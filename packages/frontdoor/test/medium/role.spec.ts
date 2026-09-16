import { readFileSync } from 'node:fs';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import Cursor from 'pg-cursor';
import { SyncRequestType } from 'src/enum';
import { DB } from 'src/schema';
import { SYNC_TYPES_ORDER } from 'src/services/sync.service';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB, wait } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';
import { decide } from '../../src/handlers/sync-stream.js';

/**
 * Two things the equivalence tests cannot show, because they run on the
 * harness's superuser connection over postgres-js:
 *
 * 1. The production driver path. The front door talks `pg` with a cursor for
 *    the sync repository's streamed queries; this runs the decision over exactly
 *    that dialect.
 * 2. The production role. Given the SQL that grants the deployment's database
 *    role its privileges (path in `IMMICH_FRONTDOOR_GRANTS_SQL`), the decision
 *    runs as that role over every sync type and must not hit a single permission
 *    error, while the columns it was never granted stay out of reach.
 *
 * The grants belong to the deployment, not to this package, so that half is
 * skipped unless the file is supplied. Run it before changing either side.
 */

const GRANTS = process.env.IMMICH_FRONTDOOR_GRANTS_SQL;
const ROLE = 'immich-frontdoor';
const PASSWORD = 'frontdoor-test';

const ALL_TYPES = SYNC_TYPES_ORDER.filter(
  (type) =>
    ![
      SyncRequestType.AssetsV1,
      SyncRequestType.AssetFacesV1,
      SyncRequestType.PartnerAssetsV1,
      SyncRequestType.AlbumAssetsV1,
    ].includes(type),
);

let harness: Kysely<DB>;

/** The front door's own dialect, as in src/db.ts, on the harness database. */
const frontdoorDb = async (user: string, password: string) => {
  const { current } = await sql<{
    current: string;
  }>`select current_database() as current`
    .execute(harness)
    .then((r) => r.rows[0]);
  const url = new URL(process.env.IMMICH_TEST_POSTGRES_URL!);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  url.pathname = `/${encodeURIComponent(current)}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool, cursor: Cursor }),
  });
};

beforeAll(async () => {
  harness = await getKyselyDB();
});

const setup = async () => {
  const ctx = new SyncTestContext(harness);
  const { auth } = await ctx.newSyncAuthUser();
  const session = { sessionId: auth.session!.id, userId: auth.user.id };
  return { ctx, auth, session };
};

describe('over pg with a cursor', () => {
  it('decides every type on the production driver', async () => {
    const { ctx, auth, session } = await setup();
    const db = await frontdoorDb('postgres', 'postgres');
    try {
      await wait(2);
      // A fresh user is itself an unsynced row for AuthUsersV1; a type with
      // nothing behind it is the empty case.
      await expect(
        decide(db, session, { types: ALL_TYPES }, 10_000),
      ).resolves.toEqual({ kind: 'busy', reason: 'AuthUserV1' });
      await expect(
        decide(db, session, { types: [SyncRequestType.StacksV1] }, 10_000),
      ).resolves.toMatchObject({ kind: 'empty' });

      await ctx.newAsset({ ownerId: auth.user.id });
      await wait(2);
      await expect(
        decide(db, session, { types: [SyncRequestType.AssetsV2] }, 10_000),
      ).resolves.toEqual({ kind: 'busy', reason: 'AssetV2' });
    } finally {
      await db.destroy();
    }
  });
});

describe.skipIf(!GRANTS)('as the immich-frontdoor role', () => {
  beforeAll(async () => {
    await sql
      .raw(`CREATE ROLE "${ROLE}" LOGIN PASSWORD '${PASSWORD}'`)
      .execute(harness);
    await sql.raw(readFileSync(GRANTS!, 'utf8')).execute(harness);
  });

  it('has every grant the dry run needs, and no more', async () => {
    const { ctx, auth, session } = await setup();
    const { user: partner } = await ctx.newUser();
    await ctx.newAsset({ ownerId: partner.id });
    await ctx.newPartner({
      sharedById: partner.id,
      sharedWithId: auth.user.id,
    });
    await ctx.newAsset({ ownerId: auth.user.id });
    await wait(2);

    const db = await frontdoorDb(ROLE, PASSWORD);
    try {
      // Busy on the first type that has output; every query up to it ran as
      // the role. Then per type, so each handler's queries are exercised.
      await expect(
        decide(db, session, { types: ALL_TYPES }, 10_000),
      ).resolves.toMatchObject({
        kind: 'busy',
      });
      for (const type of ALL_TYPES) {
        const verdict = await decide(db, session, { types: [type] }, 10_000);
        expect(verdict, type).not.toMatchObject({ reason: 'db_error' });
      }

      await expect(
        sql`select "password" from "user" limit 1`.execute(db),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        sql`select "token" from "session" limit 1`.execute(db),
      ).resolves.toBeDefined();
    } finally {
      await db.destroy();
    }
  });
});
