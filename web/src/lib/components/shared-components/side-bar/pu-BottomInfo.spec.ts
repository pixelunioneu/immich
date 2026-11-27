import type { ServerAboutResponseDto, ServerStorageResponseDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { locale } from '$lib/stores/preferences.store';
import { userInteraction } from '$lib/stores/user.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import BottomInfo from './BottomInfo.svelte';

const referral = vi.hoisted(() => ({ loadReferral: vi.fn() }));

vi.mock('$lib/services/pu-referral.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/pu-referral.service')>()),
  loadReferral: referral.loadReferral,
}));

// Upstream (v3.4) shows a FUTO Backups sidebar item to admins when this flag is on; turn every flag on
// so the test catches that item if a merge brings it in.
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: {
    init: vi.fn(),
    loadFeatureFlags: vi.fn(),
    value: new Proxy({}, { get: () => true }),
  },
}));

const GiB = 1024 ** 3;

// Lets the referral lookup resolve and the component re-render before checking that something is absent.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const ok = { status: 'ok', referral: { referral_id: 'abc', referral_url: 'https://pixelunion.eu/?ref=abc' } };

/** An admin on a long-running, unlicensed server who never hid the buy button: upstream would show "Buy Immich". */
const login = (usedBytes: number, totalBytes: number) => {
  authManager.setUser(
    userAdminFactory.build({
      isAdmin: true,
      license: null,
      createdAt: '2020-01-01T00:00:00.000Z',
      quotaUsageInBytes: usedBytes,
      quotaSizeInBytes: totalBytes,
    }),
  );
  authManager.setPreferences(
    preferencesFactory.build({ purchase: { hideBuyButtonUntil: '2020-01-01T00:00:00.000Z', showSupportBadge: true } }),
  );
  authManager.isPurchased = false;
};

// PixelUnion: the sidebar footer shows storage, then either the referral banner or (from 80%) the storage
// warning button. Upstream's "Buy Immich" / supporter block and FUTO Backups item are not shown.
describe('BottomInfo (PixelUnion)', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
    locale.set('en-US');
  });

  beforeEach(() => {
    const about = {
      version: 'v3.3.5',
      sourceRef: 'v3.3.5',
      repository: 'pixelunioneu/immich',
    } as ServerAboutResponseDto;
    userInteraction.serverInfo = { diskSizeRaw: 1000 * GiB, diskUseRaw: 10 * GiB } as ServerStorageResponseDto;
    userInteraction.aboutInfo = about;
    userInteraction.versions = [];
    sdkMock.getAboutInfo.mockResolvedValue(about);
    sdkMock.getVersionHistory.mockResolvedValue([]);
    sdkMock.getStorage.mockResolvedValue(userInteraction.serverInfo);
    referral.loadReferral.mockResolvedValue(ok);
  });

  afterEach(() => {
    authManager.reset();
    userInteraction.serverInfo = undefined;
    userInteraction.aboutInfo = undefined;
    userInteraction.versions = undefined;
    referral.loadReferral.mockReset();
  });

  it('shows the storage meter in GB', () => {
    login(2 * GiB, 10 * GiB);

    render(BottomInfo);

    expect(screen.getByText('2 GB of 10 GB used')).toBeInTheDocument();
  });

  it('shows the referral banner while storage is below 80%', async () => {
    login(2 * GiB, 10 * GiB);

    render(BottomInfo);

    expect(await screen.findByRole('link', { name: 'Get extra storage' })).toHaveAttribute('href', '/referral');
    expect(screen.queryByText('Storage almost full')).not.toBeInTheDocument();
  });

  it.each([
    { used: 8, label: 'Storage almost full' },
    { used: 9.5, label: 'Storage full' },
  ])('replaces the referral banner with a "$label" button at $used of 10 GB', async ({ used, label }) => {
    login(used * GiB, 10 * GiB);

    render(BottomInfo);

    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    await settle();
    expect(screen.queryByText('Get extra storage')).not.toBeInTheDocument();
  });

  it('does not show the upstream "Buy Immich" or supporter block', async () => {
    login(2 * GiB, 10 * GiB);

    const { container } = render(BottomInfo);

    await screen.findByText('Get extra storage');
    expect(screen.queryByText(/buy immich/i)).not.toBeInTheDocument();
    expect(container.querySelector('.license-status')).toBeNull();
  });

  it('does not show a backups entry, even to an admin with every feature flag on', async () => {
    login(2 * GiB, 10 * GiB);

    const { container } = render(BottomInfo);

    await screen.findByText('Get extra storage');
    expect(container.querySelector('a[href*="backup"]')).toBeNull();
    expect(container.textContent).not.toMatch(/backup|futo/i);
  });
});
