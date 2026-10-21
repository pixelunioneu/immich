import { Writable } from 'node:stream';
import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AlbumUserRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { SyncCheckpointRepository } from 'src/repositories/sync-checkpoint.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { SYNC_TYPES_ORDER } from 'src/services/sync.service';
import { toAck } from 'src/utils/sync';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB, wait } from 'test/utils';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setAcks } from '../../src/handlers/sync-ack.js';
import { decide, type Verdict } from '../../src/handlers/sync-stream.js';
import { frontdoorDb } from './frontdoor-db.js';

/**
 * The property the whole of Phase 2 rests on: what the front door sends is what
 * the server's own stream would have sent, line for line, and it says "busy"
 * exactly when serving would have needed a write or more than the cap. Both
 * sides run upstream's `SyncService` on the same database, the server on its
 * own driver (postgres.js) and the front door on its production pool (pg, from
 * src/db.ts), so what is under test is the sentinel, the dry-run stubs, the
 * read-only transaction and the driver, not sync itself.
 *
 * Scenarios are the ones the server's own sync specs use for backfill, because
 * that is where a naive check goes wrong: output can come from an entity created
 * after a checkpoint, not only from rows newer than it.
 */

let defaultDatabase: Kysely<DB>;
/** Where the front door's side runs. */
let frontdoor: Kysely<DB>;

const MAX_BYTES = 64 * 1024;

const ALL_TYPES = SYNC_TYPES_ORDER.filter(
  (type) =>
    ![
      SyncRequestType.AssetsV1,
      SyncRequestType.AssetFacesV1,
      SyncRequestType.PartnerAssetsV1,
      SyncRequestType.AlbumAssetsV1,
    ].includes(type),
);

type Line = { type: string; ack: string; data: unknown };

const parseLines = (body: string): Line[] =>
  body
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Line);

/**
 * Each run acks its terminating line with its own transaction's `now()`, so
 * that one id differs by construction. It is the only part of a body masked.
 */
const withoutNowId = (body: string) => {
  const complete = new RegExp(
    `"ack":"${SyncEntityType.SyncCompleteV1}\\|[^"]+"`,
  );
  expect(body).toMatch(complete);
  return body.replace(complete, '"ack":"<nowId>"');
};

class Context extends SyncTestContext {
  async decide(
    auth: { session?: { id: string }; user: { id: string } },
    types: SyncRequestType[],
    reset?: boolean,
    maxBytes = MAX_BYTES,
  ): Promise<Verdict> {
    // Same settling time the harness gives `syncStream`: `nowId` is `now() - 1ms`,
    // so a row written in the same millisecond is invisible to both sides.
    await wait(2);
    return decide(
      frontdoor,
      { sessionId: auth.session!.id, userId: auth.user.id },
      { types, reset },
      10_000,
      maxBytes,
    );
  }

