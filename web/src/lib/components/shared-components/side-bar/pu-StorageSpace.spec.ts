import type { ServerStorageResponseDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { locale } from '#lib/stores/preferences.store.ts';
import { userInteraction } from '$lib/stores/user.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import StorageSpace from './StorageSpace.svelte';

const GiB = 1024 ** 3;

const serverDisk = (diskUseRaw: number, diskSizeRaw: number) =>
  ({ diskUseRaw, diskSizeRaw, diskAvailableRaw: diskSizeRaw - diskUseRaw }) as ServerStorageResponseDto;

const login = (quotaUsageInBytes: number | null, quotaSizeInBytes: number | null) => {
  authManager.setUser(userAdminFactory.build({ quotaUsageInBytes, quotaSizeInBytes }));
  authManager.setPreferences(preferencesFactory.build());
};

// PixelUnion: storage is labelled with the familiar decimal unit names (GB, not GiB), while the
// maths stays 1024-based. The meter shows the user's quota, or the server disk for quota-less users.
describe('StorageSpace (PixelUnion)', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
    // Pin number formatting so the test doesn't depend on the machine's locale.
    locale.set('en-US');
  });

  beforeEach(() => {
    // Set so StorageSpace doesn't refetch server info on mount.
    userInteraction.serverInfo = serverDisk(100 * GiB, 1000 * GiB);
    sdkMock.getStorage.mockResolvedValue(userInteraction.serverInfo);
  });

  afterEach(() => {
    authManager.reset();
    userInteraction.serverInfo = undefined;
  });

  it.each([
    { used: 0, total: 5 * GiB, label: '0 B of 5 GB used' },
    { used: 1.5 * GiB, total: 5 * GiB, label: '1.5 GB of 5 GB used' },
    { used: 512 * 1024 ** 2, total: 16 * GiB, label: '512 MB of 16 GB used' },
    { used: 250 * GiB, total: 1024 * GiB, label: '250 GB of 1 TB used' },
  ])('labels quota usage in GB-style units: $label', ({ used, total, label }) => {
    login(used, total);

    render(StorageSpace);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows a full quota as used equal to the total', () => {
    login(5 * GiB, 5 * GiB);

    render(StorageSpace);

    expect(screen.getByText('5 GB of 5 GB used')).toBeInTheDocument();
  });

  it('shows the server disk for a user without a quota', () => {
    login(null, null);
    userInteraction.serverInfo = serverDisk(100.5 * GiB, 2048 * GiB);

    render(StorageSpace);

    expect(screen.getByText('100.5 GB of 2 TB used')).toBeInTheDocument();
  });

  it('uses GB in the hover title too, with up to three decimals', () => {
    login(1.25 * GiB, 5 * GiB);

    const { container } = render(StorageSpace);

    expect(container.querySelector('[title]')).toHaveAttribute('title', '1.25 GB of 5 GB used');
  });

  it('never shows binary unit names (KiB/MiB/GiB/TiB)', () => {
    login(1.5 * GiB, 2048 * GiB);

    const { container } = render(StorageSpace);

    expect(container.textContent).not.toMatch(/[KMGT]iB/);
    expect(container.innerHTML).not.toMatch(/[KMGT]iB/);
  });

  it.each([
    { used: 79, colour: null },
    { used: 80, colour: 'bg-warning' },
    { used: 94, colour: 'bg-warning' },
    { used: 95, colour: 'bg-danger' },
    { used: 100, colour: 'bg-danger' },
  ])('colours the meter at the storage popup thresholds: $used% → $colour', ({ used, colour }) => {
    login(used * GiB, 100 * GiB);

    const { container } = render(StorageSpace);

    const warning = container.querySelector('.bg-warning');
    const danger = container.querySelector('.bg-danger');
    expect(warning !== null).toBe(colour === 'bg-warning');
    expect(danger !== null).toBe(colour === 'bg-danger');
  });
});
