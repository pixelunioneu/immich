import { Writable } from 'node:stream';
import type { Kysely } from 'kysely';
import type { DB } from 'src/schema';
import { HttpException } from '@nestjs/common';
import contract from '../generated/contract.json' with { type: 'json' };
import { Busy, syncService } from '../sync-service.js';
import { type SessionAuth, toAuthDto } from './auth-dto.js';

/**
 * Decides whether a `sync/stream` request can be answered without the tenant's
 * own instance: when the stream would be a single reset line, or when it
 * completes without the server writing anything and stays under a byte cap.
 *
 * The decision is made by running the server's real `SyncService.stream()` against
 * a sentinel writable inside a read-only transaction that is always rolled back.
 * The sentinel keeps what the service writes, so a stream the tenant would have
 * produced can be sent verbatim: same code, same database, same session. Any
 * write the service attempts settles it the other way. Nothing here knows how
 * sync works, which is the point: an upstream change to the stream changes this
 * decision on the next merge.
 *
 * The failure modes are not symmetric. Wrongly answering "busy" wakes a pod for
 * nothing; wrongly serving a stream means a client never learns about a change.
 * So every error, timeout or doubt is "busy".
 */

export type Verdict =
  /** The stream is its terminating line and nothing else. */
  | { kind: 'empty'; body: string; types: string[] }
  /** A write-free stream under the cap: entity lines plus the terminating line. */
  | { kind: 'served'; body: string; types: string[] }
  | { kind: 'reset' }
  /** Relay. `types` are the entity types seen before the dry run was cut short. */
  | { kind: 'busy'; reason: string; types: string[] };

export type StreamBody = { types: string[]; reset?: boolean };

const SYNC_REQUEST_TYPES = new Set<string>(contract.syncRequestTypes);

const COMPLETE = 'SyncCompleteV1';
const RESET = 'SyncResetV1';

/** Thrown at the end of the dry-run transaction so Kysely rolls it back. */
class Rollback extends Error {}

/** Thrown when the deadline passes; the transaction unwinds on its own. */
class Deadline extends Error {}

/**
 * Receives what the server would have sent and keeps it, line for line. Entity
 * lines count against `maxBytes`; the terminating line does not, so a cap of 0
 * answers empty streams and nothing else. A reset is remembered rather than
 * kept: it is the whole answer. The first line that crosses the cap ends the dry
 * run, so a large stream costs at most the cap plus one line.
 */
class Sentinel extends Writable {
  readonly lines: string[] = [];
  readonly types = new Set<string>();
  bytes = 0;
  complete = false;
  reset = false;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override write(chunk: unknown): boolean {
    const line = String(chunk);
    const { type } = JSON.parse(line) as { type: string };
    if (type === RESET) {
      this.reset = true;
      return true;
    }
    if (type === COMPLETE) {
      this.complete = true;
    } else {
      this.types.add(type);
      this.bytes += Buffer.byteLength(line);
      if (this.bytes > this.maxBytes) {
        throw new Busy('large');
      }
    }
    this.lines.push(line);
    return true;
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
  maxBytes: number,
): Promise<Verdict> => {
  // The server's controller validates `types` before the service ever runs, and
  // the service skips anything it does not recognise. Without this check an
  // unknown type would look empty here where the tenant would answer 400.
  if (body.types.some((type) => !SYNC_REQUEST_TYPES.has(type))) {
    return { kind: 'busy', reason: 'unknown_type', types: [] };
  }

  const sentinel = new Sentinel(maxBytes);
  const busy = (reason: string): Verdict => ({
    kind: 'busy',
    reason,
    types: [...sentinel.types],
  });

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
    return busy('no_verdict');
  } catch (error) {
    if (error instanceof Rollback) {
      if (sentinel.reset) {
        return { kind: 'reset' };
      }
      if (!sentinel.complete) {
        return busy('no_verdict');
      }
      // The lines are passed through as captured, not regenerated, so the body
      // is the server's bytes end to end. The terminating line is the last one.
      const body = sentinel.lines.join('');
      return sentinel.types.size === 0
        ? { kind: 'empty', body, types: [] }
        : { kind: 'served', body, types: [...sentinel.types] };
    }
    if (error instanceof Busy) {
      return busy(error.reason);
    }
    if (error instanceof Deadline) {
      // The transaction keeps unwinding in the background under the pool's
      // statement timeout and rolls back when it does; observe its rejection so
      // it never surfaces as unhandled.
      dryRun.catch(() => undefined);
      return busy('timeout');
    }
    if (error instanceof HttpException) {
      // A deprecated type, or a body the server would refuse: let the tenant
      // produce the exact error.
      return busy('bad_request');
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
