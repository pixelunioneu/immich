import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { DB } from 'src/schema';
import { InvalidAckType } from '../src/errors.js';
import { ackType, setAcks } from '../src/handlers/sync-ack.js';

type Recorded = { inserted: Array<Record<string, unknown>>; resets: number };

/**
 * A stub standing in for the tenant database. It records what would be written so
 * the ack semantics can be asserted without a Postgres instance; the queries
 * themselves are covered by the contract tests against a real tenant.
 */
const fakeDb = () => {
  const recorded: Recorded = { inserted: [], resets: 0 };

  const chain = <T>(result: T): T => result;
  const executable = { execute: async () => undefined };
  const whereable: Record<string, unknown> = {
    where: () => whereable,
    execute: executable.execute,
  };
  const settable = { set: () => whereable };

  const db = {
    insertInto: () => ({
      values: (rows: Array<Record<string, unknown>>) => {
        recorded.inserted = rows;
        return { onConflict: () => executable };
      },
    }),
    updateTable: () => settable,
    deleteFrom: () => whereable,
    transaction: () => ({
      execute: async (callback: (tx: unknown) => Promise<unknown>) => {
        recorded.resets++;
        return chain(await callback(db));
      },
    }),
  } as unknown as Kysely<DB>;

  return { db, recorded };
};

describe('ackType', () => {
  it('takes the type from a type|updateId|extraId ack', () => {
    expect(ackType('AssetV2|01998a|extra')).toBe('AssetV2');
  });

  it('handles an ack with no separators', () => {
    expect(ackType('AssetV2')).toBe('AssetV2');
  });
});

describe('setAcks', () => {
  it('upserts one checkpoint per type', async () => {
    const { db, recorded } = fakeDb();
    await setAcks(db, 'session-1', ['AssetV2|a', 'AlbumV1|b']);

    expect(recorded.inserted).toHaveLength(2);
    expect(recorded.inserted.map((row) => row.type)).toEqual([
      'AssetV2',
      'AlbumV1',
    ]);
  });

  it('keeps the last ack for a repeated type, reproducing upstream behaviour', async () => {
    const { db, recorded } = fakeDb();
    await setAcks(db, 'session-1', ['AssetV2|first', 'AssetV2|second']);

    expect(recorded.inserted).toEqual([
      { sessionId: 'session-1', type: 'AssetV2', ack: 'AssetV2|second' },
    ]);
  });

  it('short-circuits on a reset and ignores every remaining ack', async () => {
    const { db, recorded } = fakeDb();
    await setAcks(db, 'session-1', [
      'AssetV2|a',
      'SyncResetV1|reset',
      'AlbumV1|b',
    ]);

    expect(recorded.resets).toBe(1);
    expect(recorded.inserted).toHaveLength(0);
  });

  it('rejects an unknown type', async () => {
    const { db } = fakeDb();
    await expect(setAcks(db, 'session-1', ['NotARealType|a'])).rejects.toThrow(
      InvalidAckType,
    );
    await expect(setAcks(db, 'session-1', ['NotARealType|a'])).rejects.toThrow(
      'Invalid ack type: NotARealType',
    );
  });

  it('rejects an earlier invalid type even when a later ack would reset', async () => {
    const { db, recorded } = fakeDb();
    await expect(
      setAcks(db, 'session-1', ['Nope|a', 'SyncResetV1|reset']),
    ).rejects.toThrow(InvalidAckType);
    expect(recorded.resets).toBe(0);
  });

  it('writes nothing for an empty ack list', async () => {
    const { db, recorded } = fakeDb();
    await setAcks(db, 'session-1', []);
    expect(recorded.inserted).toHaveLength(0);
  });
});
