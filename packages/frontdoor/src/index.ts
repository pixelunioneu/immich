import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { authenticate, type Auth } from './auth.js';
import { loadConfig, type Config } from './config.js';
import { TenantDatabaseUnavailable, TenantPools } from './db.js';
import { buildServerInfo, type ServerInfo } from './handlers/server-info.js';
import {
  deleteAcks,
  getAcks,
  InvalidAckType,
  setAcks,
} from './handlers/sync-ack.js';
import {
  asStringArray,
  BadRequest,
  readJsonBody,
  sendEmpty,
  sendError,
  sendJson,
} from './http.js';
import { metrics } from './metrics.js';
import { tenantFromHost } from './tenant.js';

/**
 * The ingress routes only the paths below here; everything else goes straight to
 * the tenant's own instance and never reaches this process. That is what lets the
 * service answer every request it receives instead of needing a way to hand one
 * back: there is no unhandled-request case at runtime.
 */

const SYNC_ACK = '/api/sync/ack';

export const createApp = (
  config: Config,
  pools: TenantPools,
  serverInfo: ServerInfo,
) => {
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // Operational endpoints, not part of the Immich API surface.
    if (path === '/healthz') {
      return sendJson(res, 200, { status: 'ok' });
    }
    if (path === '/metrics') {
      res.writeHead(200, {
        'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      });
      return res.end(metrics.render());
    }

    // Tier 0: constants. No database, no authentication.
    if (method === 'GET') {
      switch (path) {
        case '/api/server/ping': {
          return answered(res, 'ping', 200, serverInfo.ping);
        }
        case '/api/server/version': {
          return answered(res, 'version', 200, serverInfo.version);
        }
        case '/api/server/media-types': {
          return answered(res, 'media-types', 200, serverInfo.mediaTypes);
        }
      }
    }

    if (path !== SYNC_ACK) {
      metrics.increment('frontdoor_requests_total', {
        endpoint: 'unknown',
        outcome: 'not_found',
      });
      return sendError(res, 404, 'Not Found', 'Not Found');
    }

    // Tier 1: the tenant's own database.
    const endpoint = `sync-ack-${method.toLowerCase()}`;
    const tenant = tenantFromHost(req.headers.host, config.baseDomain);
    if (!tenant) {
      metrics.increment('frontdoor_errors_total', {
        reason: 'unresolved_tenant',
      });
      return sendError(res, 400, 'Unknown host', 'Bad Request');
    }

    const body = method === 'GET' ? undefined : await readJsonBody(req);

    await pools.withTenant(tenant, endpoint, async (db) => {
      const auth = await authenticate(db, req.headers, url.searchParams);
      const session = requireSession(auth);
      if (!session) {
        return refuse(res, endpoint, auth);
      }

      switch (method) {
        case 'GET': {
          const acks = await getAcks(db, session);
          return answered(res, endpoint, 200, acks);
        }
        case 'POST': {
          await setAcks(db, session, acksFrom(body));
          return answeredEmpty(res, endpoint, 204);
        }
        case 'DELETE': {
          await deleteAcks(db, session, typesFrom(body));
          return answeredEmpty(res, endpoint, 204);
        }
        default: {
          metrics.increment('frontdoor_requests_total', {
            endpoint,
            outcome: 'not_allowed',
          });
          return sendError(
            res,
            405,
            'Method Not Allowed',
            'Method Not Allowed',
          );
        }
      }
    });
  };

  return createServer((req, res) => {
    handle(req, res).catch((error) => onError(res, error));
  });
};

const requireSession = (auth: Auth): string | null =>
  auth.kind === 'session' ? auth.sessionId : null;

/**
 * Matches what the server returns. `setAcks` refuses anything without a session
 * with a 403, which covers API keys and shared links; no credentials at all is a
 * 401 from the authentication guard.
 *
 * Known deviation: an *invalid* API key is answered 403 here where the server
 * answers 401, because the server validates the key before reaching `setAcks` and
 * this package does not implement API-key validation. Both are refusals and
 * neither exposes anything; distinguishing them would mean carrying the API-key
 * and permission model for two endpoints that are out of scope.
 */
const refuse = (res: ServerResponse, endpoint: string, auth: Auth) => {
  if (auth.kind === 'no-session') {
    metrics.increment('frontdoor_requests_total', {
      endpoint,
      outcome: 'forbidden',
    });
    return sendError(
      res,
      403,
      'Sync endpoints cannot be used with API keys',
      'Forbidden',
    );
  }
  metrics.increment('frontdoor_requests_total', {
    endpoint,
    outcome: 'unauthorized',
  });
  return sendError(
    res,
    401,
    auth.kind === 'invalid' ? 'Invalid user token' : 'Authentication required',
    'Unauthorized',
  );
};

const acksFrom = (body: unknown): string[] => {
  if (typeof body !== 'object' || body === null) {
    throw new BadRequest('acks must be an array of strings');
  }
  return asStringArray((body as { acks?: unknown }).acks, 'acks');
};

const typesFrom = (body: unknown): string[] | undefined => {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const types = (body as { types?: unknown }).types;
  return types === undefined ? undefined : asStringArray(types, 'types');
};

const answered = (
  res: ServerResponse,
  endpoint: string,
  status: number,
  payload: unknown,
) => {
  metrics.increment('frontdoor_requests_total', {
    endpoint,
    outcome: 'answered',
  });
  metrics.increment('frontdoor_wakes_avoided_total');
  sendJson(res, status, payload);
};

const answeredEmpty = (
  res: ServerResponse,
  endpoint: string,
  status: number,
) => {
  metrics.increment('frontdoor_requests_total', {
    endpoint,
    outcome: 'answered',
  });
  metrics.increment('frontdoor_wakes_avoided_total');
  sendEmpty(res, status);
};

const onError = (res: ServerResponse, error: unknown) => {
  if (res.headersSent) {
    return res.end();
  }

  if (error instanceof BadRequest) {
    metrics.increment('frontdoor_errors_total', { reason: 'bad_request' });
    return sendError(res, 400, error.message, 'Bad Request');
  }

  if (error instanceof InvalidAckType) {
    metrics.increment('frontdoor_errors_total', { reason: 'invalid_ack_type' });
    return sendError(res, 400, error.message, 'Bad Request');
  }

  if (error instanceof TenantDatabaseUnavailable) {
    metrics.increment('frontdoor_errors_total', { reason: error.reason });
    return sendError(res, 503, 'Service Unavailable', 'Service Unavailable');
  }

  metrics.increment('frontdoor_errors_total', { reason: 'unhandled' });
  console.error('Unhandled request error', error);
  return sendError(res, 500, 'Internal Server Error', 'Internal Server Error');
};

const main = async () => {
  const config = loadConfig();
  const pools = new TenantPools(config);
  pools.start();

  const server = createApp(
    config,
    pools,
    buildServerInfo(config.immichVersion),
  );
  server.listen(config.port, () =>
    console.log(`frontdoor listening on ${config.port}`),
  );

  const shutdown = async () => {
    server.close();
    await pools.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
};

// Only run when executed directly, so tests can import `createApp`.
if (process.env.NODE_ENV !== 'test' && process.env.VITEST === undefined) {
  void main();
}
