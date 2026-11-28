import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/common/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { locale as i18nLocale, register } from 'svelte-i18n';
import { expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import ReferralInfo from './ReferralInfo.svelte';

// The shared test setup renders translation keys; these specs assert the English strings.
register('en', () => import('#i18n/en.json'));

beforeAll(async () => {
  await i18nLocale.set('en');
});

const referral = vi.hoisted(() => ({ loadReferral: vi.fn() }));

// Keep the real eligibility rule (the 16 GiB cut-off is fork intent); only the network lookup is faked.
vi.mock('#lib/services/pu-referral.service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/services/pu-referral.service.ts')>()),
  loadReferral: referral.loadReferral,
}));

const GiB = 1024 ** 3;

const load = () => Promise.resolve({});

const login = (quotaSizeInBytes: number | null) => {
  authManager.setUser(factory.user({ quotaSizeInBytes, quotaUsageInBytes: 0 }));
  authManager.setPreferences(factory.preferences());
};

const ok = { status: 'ok', referral: { referral_id: 'abc', referral_url: 'https://pixelunion.eu/?ref=abc' } };

const banner = () => page.getByRole('link', { name: 'Get extra storage' });

// PixelUnion: small-plan tenants with a referral link get a sidebar banner that leads to the referral page.
describe('ReferralInfo (PixelUnion)', () => {
  beforeEach(() => {
    referral.loadReferral.mockReset();
  });

  test('links to the referral page when the tenant has a referral link', async ({ render }) => {
    login(5 * GiB);
    referral.loadReferral.mockResolvedValue(ok);

    await render(ReferralInfo, load);

    await expect.element(banner()).toHaveAttribute('href', '/referral');
  });

  test('is offered up to and including 16 GB of total storage', async ({ render }) => {
    login(16 * GiB);
    referral.loadReferral.mockResolvedValue(ok);

    await render(ReferralInfo, load);

    await expect.element(banner()).toBeInTheDocument();
  });

  test.for([{ status: 'none' }, { status: 'unavailable' }])(
    'shows nothing when the referral lookup returns $status',
    async (result, { render, settle }) => {
      login(5 * GiB);
      referral.loadReferral.mockResolvedValue(result);

      await render(ReferralInfo, load);

      await vi.waitFor(() => expect(referral.loadReferral).toHaveBeenCalled());
      await settle();
      await expect.element(page.getByText('Get extra storage')).not.toBeInTheDocument();
      expect(document.body.querySelector('a')).toBeNull();
    },
  );

  test('is not offered (or looked up) above 16 GB of total storage', async ({ render, settle }) => {
    login(16 * GiB + 1);
    referral.loadReferral.mockResolvedValue(ok);

    await render(ReferralInfo, load);

    await settle();
    expect(referral.loadReferral).not.toHaveBeenCalled();
    await expect.element(page.getByText('Get extra storage')).not.toBeInTheDocument();
  });

  test('uses the server disk size for eligibility when the user has no quota', async ({
    data,
    api,
    render,
    settle,
  }) => {
    login(null);
    Object.assign(data.storage, { diskSizeRaw: 2000 * GiB, diskUseRaw: 0 });
    referral.loadReferral.mockResolvedValue(ok);

    await render(ReferralInfo, load);

    // Wait for the storage lookup, so the component has the disk size it decides on.
    await vi.waitFor(() => expect(api.getStorage.calls).toHaveLength(1));
    await settle();
    expect(referral.loadReferral).not.toHaveBeenCalled();
    await expect.element(page.getByText('Get extra storage')).not.toBeInTheDocument();
  });
});
