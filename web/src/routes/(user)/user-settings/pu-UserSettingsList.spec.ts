import { render, screen } from '@testing-library/svelte';
import UserSettingsList from './UserSettingsList.svelte';

const flags = vi.hoisted(() => ({ value: { oauth: false, passwordLogin: true } as Record<string, boolean> }));
const env = vi.hoisted(() => ({ PUBLIC_SENTRY_DSN: '' }));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: {
    init: vi.fn(),
    loadFeatureFlags: vi.fn(),
    get value() {
      return flags.value;
    },
  },
}));

vi.mock('$env/static/public', () => env);

// The i18n test setup has no messages loaded, so accordion titles render as their translation keys.
const has = (key: string) => screen.queryByText(key) !== null;

// PixelUnion: identity lives in Keycloak, so OAuth tenants get portal-backed account settings instead of native ones.
describe('UserSettingsList (PixelUnion)', () => {
  it('shows native account settings when OAuth is off', () => {
    flags.value = { oauth: false, passwordLogin: true };

    render(UserSettingsList);

    expect(has('account')).toBe(true);
    expect(has('pu_account_security')).toBe(false);
    expect(has('pu_email_address')).toBe(false);
  });

  it('replaces native account settings with PixelUnion account security and email change when OAuth is on', () => {
    flags.value = { oauth: true, passwordLogin: false };

    render(UserSettingsList);

    expect(has('account')).toBe(false);
    expect(has('pu_account_security')).toBe(true);
    expect(has('pu_email_address')).toBe(true);
  });

  it('only shows the password accordion when password login is enabled', () => {
    flags.value = { oauth: true, passwordLogin: false };
    const { unmount } = render(UserSettingsList);
    expect(has('password')).toBe(false);
    unmount();

    flags.value = { oauth: true, passwordLogin: true };
    render(UserSettingsList);
    expect(has('password')).toBe(true);
  });

  it('does not offer native OAuth linking or purchase settings', () => {
    flags.value = { oauth: true, passwordLogin: true };

    render(UserSettingsList);

    expect(has('oauth')).toBe(false);
    expect(has('purchase_settings')).toBe(false);
  });

  it('only shows privacy (Sentry consent) settings when a Sentry DSN is configured', () => {
    flags.value = { oauth: true, passwordLogin: false };
    const { unmount } = render(UserSettingsList);
    expect(has('privacy')).toBe(false);
    unmount();

    env.PUBLIC_SENTRY_DSN = 'https://dsn.test/1';
    try {
      render(UserSettingsList);
      expect(has('privacy')).toBe(true);
    } finally {
      env.PUBLIC_SENTRY_DSN = '';
    }
  });
});
