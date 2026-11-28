import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import type { MockData } from '#test/common/data.ts';
import { factory } from '#test/common/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { locale as i18nLocale, register } from 'svelte-i18n';
import { expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import BottomInfo from './BottomInfo.svelte';

// The shared test setup renders translation keys; these specs assert the English strings.
register('en', () => import('#i18n/en.json'));

beforeAll(async () => {
  await i18nLocale.set('en');
});

const referral = vi.hoisted(() => ({ loadReferral: vi.fn() }));

vi.mock('#lib/services/pu-referral.service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/services/pu-referral.service.ts')>()),
  loadReferral: referral.loadReferral,
}));

// Upstream (v3.4) shows a FUTO Backups sidebar item to admins when this flag is on; turn every flag on
// so the test catches that item if a merge brings it in.
vi.mock('#lib/managers/feature-flags-manager.svelte.ts', () => ({
  featureFlagsManager: {
    init: vi.fn(),
    loadFeatureFlags: vi.fn(),
    value: new Proxy({}, { get: () => true }),
  },
}));

const GiB = 1024 ** 3;

const load = () => Promise.resolve({});

const ok = { status: 'ok', referral: { referral_id: 'abc', referral_url: 'https://pixelunion.eu/?ref=abc' } };

/** An admin on a long-running, unlicensed server who never hid the buy button: upstream would show "Buy Immich". */
const login = (usedBytes: number, totalBytes: number) => {
  authManager.setUser(
    factory.user({
      isAdmin: true,
      license: null,
      createdAt: '2020-01-01T00:00:00.000Z',
      quotaUsageInBytes: usedBytes,
      quotaSizeInBytes: totalBytes,
    }),
  );
  authManager.setPreferences(
    factory.preferences({ purchase: { hideBuyButtonUntil: '2020-01-01T00:00:00.000Z', showSupportBadge: true } }),
  );
  authManager.isPurchased = false;
};

const setUp = (data: MockData) => {
  Object.assign(data.aboutInfo, { version: 'v3.3.5', sourceRef: 'v3.3.5', repository: 'pixelunioneu/immich' });
  Object.assign(data.storage, { diskSizeRaw: 1000 * GiB, diskUseRaw: 10 * GiB });
  data.versionHistory.length = 0;
  referral.loadReferral.mockReset();
  referral.loadReferral.mockResolvedValue(ok);
};

// PixelUnion: the sidebar footer shows storage, then either the referral banner or (from 80%) the storage
// warning button. Upstream's "Buy Immich" / supporter block and FUTO Backups item are not shown.
describe('BottomInfo (PixelUnion)', () => {
  test('shows the storage meter in GB', async ({ data, render }) => {
    setUp(data);
    login(2 * GiB, 10 * GiB);

    await render(BottomInfo, load);

    await expect.element(page.getByText('2 GB of 10 GB used', { exact: true })).toBeInTheDocument();
  });

  test('shows the referral banner while storage is below 80%', async ({ data, render }) => {
    setUp(data);
    login(2 * GiB, 10 * GiB);

    await render(BottomInfo, load);

    await expect.element(page.getByRole('link', { name: 'Get extra storage' })).toHaveAttribute('href', '/referral');
    await expect.element(page.getByText('Storage almost full')).not.toBeInTheDocument();
  });

  test.for([
    { used: 8, label: 'Storage almost full' },
    { used: 9.5, label: 'Storage full' },
  ])(
    'replaces the referral banner with a "$label" button at $used of 10 GB',
    async ({ used, label }, { data, render, settle }) => {
      setUp(data);
      login(used * GiB, 10 * GiB);

      await render(BottomInfo, load);

      await expect.element(page.getByRole('button', { name: label })).toBeInTheDocument();
      await settle();
      await expect.element(page.getByText('Get extra storage')).not.toBeInTheDocument();
    },
  );

  test('does not show the upstream "Buy Immich" or supporter block', async ({ data, render }) => {
    setUp(data);
    login(2 * GiB, 10 * GiB);

    await render(BottomInfo, load);

    await expect.element(page.getByText('Get extra storage')).toBeInTheDocument();
    await expect.element(page.getByText(/buy immich/i)).not.toBeInTheDocument();
    expect(document.body.querySelector('.license-status')).toBeNull();
  });

  test('does not show a backups entry, even to an admin with every feature flag on', async ({ data, render }) => {
    setUp(data);
    login(2 * GiB, 10 * GiB);

    await render(BottomInfo, load);

    await expect.element(page.getByText('Get extra storage')).toBeInTheDocument();
    expect(document.body.querySelector('a[href*="backup"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/backup|futo/i);
  });
});
