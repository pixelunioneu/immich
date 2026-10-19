import { describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { DB } from 'src/schema';
import { serialize } from 'src/utils/sync';
import { decide, isStreamBody } from '../src/handlers/sync-stream.js';

/**
 * A tenant database that can answer exactly the queries the server's
 * `streamInternal` makes before it reaches any sync type: the session's pending
 * reset flag, the checkpoints, and `now()` as a uuid v7. On top of that it can
 * hand out user rows, which is enough to drive the two user types through the
 * server's own handlers and see what the sentinel makes of the lines.
 *
 * The decision engine is otherwise the server's own code, so the assertions
 * here are about what the sentinel and the stubs make of it, not about sync.
 */
type Rows = {
  pendingReset?: boolean;
  checkpoints?: Array<{ type: string; ack: string }>;
  nowId?: string;
  users?: Array<Record<string, unknown>>;
  hang?: boolean;
};

const NOW_ID = '01990000-0000-7000-8000-000000000001';
const USER_UPDATE_ID = '01980000-0000-7000-8000-000000000001';
const MAX_BYTES = 64 * 1024;

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
    query.stream = async function* () {
      yield* (await result()) as unknown[];
    };
    return query;
  };

  const trx = {
    // The sync repository names its tables through `db.dynamic`.
    dynamic: {
      table: (name: string) => ({ as: () => name }),
      ref: (name: string) => name,
    },
    selectFrom: (table: string) => {
      calls.push(`select ${table}`);
      if (rows.hang) {
        return chain(() => never);
      }
      switch (table) {
        case 'session': {
          return chain(async () => ({
            isPendingSyncReset: rows.pendingReset ?? false,
          }));
        }
        case 'session_sync_checkpoint': {
          return chain(async () => rows.checkpoints ?? []);
        }
        case 'user': {
          return chain(async () => rows.users ?? []);
        }
        case 'user_audit': {
          return chain(async () => []);
        }
        default: {
          throw new Error(`unexpected table ${table}`);
        }
      }
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

const user = {
  id: 'user-1',
  updateId: USER_UPDATE_ID,
  profileImagePath: null,
  name: 'Ada',
  email: 'ada@example.com',
};

/** The server's bytes for the lines above, as `syncAuthUsersV2` and `syncUsersV1` emit them. */
const line = (type: string) =>
  serialize({
    type,
    ids: [USER_UPDATE_ID],
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      hasProfileImage: false,
    },
  } as never);
const completeLine = serialize({
  type: 'SyncCompleteV1',
  ids: [NOW_ID],
  data: {},
} as never);

describe('decide', () => {
  it("answers empty with the server's own terminating line when nothing would be streamed", async () => {
    const { db, accessMode } = fakeDb();
    await expect(
      decide(db, auth, { types: [] }, 1000, MAX_BYTES),
    ).resolves.toEqual({ kind: 'empty', body: completeLine, types: [] });
    expect(accessMode()).toBe('read only');
  });

  it('serves a small stream as the concatenation of the lines the server wrote', async () => {
    const { db } = fakeDb({ users: [user] });
    await expect(
      decide(db, auth, { types: ['AuthUsersV2'] }, 1000, MAX_BYTES),
    ).resolves.toEqual({
      kind: 'served',
      body: line('AuthUserV2') + completeLine,
      types: ['AuthUserV2'],
    });
  });

  it('keeps the lines in the order the server wrote them and lists each type once', async () => {
    const { db } = fakeDb({ users: [user, { ...user, id: 'user-2' }] });
    const verdict = await decide(
      db,
      auth,
      { types: ['UsersV1', 'AuthUsersV2'] },
      1000,
      MAX_BYTES,
    );
    expect(verdict.kind).toBe('served');
    if (verdict.kind !== 'served') {
      return;
    }
    expect(verdict.types).toEqual(['AuthUserV2', 'UserV1']);
    const lines = verdict.body.split('\n').filter(Boolean);
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => (JSON.parse(l) as { type: string }).type)).toEqual([
      'AuthUserV2',
      'AuthUserV2',
      'UserV1',
      'UserV1',
      'SyncCompleteV1',
    ]);
    expect(verdict.body).toBe(lines.join('\n') + '\n');
  });

  it('is busy, large, once the entity lines cross the cap, naming the types seen so far', async () => {
    const { db } = fakeDb({ users: [user] });
    const cap = Buffer.byteLength(line('AuthUserV2')) - 1;
    await expect(
      decide(db, auth, { types: ['AuthUsersV2'] }, 1000, cap),
    ).resolves.toEqual({
      kind: 'busy',
      reason: 'large',
      types: ['AuthUserV2'],
    });
  });

  it('counts only entity lines against the cap, so a stream exactly at the cap is served', async () => {
    const { db } = fakeDb({ users: [user] });
    const cap = Buffer.byteLength(line('AuthUserV2'));
    await expect(
      decide(db, auth, { types: ['AuthUsersV2'] }, 1000, cap),
    ).resolves.toMatchObject({ kind: 'served' });
  });

  describe('with a cap of 0', () => {
    it('still answers an empty stream', async () => {
      const { db } = fakeDb();
      await expect(
        decide(db, auth, { types: ['AuthUsersV2'] }, 1000, 0),
      ).resolves.toEqual({ kind: 'empty', body: completeLine, types: [] });
    });

    it('still answers a reset', async () => {
      const { db } = fakeDb({ pendingReset: true, users: [user] });
      await expect(
        decide(db, auth, { types: ['AuthUsersV2'] }, 1000, 0),
      ).resolves.toEqual({ kind: 'reset' });
    });

    it('relays any stream with a line in it', async () => {
      const { db } = fakeDb({ users: [user] });
      await expect(
        decide(db, auth, { types: ['AuthUsersV2'] }, 1000, 0),
      ).resolves.toEqual({
        kind: 'busy',
        reason: 'large',
        types: ['AuthUserV2'],
      });
    });
  });

  it('answers reset when the session has a pending reset', async () => {
    const { db } = fakeDb({ pendingReset: true });
    await expect(
      decide(db, auth, { types: [] }, 1000, MAX_BYTES),
    ).resolves.toEqual({ kind: 'reset' });
  });

  it('answers reset when the last complete checkpoint is older than the server allows', async () => {
    // uuid v7 with a timestamp 60 days ago
    const ms = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const hex = ms.toString(16).padStart(12, '0');
    const old = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;
    const { db } = fakeDb({
      checkpoints: [{ type: 'SyncCompleteV1', ack: `SyncCompleteV1|${old}` }],
    });
    await expect(
      decide(db, auth, { types: [] }, 1000, MAX_BYTES),
    ).resolves.toEqual({ kind: 'reset' });
  });

  it('is busy when the client asks for a reset, because that is a write', async () => {
    const { db } = fakeDb();
    await expect(
      decide(db, auth, { types: [], reset: true }, 1000, MAX_BYTES),
    ).resolves.toEqual({ kind: 'busy', reason: 'write', types: [] });
  });

  it('is busy for a type the server would not accept', async () => {
    const { db, calls } = fakeDb();
    await expect(
      decide(db, auth, { types: ['NotAType'] }, 1000, MAX_BYTES),
    ).resolves.toEqual({ kind: 'busy', reason: 'unknown_type', types: [] });
    expect(calls).toEqual([]);
  });

  it('is busy for a deprecated type, which the server answers with a 400', async () => {
    const { db } = fakeDb();
    await expect(
      decide(db, auth, { types: ['AssetsV1'] }, 1000, MAX_BYTES),
    ).resolves.toEqual({ kind: 'busy', reason: 'bad_request', types: [] });
  });

  it('is busy when the deadline passes', async () => {
    const { db } = fakeDb({ hang: true });
    await expect(
      decide(db, auth, { types: [] }, 20, MAX_BYTES),
    ).resolves.toEqual({ kind: 'busy', reason: 'timeout', types: [] });
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
