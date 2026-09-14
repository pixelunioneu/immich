import type { Kysely } from 'kysely';
import type { DB } from 'src/schema';
import contract from '../generated/contract.json' with { type: 'json' };

/**
 * Sync checkpoints, mirroring `SyncService.getAcks`, `setAcks` and `deleteAcks`.
 *
 * The rows written here carry a database-side `updatedAt` trigger and an `updateId`
 * (uuid v7) column, so a plain upsert leaves them byte-identical to what the tenant's
 * own instance would have written. That is what keeps sync state coherent no matter
 * which of the two served the request.
 */

const SYNC_ENTITY_TYPES = new Set<string>(contract.syncEntityTypes);

const SYNC_RESET = 'SyncResetV1';

if (!SYNC_ENTITY_TYPES.has(SYNC_RESET)) {
  // Guards against upstream renaming the reset sentinel: without it a reset would
  // be rejected as an unknown type instead of clearing the session's progress.
  throw new Error(`${SYNC_RESET} is missing from the generated contract`);
}

/** Mirrors `fromAck`: `type|updateId|extraId`, split on the first two separators. */
export const ackType = (ack: string): string => ack.split('|', 3)[0] ?? '';

export class InvalidAckType extends Error {
  constructor(readonly type: string) {
    super(`Invalid ack type: ${type}`);
  }
}

export const getAcks = (db: Kysely<DB>, sessionId: string) =>
  db
    .selectFrom('session_sync_checkpoint')
    .select(['type', 'ack'])
    .where('sessionId', '=', sessionId)
    .execute();

export const setAcks = async (
  db: Kysely<DB>,
  sessionId: string,
  acks: string[],
): Promise<void> => {
  const checkpoints = new Map<
    string,
    { sessionId: string; type: never; ack: string }
  >();

  for (const ack of acks) {
    const type = ackType(ack);

    // A reset short-circuits the whole request: remaining acks are ignored, exactly
    // as upstream does.
    if (type === SYNC_RESET) {
      await resetSyncProgress(db, sessionId);
      return;
    }

    if (!SYNC_ENTITY_TYPES.has(type)) {
      throw new InvalidAckType(type);
    }

    // Last ack per type wins. Upstream carries a TODO about picking the latest
    // instead; this deliberately reproduces the current behaviour rather than
    // diverging from the instance it stands in for.
    checkpoints.set(type, { sessionId, type: type as never, ack });
  }

  if (checkpoints.size === 0) {
    return;
  }

  await db
    .insertInto('session_sync_checkpoint')
    .values([...checkpoints.values()])
    .onConflict((oc) =>
      oc
        .columns(['sessionId', 'type'])
        .doUpdateSet((eb) => ({ ack: eb.ref('excluded.ack') })),
    )
    .execute();
};

export const deleteAcks = async (
  db: Kysely<DB>,
  sessionId: string,
  types?: string[],
): Promise<void> => {
  let query = db
    .deleteFrom('session_sync_checkpoint')
    .where('sessionId', '=', sessionId);
  if (types && types.length > 0) {
    query = query.where('type', 'in', types as never[]);
  }
  await query.execute();
};

/** Mirrors `SessionRepository.resetSyncProgress`. */
export const resetSyncProgress = (db: Kysely<DB>, sessionId: string) =>
  db.transaction().execute(async (tx) => {
    await tx
      .updateTable('session')
      .set({ isPendingSyncReset: false })
      .where('id', '=', sessionId)
      .execute();
    await tx
      .deleteFrom('session_sync_checkpoint')
      .where('sessionId', '=', sessionId)
      .execute();
  });