  /** The server's own stream, as the bytes it writes to the response. */
  async serverBody(
    auth: Parameters<Context['decide']>[0],
    types: SyncRequestType[],
  ) {
    const chunks: string[] = [];
    const response = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(String(chunk));
        done();
      },
    });
    await wait(2);
    await this.sut.stream(auth as never, response, { types });
    return chunks.join('');
  }

  /**
   * Runs both sides and asserts they agree: an answered stream is the server's
   * output line for line, and a relay is for a structural reason. Returns both.
   */
  async agree(
    auth: Parameters<Context['decide']>[0],
    types: SyncRequestType[],
  ) {
    const before = await this.checkpoints(auth.session!.id);
    const verdict = await this.decide(auth, types);
    expect(await this.checkpoints(auth.session!.id)).toEqual(before);

    const stream: Line[] = await this.syncStream(auth as never, types);

    switch (verdict.kind) {
      case 'reset': {
        expect(stream).toEqual([
          expect.objectContaining({ type: SyncEntityType.SyncResetV1 }),
        ]);
        break;
      }
      case 'empty':
      case 'served': {
        // The two runs take their own `now()`, so the terminating line's ack
        // differs by construction; every other line has to match exactly.
        expect(parseLines(verdict.body)).toEqual(
          stream.map((line) =>
            line.type === SyncEntityType.SyncCompleteV1
              ? {
                  ...line,
                  ack: expect.stringMatching(
                    `^${SyncEntityType.SyncCompleteV1}\\|`,
                  ),
                }
              : line,
          ),
        );
        const types = new Set(
          stream
            .map((line) => line.type)
            .filter((type) => type !== SyncEntityType.SyncCompleteV1),
        );
        expect(new Set(verdict.types)).toEqual(types);
        expect(verdict.kind).toBe(types.size === 0 ? 'empty' : 'served');
        break;
      }
      case 'busy': {
        expect(['write', 'large']).toContain(verdict.reason);
        break;
      }
    }
    return { verdict, stream };
  }

  /** Acks a served body the way the mobile client does: last ack per type. */
  async ackServed(auth: Parameters<Context['decide']>[0], verdict: Verdict) {
    expect(verdict.kind).toBe('served');
    if (verdict.kind !== 'served') {
      return;
    }
    const acks: Record<string, string> = {};
    const syncAcks: string[] = [];
    for (const { type, ack } of parseLines(verdict.body)) {
      if (type === SyncEntityType.SyncAckV1) {
        syncAcks.push(ack);
        continue;
      }
      acks[type] = ack;
    }
    await setAcks(
      this.database,
      { sessionId: auth.session!.id, userId: auth.user.id },
      [...Object.values(acks), ...syncAcks],
    );
  }

  checkpoints(sessionId: string) {
    return this.database
      .selectFrom('session_sync_checkpoint')
      .selectAll()
      .where('sessionId', '=', sessionId)
      .orderBy('type')
      .execute();
  }
}

const setup = async () => {
  const ctx = new Context(defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  frontdoor = await frontdoorDb(defaultDatabase);
});

afterAll(async () => {
  await frontdoor?.destroy();
});

