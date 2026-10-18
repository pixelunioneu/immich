import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { BLOCKED_ROUTE_PREFIXES, BlockedRouteGuard } from 'src/middleware/blocked-route.guard.js';

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
    '/api/assets',
    '/api/library',
    '/',
  ])('should allow %s', (path) => {
    expect(sut.canActivate(contextFor(path))).toBe(true);
  });
});
