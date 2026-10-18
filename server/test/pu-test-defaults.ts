import { vitest } from 'vitest';
import { AuthService } from 'src/services/auth.service.js';

/**
 * PixelUnion: wires default stubs for fork dependencies that services receive through
 * property injection, which newTestService's constructor wiring does not cover. Keeps
 * upstream specs runnable without fork edits.
 */
export const applyPixelUnionTestDefaults = (sut: unknown) => {
  if (sut instanceof AuthService) {
    (sut as unknown as { pixelUnionAuthService: unknown }).pixelUnionAuthService = {
      revokeStoredToken: vitest.fn().mockResolvedValue(undefined),
      storeRefreshToken: vitest.fn().mockResolvedValue(undefined),
      getOidcToken: vitest.fn().mockResolvedValue({ accessToken: 'access-token' }),
    };
  }
};
