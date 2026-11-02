import { LookupAddress } from 'node:dns';
import { Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  WebhookTargetError,
  assertWebhookTarget,
  createGuardedLookup,
  isBlockedAddress,
  isBlockedHostname,
  matchesHostPattern,
  parseAllowedHosts,
  webhookRequest,
} from 'src/utils/pu-webhook.js';

const assertTarget = (url: string, pluginAllowedHosts: string[], operatorAllowedHosts: string[] | null = null) =>
  assertWebhookTarget(new URL(url), { pluginAllowedHosts, operatorAllowedHosts });

const lookupWith = (addresses: LookupAddress[], all: boolean) => {
  const lookup = createGuardedLookup((hostname, options, callback) => callback(null, addresses));
  return new Promise<{ error: Error | null; address: string | LookupAddress[]; family?: number }>((resolve) =>
    lookup('hooks.example.com', { all }, (error, address, family) => resolve({ error, address, family })),
  );
};

describe('pu-webhook', () => {
  describe('matchesHostPattern', () => {
    it('should match the full hostname only', () => {
      expect(matchesHostPattern('evil.com', 'evil.com')).toBe(true);
      expect(matchesHostPattern('evil.com.attacker.net', 'evil.com')).toBe(false);
      expect(matchesHostPattern('notevil.com', 'evil.com')).toBe(false);
      expect(matchesHostPattern('evil.com', 'evil.co')).toBe(false);
    });

    it('should treat dots and other metacharacters literally', () => {
      expect(matchesHostPattern('evilxcom', 'evil.com')).toBe(false);
      expect(matchesHostPattern('a.example.com', '(a|b).example.com')).toBe(false);
      expect(matchesHostPattern('aaa.example.com', 'a+.example.com')).toBe(false);
    });

    it('should support wildcards', () => {
      expect(matchesHostPattern('anything.example.org', '*')).toBe(true);
      expect(matchesHostPattern('hooks.example.com', '*.example.com')).toBe(true);
      expect(matchesHostPattern('example.com.attacker.net', '*.example.com')).toBe(false);
      expect(matchesHostPattern('example.com', '*.example.com')).toBe(false);
    });

    it('should be case-insensitive and ignore a trailing dot', () => {
      expect(matchesHostPattern('Hooks.Example.COM', 'hooks.example.com')).toBe(true);
      expect(matchesHostPattern('hooks.example.com.', 'HOOKS.example.com')).toBe(true);
    });

    it('should never match an empty pattern', () => {
      expect(matchesHostPattern('example.com', '')).toBe(false);
      expect(matchesHostPattern('example.com', '  ')).toBe(false);
    });
  });

  describe('parseAllowedHosts', () => {
    it('should return null when unset or empty', () => {
      expect(parseAllowedHosts()).toBeNull();
      expect(parseAllowedHosts('')).toBeNull();
      expect(parseAllowedHosts(' , ')).toBeNull();
    });

    it('should split and trim a comma-separated list', () => {
      expect(parseAllowedHosts('hooks.example.com, *.example.org ,')).toEqual(['hooks.example.com', '*.example.org']);
    });
  });

  describe('isBlockedAddress', () => {
    it.each([
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      '::',
      '[::1]',
      'fe80::1',
      'fd00::1',
      'fc00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      'not-an-ip',
    ])('should block %s', (address) => {
      expect(isBlockedAddress(address)).toBe(true);
    });

    it.each(['1.1.1.1', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('should allow %s', (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    });
  });

  describe('isBlockedHostname', () => {
    it.each([
      'localhost',
      'LOCALHOST.',
      'app.localhost',
      'printer.local',
      'metadata.google.internal',
      'database.namespace.svc',
      'database.namespace.svc.cluster.local',
      'database',
      '127.0.0.1',
    ])('should block %s', (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(true);
    });

    it.each(['hooks.example.com', '1.1.1.1'])('should allow %s', (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(false);
    });
  });

  describe('assertWebhookTarget', () => {
    it('should require a match in the plugin allowedHosts', () => {
      expect(() => assertTarget('https://evil.com.attacker.net/hook', ['evil.com'])).toThrow(
        'Hostname did not match any listed in methods[].allowedHosts in the plugin manifest',
      );
      expect(() => assertTarget('https://evil.com/hook', ['evil.com'])).not.toThrow();
    });

    it('should refuse non-http protocols', () => {
      expect(() => assertTarget('file:///etc/passwd', ['*'])).toThrow(WebhookTargetError);
      expect(() => assertTarget('ftp://example.com/', ['*'])).toThrow(WebhookTargetError);
    });

    it.each([
      'http://127.0.0.1/',
      'http://localhost:2283/api',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'http://192.168.1.10:8080/',
      'http://[::1]/',
      'http://[fd12::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://2130706433/',
      'http://0x7f.1/',
      'https://database.namespace.svc.cluster.local/',
      'http://database/',
    ])('should refuse %s with a "*" plugin pattern and no operator list', (url) => {
      expect(() => assertTarget(url, ['*'])).toThrow('Requests to local or private addresses are not allowed');
    });

    it('should allow public hosts with a "*" plugin pattern and no operator list', () => {
      expect(() => assertTarget('https://hooks.example.com/abc', ['*'])).not.toThrow();
      expect(() => assertTarget('http://1.1.1.1/', ['*'])).not.toThrow();
    });

    it('should enforce the operator allowlist', () => {
      expect(() => assertTarget('https://hooks.example.com/', ['*'], ['*.example.org'])).toThrow(
        'Hostname is not allowed by the server webhook allowlist',
      );
      expect(() => assertTarget('https://hooks.example.org.attacker.net/', ['*'], ['*.example.org'])).toThrow(
        'Hostname is not allowed by the server webhook allowlist',
      );
      expect(() => assertTarget('https://hooks.example.org/', ['*'], ['*.example.org'])).not.toThrow();
    });

    it('should require both the plugin and the operator list to match', () => {
      expect(() => assertTarget('https://hooks.example.org/', ['other.example.org'], ['*.example.org'])).toThrow(
        'Hostname did not match any listed in methods[].allowedHosts in the plugin manifest',
      );
    });

    it('should let the operator explicitly allow an internal host', () => {
      expect(() => assertTarget('http://10.0.0.5/', ['*'], ['10.0.0.5'])).not.toThrow();
    });
  });

  describe('createGuardedLookup', () => {
    it('should refuse a hostname resolving to a private address', async () => {
      const { error } = await lookupWith([{ address: '10.0.0.5', family: 4 }], false);
      expect(error).toBeInstanceOf(WebhookTargetError);
    });

    it('should refuse when any resolved address is private', async () => {
      const { error } = await lookupWith(
        [
          { address: '1.1.1.1', family: 4 },
          { address: '::1', family: 6 },
        ],
        true,
      );
      expect(error).toBeInstanceOf(WebhookTargetError);
    });

    it('should pass through public addresses', async () => {
      await expect(lookupWith([{ address: '1.1.1.1', family: 4 }], false)).resolves.toEqual({
        error: null,
        address: '1.1.1.1',
        family: 4,
      });
      await expect(lookupWith([{ address: '1.1.1.1', family: 4 }], true)).resolves.toEqual({
        error: null,
        address: [{ address: '1.1.1.1', family: 4 }],
        family: undefined,
      });
    });

    it('should propagate resolver errors', async () => {
      const failure = new Error('ENOTFOUND');
      const lookup = createGuardedLookup((hostname, options, callback) => callback(failure, []));
      const error = await new Promise((resolve) => lookup('missing.example.com', {}, (error) => resolve(error)));
      expect(error).toBe(failure);
    });
  });

  describe('webhookRequest', () => {
    let server: Server;
    let port: number;
    let requests: { method?: string; url?: string; body: string; userAgent?: string }[];

    beforeAll(async () => {
      server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        req.on('end', () => {
          requests.push({
            method: req.method,
            url: req.url,
            body: Buffer.concat(chunks).toString(),
            userAgent: req.headers['user-agent'],
          });
          if (req.url === '/redirect') {
            res.writeHead(302, { Location: 'http://127.0.0.1/' }).end();
            return;
          }
          res.writeHead(201).end('created');
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });

    beforeEach(() => {
      requests = [];
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('should refuse a loopback target without contacting it', async () => {
      await expect(
        webhookRequest(
          `http://127.0.0.1:${port}/hook`,
          { method: 'POST', body: '{}' },
          {
            pluginAllowedHosts: ['*'],
            operatorAllowedHosts: null,
          },
        ),
      ).rejects.toThrow(WebhookTargetError);
      expect(requests).toHaveLength(0);
    });

    it('should send the request when the operator allows the host', async () => {
      await expect(
        webhookRequest(
          `http://127.0.0.1:${port}/hook`,
          { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } },
          { pluginAllowedHosts: ['*'], operatorAllowedHosts: ['127.0.0.1'] },
        ),
      ).resolves.toEqual({ ok: true, status: 201, body: 'created' });
      expect(requests).toEqual([
        { method: 'POST', url: '/hook', body: '{"a":1}', userAgent: expect.stringMatching(/^immich-server\//) },
      ]);
    });

    it('should not follow redirects', async () => {
      await expect(
        webhookRequest(
          `http://127.0.0.1:${port}/redirect`,
          { method: 'POST', body: '{}' },
          {
            pluginAllowedHosts: ['*'],
            operatorAllowedHosts: ['127.0.0.1'],
          },
        ),
      ).resolves.toEqual({ ok: false, status: 302, body: '' });
      expect(requests).toHaveLength(1);
    });
  });
});
