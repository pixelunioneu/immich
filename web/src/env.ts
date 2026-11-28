import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  PUBLIC_IMMICH_BUY_HOST: { public: true, static: true },
  PUBLIC_IMMICH_PAY_HOST: { public: true, static: true },
  // PixelUnion: defaults for the two below are set in vite.config.ts
  PUBLIC_API_URL: { public: true, static: true },
  PUBLIC_SENTRY_DSN: { public: true, static: true },
  // PixelUnion, dev builds only: a fixed referral id, because the lookup by host never matches localhost
  PUBLIC_PU_FAKE_REFERRAL_ID: { public: true, static: true, schema: (value) => value },
});
