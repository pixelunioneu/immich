import { ExecutionContext, NotFoundException } from '@nestjs/common';
import {
  BLOCKED_ROUTE_EXCEPTIONS,
  BLOCKED_ROUTE_PREFIXES,
  BlockedRouteGuard,
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
        '/api/admin/integrity',
        '/api/jobs',
        '/api/queues',
        '/api/server/license',
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
    '/api/Jobs',
    '/api/QUEUES/thumbnailGeneration',
    '/api/server/License',
    '/api/admin/Integrity/report',
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
