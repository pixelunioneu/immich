import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/common/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import UserSettingsList from './UserSettingsList.svelte';

vi.mock('#lib/managers/feature-flags-manager.svelte.ts', () => ({
  featureFlagsManager: {
    init: vi.fn(),
    loadFeatureFlags: vi.fn(),
    value: { oauth: true, passwordLogin: false },
  },
}));

// Browser mode evaluates this mock once per file, so no DSN is configured here; the case with one is
// covered in pu-UserSettingsList.spec.ts.
vi.mock('$app/env/public', () => ({
  PUBLIC_IMMICH_BUY_HOST: 'https://buy.immich.app',
  PUBLIC_IMMICH_PAY_HOST: 'https://pay.futo.org',
  PUBLIC_API_URL: 'https://api.prd.tech.pixelunion.eu',
  PUBLIC_SENTRY_DSN: '',
  PUBLIC_PU_FAKE_REFERRAL_ID: '',
}));

const load = () => Promise.resolve({});

// The i18n test setup has no messages loaded, so accordion titles render as their translation keys.
const accordion = (key: string) => page.getByText(key, { exact: true });

// PixelUnion: identity lives in Keycloak, so OAuth tenants get portal-backed account settings instead of native ones.
describe('UserSettingsList (PixelUnion)', () => {
  test('does not show privacy (Sentry consent) settings without a Sentry DSN', async ({ render }) => {
    authManager.setUser(factory.user());
    authManager.setPreferences(factory.preferences());

    await render(UserSettingsList, load);

    await expect.element(accordion('pu_account_security')).toBeInTheDocument();
    await expect.element(accordion('privacy')).not.toBeInTheDocument();
  });
});
