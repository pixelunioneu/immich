import { render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import ReferralInfo from './ReferralInfo.svelte';

const referral = vi.hoisted(() => ({ loadReferral: vi.fn() }));

// Keep the real eligibility rule (the 16 GiB cut-off is fork intent); only the network lookup is faked.
vi.mock('$lib/services/pu-referral.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/pu-referral.service')>()),
  loadReferral: referral.loadReferral,
}));

const GiB = 1024 ** 3;

// Lets the referral lookup resolve and the component re-render before checking that something is absent.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const login = (quotaSizeInBytes: number | null) => {
  authManager.setUser(userAdminFactory.build({ quotaSizeInBytes, quotaUsageInBytes: 0 }));
  authManager.setPreferences(preferencesFactory.build());
};

const ok = { status: 'ok', referral: { referral_id: 'abc', referral_url: 'https://pixelunion.eu/?ref=abc' } };

// PixelUnion: small-plan tenants with a referral link get a sidebar banner that leads to the referral page.
describe('ReferralInfo (PixelUnion)', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  afterEach(() => {
    authManager.reset();
    userInteraction.serverInfo = undefined;
    referral.loadReferral.mockReset();
  });

  it('links to the referral page when the tenant has a referral link', async () => {
    login(5 * GiB);
    referral.loadReferral.mockResolvedValue(ok);

    render(ReferralInfo);

    const link = await screen.findByRole('link', { name: 'Get extra storage' });
    expect(link).toHaveAttribute('href', '/referral');
  });

  it('is offered up to and including 16 GB of total storage', async () => {
    login(16 * GiB);
    referral.loadReferral.mockResolvedValue(ok);

    render(ReferralInfo);

    expect(await screen.findByRole('link', { name: 'Get extra storage' })).toBeInTheDocument();
  });

  it.each([{ status: 'none' }, { status: 'unavailable' }])(
    'shows nothing when the referral lookup returns $status',
    async (result) => {
      login(5 * GiB);
      referral.loadReferral.mockResolvedValue(result);

      const { container } = render(ReferralInfo);

      await vi.waitFor(() => expect(referral.loadReferral).toHaveBeenCalled());
      await settle();
      expect(screen.queryByText('Get extra storage')).not.toBeInTheDocument();
      expect(container.querySelector('a')).toBeNull();
    },
  );

  it('is not offered (or looked up) above 16 GB of total storage', async () => {
    login(16 * GiB + 1);
    referral.loadReferral.mockResolvedValue(ok);

    render(ReferralInfo);

    await settle();
    expect(referral.loadReferral).not.toHaveBeenCalled();
    expect(screen.queryByText('Get extra storage')).not.toBeInTheDocument();
  });

  it('uses the server disk size for eligibility when the user has no quota', async () => {
    login(null);
    userInteraction.serverInfo = { diskSizeRaw: 2000 * GiB, diskUseRaw: 0 } as typeof userInteraction.serverInfo;
    referral.loadReferral.mockResolvedValue(ok);

    render(ReferralInfo);

    await settle();
    expect(referral.loadReferral).not.toHaveBeenCalled();
    expect(screen.queryByText('Get extra storage')).not.toBeInTheDocument();
  });
});
