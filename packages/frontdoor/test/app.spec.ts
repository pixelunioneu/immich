import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import type { TenantPools } from '../src/db.js';
import { buildServerInfo } from '../src/handlers/server-info.js';
import type { Verdict } from '../src/handlers/sync-stream.js';

/**
 * The served sync/stream path over real HTTP: what `createApp` makes of a
 * verdict. Authentication and the dry run are replaced, so this is about the
 * response bytes, the metrics and the access log, not about the decision.
 */

vi.mock('../src/auth.js', () => ({
  authenticate: async () => ({
    kind: 'session',
    sessionId: 'session-1',
    userId: 'user-1',
  }),
}));

const decide = vi.fn<() => Promise<Verdict>>();
vi.mock('../src/handlers/sync-stream.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/handlers/sync-stream.js')>()),
  decide: () => decide(),
}));

const { createApp } = await import('../src/index.js');
const { metrics } = await import('../src/metrics.js');

const config = {
  baseDomain: 'example.com',
  stream: {
    mode: 'serve',
    upstreamUrl: new URL('http://127.0.0.1:9'),
    decideTimeoutMs: 1000,
    proxyTimeoutMs: 1000,
    serveMaxBytes: 65_536,
  },
} as unknown as Config;

const pools = {
  withTenant: (
    _tenant: string,
    _endpoint: string,
    work: (db: never) => unknown,
  ) => work({} as never),
} as unknown as TenantPools;

const BODY =
  '{"type":"AuthUserV2","data":{"id":"user-1"},"ack":"AuthUserV2|a"}\n' +
  '{"type":"UserV1","data":{"id":"user-1"},"ack":"UserV1|a"}\n' +
  '{"type":"SyncCompleteV1","data":{},"ack":"SyncCompleteV1|b"}\n';

let server: Server;
let base: URL;
let logged: string[];

beforeEach(async () => {
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line);
  });
  server = createApp(config, pools, buildServerInfo('v1.0.0'));
  base = await new Promise<URL>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(new URL(`http://127.0.0.1:${port}`));
    });
  });
});

afterEach(() => {
  server.close();
  vi.restoreAllMocks();
});

const stream = (headers: Record<string, string> = {}) =>
  new Promise<{
    status: number;
    headers: Record<string, unknown>;
    body: Buffer;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: base.hostname,
        port: base.port,
        method: 'POST',
        path: '/api/sync/stream',
        headers: {
          host: 'tenant.example.com',
          'content-type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk as Buffer));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ types: ['AuthUsersV2', 'UsersV1'] }));
  });

const logLine = async () => {
  // The access line is written after the response has been sent.
  await new Promise((resolve) => setTimeout(resolve, 10));
  return logged.find((line) => line.includes('/api/sync/stream'));
};

describe('createApp sync/stream', () => {
  it('sends a served body verbatim, uncompressed when nothing is accepted', async () => {
    decide.mockResolvedValue({
      kind: 'served',
      body: BODY,
      types: ['AuthUserV2', 'UserV1'],
    });

    const res = await stream();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/jsonlines+json');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(BODY)));
    expect(res.body.toString()).toBe(BODY);

    const rendered = metrics.render();
    expect(rendered).toContain(
      'frontdoor_stream_types_total{type="AuthUserV2",verdict="served"} 1',
    );
    expect(rendered).toContain(
      'frontdoor_stream_types_total{type="UserV1",verdict="served"} 1',
    );
    expect(rendered).toContain(
      `frontdoor_stream_served_bytes_sum ${Buffer.byteLength(BODY)}`,
    );
    expect(rendered).toContain('frontdoor_stream_served_bytes_count 1');
    expect(await logLine()).toMatch(
      /^POST \/api\/sync\/stream 200 [\d.]+ms tenant=tenant stream=served$/,
    );
  });

  it('gzips a served body when the client accepts it', async () => {
    decide.mockResolvedValue({ kind: 'served', body: BODY, types: ['UserV1'] });

    const res = await stream({ 'accept-encoding': 'gzip, deflate, br' });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['vary']).toBe('accept-encoding');
    expect(res.headers['content-length']).toBe(String(res.body.byteLength));
    expect(gunzipSync(res.body).toString()).toBe(BODY);
  });

  it('sends an empty verdict the same way, and logs a busy reason', async () => {
    const complete =
      '{"type":"SyncCompleteV1","data":{},"ack":"SyncCompleteV1|b"}\n';
    decide.mockResolvedValue({ kind: 'empty', body: complete, types: [] });
    const res = await stream();
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe(complete);
    expect(await logLine()).toContain(' stream=empty');

    logged = [];
    decide.mockResolvedValue({ kind: 'busy', reason: 'write', types: [] });
    // The relay target refuses connections; the relay itself is proxy.spec.ts's.
    const relayed = await stream();
    expect(relayed.status).toBe(502);
    expect(await logLine()).toContain(' stream=busy:write');
  });
});
