import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { PU_BILLING_PORTAL_URL } from '#lib/utils/pu-api.ts';
import { factory } from '#test/common/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import type { PageComponent } from '#test/unit/mocks/mock.ts';
import { locale as i18nLocale, register } from 'svelte-i18n';
import { expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import AccountInfoPanel from './AccountInfoPanel.svelte';

// The shared test setup renders translation keys; these specs assert the English strings.
register('en', () => import('#i18n/en.json'));

beforeAll(async () => {
  await i18nLocale.set('en');
});

const load = () => Promise.resolve({});

// `render` only passes page data to the component; this is how the panel gets its `onClose` prop.
const panelWith = (props: { onClose?: () => void }) =>
  ((anchor: Comment) =>
    (AccountInfoPanel as unknown as (anchor: Comment, props: object) => void)(
      anchor,
      props,
    )) as unknown as PageComponent;

const login = (isAdmin: boolean) => {
  authManager.setUser(factory.user({ isAdmin, name: 'Test User', email: 'test@example.com' }));
  authManager.setPreferences(factory.preferences());
};

const link = (name: string) => page.getByRole('link', { name, exact: true });

// PixelUnion: the account menu adds a billing link (Stripe portal) for tenant owners, sends admins to the
// user list rather than the server settings, and offers the referral ("invite a friend") page.
describe('AccountInfoPanel (PixelUnion)', () => {
  test('gives admins a Billing link to the Stripe customer portal', async ({ render }) => {
    login(true);

    await render(panelWith({}), load);

    await expect.element(link('Billing')).toHaveAttribute('href', PU_BILLING_PORTAL_URL);
    expect(PU_BILLING_PORTAL_URL).toMatch(/^https:\/\/billing\.stripe\.com\//);
  });

  test('does not show the Billing link to regular users', async ({ render }) => {
    login(false);

    await render(panelWith({}), load);

    await expect.element(link('Account Settings')).toBeInTheDocument();
    await expect.element(link('Billing')).not.toBeInTheDocument();
    await expect.element(link('Administration')).not.toBeInTheDocument();
  });

  test('sends admins to the user list, not the server settings', async ({ render }) => {
    login(true);

    await render(panelWith({}), load);

    await expect.element(link('Administration')).toHaveAttribute('href', '/admin/users');
  });

  test('offers every user an invite-a-friend link to the referral page', async ({ render }) => {
    login(false);

    await render(panelWith({}), load);

    await expect.element(link('Invite a friend')).toHaveAttribute('href', '/referral');
  });

  test('keeps account settings and sign out', async ({ render }) => {
    login(false);

    await render(panelWith({}), load);

    await expect.element(link('Account Settings')).toHaveAttribute('href', '/user-settings');
    await expect.element(link('Sign Out')).toHaveAttribute('href', '/auth/logout');
  });

  test('closes the menu when a fork link is followed', async ({ render }) => {
    login(true);
    const onClose = vi.fn();

    await render(panelWith({ onClose }), load);
    for (const name of ['Billing', 'Invite a friend']) {
      const element = link(name);
      await expect.element(element).toBeInTheDocument();
      element.element().addEventListener('click', (event) => event.preventDefault());
      await element.click();
    }

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
