import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { getKyselyDB, wait } from 'test/utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/config.js';
import { TenantPools } from '../../src/db.js';
import { TenantDatabaseUnavailable } from '../../src/errors.js';
import { frontdoorDb, harnessDatabaseName } from './frontdoor-db.js';

/**
 * src/db.ts on a real database: the pool reads every column type the sync
 * repository selects exactly as the server's driver does, and the failures pg
 * raises without a SQLSTATE count as the database failing, not as a bug here.
 */

let harness: Kysely<DB>;

beforeAll(async () => {
  harness = await getKyselyDB();
});

describe('createDatabase', () => {
  let frontdoor: Kysely<DB>;

  beforeAll(async () => {
    frontdoor = await frontdoorDb(harness);
  });

  afterAll(async () => {
    await frontdoor?.destroy();
  });

  it('reads every type the sync repository selects as the server does', async () => {
    // pg's default for a date is midnight in this process's zone; east of UTC
    // that is the day before, so this holds on a machine running in UTC too.
    vi.stubEnv('TZ', 'Pacific/Auckland');
    try {
      // Parameters with nothing around them to type them, as the partner asset
      // sync's `isFavorite`: their column's type is the type the driver
      // declared for them, if any.
      const query = sql`
        select
          ${false} as "boolParam",
          ${new Date('2021-03-04T05:06:07.123Z')} as "dateParam",
          ${Buffer.from([0, 255])} as "byteaParam",
          ${'text'} as "textParam",
          ${42} as "numberParam",
          ${null} as "nullParam",
          1::int2 as int2,
          2147483647::int4 as int4,
          9007199254740991::int8 as int8,
          12.75::numeric as numeric,
          1.1::float4 as float4,
          0.1::float8 as float8,
          true as bool,
          'text'::text as text,
          'varchar'::varchar as varchar,
          '0190f0e2-8c3c-7d2b-9d0c-6f9e4f0b9a11'::uuid as uuid,
          'timeline'::asset_visibility_enum as enum,
          '\\x00ff10'::bytea as bytea,
          '{"a":1}'::json as json,
          '{"b":[1,"2",null]}'::jsonb as jsonb,
          '1990-05-20'::date as date,
          '2021-03-04 05:06:07.123456'::timestamp as timestamp,
          '2021-03-04 05:06:07.123456+02'::timestamptz as timestamptz,
          current_setting('TimeZone') as "timeZone",
          current_setting('DateStyle') as "dateStyle"
      `;
      const [server] = (await query.execute(harness)).rows;
      const [front] = (await query.execute(frontdoor)).rows;

      expect(front).toEqual(server);
      // What a served body is made of.
      expect(JSON.stringify(front)).toBe(JSON.stringify(server));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('TenantPools', () => {
  const PREFIX = 'immich_';
  let pools: TenantPools;
  let tenant: string;

  beforeAll(async () => {
    // The harness names each spec file's database `immich_<suffix>`, so the
    // suffix is a tenant name under that prefix.
    tenant = (await harnessDatabaseName(harness)).slice(PREFIX.length);
    pools = new TenantPools({
      databaseUrl: process.env.IMMICH_TEST_POSTGRES_URL!,
      databasePrefix: PREFIX,
      pool: { maxPools: 4, maxPerPool: 1, idleMs: 60_000, maxConnections: 8 },
      queryTimeoutMs: 100,
      breaker: { threshold: 100, resetMs: 30_000 },
    } as Config);
  });

  afterAll(async () => {
    await pools?.stop();
  });

  it('reports a cursor that outlives the query timeout as the database failing', async () => {
    // A dry run's shape: a cursor read in a transaction, from a database
    // slower than the timeout. pg's `query_timeout` fails the pending read with
    // a plain Error. The server-side `statement_timeout`, normally racing it, is
    // lifted so the client-side one is the timeout under test.
    const work = pools.withTenant(tenant, 'test', (db) =>
      db.transaction().execute(async (trx) => {
        await sql`set local statement_timeout = 0`.execute(trx);
        const rows = trx
          .selectFrom(
            sql<{
              n: number;
            }>`(select n, pg_sleep(0.06) from generate_series(1, 5) n)`.as('t'),
          )
          .select('n')
          .stream(1);
        for await (const _ of rows) {
          // Each read waits on the database.
        }
      }),
    );

    await expect(work).rejects.toBeInstanceOf(TenantDatabaseUnavailable);
    await expect(work).rejects.toMatchObject({ reason: 'query_timeout' });
  });

  it('reports a pool with no connection to spare as the database failing', async () => {
    // One connection per pool, held by an open transaction for longer than
    // the pool waits for one (4x the query timeout).
    const holding = pools.withTenant(tenant, 'test', (db) =>
      db.transaction().execute(() => wait(1000)),
    );
    await wait(50);

    const work = pools.withTenant(tenant, 'test', (db) =>
      sql`select 1`.execute(db),
    );

    await expect(work).rejects.toBeInstanceOf(TenantDatabaseUnavailable);
    await expect(work).rejects.toMatchObject({ reason: 'connect_timeout' });
    await expect(holding).resolves.toBeUndefined();
  });
});
