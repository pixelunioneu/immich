import { BadRequestException } from '@nestjs/common';
import { Mock } from 'vitest';
import { AuthType } from 'src/enum.js';
import { AuthService } from 'src/services/auth.service.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { OAuthProfileFactory } from 'test/factories/oauth-profile.factory.js';
import { SessionFactory } from 'test/factories/session.factory.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { systemConfigStub } from 'test/fixtures/system-config.stub.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const loginDetails = {
  isSecure: true,
  clientIp: '127.0.0.1',
  deviceOS: '',
  deviceType: '',
  appVersion: null,
};

const callbackDto = { url: 'http://immich/auth/login?code=abc123', state: 'xyz789', codeVerifier: 'foobar' };

// PixelUnion: OIDC token bridge wiring in AuthService (store on OAuth login, revoke on logout, token endpoint).
describe(`${AuthService.name} (PixelUnion OIDC token bridge)`, () => {
  let sut: AuthService;
  let mocks: ServiceMocks;
  let pixelUnionAuth: { revokeStoredToken: Mock; storeRefreshToken: Mock; getOidcToken: Mock };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AuthService));

    // property-injected, so newTestService does not wire it
    pixelUnionAuth = {
      revokeStoredToken: vitest.fn().mockResolvedValue(undefined),
      storeRefreshToken: vitest.fn().mockResolvedValue(undefined),
      getOidcToken: vitest.fn().mockResolvedValue({ accessToken: 'access-token' }),
    };
    (sut as unknown as { pixelUnionAuthService: unknown }).pixelUnionAuthService = pixelUnionAuth;

    mocks.oauth.getLogoutEndpoint.mockResolvedValue('http://end-session-endpoint');
  });

  describe('callback', () => {
    beforeEach(() => {
      const user = UserFactory.create();
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);
      mocks.user.getByEmail.mockResolvedValue(user);
      mocks.user.update.mockResolvedValue(user);
    });

    it('should store the Keycloak refresh token for the new session', async () => {
      const session = SessionFactory.create();
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({
        profile: OAuthProfileFactory.create(),
        refreshToken: 'keycloak-refresh-token',
      });
      mocks.session.create.mockResolvedValue(session);

      await sut.callback(callbackDto, {}, loginDetails);

      expect(pixelUnionAuth.storeRefreshToken).toHaveBeenCalledWith(
        session.id,
        'keycloak-refresh-token',
        expect.any(String),
      );
    });

    it('should not store anything when the provider returns no refresh token', async () => {
      mocks.oauth.getProfileAndOAuthSid.mockResolvedValue({ profile: OAuthProfileFactory.create() });
      mocks.session.create.mockResolvedValue(SessionFactory.create());

      await sut.callback(callbackDto, {}, loginDetails);

      expect(pixelUnionAuth.storeRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should revoke the stored Keycloak refresh token before deleting the session', async () => {
      const auth = AuthFactory.from().session().build();
      mocks.session.get.mockResolvedValue(void 0);
      mocks.session.delete.mockResolvedValue();

      await sut.logout(auth, AuthType.OAuth);

      expect(pixelUnionAuth.revokeStoredToken).toHaveBeenCalledWith(auth.session!.id, auth.user.id);
      expect(pixelUnionAuth.revokeStoredToken.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.session.delete.mock.invocationCallOrder[0],
      );
    });

    it('should still log out when revoking the Keycloak refresh token fails', async () => {
      const auth = AuthFactory.from().session().build();
      mocks.session.get.mockResolvedValue(void 0);
      mocks.session.delete.mockResolvedValue();
      pixelUnionAuth.revokeStoredToken.mockRejectedValue(new Error('keycloak down'));

      await expect(sut.logout(auth, AuthType.Password)).resolves.toEqual({
        successful: true,
        redirectUri: '/auth/login?autoLaunch=0',
      });
      expect(mocks.session.delete).toHaveBeenCalledWith(auth.session!.id);
    });
  });

  describe('getOidcToken', () => {
    it('should require a session token', async () => {
      const auth = AuthFactory.create();

      await expect(sut.getOidcToken({ ...auth, session: undefined })).rejects.toBeInstanceOf(BadRequestException);
      expect(pixelUnionAuth.getOidcToken).not.toHaveBeenCalled();
    });

    it('should delegate to the PixelUnion auth service', async () => {
      const auth = AuthFactory.from().session().build();

      await expect(sut.getOidcToken(auth)).resolves.toEqual({ accessToken: 'access-token' });
      expect(pixelUnionAuth.getOidcToken).toHaveBeenCalledWith(auth.session!.id, auth.user.id);
    });
  });
});
