import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/common/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { expect, vi } from 'vitest';
import { cleanup } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import UserSettingsList from './UserSettingsList.svelte';

const flags = vi.hoisted(() => ({ value: { oauth: false, passwordLogin: true } as Record<string, boolean> }));

vi.mock('#lib/managers/feature-flags-manager.svelte.ts', () => ({
  featureFlagsManager: {
    init: vi.fn(),
    loadFeatureFlags: vi.fn(),
    get value() {
      return flags.value;
    },
  },
}));

// Browser mode evaluates this mock once per file, so a DSN is configured here; the case without one is
// covered in pu-UserSettingsList-without-sentry-dsn.spec.ts.
vi.mock('$app/env/public', () => ({
  PUBLIC_IMMICH_BUY_HOST: 'https://buy.immich.app',
  PUBLIC_IMMICH_PAY_HOST: 'https://pay.futo.org',
  PUBLIC_API_URL: 'https://api.prd.tech.pixelunion.eu',
  PUBLIC_SENTRY_DSN: 'https://dsn.test/1',
  PUBLIC_PU_FAKE_REFERRAL_ID: '',
}));

const load = () => Promise.resolve({});

const login = () => {
  authManager.setUser(factory.user());
  authManager.setPreferences(factory.preferences());
};

// The i18n test setup has no messages loaded, so accordion titles render as their translation keys.
const accordion = (key: string) => page.getByText(key, { exact: true });

// PixelUnion: identity lives in Keycloak, so OAuth tenants get portal-backed account settings instead of native ones.
describe('UserSettingsList (PixelUnion)', () => {
  test('shows native account settings when OAuth is off', async ({ render }) => {
    flags.value = { oauth: false, passwordLogin: true };
    login();

    await render(UserSettingsList, load);

    await expect.element(accordion('account')).toBeInTheDocument();
    await expect.element(accordion('pu_account_security')).not.toBeInTheDocument();
    await expect.element(accordion('pu_email_address')).not.toBeInTheDocument();
  });

  test('replaces native account settings with PixelUnion account security and email change when OAuth is on', async ({
    render,
  }) => {
    flags.value = { oauth: true, passwordLogin: false };
    login();

    await render(UserSettingsList, load);

    await expect.element(accordion('pu_account_security')).toBeInTheDocument();
    await expect.element(accordion('pu_email_address')).toBeInTheDocument();
    await expect.element(accordion('account')).not.toBeInTheDocument();
  });

  test('only shows the password accordion when password login is enabled', async ({ render }) => {
    flags.value = { oauth: true, passwordLogin: false };
    login();
    await render(UserSettingsList, load);
    await expect.element(accordion('pu_account_security')).toBeInTheDocument();
    await expect.element(accordion('password')).not.toBeInTheDocument();
    cleanup();

    flags.value = { oauth: true, passwordLogin: true };
    await render(UserSettingsList, load);
    await expect.element(accordion('password')).toBeInTheDocument();
  });

  test('does not offer native OAuth linking or purchase settings', async ({ render }) => {
    flags.value = { oauth: true, passwordLogin: true };
    login();

    await render(UserSettingsList, load);

    await expect.element(accordion('pu_account_security')).toBeInTheDocument();
    await expect.element(accordion('oauth')).not.toBeInTheDocument();
    await expect.element(accordion('purchase_settings')).not.toBeInTheDocument();
  });

  test('shows privacy (Sentry consent) settings when a Sentry DSN is configured', async ({ render }) => {
    flags.value = { oauth: true, passwordLogin: false };
    login();

    await render(UserSettingsList, load);

    await expect.element(accordion('privacy')).toBeInTheDocument();
  });
});
