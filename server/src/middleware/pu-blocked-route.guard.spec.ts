import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RouteKey } from 'src/enum.js';
import {
  BLOCKED_ROUTE_EXCEPTIONS,
  BLOCKED_ROUTE_PREFIXES,
  BlockedRouteGuard,
  isBlockedRoute,
} from 'src/middleware/blocked-route.guard.js';

const contextFor = (path: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ path }) }),
  }) as unknown as ExecutionContext;

// PixelUnion: tenant deployments must never expose these admin endpoints.
describe(BlockedRouteGuard.name, () => {
  const sut = new BlockedRouteGuard();

  it('should block the expected prefixes', () => {
    expect(BLOCKED_ROUTE_PREFIXES).toEqual(
      expect.arrayContaining([
        '/api/admin/config',
        '/api/system-config',
        '/api/admin/database-backups',
        '/api/libraries',
        '/api/admin/maintenance',
        '/api/admin/notifications/test-email',
      ]),
    );
  });

  describe.each(BLOCKED_ROUTE_PREFIXES)('%s', (prefix) => {
    it('should 404 the exact path', () => {
      expect(() => sut.canActivate(contextFor(prefix))).toThrow(NotFoundException);
    });

    it('should 404 sub-paths', () => {
      expect(() => sut.canActivate(contextFor(`${prefix}/some-id`))).toThrow(NotFoundException);
      expect(() => sut.canActivate(contextFor(`${prefix}/a/b`))).toThrow(NotFoundException);
    });

    it('should not match a longer segment sharing the prefix', () => {
      expect(sut.canActivate(contextFor(`${prefix}-other`))).toBe(true);
      expect(sut.canActivate(contextFor(`${prefix}s`))).toBe(true);
    });
  });

  it.each([
    '/api/public/config',
    '/api/config',
    '/api/server/config',
    '/api/admin/users',
    '/api/admin/notifications',
    '/api/admin/notifications/templates/welcome',
    '/api/assets',
    '/api/library',
    '/api/server/version',
    '/api/server/features',
    '/api/server/licenses',
    '/api/admin/maintenances',
    '/api/job',
    '/api/queue',
    // Tenant admins keep job/queue control, integrity reports and the license screen.
    '/api/jobs',
    '/api/queues/thumbnailGeneration',
    '/api/admin/integrity/report',
    '/api/server/license',
    '/api/Jobs',
    '/',
  ])('should allow %s', (path) => {
    expect(sut.canActivate(contextFor(path))).toBe(true);
  });

  // Express routing is case-insensitive, so mixed-case paths reach the same handlers.
  it.each([
    '/api/Admin/config',
    '/API/admin/config',
    '/api/System-Config',
    '/api/LIBRARIES/x',
    '/api/admin/Database-Backups/upload',
    '/api/ADMIN/maintenance',
    '/api/Admin/Maintenance/Detect-Install',
    '/api/Admin/Notifications/Test-Email',
  ])('should 404 mixed-case %s', (path) => {
    expect(() => sut.canActivate(contextFor(path))).toThrow(NotFoundException);
  });

  it.each([
    '/api/admin/config/',
    '/api/admin/config//',
    '/api/system-config/',
    '/api/admin/maintenance/',
    '/api/admin/database-backups/upload/',
    '/API/LIBRARIES/',
  ])('should 404 with a trailing slash: %s', (path) => {
    expect(() => sut.canActivate(contextFor(path))).toThrow(NotFoundException);
  });

  it.each(['/api/Public/Config', '/API/CONFIG', '/api/public/config/', '/api/config/'])(
    'should allow non-blocked look-alike %s',
    (path) => {
      expect(sut.canActivate(contextFor(path))).toBe(true);
    },
  );

  describe('maintenance exceptions', () => {
    it('should keep the exceptions under a blocked prefix', () => {
      for (const exception of BLOCKED_ROUTE_EXCEPTIONS) {
        expect(BLOCKED_ROUTE_PREFIXES.some((prefix) => exception.startsWith(`${prefix}/`))).toBe(true);
      }
    });

    it.each([
      '/api/admin/maintenance/status',
      '/api/admin/maintenance/login',
      '/api/Admin/Maintenance/Status',
      '/api/admin/maintenance/login/',
    ])('should allow %s (used by the web maintenance page)', (path) => {
      expect(sut.canActivate(contextFor(path))).toBe(true);
    });

    it.each([
      '/api/admin/maintenance',
      '/api/admin/maintenance/detect-install',
      '/api/admin/maintenance/status/x',
      '/api/admin/maintenance/login/x',
    ])('should 404 %s', (path) => {
      expect(() => sut.canActivate(contextFor(path))).toThrow(NotFoundException);
    });
  });
});

