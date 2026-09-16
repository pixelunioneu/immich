import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import Cursor from 'pg-cursor';
import type { DB } from 'src/schema';
import type { Config } from './config.js';
import { FrontdoorError, TenantDatabaseUnavailable } from './errors.js';
import { metrics } from './metrics.js';
import { databaseForTenant } from './tenant.js';

/**
 * The service talks to thousands of tenant databases through one role, so it cannot
 * hold a pool for each. It keeps a bounded, least-recently-used set of pools that
 * start empty (`min: 0`), and closes them once a tenant goes quiet.
 */

type Entry = {
  pool: pg.Pool;
  db: Kysely<DB>;
  lastUsed: number;
  /** Resolves once the connection has been confirmed to be the right database. */
  verified: Promise<void>;
};

export class TenantPools {
  private entries = new Map<string, Entry>();
  private failures = new Map<string, { count: number; openUntil: number }>();
  private reaper?: NodeJS.Timeout;

  constructor(private config: Config) {}

  start() {
    this.reaper = setInterval(
      () => this.reap(),
      Math.min(this.config.pool.idleMs, 60_000),
    );
    this.reaper.unref();
  }

  async stop() {
    if (this.reaper) {
      clearInterval(this.reaper);
    }
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(entries.map((entry) => entry.db.destroy()));
    this.report();
  }

  /**
   * Runs `work` against the tenant's database. Throws {@link TenantDatabaseUnavailable}
   * when the tenant is failing fast or the pool cannot be established; callers turn
   * that into a failure rather than reaching for the tenant's own instance.
   */
  async withTenant<T>(
    tenant: string,
    endpoint: string,
    work: (db: Kysely<DB>) => Promise<T>,
  ): Promise<T> {
    const breaker = this.failures.get(tenant);
    if (breaker && breaker.openUntil > Date.now()) {
      throw new TenantDatabaseUnavailable('circuit_open');
    }

    const entry = this.acquire(tenant);
    const started = process.hrtime.bigint();

    try {
      await entry.verified;
      const result = await work(entry.db);
      this.failures.delete(tenant);
      return result;
    } catch (error) {
      // Three kinds of failure, kept apart on purpose:
      //  - a deliberate error (a 400, or an already-classified 503) passes
      //    through and does not count against the tenant;
      //  - a driver error is the database failing: it trips the breaker and
      //    becomes a 503 with a one-line log, not a stack trace per request;
      //  - anything else is a bug in this service and must surface as a 500,
      //    not be dressed up as an outage.
      if (error instanceof FrontdoorError) {
        throw error;
      }
      if (isDriverError(error)) {
        this.recordFailure(tenant);
        throw new TenantDatabaseUnavailable(driverReason(error));
      }
      throw error;
    } finally {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      metrics.observe('frontdoor_db_latency_seconds', seconds, { endpoint });
    }
  }

  private acquire(tenant: string): Entry {
    const existing = this.entries.get(tenant);
    if (existing) {
      existing.lastUsed = Date.now();
      // Re-insert so Map iteration order stays least-recently-used first.
      this.entries.delete(tenant);
      this.entries.set(tenant, existing);
      return existing;
    }

    if (this.totalConnections() >= this.config.pool.maxConnections) {
      this.evictOldest();
    }
    while (this.entries.size >= this.config.pool.maxPools) {
      this.evictOldest();
    }

    const database = databaseForTenant(tenant, this.config.databasePrefix);
    const pool = new pg.Pool({
      // The database MUST be carried in the connection string, not passed
      // alongside it. `pg` resolves the two with
      // `Object.assign({}, config, parse(config.connectionString))`, so anything
      // parsed out of the string overrides the explicit option - including the
      // `database: null` it emits for a URL with no path. Passing both silently
      // sends every tenant to the same database while leaving the tenant
      // validation looking correct.
      connectionString: connectionStringFor(this.config.databaseUrl, database),
      min: 0,
      max: this.config.pool.maxPerPool,
      idleTimeoutMillis: this.config.pool.idleMs,
      connectionTimeoutMillis: this.config.queryTimeoutMs * 4,
      statement_timeout: this.config.queryTimeoutMs,
      query_timeout: this.config.queryTimeoutMs,
      application_name: 'immich-frontdoor',
    });

    // A pool-level error must never take the process down: the tenant fails, not the fleet.
    pool.on('error', () => this.recordFailure(tenant));

    // The server's sync repository streams its queries; with `pg` that needs a
    // cursor implementation on the dialect.
    const db = new Kysely<DB>({
      dialect: new PostgresDialect({ pool, cursor: Cursor }),
    });

    // Checked once per pool, before the pool is used for anything. Makes the
    // tenant-to-database mapping load-bearing at runtime rather than trusting
    // that the connection options were assembled correctly.
    const verified = verifyDatabase(db, database);

    const entry: Entry = { pool, db, lastUsed: Date.now(), verified };

    // A failed check counts as a database failure, and the entry is dropped so
    // the next request builds a fresh pool and tries again. Without this a
    // transient failure - a timeout during a database restart, say - would leave
    // a permanently rejected promise in place, and because every request
    // refreshes lastUsed the reaper would never evict it while traffic kept
    // coming. This handler also marks the rejection observed: a pool evicted
    // before any request awaits it would otherwise crash the process.
    verified.catch(() => {
      this.recordFailure(tenant);
      if (this.entries.get(tenant) === entry) {
        this.close(tenant);
      }
    });

    this.entries.set(tenant, entry);
    this.report();
    return entry;
  }

