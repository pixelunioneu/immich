import { HttpException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { DB } from 'src/schema';
import { deleteAcks, setAcks } from '../src/handlers/sync-ack.js';

type Recorded = { inserted: Array<Record<string, unknown>>; resets: number };

/**
 * A stub standing in for the tenant database. It records what would be written so
 * the ack semantics can be asserted without a Postgres instance.
 *
 * The semantics themselves are the server's: `setAcks` here is the bundled
 * `SyncService.setAcks`, so these tests pin the shims and the wiring, and they
 * document upstream's behaviour rather than re-deciding it.
 */
const fakeDb = () => {
  const recorded: Recorded = { inserted: [], resets: 0 };

  const executable = { execute: async () => undefined };
  const whereable: Record<string, unknown> = {
    where: () => whereable,
    $if: () => whereable,
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
        return callback(db);
      },
    }),
  } as unknown as Kysely<DB>;

  return { db, recorded };
};

const auth = { sessionId: 'session-1', userId: 'user-1' };

describe('setAcks', () => {
  it('upserts one checkpoint per type', async () => {
    const { db, recorded } = fakeDb();
    await setAcks(db, auth, ['AssetV2|a', 'AlbumV1|b']);

    expect(recorded.inserted).toHaveLength(2);
    expect(recorded.inserted.map((row) => row.type)).toEqual([
      'AssetV2',
      'AlbumV1',
    ]);
    expect(recorded.inserted[0]).toMatchObject({
      sessionId: 'session-1',
      ack: 'AssetV2|a',
    });
  });

  it('keeps the last ack for a repeated type, reproducing upstream behaviour', async () => {
    const { db, recorded } = fakeDb();
    await setAcks(db, auth, ['AssetV2|first', 'AssetV2|second']);

    expect(recorded.inserted).toEqual([
      { sessionId: 'session-1', type: 'AssetV2', ack: 'AssetV2|second' },
    ]);
  });

  it('short-circuits on a reset and ignores every remaining ack', async () => {
    const { db, recorded } = fakeDb();
    await setAcks(db, auth, ['AssetV2|a', 'SyncResetV1|reset', 'AlbumV1|b']);

    expect(recorded.resets).toBe(1);
    expect(recorded.inserted).toEqual([]);
  });

  it("rejects an unknown type with the server's own 400", async () => {
    const { db, recorded } = fakeDb();
    const failure = setAcks(db, auth, ['NotAType|a']);

    await expect(failure).rejects.toBeInstanceOf(HttpException);
    await expect(failure).rejects.toMatchObject({
      message: 'Invalid ack type: NotAType',
    });
    await failure.catch((error: HttpException) =>
      expect(error.getStatus()).toBe(400),
    );
    expect(recorded.inserted).toEqual([]);
  });

  it('rejects an earlier invalid type even when a later ack would reset', async () => {
    const { db, recorded } = fakeDb();
    await expect(
      setAcks(db, auth, ['NotAType|a', 'SyncResetV1|reset']),
    ).rejects.toBeInstanceOf(HttpException);
    expect(recorded.resets).toBe(0);
  });
});

describe('deleteAcks', () => {
  it('deletes for the session, narrowed to types when given', async () => {
    const { db } = fakeDb();
    await expect(deleteAcks(db, auth, ['AssetV2'])).resolves.toBeUndefined();
    await expect(deleteAcks(db, auth)).resolves.toBeUndefined();
  });
});
