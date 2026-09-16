import { Kysely, sql } from 'kysely';
import { SyncRepository } from 'src/repositories/sync.repository';
import type { DB } from 'src/schema';
import { SyncService } from 'src/services/sync.service';
import type {
  LoggerLike,
  SessionLike,
  SyncCheckpointLike,
  SyncServiceDeps,
} from './shims/base.service.js';

/**
 * Builds the server's own `SyncService` on a tenant database.
 *
 * The service is bundled from the server sources unchanged (see the shims in
 * vite.config.ts), so every rule in `streamInternal`, `setAcks` and friends is
 * upstream's code, not a copy of it. What this file supplies is the handful of
 * repository methods the service reaches for, each a single query lifted from
 * the corresponding server repository.
 *
 * `live` performs writes. `dry-run` turns every write into a {@link Busy} so a
 * stream can be evaluated inside a rolled-back transaction: if the server would
 * have written anything while serving it, the tenant's own instance must do it.
 */

export class Busy extends Error {
  constructor(readonly reason: string) {
    super(`Stream would not be empty: ${reason}`);
  }
}

const noopLogger: LoggerLike = {
  debug: () => undefined,
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  setContext: () => undefined,
};

/** Mirrors `SyncCheckpointRepository`. */
const checkpoints = (db: Kysely<DB>, dryRun: boolean): SyncCheckpointLike => ({
  getAll: (sessionId) =>
    db
      .selectFrom('session_sync_checkpoint')
      .select(['type', 'ack'])
      .where('sessionId', '=', sessionId)
      .execute(),

  getNow: () =>
    db
      .selectNoFrom((eb) => [
        eb
          .fn<string>('immich_uuid_v7', [
            sql.raw<Date>("now() - interval '1 millisecond'"),
          ])
          .as('nowId'),
      ])
      .executeTakeFirstOrThrow(),

  upsertAll: (items) => {
    if (dryRun) {
      throw new Busy('write');
    }
    return db
      .insertInto('session_sync_checkpoint')
      .values(items as never)
      .onConflict((oc) =>
        oc.columns(['sessionId', 'type']).doUpdateSet((eb) => ({
          ack: eb.ref('excluded.ack'),
        })),
      )
      .execute();
  },

  deleteAll: (sessionId, types) => {
    if (dryRun) {
      throw new Busy('write');
    }
    return db
      .deleteFrom('session_sync_checkpoint')
      .where('sessionId', '=', sessionId)
      .$if(!!types, (qb) => qb.where('type', 'in', types as never[]))
      .execute();
  },
});

/** Mirrors the two `SessionRepository` methods the sync service uses. */
const sessions = (db: Kysely<DB>, dryRun: boolean): SessionLike => ({
  isPendingSyncReset: async (id) => {
    const row = await db
      .selectFrom('session')
      .select(['isPendingSyncReset'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row?.isPendingSyncReset ?? false;
  },

  resetSyncProgress: (sessionId) => {
    if (dryRun) {
      throw new Busy('write');
    }
    return db
      .transaction()
      .execute((tx) =>
        Promise.all([
          tx
            .updateTable('session')
            .set({ isPendingSyncReset: false })
            .where('id', '=', sessionId)
            .execute(),
          tx
            .deleteFrom('session_sync_checkpoint')
            .where('sessionId', '=', sessionId)
            .execute(),
        ]),
      );
  },
});

export const syncService = (
  db: Kysely<DB>,
  mode: 'live' | 'dry-run',
): SyncService => {
  const dryRun = mode === 'dry-run';
  const deps: SyncServiceDeps = {
    logger: noopLogger,
    syncRepository: new SyncRepository(db),
    syncCheckpointRepository: checkpoints(db, dryRun),
    sessionRepository: sessions(db, dryRun),
  };
  // Built without running a constructor. In the bundle `BaseService` is the shim
  // and would accept `deps` as-is; in the server's own test suite, where this
  // file is imported unbundled, it is the real one and takes 56 repositories by
  // position. Skipping the constructor makes the two identical: an instance
  // with exactly the four fields the sync service reads.
  return Object.assign(Object.create(SyncService.prototype), deps);
};
