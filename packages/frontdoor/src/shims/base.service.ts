/**
 * Stands in for `src/services/base.service` when the server's `SyncService` is
 * bundled into this package.
 *
 * The real `BaseService` is the server's god object: it takes 56 repositories by
 * position and pulls all of them in at import time. `SyncService` only ever reaches
 * for four of them, so this shim takes those four by name and nothing else. If an
 * upstream change makes `SyncService` touch a fifth, the typecheck fails here.
 */
import type { SyncRepository } from 'src/repositories/sync.repository';

export type SyncCheckpointLike = {
  getAll(sessionId: string): Promise<Array<{ type: string; ack: string }>>;
  getNow(): Promise<{ nowId: string }>;
  upsertAll(
    items: Array<{ sessionId: string; type: string; ack: string }>,
  ): Promise<unknown>;
  deleteAll(sessionId: string, types?: string[]): Promise<unknown>;
};

export type SessionLike = {
  isPendingSyncReset(id: string): Promise<boolean>;
  resetSyncProgress(sessionId: string): Promise<unknown>;
};

export type LoggerLike = {
  debug(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  setContext(context: string): void;
};

export type SyncServiceDeps = {
  logger: LoggerLike;
  sessionRepository: SessionLike;
  syncRepository: SyncRepository;
  syncCheckpointRepository: SyncCheckpointLike;
};

export class BaseService {
  protected logger: LoggerLike;
  protected sessionRepository: SessionLike;
  protected syncRepository: SyncRepository;
  protected syncCheckpointRepository: SyncCheckpointLike;

  constructor(deps: SyncServiceDeps) {
    this.logger = deps.logger;
    this.sessionRepository = deps.sessionRepository;
    this.syncRepository = deps.syncRepository;
    this.syncCheckpointRepository = deps.syncCheckpointRepository;
  }
}
