import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/common/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import type { Mock } from '#test/unit/mocks/mock.ts';
import { StorageWarningLevel } from '@immich/sdk';
import { expect, vi } from 'vitest';
import StorageWarning from './StorageWarning.svelte';

const modal = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('#lib/utils/storage-warning-modal.ts', () => ({ openStorageWarningModal: modal.open }));

const { None, AlmostFull, Full } = StorageWarningLevel;

const load = () => Promise.resolve({});

const totalBytes = 100;

const login = (usedBytes: number, shownLevel: StorageWarningLevel) => {
  authManager.setUser(factory.user({ quotaUsageInBytes: usedBytes, quotaSizeInBytes: totalBytes }));
  authManager.setPreferences(factory.preferences({ storageWarning: { shownLevel } }));
};

/** The server stores the preference and answers with the updated preferences; `events` records the order. */
const storePreferences = (api: Mock['api'], events: string[]) =>
  api.on({
    updateMyPreferences: ({ body }) => {
      events.push('stored');
      return { json: factory.preferences({ storageWarning: body.storageWarning as never }) };
    },
  });

// PixelUnion: the (user) layout opens the storage popup once per level (80%, 95%) and remembers that
// in the user's preferences, so a reload or a second tab doesn't show it again.
describe('StorageWarning (PixelUnion)', () => {
  beforeEach(() => {
    modal.open.mockReset();
  });

  test('opens the almost-full popup once, after storing that it was shown', async ({ api, render }) => {
    const events: string[] = [];
    storePreferences(api, events);
    modal.open.mockImplementation(() => {
      events.push('popup');
    });
    login(85, None);

    await render(StorageWarning, load);

    await vi.waitFor(() => expect(modal.open).toHaveBeenCalledWith(AlmostFull, { usedBytes: 85, totalBytes: 100 }));
    expect(api.updateMyPreferences).toHaveBeenCalledWith({ body: { storageWarning: { shownLevel: AlmostFull } } });
    expect(events).toEqual(['stored', 'popup']);
    expect(authManager.preferences.storageWarning.shownLevel).toBe(AlmostFull);
  });

  test('escalates to the full popup at 95% even when almost-full was already shown', async ({ api, render }) => {
    storePreferences(api, []);
    login(96, AlmostFull);

    await render(StorageWarning, load);

    await vi.waitFor(() => expect(modal.open).toHaveBeenCalledWith(Full, { usedBytes: 96, totalBytes: 100 }));
    expect(api.updateMyPreferences).toHaveBeenCalledWith({ body: { storageWarning: { shownLevel: Full } } });
  });

  test('does not show a level that was already shown', async ({ api, render, settle }) => {
    login(85, AlmostFull);

    await render(StorageWarning, load);

    await settle();
    expect(modal.open).not.toHaveBeenCalled();
    expect(api.updateMyPreferences.calls).toHaveLength(0);
  });

  test('skips the popup when storing the shown level fails, so it cannot nag on every load', async ({
    api,
    logger,
    render,
    settle,
  }) => {
    api.on({ updateMyPreferences: () => ({ status: 500, json: { message: 'offline', statusCode: 500 } }) });
    login(85, None);

    await render(StorageWarning, load);

    await vi.waitFor(() => expect(api.updateMyPreferences.calls).toHaveLength(1));
    await settle();
    expect(api.updateMyPreferences).toHaveBeenCalledWith({ body: { storageWarning: { shownLevel: AlmostFull } } });
    expect(logger.error).toHaveBeenCalledWith(/Error \[StorageWarning\]/);
    expect(modal.open).not.toHaveBeenCalled();
  });

  test('re-arms the popup once usage drops below 80%', async ({ api, render, settle }) => {
    storePreferences(api, []);
    login(50, Full);

    await render(StorageWarning, load);

    await vi.waitFor(() =>
      expect(api.updateMyPreferences).toHaveBeenCalledWith({ body: { storageWarning: { shownLevel: None } } }),
    );
    await settle();
    expect(modal.open).not.toHaveBeenCalled();
  });
});
