import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { proxy } from '../src/proxy.js';

type Seen = {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
};

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

const listen = (server: Server) =>
  new Promise<URL>((resolve) => {
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(new URL(`http://127.0.0.1:${port}`));
    });
  });

/** An upstream that records what it received and answers as told. */
const upstream = async (
  answer: (seen: Seen, res: import('node:http').ServerResponse) => void,
) => {
  const seen: Seen = { headers: {}, body: '' };
  const url = await listen(
    createServer((req, res) => {
      seen.method = req.method;
      seen.url = req.url;
      seen.headers = req.headers;
      req.on('data', (chunk) => (seen.body += chunk));
      req.on('end', () => answer(seen, res));
    }),
  );
  return { url, seen };
};

/** The front door, with the proxy as its whole handler. */
const frontdoor = async (target: URL, timeoutMs = 1000) =>
  listen(
    createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      await proxy(req, Buffer.concat(chunks), res, target, timeoutMs);
    }),
  );

const call = (
  base: URL,
  init: { path: string; body: string; headers: Record<string, string> },
) =>
  new Promise<{
    status: number;
    headers: IncomingMessage['headers'];
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: base.hostname,
        port: base.port,
        method: 'POST',
        path: init.path,
        headers: init.headers,
        setHost: false,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end(init.body);
  });

describe('proxy', () => {
  it('relays method, path, body and the tenant Host, and drops hop-by-hop headers', async () => {
    const { url, seen } = await upstream((_, res) => {
      res.writeHead(200, { 'content-type': 'application/jsonlines+json' });
      res.end('{"type":"SyncCompleteV1"}\n');
    });
    const door = await frontdoor(url);

    const response = await call(door, {
      path: '/api/sync/stream?x=1',
      body: '{"types":["AssetsV2"]}',
      headers: {
        host: 'acme.example.com',
        'content-type': 'application/json',
        'content-length': '22',
        'x-immich-user-token': 'tok',
        connection: 'keep-alive',
        te: 'trailers',
      },
    });

    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/api/sync/stream?x=1');
    expect(seen.body).toBe('{"types":["AssetsV2"]}');
    expect(seen.headers.host).toBe('acme.example.com');
    expect(seen.headers['x-immich-user-token']).toBe('tok');
    expect(seen.headers['content-length']).toBe('22');
    expect(seen.headers.te).toBeUndefined();

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/jsonlines+json');
    expect(response.body).toBe('{"type":"SyncCompleteV1"}\n');
  });

  it('relays the upstream status and body unchanged', async () => {
    const { url } = await upstream((_, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end('{"message":"Sync endpoints cannot be used with API keys"}');
    });
    const door = await frontdoor(url);

    const response = await call(door, {
      path: '/api/sync/stream',
      body: '{}',
      headers: { host: 'acme.example.com', 'content-length': '2' },
    });
    expect(response.status).toBe(403);
    expect(response.body).toContain('API keys');
  });

  it('answers 502 when the upstream is unreachable', async () => {
    const door = await frontdoor(new URL('http://127.0.0.1:1'));
    const response = await call(door, {
      path: '/api/sync/stream',
      body: '{}',
      headers: { host: 'acme.example.com', 'content-length': '2' },
    });
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Bad Gateway',
      error: 'Bad Gateway',
      statusCode: 502,
    });
  });

  it('answers 502 when the upstream does not respond in time', async () => {
    const { url } = await upstream(() => undefined);
    const door = await frontdoor(url, 50);
    const response = await call(door, {
      path: '/api/sync/stream',
      body: '{}',
      headers: { host: 'acme.example.com', 'content-length': '2' },
    });
    expect(response.status).toBe(502);
  });
});
