import type { ServerAboutResponseDto } from '@immich/sdk';
import { cleanup, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { userInteraction } from '$lib/stores/user.svelte';
import { PU_BILLING_PORTAL_URL } from '#lib/utils/pu-api.ts';
import { renderWithTooltips } from '$tests/helpers';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import AccountInfoPanel from './AccountInfoPanel.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/photos'), route: { id: null }, params: {} } }));

const login = (isAdmin: boolean) => {
  authManager.setUser(userAdminFactory.build({ isAdmin, name: 'Test User', email: 'test@example.com' }));
  authManager.setPreferences(preferencesFactory.build());
};

const link = (name: string) => screen.getByRole('link', { name });

// PixelUnion: the account menu adds a billing link (Stripe portal) for tenant owners, sends admins to the
// user list rather than the server settings, and offers the referral ("invite a friend") page.
describe('AccountInfoPanel (PixelUnion)', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  beforeEach(() => {
    userInteraction.aboutInfo = {} as ServerAboutResponseDto;
    sdkMock.getAboutInfo.mockResolvedValue({} as ServerAboutResponseDto);
  });

  afterEach(() => {
    // Unmount before logging out: the panel reads the user while it renders.
    cleanup();
    authManager.reset();
    userInteraction.aboutInfo = undefined;
  });

  it('gives admins a Billing link to the Stripe customer portal', () => {
    login(true);

    renderWithTooltips(AccountInfoPanel, {});

    expect(link('Billing')).toHaveAttribute('href', PU_BILLING_PORTAL_URL);
    expect(PU_BILLING_PORTAL_URL).toMatch(/^https:\/\/billing\.stripe\.com\//);
  });

  it('does not show the Billing link to regular users', () => {
    login(false);

    renderWithTooltips(AccountInfoPanel, {});

    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
  });

  it('sends admins to the user list, not the server settings', () => {
    login(true);

    renderWithTooltips(AccountInfoPanel, {});

    expect(link('Administration')).toHaveAttribute('href', '/admin/users');
  });

  it('offers every user an invite-a-friend link to the referral page', () => {
    login(false);

    renderWithTooltips(AccountInfoPanel, {});

    expect(link('Invite a friend')).toHaveAttribute('href', '/referral');
  });

  it('keeps account settings and sign out', () => {
    login(false);

    renderWithTooltips(AccountInfoPanel, {});

    expect(link('Account Settings')).toHaveAttribute('href', '/user-settings');
    expect(link('Sign Out')).toHaveAttribute('href', '/auth/logout');
  });

  it('closes the menu when a fork link is followed', async () => {
    login(true);
    const onClose = vi.fn();

    renderWithTooltips(AccountInfoPanel, { onClose });
    for (const name of ['Billing', 'Invite a friend']) {
      link(name).addEventListener('click', (event) => event.preventDefault());
      link(name).click();
    }

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
