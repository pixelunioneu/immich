import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectionStringFor } from '../src/db.js';

/**
 * These assert the tenant-to-database mapping survives all the way into the
 * driver. An earlier version passed the database as an option alongside
 * `connectionString`, which `pg` silently discards: every tenant connected to
 * the same database while `tenantFromHost` and `databaseForTenant` still looked
 * correct and still passed their own tests. Testing the pure functions alone
 * does not catch that, so these go through pg's own resolution.
 */
const resolvedDatabase = (config: pg.ClientConfig): string | undefined =>
  new pg.Client(config).database;

describe('connectionStringFor', () => {
  it.each([
    ['no path', 'postgres://u:p@host:5432'],
    ['a trailing slash', 'postgres://u:p@host:5432/'],
    ['an existing database', 'postgres://u:p@host:5432/something-else'],
  ])(
    'puts the tenant database in the path, given a base with %s',
    (_label, base) => {
      const connectionString = connectionStringFor(base, 'db-acme');
      expect(resolvedDatabase({ connectionString })).toBe('db-acme');
    },
  );

  it('keeps credentials, host and port from the base', () => {
    const client = new pg.Client({
      connectionString: connectionStringFor(
        'postgres://u:p@host:6543',
        'db-acme',
      ),
    });
    expect(client.host).toBe('host');
    expect(client.port).toBe(6543);
    expect(client.user).toBe('u');
  });

  it('escapes a database name so it cannot alter the URL', () => {
    // databaseForTenant rejects these before they reach here; this is the
    // second line of defence, asserting the name stays confined to the path.
    const connectionString = connectionStringFor(
      'postgres://u:p@host:5432',
      'a/b?c#d',
    );
    expect(new URL(connectionString).pathname).toBe('/a%2Fb%3Fc%23d');
    expect(new URL(connectionString).host).toBe('host:5432');
  });

  it('documents why the database is not passed as a separate option', () => {
    // pg resolves via Object.assign({}, config, parse(connectionString)), so the
    // parsed value wins - including the null it emits for a pathless URL, which
    // makes pg fall back to the role name. Regressing to this shape is the bug.
    expect(
      resolvedDatabase({
        connectionString: 'postgres://u:p@host:5432',
        database: 'db-acme',
      }),
    ).not.toBe('db-acme');
  });
});