/**
 * PixelUnion: snapshot of every `@Controller(...)` prefix, each classified as allowed,
 * blocked or partial. Upstream adds admin surface without telling us; this snapshot turns
 * that into a red test on the merge so someone decides whether tenants may reach it.
 *
 * - allowed: no path under the prefix is blocked.
 * - blocked: the prefix itself is in BLOCKED_ROUTE_PREFIXES; `open` lists the
 *   BLOCKED_ROUTE_EXCEPTIONS under it (sub-paths relative to the prefix).
 * - partial: only the listed sub-paths are blocked (narrower BLOCKED_ROUTE_PREFIXES
 *   entries); `open` lists sub-paths that must stay reachable.
 */
type RouteClass =
  | { status: 'allowed' }
  | { status: 'blocked'; open?: string[] }
  | { status: 'partial'; blocked: string[]; open: string[] };

const CONTROLLER_ROUTES: Record<string, RouteClass> = {
  '': { status: 'allowed' }, // app.controller.ts: /.well-known/immich, /custom.css
  activities: { status: 'allowed' },
  'admin/auth': { status: 'allowed' },
  'admin/config': { status: 'blocked' },
  'admin/database-backups': { status: 'blocked' },
  'admin/integrity': { status: 'allowed' },
  'admin/maintenance': { status: 'blocked', open: ['status', 'login'] },
  'admin/notifications': { status: 'partial', blocked: ['test-email'], open: ['', 'templates/welcome'] },
  'admin/users': { status: 'allowed' },
  albums: { status: 'allowed' },
  'api-keys': { status: 'allowed' },
  'asset-files': { status: 'allowed' },
  assets: { status: 'allowed' },
  auth: { status: 'allowed' },
  'cluster-groups': { status: 'allowed' },
  config: { status: 'allowed' },
  download: { status: 'allowed' },
  duplicates: { status: 'allowed' },
  faces: { status: 'allowed' },
  jobs: { status: 'allowed' },
  libraries: { status: 'blocked' },
  map: { status: 'allowed' },
  memories: { status: 'allowed' },
  notifications: { status: 'allowed' },
  oauth: { status: 'allowed' },
  partners: { status: 'allowed' },
  people: { status: 'allowed' },
  plugins: { status: 'allowed' },
  'public/config': { status: 'allowed' },
  queues: { status: 'allowed' },
  search: { status: 'allowed' },
  server: { status: 'allowed' },
  sessions: { status: 'allowed' },
  'shared-links': { status: 'allowed' },
  stacks: { status: 'allowed' },
  sync: { status: 'allowed' },
  'system-config': { status: 'blocked' },
  'system-metadata': { status: 'allowed' },
  tags: { status: 'allowed' },
  timeline: { status: 'allowed' },
  trash: { status: 'allowed' },
  users: { status: 'allowed' },
  view: { status: 'allowed' },
  workflows: { status: 'allowed' },
};

const controllersDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'controllers');

/** Every `@Controller(...)` prefix under server/src/controllers, with `RouteKey.X` resolved. */
const controllerPrefixes = () => {
  const prefixes = new Set<string>();
  for (const file of readdirSync(controllersDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) {
      continue;
    }
    for (const [, argument] of readFileSync(join(controllersDir, file), 'utf8').matchAll(/@Controller\(([^)]*)\)/g)) {
      const trimmed = argument.trim();
      const quoted = trimmed.match(/^'([^']*)'$/);
      const routeKey = trimmed.match(/^RouteKey\.(\w+)$/);
      if (trimmed === '') {
        prefixes.add('');
      } else if (quoted) {
        prefixes.add(quoted[1]);
      } else if (routeKey && routeKey[1] in RouteKey) {
        prefixes.add(RouteKey[routeKey[1] as keyof typeof RouteKey]);
      } else {
        throw new Error(`${file}: cannot resolve @Controller(${trimmed}); teach controllerPrefixes() about it`);
      }
    }
  }
  return prefixes;
};

