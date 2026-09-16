import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AlbumUserRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { SyncCheckpointRepository } from 'src/repositories/sync-checkpoint.repository';
import { DB } from 'src/schema';
import { SYNC_TYPES_ORDER } from 'src/services/sync.service';
import { toAck } from 'src/utils/sync';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB, wait } from 'test/utils';
import { v7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import { decide, type Verdict } from '../../src/handlers/sync-stream.js';

/**
 * The property the whole of Phase 2 rests on: the front door says "empty" exactly
 * when the server's own stream would have been nothing but its terminating line,
 * and "reset" exactly when it would have been a single reset line. Both sides run
 * upstream's `SyncService` on the same database, so what is under test is the
 * sentinel, the dry-run stubs and the read-only transaction, not sync itself.
 *
 * Scenarios are the ones the server's own sync specs use for backfill, because
 * that is where a naive check goes wrong: output can come from an entity created
 * after a checkpoint, not only from rows newer than it.
 */

let defaultDatabase: Kysely<DB>;

const ALL_TYPES = SYNC_TYPES_ORDER.filter(
  (type) =>
    ![
      SyncRequestType.AssetsV1,
      SyncRequestType.AssetFacesV1,
      SyncRequestType.PartnerAssetsV1,
      SyncRequestType.AlbumAssetsV1,
    ].includes(type),
);

class Context extends SyncTestContext {
  async decide(
    auth: { session?: { id: string }; user: { id: string } },
    types: SyncRequestType[],
    reset?: boolean,
  ): Promise<Verdict> {
    // Same settling time the harness gives `syncStream`: `nowId` is `now() - 1ms`,
    // so a row written in the same millisecond is invisible to both sides.
    await wait(2);
    return decide(
      this.database,
      { sessionId: auth.session!.id, userId: auth.user.id },
      { types, reset },
      10_000,
    );
  }

  /** Runs both sides and asserts they agree. Returns the real stream. */
  async agree(
    auth: Parameters<Context['decide']>[0],
    types: SyncRequestType[],
  ) {
    const before = await this.checkpoints(auth.session!.id);
    const verdict = await this.decide(auth, types);
    expect(await this.checkpoints(auth.session!.id)).toEqual(before);

    const stream = await this.syncStream(auth as never, types);
    const onlyComplete =
      stream.length === 1 && stream[0].type === SyncEntityType.SyncCompleteV1;
    const onlyReset =
      stream.length === 1 && stream[0].type === SyncEntityType.SyncResetV1;

    if (onlyComplete) {
      expect(verdict).toEqual({ kind: 'empty', nowId: expect.any(String) });
    } else if (onlyReset) {
      expect(verdict).toEqual({ kind: 'reset' });
    } else {
      expect(verdict).toMatchObject({ kind: 'busy' });
    }
    return stream;
  }

  checkpoints(sessionId: string) {
    return this.database
      .selectFrom('session_sync_checkpoint')
      .selectAll()
      .where('sessionId', '=', sessionId)
      .orderBy('type')
      .execute();
  }
}

const setup = async () => {
  const ctx = new Context(defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('decide', () => {
  it('is empty for a fresh session with nothing to sync', async () => {
    const { auth, ctx } = await setup();
    await ctx.agree(auth, [SyncRequestType.AssetsV2]);
  });

  it('is empty for every type at once on a fresh session', async () => {
    const { auth, ctx } = await setup();
    await ctx.agree(auth, ALL_TYPES);
  });

  it('is busy once the user has an asset, then empty after it is acked', async () => {
    const { auth, ctx } = await setup();
    await ctx.newAsset({ ownerId: auth.user.id });
    await wait(2);

    const stream = await ctx.agree(auth, [SyncRequestType.AssetsV2]);
    expect(stream.length).toBeGreaterThan(1);

    await ctx.syncAckAll(auth, stream);
    await ctx.agree(auth, [SyncRequestType.AssetsV2]);
  });

  it('is reset when the session has a pending reset', async () => {
    const { auth, session, ctx } = await setup();
    await ctx.database
      .updateTable('session')
      .set({ isPendingSyncReset: true })
      .where('id', '=', session.id)
      .execute();
    await ctx.agree(auth, [SyncRequestType.AssetsV2]);
  });

  it('is reset when the complete checkpoint is older than the server allows', async () => {
    const { auth, session, ctx } = await setup();
    const updateId = v7({
      msecs: DateTime.now().minus({ days: 60 }).toMillis(),
    });
    await ctx.get(SyncCheckpointRepository).upsertAll([
      {
        type: SyncEntityType.SyncCompleteV1,
        sessionId: session.id,
        ack: toAck({ type: SyncEntityType.SyncCompleteV1, updateId }),
      },
    ]);
    await ctx.agree(auth, [SyncRequestType.AssetsV2]);
  });

  it('is busy when the client asks for a reset, and writes nothing', async () => {
    const { auth, session, ctx } = await setup();
    await ctx.get(SyncCheckpointRepository).upsertAll([
      {
        type: SyncEntityType.AssetV2,
        sessionId: session.id,
        ack: 'AssetV2|x',
      },
    ]);
    const before = await ctx.checkpoints(session.id);
    await expect(
      ctx.decide(auth, [SyncRequestType.AssetsV2], true),
    ).resolves.toEqual({ kind: 'busy', reason: 'write' });
    expect(await ctx.checkpoints(session.id)).toEqual(before);
  });

  it('follows the partner backfill exactly as the server does', async () => {
    // Mirrors "should backfill partner assets when a partner shared their
    // library with you" in server/test/medium/specs/sync/sync-partner-asset.spec.ts
    const { auth, ctx } = await setup();
    const { user: user2 } = await ctx.newUser();
    const { user: user3 } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user3.id });
    await wait(2);
    await ctx.newAsset({ ownerId: user2.id });
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });

    const first = await ctx.agree(auth, [SyncRequestType.PartnerAssetsV2]);
    await ctx.syncAckAll(auth, first);
    await ctx.agree(auth, [SyncRequestType.PartnerAssetsV2]);

    // A new partner with older assets: nothing is newer than the checkpoint,
    // yet the server backfills. The front door must say busy here.
    await ctx.newPartner({ sharedById: user3.id, sharedWithId: auth.user.id });
    const second = await ctx.agree(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(second.map((line) => line.type)).toContain(
      SyncEntityType.PartnerAssetBackfillV2,
    );

    await ctx.syncAckAll(auth, second);
    await ctx.agree(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('is busy when the server would only write a backfill checkpoint', async () => {
    // A partner exists but the session has never acked partner assets: the
    // server streams nothing and records a backfill checkpoint. That write is
    // reason enough to let the tenant serve it.
    const { auth, ctx } = await setup();
    const { user: user2 } = await ctx.newUser();
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });
    await wait(2);

    await expect(
      ctx.decide(auth, [SyncRequestType.PartnerAssetsV2]),
    ).resolves.toEqual({ kind: 'busy', reason: 'write' });
  });

  it('follows the album backfill exactly as the server does', async () => {
    // Mirrors "should backfill album assets when a user shares an album with
    // you" in server/test/medium/specs/sync/sync-album-asset.spec.ts
    const { auth, ctx } = await setup();
    const { user: user2 } = await ctx.newUser();
    const { album: album1 } = await ctx.newAlbum({ ownerId: user2.id });
    const { album: album2 } = await ctx.newAlbum({ ownerId: user2.id });
    const { asset: asset1 } = await ctx.newAsset({ ownerId: user2.id });
    await ctx.newAlbumAsset({ albumId: album2.id, assetId: asset1.id });
    await wait(2);
    const { asset: asset2 } = await ctx.newAsset({ ownerId: user2.id });
    await ctx.newAlbumAsset({ albumId: album2.id, assetId: asset2.id });
    await wait(2);
    await ctx.newAlbumAsset({ albumId: album1.id, assetId: asset2.id });
    await wait(2);
    await ctx.newAlbumUser({
      albumId: album1.id,
      userId: auth.user.id,
      role: AlbumUserRole.Editor,
    });

    const first = await ctx.agree(auth, [SyncRequestType.AlbumAssetsV2]);
    await ctx.syncAckAll(auth, first);
    await ctx.agree(auth, [SyncRequestType.AlbumAssetsV2]);

    await ctx.newAlbumUser({
      albumId: album2.id,
      userId: auth.user.id,
      role: AlbumUserRole.Editor,
    });
    const second = await ctx.agree(auth, [SyncRequestType.AlbumAssetsV2]);
    expect(second.length).toBeGreaterThan(1);

    await ctx.syncAckAll(auth, second);
    await ctx.agree(auth, [SyncRequestType.AlbumAssetsV2]);
  });
});
