import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';

/**
 * PixelUnion: routes that must never be reachable on a tenant deployment.
 *
 * These endpoints expose admin surface that tenant admins should not have — most
 * importantly `/api/admin/config`, whose response is unredacted and includes
 * `oauth.clientSecret`. The `cluster-core` ingress blocks the same prefixes at the
 * edge; this guard is the in-image copy so the guarantee travels with the server
 * and cannot be lost by forgetting to update an nginx rule.
 *
 * Keep this list in sync with the ingress `location` rules in
 * `cluster-core/apps/{ingress,envoy}/templates/ingress-global-all-tenants.yaml`.
 * When upstream adds or renames an admin endpoint, diff it against this list:
 *   git grep "@Controller(" <newtag> -- server/src/controllers
 *
 * Segment-exact matching only: `/api/admin/config` must not also match
 * `/api/public/config` (read by the web login page) or `/api/config`
 * (user-visibility config).
 */
export const BLOCKED_ROUTE_PREFIXES = [
  '/api/admin/config',
  '/api/system-config',
  '/api/admin/database-backups',
  '/api/libraries',
];

@Injectable()
export class BlockedRouteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { path } = context.switchToHttp().getRequest<Request>();
    const isBlocked = BLOCKED_ROUTE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (isBlocked) {
      throw new NotFoundException();
    }
    return true;
  }
}
