import './instrument.js';

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { HttpException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { SyncEntityType } from 'src/enum';
import { serialize } from 'src/utils/sync';
import { authenticate, type Auth } from './auth.js';
import { loadConfig, type Config } from './config.js';
import { TenantPools } from './db.js';
import {
  BadRequest,
  FrontdoorError,
  TenantDatabaseUnavailable,
} from './errors.js';
import type { SessionAuth } from './handlers/auth-dto.js';
import { buildServerInfo, type ServerInfo } from './handlers/server-info.js';
import { deleteAcks, getAcks, setAcks } from './handlers/sync-ack.js';
import { decide, isStreamBody } from './handlers/sync-stream.js';
import {
  asStringArray,
  parseJson,
  readBody,
  sendEmpty,
  sendError,
  sendJson,
  sendJsonLines,
} from './http.js';
import { metrics } from './metrics.js';
import { proxy } from './proxy.js';
import { tenantFromHost } from './tenant.js';

/**
 * The ingress routes only the paths below here; everything else goes straight to
 * the tenant's own instance and never reaches this process. That is what lets the
 * service answer every request it receives instead of needing a way to hand one
 * back: there is no unhandled-request case at runtime.
 *
 * `sync/stream` is the one deliberate exception. Whether it can be answered is
 * only known after looking at the tenant's database, by which time the ingress
 * has committed the request here, so that one path carries a relay to the tenant.
 */

const SYNC_ACK = '/api/sync/ack';
const SYNC_STREAM = '/api/sync/stream';

/** Paths that never reach the app logic and would just be noise in the access log. */
const UNLOGGED_PATHS = new Set(['/healthz', '/metrics']);

type AccessContext = { tenant?: string };

/**
 * One line per request, to stdout, for the operator to correlate a tenant with
 * the traffic this service answered on its behalf. Deliberately logs only the
 * path, not the full URL: Immich accepts `?apiKey=` on requests, and the query
 * string is not something this line should ever be able to leak.
 */
const logAccess = (
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  access: AccessContext,
  start: number,
) => {
  if (UNLOGGED_PATHS.has(path)) {
    return;
  }
  const duration = (performance.now() - start).toFixed(2);
  const method = req.method ?? 'GET';
  const tenant = access.tenant ?? '-';
  console.log(
    `${method} ${path} ${res.statusCode} ${duration}ms tenant=${tenant}`,
  );
};

export const createApp = (
  config: Config,
  pools: TenantPools,
  serverInfo: ServerInfo,
) => {
  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    access: AccessContext,
  ) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // Resolved for every request, not just sync/ack, so the access log can
    // attribute Tier 0 traffic to a tenant too. The sync/ack handler below
    // re-derives the same value where an unresolved tenant is a 400, not just
    // a blank log field.
    access.tenant =
      tenantFromHost(req.headers.host, config.baseDomain) ?? undefined;

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

    if (path === SYNC_STREAM) {
      return handleStream(req, res, url);
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

    const body = method === 'GET' ? undefined : parseJson(await readBody(req));

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

  /**
   * Phase 2. Answered only when the tenant's stream would be empty; relayed to
   * the tenant otherwise. Every failure on the way to a verdict is a relay, not
   * an error: wrongly waking a pod is harmless, wrongly answering "empty" is a
   * client that never sees a change.
   */
  const handleStream = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ) => {
    const endpoint = 'sync-stream';
    if (req.method !== 'POST') {
      metrics.increment('frontdoor_requests_total', {
        endpoint,
        outcome: 'not_allowed',
      });
      return sendError(res, 405, 'Method Not Allowed', 'Method Not Allowed');
    }

    const raw = await readBody(req);
    const relay = async () => {
      metrics.increment('frontdoor_requests_total', {
        endpoint,
        outcome: 'proxied',
      });
      await proxy(
        req,
        raw,
        res,
        config.stream.upstreamUrl,
        config.stream.proxyTimeoutMs,
      );
    };

    if (config.stream.mode === 'proxy') {
      return relay();
    }

    // Anything the tenant would refuse, it should refuse in its own words.
    const tenant = tenantFromHost(req.headers.host, config.baseDomain);
    if (!tenant) {
      return relay();
    }
    let body: unknown;
    try {
      body = parseJson(raw);
    } catch {
      return relay();
    }
    if (!isStreamBody(body)) {
      return relay();
    }

    let verdict:
      Awaited<ReturnType<typeof decide>> | { kind: 'refused' } | undefined;
    try {
      await pools.withTenant(tenant, endpoint, async (db) => {
        const auth = await authenticate(db, req.headers, url.searchParams);
        const session = requireSession(auth);
        if (!session) {
          verdict = { kind: 'refused' };
          return refuse(res, endpoint, auth);
        }
        verdict = await decide(
          db,
          session,
          body,
          config.stream.decideTimeoutMs,
        );
      });
    } catch (error) {
      // The database is down or the tenant is failing fast. The tenant's own
      // instance shares that database, but a relay there is still the right
      // answer: it is what happens today, and it is not this service's
      // outage to report.
      if (error instanceof TenantDatabaseUnavailable) {
        metrics.increment('frontdoor_stream_decisions_total', {
          verdict: 'busy',
          reason: 'db_unavailable',
        });
        return relay();
      }
      throw error;
    }

    if (!verdict || verdict.kind === 'refused') {
      return;
    }

    metrics.increment('frontdoor_stream_decisions_total', {
      verdict: verdict.kind,
      reason: verdict.kind === 'busy' ? verdict.reason : '',
    });

    switch (verdict.kind) {
      case 'empty': {
        metrics.increment('frontdoor_requests_total', {
          endpoint,
          outcome: 'answered',
        });
        metrics.increment('frontdoor_wakes_avoided_total');
        return sendJsonLines(
          res,
          200,
          serialize({
            type: SyncEntityType.SyncCompleteV1,
            ids: [verdict.nowId],
            data: {},
          }),
        );
      }
      case 'reset': {
        metrics.increment('frontdoor_requests_total', {
          endpoint,
          outcome: 'answered',
        });
        metrics.increment('frontdoor_wakes_avoided_total');
        return sendJsonLines(
          res,
          200,
          serialize({
            type: SyncEntityType.SyncResetV1,
            ids: ['reset'],
            data: {},
          }),
        );
      }
      case 'busy': {
        return relay();
      }
    }
  };

  return createServer((req, res) => {
    const start = performance.now();
    const access: AccessContext = {};
    const path = (req.url ?? '/').split('?')[0];
    handle(req, res, access)
      .catch((error) => onError(res, error))
      .finally(() => logAccess(req, res, path, access, start));
  });
};