const api = (prefix: string, subPath = '') => ['/api', prefix, subPath].filter(Boolean).join('/');

describe('PixelUnion controller route snapshot (tenant reachability of every API controller)', () => {
  const found = controllerPrefixes();
  const entries = Object.entries(CONTROLLER_ROUTES);

  it('classifies every controller prefix as allowed, blocked or partial', () => {
    const unknown = [...found].filter((prefix) => !(prefix in CONTROLLER_ROUTES));
    expect(
      unknown,
      'New @Controller prefix(es). Decide whether tenants may reach them, add each to CONTROLLER_ROUTES ' +
        'in this file, and if blocked also add /api/<prefix> to BLOCKED_ROUTE_PREFIXES in ' +
        'server/src/middleware/blocked-route.guard.ts.',
    ).toEqual([]);
  });

  it('lists no controller prefix that no longer exists', () => {
    const stale = Object.keys(CONTROLLER_ROUTES).filter((prefix) => !found.has(prefix));
    expect(
      stale,
      'Controller prefix(es) gone or renamed upstream. Remove them from CONTROLLER_ROUTES, classify the new ' +
        'name, and update BLOCKED_ROUTE_PREFIXES if a blocked controller moved.',
    ).toEqual([]);
  });

  it.each(entries.filter(([, route]) => route.status === 'allowed').map(([prefix]) => prefix))(
    'allowed: %s is reachable',
    (prefix) => {
      expect(isBlockedRoute(api(prefix)), `${api(prefix)} is blocked but classified allowed`).toBe(false);
      expect(isBlockedRoute(api(prefix, 'some-id'))).toBe(false);
    },
  );

  it.each(
    entries.flatMap(([prefix, route]) => (route.status === 'blocked' ? [[prefix, route.open ?? []] as const] : [])),
  )('blocked: %s is refused by isBlockedRoute', (prefix, open) => {
    expect(isBlockedRoute(api(prefix)), `add ${api(prefix)} to BLOCKED_ROUTE_PREFIXES`).toBe(true);
    expect(isBlockedRoute(api(prefix, 'some-id'))).toBe(true);
    for (const subPath of open) {
      expect(isBlockedRoute(api(prefix, subPath)), `${api(prefix, subPath)} should stay open`).toBe(false);
    }
  });

  it.each(
    entries.flatMap(([prefix, route]) =>
      route.status === 'partial' ? [[prefix, route.blocked, route.open] as const] : [],
    ),
  )('partial: %s blocks only the listed sub-paths', (prefix, blocked, open) => {
    for (const subPath of blocked) {
      expect(isBlockedRoute(api(prefix, subPath)), `add ${api(prefix, subPath)} to BLOCKED_ROUTE_PREFIXES`).toBe(true);
    }
    for (const subPath of open) {
      expect(isBlockedRoute(api(prefix, subPath)), `${api(prefix, subPath)} should stay open`).toBe(false);
    }
  });

  it('accounts for every BLOCKED_ROUTE_PREFIXES entry and exception in the snapshot', () => {
    const blockedPaths = entries.flatMap(([prefix, route]) => {
      if (route.status === 'blocked') {
        return [api(prefix)];
      }
      return route.status === 'partial' ? route.blocked.map((subPath) => api(prefix, subPath)) : [];
    });
    const openPaths = entries.flatMap(([prefix, route]) =>
      route.status === 'blocked' ? (route.open ?? []).map((subPath) => api(prefix, subPath)) : [],
    );
    expect(BLOCKED_ROUTE_PREFIXES.toSorted()).toEqual(blockedPaths.toSorted());
    expect(BLOCKED_ROUTE_EXCEPTIONS.toSorted()).toEqual(openPaths.toSorted());
  });
});
