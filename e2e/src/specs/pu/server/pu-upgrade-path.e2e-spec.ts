import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { containers, dockerExec, repoRoot } from 'src/pu/helpers.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Upgrade path: a database at the schema of the last fork release must migrate cleanly
 * with the server under test. The fixture is a dump of a fresh v3.3.5-pu7 database, see
 * e2e/pu/fixtures/README.md. While the server has no newer migrations this only proves
 * the fixture loads and matches; once an upstream merge adds migrations, it runs them.
 */
const fixture = resolve(repoRoot, 'e2e/pu/fixtures/v3.3.5-pu7-schema.sql');
const database = 'immich_pu_upgrade';

const psql = (sql: string, dbName = 'postgres') =>
  dockerExec(containers.database, ['psql', '-tA', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', dbName, '-c', sql]);

const immichAdmin = (command: string, dbName = database) =>
  dockerExec(containers.server, ['immich-admin', command], { env: { DB_DATABASE_NAME: dbName } });

/** The `  - IndexCreate: ...` lines of a schema-check report. */
const drift = (output: string) => output.split('\n').filter((line) => line.startsWith('  - '));

describe('PixelUnion upgrade path from v3.3.5-pu7', () => {
  beforeAll(async () => {
    await psql(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    const created = await psql(`CREATE DATABASE ${database}`);
    expect(created.exitCode, created.stderr).toBe(0);

    const restored = await dockerExec(
      containers.database,
      ['psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database],
      { input: readFileSync(fixture, 'utf8') },
    );
    expect(restored.exitCode, restored.stderr).toBe(0);
  }, 60_000);

  afterAll(async () => {
    await psql(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  });

  it('starts from a database with migration history', async () => {
    const { stdout } = await psql('SELECT count(*) FROM kysely_migrations', database);
    expect(Number(stdout.trim())).toBeGreaterThan(100);
  });

  it('runs the migrations cleanly', async () => {
    const { exitCode, stdout, stderr } = await immichAdmin('db-migrate');
    expect(exitCode, stdout + stderr).toBe(0);
  }, 120_000);

  it('ends up with every migration applied', async () => {
    // schema-check catches its own errors and exits 0, so the output is what counts.
    const { stdout, stderr } = await immichAdmin('schema-check', database);
    expect(stdout, stderr).toContain('Migrations are up to date');
  }, 60_000);

  it('ends up with the same schema drift report as a fresh database', async () => {
    // Compared with the e2e database, which the server under test migrated from empty.
    // Any drift that schema-check reports must be the same on both, so an upgrade adds
    // none of its own.
    const upgraded = await immichAdmin('schema-check', database);
    const fresh = await immichAdmin('schema-check', 'immich');
    expect(drift(upgraded.stdout)).toEqual(drift(fresh.stdout));
  }, 60_000);
});
