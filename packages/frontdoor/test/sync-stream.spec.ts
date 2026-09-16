import { describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { DB } from 'src/schema';
import { decide, isStreamBody } from '../src/handlers/sync-stream.js';

/**
 * A tenant database that can answer exactly the queries the server's
 * `streamInternal` makes before it reaches any sync type: the session's pending
 * reset flag, the checkpoints, and `now()` as a uuid v7. With no types requested,
 * or with only the pre-checks reached, that is the whole stream.
 *
 * The decision engine is otherwise the server's own code, so the assertions
 * here are about what the sentinel and the stubs make of it, not about sync.
 */
type Rows = {
  pendingReset?: boolean;
  checkpoints?: Array<{ type: string; ack: string }>;
  nowId?: string;
  hang?: boolean;
};

const NOW_ID = '01990000-0000-7000-8000-000000000001';

const fakeDb = (rows: Rows = {}) => {
  const calls: string[] = [];
  const never = new Promise<never>(() => undefined);

  const chain = (result: () => Promise<unknown>) => {
    const query: Record<string, unknown> = {};
    for (const step of ['select', 'where', 'orderBy', '$if', 'selectAll']) {
      query[step] = () => query;
    }
    query.execute = result;
    query.executeTakeFirst = result;
    query.executeTakeFirstOrThrow = result;
    return query;
  };

  const trx = {
    selectFrom: (table: string) => {
      calls.push(`select ${table}`);
      if (rows.hang) {
        return chain(() => never);
      }
      if (table === 'session') {
        return chain(async () => ({
          isPendingSyncReset: rows.pendingReset ?? false,
        }));
      }
      if (table === 'session_sync_checkpoint') {
        return chain(async () => rows.checkpoints ?? []);
      }
      throw new Error(`unexpected table ${table}`);
    },
    selectNoFrom: () => {
      calls.push('now');
      return chain(async () => ({ nowId: rows.nowId ?? NOW_ID }));
    },
    insertInto: () => {
      throw new Error('a dry run must never insert');
    },
    updateTable: () => {
      throw new Error('a dry run must never update');
    },
    deleteFrom: () => {
      throw new Error('a dry run must never delete');
    },
  };

  let accessMode: string | undefined;
  const db = {
    transaction: () => ({
      setAccessMode: (mode: string) => {
        accessMode = mode;
        return {
          execute: (callback: (tx: unknown) => Promise<unknown>) =>
            callback(trx),
        };
      },
    }),
  } as unknown as Kysely<DB>;

  return { db, calls, accessMode: () => accessMode };
};

const auth = { sessionId: 'session-1', userId: 'user-1' };

describe('decide', () => {
  it("answers empty with the server's nowId when nothing would be streamed", async () => {
    const { db, accessMode } = fakeDb();
    await expect(decide(db, auth, { types: [] }, 1000)).resolves.toEqual({
      kind: 'empty',
      nowId: NOW_ID,
    });
    expect(accessMode()).toBe('read only');
  });

  it('answers reset when the session has a pending reset', async () => {
    const { db } = fakeDb({ pendingReset: true });
    await expect(decide(db, auth, { types: [] }, 1000)).resolves.toEqual({
      kind: 'reset',
    });
  });

  it('answers reset when the last complete checkpoint is older than the server allows', async () => {
    // uuid v7 with a timestamp 60 days ago
    const ms = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const hex = ms.toString(16).padStart(12, '0');
    const old = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;
    const { db } = fakeDb({
      checkpoints: [{ type: 'SyncCompleteV1', ack: `SyncCompleteV1|${old}` }],
    });
    await expect(decide(db, auth, { types: [] }, 1000)).resolves.toEqual({
      kind: 'reset',
    });
  });

  it('is busy when the client asks for a reset, because that is a write', async () => {
    const { db } = fakeDb();
    await expect(
      decide(db, auth, { types: [], reset: true }, 1000),
    ).resolves.toEqual({ kind: 'busy', reason: 'write' });
  });

  it('is busy for a type the server would not accept', async () => {
    const { db, calls } = fakeDb();
    await expect(
      decide(db, auth, { types: ['NotAType'] }, 1000),
    ).resolves.toEqual({ kind: 'busy', reason: 'unknown_type' });
    expect(calls).toEqual([]);
  });

  it('is busy for a deprecated type, which the server answers with a 400', async () => {
    const { db } = fakeDb();
    await expect(
      decide(db, auth, { types: ['AssetsV1'] }, 1000),
    ).resolves.toEqual({ kind: 'busy', reason: 'bad_request' });
  });

  it('is busy when the deadline passes', async () => {
    const { db } = fakeDb({ hang: true });
    await expect(decide(db, auth, { types: [] }, 20)).resolves.toEqual({
      kind: 'busy',
      reason: 'timeout',
    });
  });
});

describe('isStreamBody', () => {
  it.each([
    [{ types: [] }, true],
    [{ types: ['AssetsV2'], reset: false }, true],
    [{ types: 'AssetsV2' }, false],
    [{ types: [1] }, false],
    [{ types: [], reset: 'yes' }, false],
    [null, false],
    [undefined, false],
  ])('%j → %s', (body, expected) => {
    expect(isStreamBody(body)).toBe(expected);
  });
});
