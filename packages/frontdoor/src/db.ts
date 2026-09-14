import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from 'src/schema';
import type { Config } from './config.js';
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
};

export class TenantDatabaseUnavailable extends Error {
  constructor(readonly reason: string) {
    super(`Tenant database unavailable: ${reason}`);
  }
}

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
      throw new TenantDatabaseUnavailable('circuit open');
    }

    const entry = this.acquire(tenant);
    const started = process.hrtime.bigint();

    try {
      const result = await work(entry.db);
      this.failures.delete(tenant);
      return result;
    } catch (error) {
      this.recordFailure(tenant);
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
      connectionString: this.config.databaseUrl,
      database,
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

    const entry: Entry = {
      pool,
      db: new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }),
      lastUsed: Date.now(),
    };

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
