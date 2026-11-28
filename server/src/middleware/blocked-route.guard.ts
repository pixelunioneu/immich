import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';

/**
 * PixelUnion: routes that must not be reachable on a hosted tenant deployment.
 *
 * These endpoints expose server-wide admin surface (system configuration, external
 * libraries, database backups, maintenance mode, the SMTP test email, which connects
 * to any host:port in the request) that tenant admins should not have on a hosted
 * deployment, where the
 * operator manages the server. The same routes are also blocked at the edge; this
 * guard is the in-image copy, so the guarantee travels with the server image.
 *
 * When upstream adds or renames an admin endpoint, diff it against this list:
 *   git grep "@Controller(" <newtag> -- server/src/controllers
 *
 * Matching rules:
 * - Case-insensitive, because Express routing is case-insensitive: `/api/Admin/config`
 *   reaches the same handler as `/api/admin/config`.
 * - Segment-exact: `/api/admin/config` blocks itself and `/api/admin/config/...`, but
 *   not `/api/public/config` (read by the web login page) or `/api/config`.
 * - Trailing slashes are ignored.
 */
export const BLOCKED_ROUTE_PREFIXES = [
  '/api/admin/config',
  '/api/system-config',
  '/api/admin/database-backups',
  '/api/libraries',
  '/api/admin/maintenance',
  '/api/admin/notifications/test-email',
  // FUTO Backups (upstream v3.4) is not mounted on this server; this keeps its routes and
  // socket path closed even if a later merge re-mounts the module by accident.
  '/api/futo-backups',
  // Passkeys are a login path next to Keycloak. Upstream ships them disabled; blocked here too
  // so a later upstream re-enable cannot open a login that bypasses Keycloak.
  '/api/passkeys',
];

/**
 * Exact paths under a blocked prefix that stay reachable.
 *
 * The web `/maintenance` page calls these two (status is public, login takes a
 * maintenance token). Keeping them open means the page still renders if the operator
 * enables maintenance mode via the CLI; entering/leaving maintenance mode
 * (`POST /api/admin/maintenance`) and `detect-install` remain blocked.
 */
export const BLOCKED_ROUTE_EXCEPTIONS = ['/api/admin/maintenance/status', '/api/admin/maintenance/login'];

const normalizePath = (path: string) => path.toLowerCase().replace(/\/+$/, '') || '/';

export const isBlockedRoute = (path: string): boolean => {
  const normalized = normalizePath(path);
  if (BLOCKED_ROUTE_EXCEPTIONS.includes(normalized)) {
    return false;
  }
  return BLOCKED_ROUTE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
};

@Injectable()
export class BlockedRouteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { path } = context.switchToHttp().getRequest<Request>();
    if (isBlockedRoute(path)) {
      throw new NotFoundException();
    }
    return true;
  }
}
