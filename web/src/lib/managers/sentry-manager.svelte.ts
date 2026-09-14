import * as Sentry from '@sentry/sveltekit';
import type { UserAdminResponseDto } from '@immich/sdk';
import { PUBLIC_SENTRY_DSN } from '$env/static/public';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';

/**
 * PixelUnion addition: opt-in Sentry error tracking, per user, errors only —
 * no tracing, no session replay (this app displays private photos on screen).
 * Never initializes before login, since consent is only known once the
 * user's preferences have loaded.
 */
class SentryManager {
  #enabled = false;

  constructor() {
    eventManager.on({
      AuthUserLoaded: (user) => this.sync(user),
      AuthLogout: () => this.disable(),
    });

    if (authManager.authenticated) {
      this.sync(authManager.user);
    }
  }

  sync(user: UserAdminResponseDto) {
    if (authManager.preferences.telemetry?.enabled) {
      this.enable(user);
    } else {
      this.disable();
    }
  }

  private enable(user: UserAdminResponseDto) {
    if (!PUBLIC_SENTRY_DSN) {
      return;
    }

    if (!this.#enabled) {
      Sentry.init({
        dsn: PUBLIC_SENTRY_DSN,
        integrations: [],
        tracesSampleRate: 0,
      });
      this.#enabled = true;
    }

    Sentry.setUser({ id: user.id, email: user.email });
  }

  private disable() {
    if (this.#enabled) {
      Sentry.getClient()?.close();
      this.#enabled = false;
    }

    Sentry.setUser(null);
  }
}

export const sentryManager = new SentryManager();