const requireSession = (auth: Auth): SessionAuth | null =>
  auth.kind === 'session'
    ? { sessionId: auth.sessionId, userId: auth.userId }
    : null;

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

/** The server's error body for an exception it raised on purpose. */
const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
};

export const onError = (res: ServerResponse, error: unknown) => {
  if (res.headersSent) {
    return res.end();
  }

  if (error instanceof FrontdoorError) {
    metrics.increment('frontdoor_errors_total', { reason: error.reason });

    if (error instanceof TenantDatabaseUnavailable) {
      // One line, not a stack: during a database outage every request in the
      // fleet lands here, and a stack trace each would drown the logs.
      console.warn(`Tenant database unavailable (${error.reason})`);
      res.setHeader('retry-after', '5');
      return sendError(
        res,
        error.status,
        'Service Unavailable',
        'Service Unavailable',
      );
    }

    return sendError(res, error.status, error.message, 'Bad Request');
  }

  // Raised by the bundled server code on purpose - an unknown ack type, a
  // request without a session - and answered in its own words, the way the
  // server's exception filter would.
  if (error instanceof HttpException) {
    const status = error.getStatus();
    metrics.increment('frontdoor_errors_total', { reason: `http_${status}` });
    return sendError(
      res,
      status,
      error.message,
      STATUS_TEXT[status] ?? 'Error',
    );
  }

  metrics.increment('frontdoor_errors_total', { reason: 'unhandled' });
  console.error('Unhandled request error', error);
  Sentry.captureException(error);
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
