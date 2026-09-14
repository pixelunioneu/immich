import contract from '../generated/contract.json' with { type: 'json' };
import { parseVersion } from '../config.js';

/**
 * The three constant endpoints. Identical for every tenant in the fleet, so they
 * are computed once at startup and need neither a database nor authentication —
 * all three are `@Authenticated({ public: true })` on the server.
 *
 * Media types come from the generated contract rather than a live import of
 * `src/utils/mime-types`: see scripts/generate-contract.ts for why.
 */
export const buildServerInfo = (immichVersion: string) => ({
  ping: { res: 'pong' },
  version: parseVersion(immichVersion),
  mediaTypes: contract.mediaTypes,
});

export type ServerInfo = ReturnType<typeof buildServerInfo>;
