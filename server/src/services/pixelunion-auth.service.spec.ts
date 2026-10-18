import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { OAuthRepository } from 'src/repositories/oauth.repository.js';
import { PixelUnionSessionTokenRepository } from 'src/repositories/pixelunion-session-token.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { PixelUnionAuthService } from 'src/services/pixelunion-auth.service.js';
import { systemConfigStub } from 'test/fixtures/system-config.stub.js';
import { ServiceMocks, automock, getMocks } from 'test/utils.js';

const KEY_HEX = 'a'.repeat(64);
const sessionId = 'session-1';
const userId = 'user-1';

describe(PixelUnionAuthService.name, () => {
  let sut: PixelUnionAuthService;
  let mocks: ServiceMocks;
  let tokenRepository: ReturnType<typeof automock<PixelUnionSessionTokenRepository>>;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.IMMICH_KEYCLOAK_TOKEN_ENCRYPTION_KEY;
    process.env.IMMICH_KEYCLOAK_TOKEN_ENCRYPTION_KEY = KEY_HEX;

    mocks = getMocks();
    tokenRepository = automock(PixelUnionSessionTokenRepository);
    tokenRepository.upsert.mockResolvedValue([]);
    tokenRepository.delete.mockResolvedValue([] as never);
    mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.oauthEnabled);

    sut = new PixelUnionAuthService(
      tokenRepository as unknown as PixelUnionSessionTokenRepository,
      mocks.crypto as unknown as CryptoRepository,
      mocks.oauth as unknown as OAuthRepository,
      mocks.config as unknown as ConfigRepository,
      mocks.systemMetadata as unknown as SystemMetadataRepository,
      mocks.logger as unknown as LoggingRepository,
    );
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.IMMICH_KEYCLOAK_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.IMMICH_KEYCLOAK_TOKEN_ENCRYPTION_KEY = originalKey;
    }
  });

  describe('storeRefreshToken', () => {
    it('should encrypt the refresh token with the configured key and upsert it', async () => {
      await sut.storeRefreshToken(sessionId, 'refresh-token', userId);

      expect(mocks.crypto.encryptAesGcm).toHaveBeenCalledWith('refresh-token', Buffer.from(KEY_HEX, 'hex'));
      expect(tokenRepository.upsert).toHaveBeenCalledWith(sessionId, Buffer.from('encrypted:refresh-token'));
      expect(mocks.logger.log).toHaveBeenCalledWith('oidc_token_store', { userId, sessionId });
    });

    it('should never store the plaintext token', async () => {
      await sut.storeRefreshToken(sessionId, 'refresh-token', userId);

      const stored = tokenRepository.upsert.mock.calls[0][1];
      expect(stored.equals(Buffer.from('refresh-token'))).toBe(false);
    });

    it.each([
      ['missing', undefined],
      ['too short', 'ab'],
      ['too long', 'a'.repeat(66)],
    ])('should throw when the encryption key is %s', async (_, value) => {
      if (value === undefined) {
        delete process.env.IMMICH_KEYCLOAK_TOKEN_ENCRYPTION_KEY;
      } else {
        process.env.IMMICH_KEYCLOAK_TOKEN_ENCRYPTION_KEY = value;
      }

      await expect(sut.storeRefreshToken(sessionId, 'refresh-token', userId)).rejects.toThrow(
        'IMMICH_KEYCLOAK_TOKEN_ENCRYPTION_KEY',
      );
      expect(tokenRepository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getOidcToken', () => {
    it('should require reauth when no token is stored for the session', async () => {
      tokenRepository.get.mockResolvedValue(undefined);

      await expect(sut.getOidcToken(sessionId, userId)).resolves.toEqual({ reauth: true });
      expect(mocks.oauth.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('should require reauth when OAuth is disabled', async () => {
      tokenRepository.get.mockResolvedValue({ keycloakRefreshToken: Buffer.from('encrypted:refresh-token') });
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.disabled);

      await expect(sut.getOidcToken(sessionId, userId)).resolves.toEqual({ reauth: true });
      expect(mocks.oauth.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('should exchange the stored refresh token for an access token', async () => {
      tokenRepository.get.mockResolvedValue({ keycloakRefreshToken: Buffer.from('encrypted:refresh-token') });
      mocks.oauth.refreshAccessToken.mockResolvedValue({ accessToken: 'access-token' });

      await expect(sut.getOidcToken(sessionId, userId)).resolves.toEqual({ accessToken: 'access-token' });

      expect(mocks.oauth.refreshAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
        'refresh-token',
      );
      expect(tokenRepository.upsert).not.toHaveBeenCalled();
      expect(tokenRepository.delete).not.toHaveBeenCalled();
      expect(mocks.logger.log).toHaveBeenCalledWith('oidc_token_refresh', { userId, sessionId, rotated: false });
    });

    it('should store a rotated refresh token', async () => {
      tokenRepository.get.mockResolvedValue({ keycloakRefreshToken: Buffer.from('encrypted:refresh-token') });
      mocks.oauth.refreshAccessToken.mockResolvedValue({
        accessToken: 'access-token',
        newRefreshToken: 'new-refresh-token',
      });

      await expect(sut.getOidcToken(sessionId, userId)).resolves.toEqual({ accessToken: 'access-token' });

      expect(tokenRepository.upsert).toHaveBeenCalledWith(sessionId, Buffer.from('encrypted:new-refresh-token'));
      expect(mocks.logger.log).toHaveBeenCalledWith('oidc_token_refresh', { userId, sessionId, rotated: true });
    });

    it('should delete the stored token and require reauth when decryption fails', async () => {
      tokenRepository.get.mockResolvedValue({ keycloakRefreshToken: Buffer.from('garbage') });
      mocks.crypto.decryptAesGcm.mockImplementation(() => {
        throw new Error('Unsupported state or unable to authenticate data');
      });

      await expect(sut.getOidcToken(sessionId, userId)).resolves.toEqual({ reauth: true });

      expect(tokenRepository.delete).toHaveBeenCalledWith(sessionId);
      expect(mocks.oauth.refreshAccessToken).not.toHaveBeenCalled();
      expect(mocks.logger.log).toHaveBeenCalledWith('oidc_token_refresh_failed', {
        userId,
        sessionId,
        reason: 'decrypt_failed',
      });
    });

    it('should delete the stored token and require reauth when the refresh exchange fails', async () => {
      tokenRepository.get.mockResolvedValue({ keycloakRefreshToken: Buffer.from('encrypted:refresh-token') });
      mocks.oauth.refreshAccessToken.mockRejectedValue(new Error('invalid_grant'));

      await expect(sut.getOidcToken(sessionId, userId)).resolves.toEqual({ reauth: true });

      expect(tokenRepository.delete).toHaveBeenCalledWith(sessionId);
      expect(mocks.logger.log).toHaveBeenCalledWith('oidc_token_refresh_failed', {
        userId,
        sessionId,
        reason: 'refresh_exchange_failed',
      });
    });
  });

  describe('revokeStoredToken', () => {
    it('should do nothing without a session', async () => {
      await sut.revokeStoredToken(undefined, userId);

      expect(tokenRepository.get).not.toHaveBeenCalled();
      expect(mocks.oauth.revokeToken).not.toHaveBeenCalled();
    });

    it('should do nothing when no token is stored', async () => {
      tokenRepository.get.mockResolvedValue(undefined);

      await sut.revokeStoredToken(sessionId, userId);

      expect(mocks.oauth.revokeToken).not.toHaveBeenCalled();
    });

    it('should do nothing when OAuth is disabled', async () => {
      tokenRepository.get.mockResolvedValue({ keycloakRefreshToken: Buffer.from('encrypted:refresh-token') });
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.disabled);

      await sut.revokeStoredToken(sessionId, userId);

      expect(mocks.oauth.revokeToken).not.toHaveBeenCalled();
    });

    it('should revoke the decrypted refresh token at the provider', async () => {
      tokenRepository.get.mockResolvedValue({ keycloakRefreshToken: Buffer.from('encrypted:refresh-token') });
      mocks.oauth.revokeToken.mockResolvedValue();

      await sut.revokeStoredToken(sessionId, userId);

      expect(mocks.oauth.revokeToken).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }), 'refresh-token');
      expect(mocks.logger.log).toHaveBeenCalledWith('oidc_token_revoke', { userId, sessionId });
    });

    it('should swallow revocation failures', async () => {
      tokenRepository.get.mockResolvedValue({ keycloakRefreshToken: Buffer.from('encrypted:refresh-token') });
      mocks.oauth.revokeToken.mockRejectedValue(new Error('network down'));

      await expect(sut.revokeStoredToken(sessionId, userId)).resolves.toBeUndefined();

      expect(mocks.logger.warn).toHaveBeenCalled();
      expect(mocks.logger.log).toHaveBeenCalledWith('oidc_token_revoke_failed', { userId, sessionId });
    });
  });

  it('should not leak the refresh token into audit logs', async () => {
    tokenRepository.get.mockResolvedValue({ keycloakRefreshToken: Buffer.from('encrypted:refresh-token') });
    mocks.oauth.refreshAccessToken.mockResolvedValue({
      accessToken: 'access-token',
      newRefreshToken: 'rotated-secret',
    });

    await sut.storeRefreshToken(sessionId, 'refresh-token', userId);
    await sut.getOidcToken(sessionId, userId);

    const logged = JSON.stringify([
      ...mocks.logger.log.mock.calls,
      ...mocks.logger.warn.mock.calls,
      ...vitest.mocked(mocks.logger.debug).mock.calls,
    ]);
    expect(logged).not.toContain('refresh-token');
    expect(logged).not.toContain('rotated-secret');
    expect(logged).not.toContain('access-token');
  });
});