describe('decide', () => {
  it('is empty for a fresh session with nothing to sync', async () => {
    const { auth, ctx } = await setup();
    const { verdict } = await ctx.agree(auth, [SyncRequestType.AssetsV2]);
    expect(verdict.kind).toBe('empty');
  });

  it('agrees with the server for every type at once on a fresh session', async () => {
    const { auth, ctx } = await setup();
    await ctx.agree(auth, ALL_TYPES);
  });

  it('serves the stream once the user has an asset, and is empty after it is acked', async () => {
    const { auth, ctx } = await setup();
    await ctx.newAsset({ ownerId: auth.user.id });
    await wait(2);

    const { verdict, stream } = await ctx.agree(auth, [
      SyncRequestType.AssetsV2,
    ]);
    expect(stream.length).toBeGreaterThan(1);
    expect(verdict).toMatchObject({
      kind: 'served',
      types: [SyncEntityType.AssetV2],
    });

    // With no room for entity lines the same stream relays, naming its type.
    await expect(
      ctx.decide(auth, [SyncRequestType.AssetsV2], undefined, 0),
    ).resolves.toEqual({
      kind: 'busy',
      reason: 'large',
      types: [SyncEntityType.AssetV2],
    });

    await ctx.syncAckAll(auth, stream);
    const after = await ctx.agree(auth, [SyncRequestType.AssetsV2]);
    expect(after.verdict.kind).toBe('empty');
  });

  it('serves the user rows a usage sync rewrites, and is empty once they are acked', async () => {
    // The loop this change breaks: the tenant's nightly tasks run
    // `UserRepository.syncUsage()` after every boot, which rewrites every user
    // row and bumps its updateId whether usage changed or not. Each device then
    // has two small lines to fetch, which until now meant a wake.
    const { auth, user, ctx } = await setup();
    const types = [SyncRequestType.AuthUsersV2, SyncRequestType.UsersV1];

    // A fresh session fetches the user's own row first.
    const first = await ctx.agree(auth, types);
    expect(first.verdict.kind).toBe('served');
    await ctx.ackServed(auth, first.verdict);
    const settled = await ctx.agree(auth, types);
    expect(settled.verdict.kind).toBe('empty');

    await ctx.get(UserRepository).syncUsage(user.id);
    await wait(2);

    const bumped = await ctx.agree(auth, types);
    expect(bumped.verdict).toMatchObject({
      kind: 'served',
      types: expect.arrayContaining([
        SyncEntityType.AuthUserV2,
        SyncEntityType.UserV1,
      ]),
    });
    expect(bumped.stream.map((line) => line.type)).toEqual([
      SyncEntityType.AuthUserV2,
      SyncEntityType.UserV1,
      SyncEntityType.SyncCompleteV1,
    ]);

    await ctx.ackServed(auth, bumped.verdict);
    const acked = await ctx.agree(auth, types);
    expect(acked.verdict.kind).toBe('empty');
  });

  it("sends the server's bytes for its bigint, date and timestamp columns", async () => {
    // These read the same on both sides only because src/db.ts gives pg the
    // server's parsers. pg's defaults send a bigint as a string, which the
    // mobile client's generated model reads as null, and a date as midnight in
    // this process's zone. The zone is pinned east of UTC, where that midnight
    // is the day before, so the date is checked on a machine running in UTC too.
    vi.stubEnv('TZ', 'Pacific/Auckland');
    try {
      const { auth, user, ctx } = await setup();
      await ctx.database
        .updateTable('user')
        .set({
          quotaSizeInBytes: 10 * 1024 ** 3,
          quotaUsageInBytes: 1_234_567_890_123,
        })
        .where('id', '=', user.id)
        .execute();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({
        assetId: asset.id,
        fileSizeInByte: 5_000_000_000,
        // Microseconds, which both drivers have to drop the same way.
        dateTimeOriginal: '2021-03-04 05:06:07.123456+00',
        modifyDate: '2021-03-04 06:07:08.654321+02',
      });
      await ctx.newPerson({ ownerId: user.id, birthDate: '1990-05-20' });
      const types = [
        SyncRequestType.AuthUsersV2,
        SyncRequestType.UsersV1,
        SyncRequestType.AssetsV2,
        SyncRequestType.AssetExifsV1,
        SyncRequestType.PeopleV1,
      ];

      const verdict = await ctx.decide(auth, types);
      const server = await ctx.serverBody(auth, types);

      expect(verdict).toMatchObject({ kind: 'served' });
      const { body } = verdict as Extract<Verdict, { kind: 'served' }>;
      expect(withoutNowId(body)).toBe(withoutNowId(server));

      const data = (type: SyncEntityType) =>
        parseLines(body).find((line) => line.type === type)?.data;
      expect(data(SyncEntityType.AuthUserV2)).toMatchObject({
        quotaSizeInBytes: 10 * 1024 ** 3,
        quotaUsageInBytes: 1_234_567_890_123,
      });
      expect(data(SyncEntityType.AssetExifV1)).toMatchObject({
        fileSizeInByte: 5_000_000_000,
        dateTimeOriginal: '2021-03-04T05:06:07.123Z',
        modifyDate: '2021-03-04T04:07:08.654Z',
      });
      expect(data(SyncEntityType.PersonV1)).toMatchObject({
        birthDate: '1990-05-20T00:00:00.000Z',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('is reset when the session has a pending reset', async () => {
    const { auth, session, ctx } = await setup();
    await ctx.database
      .updateTable('session')
      .set({ isPendingSyncReset: true })
      .where('id', '=', session.id)
      .execute();
    const { verdict } = await ctx.agree(auth, [SyncRequestType.AssetsV2]);
    expect(verdict.kind).toBe('reset');
  });

  it('is reset when the complete checkpoint is older than the server allows', async () => {
    const { auth, session, ctx } = await setup();
    const updateId = v7({
      msecs: DateTime.now().minus({ days: 60 }).toMillis(),
    });
    await ctx.get(SyncCheckpointRepository).upsertAll([
      {
        type: SyncEntityType.SyncCompleteV1,
        sessionId: session.id,
        ack: toAck({ type: SyncEntityType.SyncCompleteV1, updateId }),
      },
    ]);
    const { verdict } = await ctx.agree(auth, [SyncRequestType.AssetsV2]);
    expect(verdict.kind).toBe('reset');
  });

  it('is busy when the client asks for a reset, and writes nothing', async () => {
    const { auth, session, ctx } = await setup();
    await ctx.get(SyncCheckpointRepository).upsertAll([
      {
        type: SyncEntityType.AssetV2,
        sessionId: session.id,
        ack: 'AssetV2|x',
      },
    ]);
    const before = await ctx.checkpoints(session.id);
    await expect(
      ctx.decide(auth, [SyncRequestType.AssetsV2], true),
    ).resolves.toEqual({ kind: 'busy', reason: 'write', types: [] });
    expect(await ctx.checkpoints(session.id)).toEqual(before);
  });

  it('follows the partner backfill exactly as the server does', async () => {
    // Mirrors "should backfill partner assets when a partner shared their
    // library with you" in server/test/medium/specs/sync/sync-partner-asset.spec.ts
    const { auth, ctx } = await setup();
    const { user: user2 } = await ctx.newUser();
    const { user: user3 } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user3.id });
    await wait(2);
    await ctx.newAsset({ ownerId: user2.id });
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });

    const first = await ctx.agree(auth, [SyncRequestType.PartnerAssetsV2]);
    await ctx.syncAckAll(auth, first.stream);
    const settled = await ctx.agree(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(settled.verdict.kind).toBe('empty');

    // A new partner with older assets: nothing is newer than the checkpoint,
    // yet the server backfills. With an upsert checkpoint in place it writes
    // nothing of its own (the backfill-complete ack is a line for the client
    // to ack), so this is served, backfill lines and ack line included.
    await ctx.newPartner({ sharedById: user3.id, sharedWithId: auth.user.id });
    const second = await ctx.agree(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(second.stream.map((line) => line.type)).toContain(
      SyncEntityType.PartnerAssetBackfillV2,
    );
    expect(second.verdict).toMatchObject({
      kind: 'served',
      types: expect.arrayContaining([
        SyncEntityType.PartnerAssetBackfillV2,
        SyncEntityType.SyncAckV1,
      ]),
    });

    await ctx.ackServed(auth, second.verdict);
    const acked = await ctx.agree(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(acked.verdict.kind).toBe('empty');
  });

  it('is busy when the server would only write a backfill checkpoint', async () => {
    // A partner exists but the session has never acked partner assets: the
    // server streams nothing and records a backfill checkpoint. That write is
    // reason enough to let the tenant serve it.
    const { auth, ctx } = await setup();
    const { user: user2 } = await ctx.newUser();
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });
    await wait(2);

    await expect(
      ctx.decide(auth, [SyncRequestType.PartnerAssetsV2]),
    ).resolves.toEqual({ kind: 'busy', reason: 'write', types: [] });
  });

  it('follows the album backfill exactly as the server does', async () => {
    // Mirrors "should backfill album assets when a user shares an album with
    // you" in server/test/medium/specs/sync/sync-album-asset.spec.ts
    const { auth, ctx } = await setup();
    const { user: user2 } = await ctx.newUser();
    const { album: album1 } = await ctx.newAlbum({ ownerId: user2.id });
    const { album: album2 } = await ctx.newAlbum({ ownerId: user2.id });
    const { asset: asset1 } = await ctx.newAsset({ ownerId: user2.id });
    await ctx.newAlbumAsset({ albumId: album2.id, assetId: asset1.id });
    await wait(2);
    const { asset: asset2 } = await ctx.newAsset({ ownerId: user2.id });
    await ctx.newAlbumAsset({ albumId: album2.id, assetId: asset2.id });
    await wait(2);
    await ctx.newAlbumAsset({ albumId: album1.id, assetId: asset2.id });
    await wait(2);
    await ctx.newAlbumUser({
      albumId: album1.id,
      userId: auth.user.id,
      role: AlbumUserRole.Editor,
    });

    const first = await ctx.agree(auth, [SyncRequestType.AlbumAssetsV2]);
    await ctx.syncAckAll(auth, first.stream);
    const settled = await ctx.agree(auth, [SyncRequestType.AlbumAssetsV2]);
    expect(settled.verdict.kind).toBe('empty');

    await ctx.newAlbumUser({
      albumId: album2.id,
      userId: auth.user.id,
      role: AlbumUserRole.Editor,
    });
    const second = await ctx.agree(auth, [SyncRequestType.AlbumAssetsV2]);
    expect(second.stream.length).toBeGreaterThan(1);
    expect(second.verdict).toMatchObject({
      kind: 'served',
      types: expect.arrayContaining([
        SyncEntityType.AlbumAssetBackfillV2,
        SyncEntityType.SyncAckV1,
      ]),
    });

    await ctx.ackServed(auth, second.verdict);
    const acked = await ctx.agree(auth, [SyncRequestType.AlbumAssetsV2]);
    expect(acked.verdict.kind).toBe('empty');
  });
});
