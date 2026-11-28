import { StorageWarningLevel } from '@immich/sdk';
import { render } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { userInteraction } from '$lib/stores/user.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import StorageWarning from './StorageWarning.svelte';

const modal = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('#lib/utils/storage-warning-modal.ts', () => ({ openStorageWarningModal: modal.open }));

const { None, AlmostFull, Full } = StorageWarningLevel;

const login = (usedBytes: number, totalBytes: number, shownLevel: StorageWarningLevel) => {
  authManager.setUser(userAdminFactory.build({ quotaUsageInBytes: usedBytes, quotaSizeInBytes: totalBytes }));
  authManager.setPreferences(preferencesFactory.build({ storageWarning: { shownLevel } }));
};

// PixelUnion: the (user) layout opens the storage popup once per level (80%, 95%) and remembers that
// in the user's preferences, so a reload or a second tab doesn't show it again.
describe('StorageWarning (PixelUnion)', () => {
  beforeEach(() => {
    sdkMock.updateMyPreferences.mockImplementation(({ userPreferencesUpdateDto }) =>
      Promise.resolve(preferencesFactory.build({ storageWarning: userPreferencesUpdateDto.storageWarning as never })),
    );
  });

  afterEach(() => {
    authManager.reset();
    userInteraction.serverInfo = undefined;
    modal.open.mockReset();
    sdkMock.updateMyPreferences.mockReset();
  });

  it('opens the almost-full popup once, after storing that it was shown', async () => {
    login(85, 100, None);

    render(StorageWarning);

    await vi.waitFor(() => expect(modal.open).toHaveBeenCalledWith(AlmostFull, { usedBytes: 85, totalBytes: 100 }));
    expect(sdkMock.updateMyPreferences).toHaveBeenCalledWith({
      userPreferencesUpdateDto: { storageWarning: { shownLevel: AlmostFull } },
    });
    expect(sdkMock.updateMyPreferences.mock.invocationCallOrder[0]).toBeLessThan(
      modal.open.mock.invocationCallOrder[0],
    );
    expect(authManager.preferences.storageWarning.shownLevel).toBe(AlmostFull);
  });

  it('escalates to the full popup at 95% even when almost-full was already shown', async () => {
    login(96, 100, AlmostFull);

    render(StorageWarning);

    await vi.waitFor(() => expect(modal.open).toHaveBeenCalledWith(Full, { usedBytes: 96, totalBytes: 100 }));
  });

  it('does not show a level that was already shown', async () => {
    login(85, 100, AlmostFull);

    render(StorageWarning);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modal.open).not.toHaveBeenCalled();
    expect(sdkMock.updateMyPreferences).not.toHaveBeenCalled();
  });

  it('skips the popup when storing the shown level fails, so it cannot nag on every load', async () => {
    login(85, 100, None);
    sdkMock.updateMyPreferences.mockRejectedValue(new Error('offline'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(StorageWarning);

    await vi.waitFor(() => expect(sdkMock.updateMyPreferences).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modal.open).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('re-arms the popup once usage drops below 80%', async () => {
    login(50, 100, Full);

    render(StorageWarning);

    await vi.waitFor(() =>
      expect(sdkMock.updateMyPreferences).toHaveBeenCalledWith({
        userPreferencesUpdateDto: { storageWarning: { shownLevel: None } },
      }),
    );
    expect(modal.open).not.toHaveBeenCalled();
  });
});
