import { Writable } from 'node:stream';
import type { Kysely } from 'kysely';
import type { DB } from 'src/schema';
import { HttpException } from '@nestjs/common';
import { fromAck } from 'src/utils/sync';
import contract from '../generated/contract.json' with { type: 'json' };
import { Busy, syncService } from '../sync-service.js';
import { type SessionAuth, toAuthDto } from './auth-dto.js';

/**
 * Decides whether a `sync/stream` request can be answered without the tenant's
 * own instance: only when the stream would contain nothing but its terminating
 * line, or a single reset line.
 *
 * The decision is made by running the server's real `SyncService.stream()` against
 * a sentinel writable inside a read-only transaction that is always rolled back.
 * The first line the service would send settles it; any write it would make
 * settles it too. Nothing here knows how sync works, which is the point: an
 * upstream change to the stream changes this decision on the next merge.
 *
 * The failure modes are not symmetric. Wrongly answering "busy" wakes a pod for
 * nothing; wrongly answering "empty" means a client never learns about a change.
 * So every error, timeout or doubt is "busy".
 */

export type Verdict =
  | { kind: 'empty'; nowId: string }
  | { kind: 'reset' }
  | { kind: 'busy'; reason: string };

export type StreamBody = { types: string[]; reset?: boolean };

const SYNC_REQUEST_TYPES = new Set<string>(contract.syncRequestTypes);

const COMPLETE = 'SyncCompleteV1';
const RESET = 'SyncResetV1';

/** Thrown at the end of the dry-run transaction so Kysely rolls it back. */
class Rollback extends Error {}

/** Thrown when the deadline passes; the transaction unwinds on its own. */
class Deadline extends Error {}

/**
 * Receives what the server would have sent. The terminating line and a reset are
 * the only lines an answerable stream contains; anything else ends the dry run.
 */
class Sentinel extends Writable {
  nowId?: string;
  reset = false;

  override write(chunk: unknown): boolean {
    const { type, ack } = JSON.parse(String(chunk)) as {
      type: string;
      ack: string;
    };
    if (type === COMPLETE) {
      this.nowId = fromAck(ack).updateId;
      return true;
    }
    if (type === RESET) {
      this.reset = true;
      return true;
    }
    throw new Busy(type);
  }

  override end(): this {
    return this;
  }
}

export const decide = async (
  db: Kysely<DB>,
  auth: SessionAuth,
  body: StreamBody,
  deadlineMs: number,
): Promise<Verdict> => {
  // The server's controller validates `types` before the service ever runs, and
  // the service skips anything it does not recognise. Without this check an
  // unknown type would look empty here where the tenant would answer 400.
  if (body.types.some((type) => !SYNC_REQUEST_TYPES.has(type))) {
    return { kind: 'busy', reason: 'unknown_type' };
  }

  const sentinel = new Sentinel();

  const dryRun = db
    .transaction()
    .setAccessMode('read only')
    .execute(async (trx) => {
      await syncService(trx, 'dry-run').stream(
        toAuthDto(auth),
        sentinel,
        body as never,
      );
      throw new Rollback();
    });

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Deadline()), deadlineMs);
  });

  try {
    await Promise.race([dryRun, deadline]);
    // `execute` cannot resolve: the callback always throws.
    return { kind: 'busy', reason: 'no_verdict' };
  } catch (error) {
    if (error instanceof Rollback) {
      if (sentinel.reset) {
        return { kind: 'reset' };
      }
      if (sentinel.nowId) {
        return { kind: 'empty', nowId: sentinel.nowId };
      }
      return { kind: 'busy', reason: 'no_verdict' };
    }
    if (error instanceof Busy) {
      return { kind: 'busy', reason: error.reason };
    }
    if (error instanceof Deadline) {
      // The transaction keeps unwinding in the background under the pool's
      // statement timeout and rolls back when it does; observe its rejection so
      // it never surfaces as unhandled.
      dryRun.catch(() => undefined);
      return { kind: 'busy', reason: 'timeout' };
    }
    if (error instanceof HttpException) {
      // A deprecated type, or a body the server would refuse: let the tenant
      // produce the exact error.
      return { kind: 'busy', reason: 'bad_request' };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const isStreamBody = (body: unknown): body is StreamBody =>
  typeof body === 'object' &&
  body !== null &&
  Array.isArray((body as StreamBody).types) &&
  (body as StreamBody).types.every((type) => typeof type === 'string') &&
  ((body as StreamBody).reset === undefined ||
    typeof (body as StreamBody).reset === 'boolean');
