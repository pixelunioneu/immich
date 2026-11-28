import { factory } from '#test/common/factories.ts';
import * as Sentry from '@sentry/sveltekit';

// Browser mode evaluates this mock once per file, so the DSN is fixed here (empty). The cases with a DSN
// are in sentry-manager.svelte.spec.ts.
vi.mock('$app/env/public', () => ({ PUBLIC_SENTRY_DSN: '' }));

vi.mock('@sentry/sveltekit', () => {
  const close = vi.fn();
  return {
    init: vi.fn(),
    setUser: vi.fn(),
    getClient: vi.fn(() => ({ close })),
  };
});

const user = factory.user({ id: 'user-1', email: 'user@example.com' });

// PixelUnion: opt-in Sentry (errors only), never before login and never without consent or a DSN.
describe('SentryManager', () => {
  it('does not initialize without a DSN, even with consent', async () => {
    const { authManager } = await import('#lib/managers/auth-manager.svelte.ts');
    const { eventManager } = await import('#lib/managers/event-manager.svelte.ts');
    await import('#lib/managers/sentry-manager.svelte.ts');
    authManager.setPreferences(factory.preferences({ telemetry: { enabled: true } }));

    eventManager.emit('AuthUserLoaded', user);

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.setUser).not.toHaveBeenCalledWith(expect.objectContaining({ id: user.id }));
  });
});
