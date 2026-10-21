import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { connectionStringFor, createDatabase } from '../../src/db.js';

/** The database the harness created for this spec file. */
export const harnessDatabaseName = async (harness: Kysely<DB>) => {
  const { rows } = await sql<{
    current: string;
  }>`select current_database() as current`.execute(harness);
  return rows[0].current;
};

/**
 * The front door's own pool and dialect (`createDatabase` in src/db.ts) on the
 * harness database: pg with a cursor, the server's type parsers and session
 * settings. Anything run on this reads rows the way production does, not the
 * way the harness's postgres.js connection does.
 */
export const frontdoorDb = async (
  harness: Kysely<DB>,
  user = 'postgres',
  password = 'postgres',
) => {
  const url = new URL(process.env.IMMICH_TEST_POSTGRES_URL!);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  const connectionString = connectionStringFor(
    url.toString(),
    await harnessDatabaseName(harness),
  );
  return createDatabase({ connectionString, max: 2 }).db;
};
