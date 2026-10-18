import * as Sentry from '@sentry/sveltekit';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';

const env = vi.hoisted(() => ({ PUBLIC_SENTRY_DSN: '' }));

vi.mock('$env/static/public', () => env);

vi.mock('@sentry/sveltekit', () => {
  const close = vi.fn();
  return {
    init: vi.fn(),
    setUser: vi.fn(),
    getClient: vi.fn(() => ({ close })),
  };
});

const user = userAdminFactory.build({ id: 'user-1', email: 'user@example.com' });
const withTelemetry = (enabled: boolean) => preferencesFactory.build({ telemetry: { enabled } });

/** The manager subscribes at import time, so load a fresh copy (with fresh auth/event managers) per test. */
const load = async (dsn: string) => {
  env.PUBLIC_SENTRY_DSN = dsn;
  vi.resetModules();
  const { authManager } = await import('$lib/managers/auth-manager.svelte');
  const { eventManager } = await import('$lib/managers/event-manager.svelte');
  const { sentryManager } = await import('$lib/managers/sentry-manager.svelte');
  return { authManager, eventManager, sentryManager };
};

// PixelUnion: opt-in Sentry (errors only), never before login and never without consent or a DSN.
describe('SentryManager', () => {
  beforeEach(() => {
    vi.mocked(Sentry.init).mockClear();
    vi.mocked(Sentry.setUser).mockClear();
    vi.mocked(Sentry.getClient()!.close).mockClear();
  });

  it('does not initialize at import time', async () => {
    await load('https://dsn.test/1');

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('does not initialize without telemetry consent', async () => {
    const { authManager, eventManager } = await load('https://dsn.test/1');
    authManager.setPreferences(withTelemetry(false));

    eventManager.emit('AuthUserLoaded', user);

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('does not initialize without a DSN, even with consent', async () => {
    const { authManager, eventManager } = await load('');
    authManager.setPreferences(withTelemetry(true));

    eventManager.emit('AuthUserLoaded', user);

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.setUser).not.toHaveBeenCalledWith(expect.objectContaining({ id: user.id }));
  });

  it('initializes errors-only with consent and a DSN', async () => {
    const { authManager, eventManager } = await load('https://dsn.test/1');
    authManager.setPreferences(withTelemetry(true));

    eventManager.emit('AuthUserLoaded', user);

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith({ dsn: 'https://dsn.test/1', integrations: [], tracesSampleRate: 0 });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: user.id, email: user.email });
  });

  it('initializes only once', async () => {
    const { authManager, eventManager } = await load('https://dsn.test/1');
    authManager.setPreferences(withTelemetry(true));

    eventManager.emit('AuthUserLoaded', user);
    eventManager.emit('AuthUserLoaded', user);

    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  it('initializes at import time when already logged in with consent', async () => {
    env.PUBLIC_SENTRY_DSN = 'https://dsn.test/1';
    vi.resetModules();
    const { authManager } = await import('$lib/managers/auth-manager.svelte');
    authManager.setUser(user);
    authManager.setPreferences(withTelemetry(true));

    await import('$lib/managers/sentry-manager.svelte');

    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  it('shuts down and clears the user on logout', async () => {
    const { authManager, eventManager } = await load('https://dsn.test/1');
    authManager.setPreferences(withTelemetry(true));
    eventManager.emit('AuthUserLoaded', user);

    eventManager.emit('AuthLogout');

    expect(Sentry.getClient()!.close).toHaveBeenCalledTimes(1);
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
  });

  it('shuts down when consent is withdrawn', async () => {
    const { authManager, eventManager, sentryManager } = await load('https://dsn.test/1');
    authManager.setPreferences(withTelemetry(true));
    eventManager.emit('AuthUserLoaded', user);

    authManager.setPreferences(withTelemetry(false));
    sentryManager.sync(user);

    expect(Sentry.getClient()!.close).toHaveBeenCalledTimes(1);
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
  });
});
