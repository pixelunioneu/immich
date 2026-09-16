import type { Kysely } from 'kysely';
import type { DB } from 'src/schema';
import { syncService } from '../sync-service.js';
import { type SessionAuth, toAuthDto } from './auth-dto.js';

/**
 * Sync checkpoints, served by the server's own `SyncService.getAcks`, `setAcks`
 * and `deleteAcks`, bundled unchanged. The ack parsing, the reset short-circuit,
 * last-ack-per-type and the unknown-type 400 are all upstream's code.
 *
 * The rows written carry a database-side `updatedAt` trigger and an `updateId`
 * (uuid v7) column, so the upsert leaves them byte-identical to what the tenant's
 * own instance would have written. That is what keeps sync state coherent no
 * matter which of the two served the request.
 */

export const getAcks = (db: Kysely<DB>, auth: SessionAuth) =>
  syncService(db, 'live').getAcks(toAuthDto(auth));

export const setAcks = (db: Kysely<DB>, auth: SessionAuth, acks: string[]) =>
  syncService(db, 'live').setAcks(toAuthDto(auth), { acks });

export const deleteAcks = (
  db: Kysely<DB>,
  auth: SessionAuth,
  types?: string[],
) =>
  syncService(db, 'live').deleteAcks(toAuthDto(auth), {
    types: types as never,
  });
