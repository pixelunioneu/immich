import {
  app,
  asBearerAuth,
  LoginResponse,
  loginWithOAuth,
  OAuthAdmin,
  parseStringArray,
  readRepoFile,
} from 'src/pu/helpers.js';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Read from the server source, so this spec follows the list when it changes.
const guardSource = readRepoFile('server/src/middleware/blocked-route.guard.ts');
const BLOCKED_ROUTE_PREFIXES = parseStringArray(guardSource, 'BLOCKED_ROUTE_PREFIXES');
const BLOCKED_ROUTE_EXCEPTIONS = parseStringArray(guardSource, 'BLOCKED_ROUTE_EXCEPTIONS');

/** `/api/admin/config` -> `/api/Admin/CONFIG`-style: alternate the case of every other character. */
const mixedCase = (path: string) =>
  [...path].map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char.toLowerCase())).join('');

const methods = ['get', 'post', 'put', 'delete'] as const;

/**
The guard answers with Nest's plain NotFoundException (`Not Found`). It only runs for
a request that matches a handler: a path or method without one gets Express's own
404 (`Cannot GET /api/...`), which is just as safe. So every variant must be a 404 for
every method, and each variant of the blocked path itself must reach a real handler
and be refused by the guard for at least one method.
*/
const GUARD_MESSAGE = 'Not Found';

/**
Blocked prefixes that must have no handler at all on this server. FUTO Backups (upstream
v3.4) is not mounted in the fork, so nothing under its prefix may reach a handler: every
answer is Express's own 404, never the guard's. If one of these starts answering with the
guard's message, a merge has mounted the module again.
*/
const NOT_MOUNTED_PREFIXES = new Set(['/api/futo-backups']);

describe('PixelUnion blocked routes', () => {
  let admin: LoginResponse;

  beforeAll(async () => {
    admin = await loginWithOAuth(OAuthAdmin);
    expect(admin.isAdmin).toBe(true);
  });

  it('reads the lists from the server source', () => {
    expect(BLOCKED_ROUTE_PREFIXES).toContain('/api/system-config');
    expect(BLOCKED_ROUTE_PREFIXES).toContain('/api/admin/config');
    expect(BLOCKED_ROUTE_EXCEPTIONS).toContain('/api/admin/maintenance/status');
    expect(BLOCKED_ROUTE_EXCEPTIONS).toHaveLength(2);
    for (const prefix of NOT_MOUNTED_PREFIXES) {
      expect(BLOCKED_ROUTE_PREFIXES).toContain(prefix);
    }
  });

  it('lets an admin reach admin routes that are not blocked', async () => {
    const { status } = await request(app).get('/admin/users').set(asBearerAuth(admin.accessToken));
    expect(status).toBe(200);
  });

  it('tells an unknown route apart from a blocked one', async () => {
    const { status, body } = await request(app).get('/pu-e2e-no-such-route').set(asBearerAuth(admin.accessToken));
    expect(status).toBe(404);
    expect(body.message).not.toBe(GUARD_MESSAGE);
  });

  describe.each(BLOCKED_ROUTE_PREFIXES)('%s', (prefix) => {
    const route = prefix.replace(/^\/api/, '');
    const variants = {
      exact: route,
      'trailing slash': `${route}/`,
      'mixed case': mixedCase(route),
      'mixed case with trailing slash': `${mixedCase(route)}/`,
      'sub-path': `${route}/pu-e2e`,
    };

    it.each(Object.entries(variants))('returns 404 for the %s variant (%s)', async (variant, path) => {
      const responses = [];
      for (const method of methods) {
        responses.push(await request(app)[method](path).set(asBearerAuth(admin.accessToken)));
      }

      expect(responses.map(({ status }) => status)).toEqual(methods.map(() => 404));
      if (NOT_MOUNTED_PREFIXES.has(prefix)) {
        expect(responses.map(({ body }) => body.message)).not.toContain(GUARD_MESSAGE);
      } else if (variant !== 'sub-path') {
        expect(responses.map(({ body }) => body.message)).toContain(GUARD_MESSAGE);
      }
    });
  });

  describe('FUTO Backups is not available', () => {
    it('has no socket endpoint', async () => {
      const { status } = await request(app)
        .get('/futo-backups/socket.io/?EIO=4&transport=polling')
        .set(asBearerAuth(admin.accessToken));
      expect(status).toBe(404);
    });

    it('reports the backups feature as off', async () => {
      const { status, body } = await request(app).get('/server/features');
      expect(status).toBe(200);
      expect(body.backups).toBe(false);
    });
  });

  describe('documented exceptions', () => {
    it('keeps GET /api/admin/maintenance/status reachable', async () => {
      const { status, body } = await request(app).get('/admin/maintenance/status');
      expect(status).toBe(200);
      expect(body).toEqual(expect.objectContaining({ active: false }));
    });

    it('keeps POST /api/admin/maintenance/login reachable', async () => {
      // Not in maintenance mode, so there is no token to log in with, but the route answers.
      const { status } = await request(app).post('/admin/maintenance/login').send({ token: 'pu-e2e-invalid' });
      expect(status).not.toBe(404);
      expect(status).toBeGreaterThanOrEqual(400);
    });

    it('still blocks the rest of /api/admin/maintenance', async () => {
      for (const response of [
        await request(app).post('/admin/maintenance').set(asBearerAuth(admin.accessToken)).send({ action: 'start' }),
        await request(app).get('/admin/maintenance/detect-install').set(asBearerAuth(admin.accessToken)),
      ]) {
        expect(response.status).toBe(404);
        expect(response.body.message).toBe(GUARD_MESSAGE);
      }
    });
  });
});
