import { Injectable } from '@nestjs/common';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { OAuthRepository } from 'src/repositories/oauth.repository';
import { PixelUnionSessionTokenRepository } from 'src/repositories/pixelunion-session-token.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { getConfig } from 'src/utils/config';

export type OidcTokenResult =
  | { accessToken: string; reauth?: never }
  | { reauth: true; accessToken?: never };

type OidcTokenAuditEvent =
  | 'oidc_token_store'
  | 'oidc_token_refresh'
  | 'oidc_token_refresh_failed'
  | 'oidc_token_revoke'
  | 'oidc_token_revoke_failed';

@Injectable()
export class PixelUnionAuthService {
  constructor(
    private tokenRepository: PixelUnionSessionTokenRepository,
    private cryptoRepository: CryptoRepository,
    private oauthRepository: OAuthRepository,
    private configRepository: ConfigRepository,
    private systemMetadataRepository: SystemMetadataRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(PixelUnionAuthService.name);
  }

  private get configRepos() {
    return { configRepo: this.configRepository, metadataRepo: this.systemMetadataRepository, logger: this.logger };
  }

  private getEncryptionKey(): Buffer {
    const hex = process.env.IMMICH_KEYCLOAK_TOKEN_ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
      throw new Error('IMMICH_KEYCLOAK_TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
    }
    return Buffer.from(hex, 'hex');
  }

  private decryptRefreshToken(encrypted: Buffer): string {
    return this.cryptoRepository.decryptAesGcm(encrypted, this.getEncryptionKey());
  }

  private audit(event: OidcTokenAuditEvent, userId: string, sessionId: string, details?: Record<string, unknown>): void {
    this.logger.log(event, { userId, sessionId, ...details });
  }

  async storeRefreshToken(sessionId: string, refreshToken: string, userId: string): Promise<void> {
    const encrypted = this.cryptoRepository.encryptAesGcm(refreshToken, this.getEncryptionKey());
    await this.tokenRepository.upsert(sessionId, encrypted);
    this.audit('oidc_token_store', userId, sessionId);
  }

  async revokeStoredToken(sessionId: string | undefined, userId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    const row = await this.tokenRepository.get(sessionId);
    if (!row?.keycloakRefreshToken) {
      return;
    }

    const { oauth } = await getConfig(this.configRepos, { withCache: true });
    if (!oauth.enabled) {
      return;
    }

    try {
      const refreshToken = this.decryptRefreshToken(row.keycloakRefreshToken);
      await this.oauthRepository.revokeToken(oauth, refreshToken);
      this.audit('oidc_token_revoke', userId, sessionId);
    } catch (error) {
      this.logger.warn(`Failed to revoke Keycloak token for session ${sessionId}: ${error}`);
      this.audit('oidc_token_revoke_failed', userId, sessionId);
    }
  }

  async getOidcToken(sessionId: string, userId: string): Promise<OidcTokenResult> {
    const row = await this.tokenRepository.get(sessionId);
    if (!row?.keycloakRefreshToken) {
      return { reauth: true };
    }

    const { oauth } = await getConfig(this.configRepos, { withCache: true });
    if (!oauth.enabled) {
      return { reauth: true };
    }

    let refreshToken: string;
    try {
      refreshToken = this.decryptRefreshToken(row.keycloakRefreshToken);
    } catch {
      await this.tokenRepository.delete(sessionId);
      this.audit('oidc_token_refresh_failed', userId, sessionId, { reason: 'decrypt_failed' });
      return { reauth: true };
    }

    try {
      const { accessToken, newRefreshToken } = await this.oauthRepository.refreshAccessToken(oauth, refreshToken);

      if (newRefreshToken) {
        const encrypted = this.cryptoRepository.encryptAesGcm(newRefreshToken, this.getEncryptionKey());
        await this.tokenRepository.upsert(sessionId, encrypted);
      }

      this.audit('oidc_token_refresh', userId, sessionId, { rotated: !!newRefreshToken });
      return { accessToken };
    } catch (error) {
      this.logger.warn(`Refresh token exchange failed for session ${sessionId}: ${error}`);
      await this.tokenRepository.delete(sessionId);
      this.audit('oidc_token_refresh_failed', userId, sessionId, { reason: 'refresh_exchange_failed' });
      return { reauth: true };
    }
  }
}