  private recordFailure(tenant: string) {
    const current = this.failures.get(tenant) ?? { count: 0, openUntil: 0 };
    const count = current.count + 1;
    const openUntil =
      count >= this.config.breaker.threshold
        ? Date.now() + this.config.breaker.resetMs
        : 0;
    this.failures.set(tenant, { count, openUntil });
    this.report();
  }

  private evictOldest() {
    const oldest = this.entries.keys().next();
    if (oldest.done) {
      return;
    }
    this.close(oldest.value);
  }

  private reap() {
    const cutoff = Date.now() - this.config.pool.idleMs;
    for (const [tenant, entry] of this.entries) {
      if (entry.lastUsed < cutoff) {
        this.close(tenant);
      }
    }
    for (const [tenant, breaker] of this.failures) {
      if (breaker.openUntil !== 0 && breaker.openUntil < Date.now()) {
        this.failures.delete(tenant);
      }
    }
    this.report();
  }

  private close(tenant: string) {
    const entry = this.entries.get(tenant);
    if (!entry) {
      return;
    }
    this.entries.delete(tenant);
    void entry.db.destroy().catch(() => undefined);
    this.report();
  }

  private totalConnections() {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.pool.totalCount;
    }
    return total;
  }

  private report() {
    metrics.setGauge('frontdoor_pools_open', this.entries.size);
    metrics.setGauge('frontdoor_connections_open', this.totalConnections());
    let open = 0;
    for (const breaker of this.failures.values()) {
      if (breaker.openUntil > Date.now()) {
        open++;
      }
    }
    metrics.setGauge('frontdoor_breakers_open', open);
  }
}

/** A short, stable label for a driver failure, suitable for a metric label. */
const driverReason = (error: unknown): string => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code.toLowerCase() : 'query_failed';
};

/**
 * Puts the database in the connection string's path.
 *
 * Exported so it can be tested directly: getting this wrong does not fail, it
 * quietly serves every tenant from one database.
 */
export const connectionStringFor = (
  baseUrl: string,
  database: string,
): string => {
  const url = new URL(baseUrl);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
};

/**
 * Asks the server which database it actually opened and refuses to proceed if it
 * is not the one intended. A mismatch here would be a cross-tenant read, so it
 * fails closed.
 */
const verifyDatabase = async (
  db: Kysely<DB>,
  expected: string,
): Promise<void> => {
  let actual: string | undefined;
  try {
    const row = await sql<{
      current: string;
    }>`select current_database() as current`.execute(db);
    actual = row.rows[0]?.current;
  } catch (error) {
    // Classified here so the awaiting caller sees one FrontdoorError and the
    // failure is counted exactly once, by the handler attached in acquire().
    throw new TenantDatabaseUnavailable(driverReason(error));
  }
  if (actual !== expected) {
    throw new TenantDatabaseUnavailable('database_mismatch');
  }
};

/**
 * pg sets a string `code` on every error it raises: an errno such as
 * ECONNREFUSED on connection failures, a SQLSTATE on query failures. A bug in
 * this service throws a TypeError or similar, which has none.
 */
const isDriverError = (error: unknown): boolean =>
  typeof (error as { code?: unknown })?.code === 'string';
