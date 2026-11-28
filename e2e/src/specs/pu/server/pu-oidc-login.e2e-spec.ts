import {
  app,
  asBearerAuth,
  authServerUrl,
  closeDb,
  db,
  LoginResponse,
  loginWithOAuth,
  newOAuthSub,
  OAuthAdmin,
} from 'src/pu/helpers.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
The fork's login is OIDC-only (Keycloak). These run the whole flow against the
e2e-auth-server mock: authorize, the provider's login and consent pages, the code
exchange at /api/oauth/callback, and the OIDC token bridge that keeps the
provider's refresh token per session.
*/
describe('PixelUnion OIDC login', () => {
  afterAll(async () => {
    await closeDb();
  });

  describe('first login', () => {
    let login: LoginResponse;
    let sub: string;

    beforeAll(async () => {
      sub = newOAuthSub();
      login = await loginWithOAuth(sub);
    });

    it('auto-registers a new user from the OIDC profile', async () => {
      expect(login).toMatchObject({
        accessToken: expect.any(String),
        userId: expect.any(String),
        userEmail: `${sub}@immich.app`,
        name: 'OAuth User',
        isAdmin: false,
      });

      const client = await db();
      const { rows } = await client.query('SELECT "oauthId", "email" FROM "user" WHERE "id" = $1', [login.userId]);
      expect(rows).toEqual([{ oauthId: sub, email: `${sub}@immich.app` }]);
    });

    it('creates a session that works for an authenticated call', async () => {
      const { status, body } = await request(app).get('/users/me').set(asBearerAuth(login.accessToken));
      expect(status).toBe(200);
      expect(body).toMatchObject({ id: login.userId, email: `${sub}@immich.app` });

      const sessions = await request(app).get('/sessions').set(asBearerAuth(login.accessToken));
      expect(sessions.status).toBe(200);
      expect(sessions.body).toEqual([expect.objectContaining({ current: true })]);
    });

    it('stores the encrypted refresh token for the session', async () => {
      const client = await db();
      const { rows } = await client.query(
        `SELECT t."keycloakRefreshToken" AS token
         FROM "pixelunion_session_token" t JOIN "session" s ON s."id" = t."sessionId"
         WHERE s."userId" = $1`,
        [login.userId],
      );
      expect(rows).toHaveLength(1);
      expect(Buffer.isBuffer(rows[0].token)).toBe(true);
      expect(rows[0].token.length).toBeGreaterThan(0);
    });

    it('signs the same user in again on the next login', async () => {
      const again = await loginWithOAuth(sub);
      expect(again.userId).toBe(login.userId);
      expect(again.accessToken).not.toBe(login.accessToken);
    });
  });

  describe('first admin', () => {
    it('gets admin from the role claim, which is how a fresh tenant gets its first admin', async () => {
      const admin = await loginWithOAuth(OAuthAdmin);
      expect(admin.isAdmin).toBe(true);

      const { status } = await request(app).get('/admin/users').set(asBearerAuth(admin.accessToken));
      expect(status).toBe(200);
    });
  });

  describe('POST /auth/oidc-token', () => {
    let login: LoginResponse;

    beforeAll(async () => {
      login = await loginWithOAuth(newOAuthSub());
    });

    it('returns a provider access token for the session, and again after the refresh token rotated', async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { status, body } = await request(app).post('/auth/oidc-token').set(asBearerAuth(login.accessToken));
        expect(status).toBe(200);
        expect(body).toEqual({ accessToken: expect.any(String) });
        expect(body.reauth).toBeUndefined();

        // The token is real: the provider accepts it at its userinfo endpoint.
        const userinfo = await request(authServerUrl).get('/me').set(asBearerAuth(body.accessToken));
        expect(userinfo.status).toBe(200);
      }
    });

    it('is refused without authentication', async () => {
      const { status } = await request(app).post('/auth/oidc-token');
      expect(status).toBe(401);
    });

    it('is refused for an API key, which has no session', async () => {
      const apiKey = await request(app)
        .post('/api-keys')
        .set(asBearerAuth(login.accessToken))
        .send({ name: 'pu-e2e', permissions: ['all'] });
      expect(apiKey.status).toBe(201);

      const { status, body } = await request(app).post('/auth/oidc-token').set('x-api-key', apiKey.body.secret);
      expect(status).toBe(400);
      expect(body.message).toBe('This endpoint requires a session token');
    });

    it('asks for a new login when the session has no refresh token', async () => {
      const other = await loginWithOAuth(newOAuthSub());
      const client = await db();
      await client.query(
        `DELETE FROM "pixelunion_session_token" WHERE "sessionId" IN (SELECT "id" FROM "session" WHERE "userId" = $1)`,
        [other.userId],
      );

      const { status, body } = await request(app).post('/auth/oidc-token').set(asBearerAuth(other.accessToken));
      expect(status).toBe(200);
      expect(body).toEqual({ reauth: true });
    });

    it('is refused after logout', async () => {
      const other = await loginWithOAuth(newOAuthSub());
      const logout = await request(app).post('/auth/logout').set(asBearerAuth(other.accessToken));
      expect(logout.status).toBe(200);

      const { status } = await request(app).post('/auth/oidc-token').set(asBearerAuth(other.accessToken));
      expect(status).toBe(401);
    });
  });
});
