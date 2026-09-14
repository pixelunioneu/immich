/**
 * Configuration is entirely environment-driven. The service holds one database
 * role for the whole fleet and selects a tenant's database by name, so there is
 * no per-tenant secret material anywhere in this package.
 */

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const number = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got: ${raw}`);
  }
  return value;
};

export type Config = ReturnType<typeof loadConfig>;

export const loadConfig = () => ({
  port: number('FRONTDOOR_PORT', 8080),

  /**
   * Base connection for the shared role, e.g.
   * `postgres://user:pass@postgres.internal:5432`.
   * The database name is appended per request from the tenant in the Host header.
   */
  databaseUrl: required('FRONTDOOR_DATABASE_URL'),

  /** Apex domain tenants live under, e.g. `example.com`. */
  baseDomain: required('FRONTDOOR_BASE_DOMAIN'),

  /**
   * Prefix applied to a tenant name to get its database name. Empty by default:
   * the naming convention belongs to the deployment, not to this package.
   */
  databasePrefix: process.env.FRONTDOOR_DATABASE_PREFIX ?? '',

  /** Version reported by /api/server/version. Set from the deployed server image. */
  immichVersion: required('FRONTDOOR_IMMICH_VERSION'),

  pool: {
    /** Most tenants kept warm at once. Beyond this the least-recently-used is closed. */
    maxPools: number('FRONTDOOR_MAX_POOLS', 256),
    /** Connections per tenant pool. */
    maxPerPool: number('FRONTDOOR_MAX_PER_POOL', 2),
    /** Close a tenant's pool after this long without a request. */
    idleMs: number('FRONTDOOR_POOL_IDLE_MS', 5 * 60 * 1000),
    /** Fleet-wide ceiling, well under the server's max_connections. */
    maxConnections: number('FRONTDOOR_MAX_CONNECTIONS', 1000),
  },

  /** Per-request database timeout. Anything slower is a failure, not a wait. */
  queryTimeoutMs: number('FRONTDOOR_QUERY_TIMEOUT_MS', 250),

  /** Consecutive failures before a tenant is failed fast, and for how long. */
  breaker: {
    threshold: number('FRONTDOOR_BREAKER_THRESHOLD', 5),
    resetMs: number('FRONTDOOR_BREAKER_RESET_MS', 30_000),
  },
});

/**
 * Mirrors `ServerVersionResponseDto.fromSemVer`: semver splits the pre-release on
 * `.` and the server reports the second identifier, which is `null` for a release.
 */
export const parseVersion = (version: string) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version);
  if (!match) {
    throw new Error(`Could not parse version: ${version}`);
  }

  const [, major, minor, patch, prerelease] = match;
  const identifier = prerelease?.split('.')[1];
  const asNumber = identifier === undefined ? Number.NaN : Number(identifier);

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: Number.isInteger(asNumber) ? asNumber : null,
  };
};
