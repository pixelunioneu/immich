import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { metrics } from './metrics.js';

/**
 * Relays one request to the tenant's own instance, by way of whatever the
 * ingress would otherwise have sent it to. `Host` is preserved because that is
 * how the upstream picks the tenant; hop-by-hop headers are dropped because
 * they describe this connection, not the next one.
 *
 * Errors here are the upstream's, never the tenant database's, so they do not
 * touch the circuit breaker: a 502 with its own reason.
 */

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export const proxy = (
  req: IncomingMessage,
  body: Buffer | undefined,
  res: ServerResponse,
  upstream: URL,
  timeoutMs: number,
): Promise<void> =>
  new Promise((resolve) => {
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(name)) {
        headers[name] = value;
      }
    }
    headers['content-length'] = String(body?.length ?? 0);

    const started = process.hrtime.bigint();
    const done = (outcome: string) => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      metrics.observe('frontdoor_proxy_latency_seconds', seconds, { outcome });
      resolve();
    };

    const fail = (reason: string) => {
      metrics.increment('frontdoor_errors_total', {
        reason: `proxy_${reason}`,
      });
      if (!res.headersSent) {
        res.writeHead(502, {
          'content-type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            message: 'Bad Gateway',
            error: 'Bad Gateway',
            statusCode: 502,
          }),
        );
      } else {
        res.destroy();
      }
      done('failed');
    };

    const outbound = request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers,
        // The Host header above is the tenant's; do not replace it with the
        // upstream's address.
        setHost: false,
        timeout: timeoutMs,
      },
      (inbound) => {
        const relayed: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(inbound.headers)) {
          if (value !== undefined && !HOP_BY_HOP.has(name)) {
            relayed[name] = value;
          }
        }
        res.writeHead(inbound.statusCode ?? 502, relayed);
        inbound.on('error', () => fail('upstream_read'));
        inbound.on('end', () => done('relayed'));
        inbound.pipe(res);
      },
    );

    outbound.on('timeout', () => outbound.destroy(new Error('timeout')));
    outbound.on('error', (error: NodeJS.ErrnoException) =>
      fail((error.code ?? error.message ?? 'error').toLowerCase()),
    );
    outbound.end(body);
  });
