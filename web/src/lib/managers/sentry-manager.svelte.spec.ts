import { factory } from '#test/common/factories.ts';
import * as Sentry from '@sentry/sveltekit';

// Browser mode evaluates this mock once per file, so the DSN is fixed here; the case without a DSN is
// covered in sentry-manager-without-dsn.svelte.spec.ts.
vi.mock('$app/env/public', () => ({ PUBLIC_SENTRY_DSN: 'https://dsn.test/1' }));

vi.mock('@sentry/sveltekit', () => {
  const close = vi.fn();
  return {
    init: vi.fn(),
    setUser: vi.fn(),
    getClient: vi.fn(() => ({ close })),
  };
});

const user = factory.user({ id: 'user-1', email: 'user@example.com' });
const withTelemetry = (enabled: boolean) => factory.preferences({ telemetry: { enabled } });

const cleanups: Array<() => void> = [];

/**
The manager subscribes at import time. Browser mode cannot reset the module registry, so the shared
instance is reused (and logged out after each test) and `loadFresh` is only for the import-time cases.
*/
const load = async () => {
  const { authManager } = await import('#lib/managers/auth-manager.svelte.ts');
  const { eventManager } = await import('#lib/managers/event-manager.svelte.ts');
  const { sentryManager } = await import('#lib/managers/sentry-manager.svelte.ts');
  return { authManager, eventManager, sentryManager };
};

/** A new manager instance (a distinct module URL), whose event subscriptions are removed after the test. */
const loadFresh = async (instance: 'without-login' | 'with-login') => {
  const { eventManager } = await import('#lib/managers/event-manager.svelte.ts');
  const on = eventManager.on.bind(eventManager);
  const spy = vi.spyOn(eventManager, 'on').mockImplementation((subscriptions) => {
    const cleanup = on(subscriptions);
    cleanups.push(cleanup);
    return cleanup;
  });
  try {
    // A query string makes the browser evaluate the module again; TypeScript has no types for such specifiers.
    const module =
      instance === 'without-login'
        ? // @ts-expect-error -- query-suffixed specifier
          await import('#lib/managers/sentry-manager.svelte.ts?without-login')
        : // @ts-expect-error -- query-suffixed specifier
          await import('#lib/managers/sentry-manager.svelte.ts?with-login');
    return module as typeof import('#lib/managers/sentry-manager.svelte.ts');
  } finally {
    spy.mockRestore();
  }
};

// PixelUnion: opt-in Sentry (errors only), never before login and never without consent or a DSN.
describe('SentryManager', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    const { authManager } = await import('#lib/managers/auth-manager.svelte.ts');
    const { eventManager } = await import('#lib/managers/event-manager.svelte.ts');
    eventManager.emit('AuthLogout');
    authManager.reset();
  });

  beforeEach(() => {
    vi.mocked(Sentry.init).mockClear();
    vi.mocked(Sentry.setUser).mockClear();
    vi.mocked(Sentry.getClient()!.close).mockClear();
  });

  it('does not initialize at import time', async () => {
    await loadFresh('without-login');

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('does not initialize without telemetry consent', async () => {
    const { authManager, eventManager } = await load();
    authManager.setPreferences(withTelemetry(false));

    eventManager.emit('AuthUserLoaded', user);

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initializes errors-only with consent and a DSN', async () => {
    const { authManager, eventManager } = await load();
    authManager.setPreferences(withTelemetry(true));

    eventManager.emit('AuthUserLoaded', user);

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith({ dsn: 'https://dsn.test/1', integrations: [], tracesSampleRate: 0 });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: user.id, email: user.email });
  });

  it('initializes only once', async () => {
    const { authManager, eventManager } = await load();
    authManager.setPreferences(withTelemetry(true));

    eventManager.emit('AuthUserLoaded', user);
    eventManager.emit('AuthUserLoaded', user);

    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  it('initializes at import time when already logged in with consent', async () => {
    const { authManager } = await import('#lib/managers/auth-manager.svelte.ts');
    authManager.setUser(user);
    authManager.setPreferences(withTelemetry(true));

    await loadFresh('with-login');

    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  it('shuts down and clears the user on logout', async () => {
    const { authManager, eventManager } = await load();
    authManager.setPreferences(withTelemetry(true));
    eventManager.emit('AuthUserLoaded', user);

    eventManager.emit('AuthLogout');

    expect(Sentry.getClient()!.close).toHaveBeenCalledTimes(1);
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
  });

  it('shuts down when consent is withdrawn', async () => {
    const { authManager, eventManager, sentryManager } = await load();
    authManager.setPreferences(withTelemetry(true));
    eventManager.emit('AuthUserLoaded', user);

    authManager.setPreferences(withTelemetry(false));
    sentryManager.sync(user);

    expect(Sentry.getClient()!.close).toHaveBeenCalledTimes(1);
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
  });
});
