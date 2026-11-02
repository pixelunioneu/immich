// PixelUnion: outbound request guard for the plugin `httpRequest` host function (webhook action).
//
// Upstream turns `allowedHosts` patterns into an unanchored regex, and the bundled core plugin declares
// `allowedHosts: ["*"]`, so any user allowed to create workflows could make the server call internal
// addresses. This module:
//   - matches host patterns anchored and case-insensitively (`*` is the only wildcard),
//   - lets the operator restrict targets with IMMICH_WEBHOOK_ALLOWED_HOSTS (the target must then match
//     both the plugin's `allowedHosts` and the operator list),
//   - without an operator list, refuses loopback/private/link-local/unique-local targets and internal
//     hostnames, checks the addresses DNS resolves to at connect time (so a public name pointing at a
//     private address is refused too), and never follows redirects.
import { LookupAddress, LookupOptions, lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, LookupFunction, isIP } from 'node:net';
import { serverVersion } from 'src/constants.js';

export type WebhookRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type WebhookResponse = {
  ok: boolean;
  status: number;
  body: string;
};

export type WebhookGuardOptions = {
  /** `allowedHosts` declared by the plugin method */
  pluginAllowedHosts: string[];
  /** operator allowlist (IMMICH_WEBHOOK_ALLOWED_HOSTS), `null` when unset */
  operatorAllowedHosts: string[] | null;
};

export class WebhookTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookTargetError';
  }
}

// separate lists: BlockList also matches IPv4 addresses against IPv4-mapped IPv6 subnets
const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // shared address space (CGNAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. cloud metadata endpoints)
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blockedIpv4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  blockedIpv6.addSubnet(network, prefix, 'ipv6');
}

const blockedHostnameSuffixes = ['.localhost', '.local', '.internal', '.svc', '.cluster.local', '.home.arpa'];

const normalizeHostname = (hostname: string) =>
  hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)]$/, '$1')
    .replace(/\.$/, '');

const escapeRegex = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Anchored, case-insensitive host match. `*` matches any sequence of characters; nothing else is special. */
export const matchesHostPattern = (hostname: string, pattern: string) => {
  const normalized = normalizeHostname(pattern);
  if (!normalized) {
    return false;
  }

  const regex = new RegExp(
    `^${normalized
      .split('*')
      .map((part) => escapeRegex(part))
      .join('.*')}$`,
    'i',
  );
  return regex.test(normalizeHostname(hostname));
};

export const parseAllowedHosts = (value?: string): string[] | null => {
  if (value === undefined) {
    return null;
  }

  const hosts = value
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : null;
};

export const isBlockedAddress = (address: string) => {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  if (family === 4) {
    return blockedIpv4.check(normalized, 'ipv4');
  }
  if (family === 6) {
    return blockedIpv6.check(normalized, 'ipv6');
  }
  // not an IP address: refuse rather than guess
  return true;
};

export const isBlockedHostname = (hostname: string) => {
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized)) {
    return isBlockedAddress(normalized);
  }

  return (
    !normalized ||
    normalized === 'localhost' ||
    // single-label names are resolved through local search domains
    !normalized.includes('.') ||
    blockedHostnameSuffixes.some((suffix) => normalized.endsWith(suffix))
  );
};

/** Throws a {@link WebhookTargetError} when the url may not be requested. */
export const assertWebhookTarget = (url: URL, { pluginAllowedHosts, operatorAllowedHosts }: WebhookGuardOptions) => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebhookTargetError(`Unsupported protocol: ${url.protocol}`);
  }

  const hostname = normalizeHostname(url.hostname);
  if (pluginAllowedHosts.every((pattern) => !matchesHostPattern(hostname, pattern))) {
    throw new WebhookTargetError('Hostname did not match any listed in methods[].allowedHosts in the plugin manifest');
  }

  if (operatorAllowedHosts) {
    if (operatorAllowedHosts.every((pattern) => !matchesHostPattern(hostname, pattern))) {
      throw new WebhookTargetError('Hostname is not allowed by the server webhook allowlist');
    }
    return;
  }

  if (isBlockedHostname(hostname)) {
    throw new WebhookTargetError('Requests to local or private addresses are not allowed');
  }
};

type Resolver = (
  hostname: string,
  options: LookupOptions & { all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/** A `lookup` for http(s).request that refuses hostnames resolving to any blocked address. */
export const createGuardedLookup = (resolver: Resolver = dnsLookup): LookupFunction => {
  return (hostname, options, callback) => {
    resolver(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, '', 0);
        return;
      }

      if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
        callback(new WebhookTargetError(`Hostname ${hostname} resolves to a local or private address`), '', 0);
        return;
      }

      if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    });
  };
};

const guardedLookup = createGuardedLookup();

/**
 * Performs a single request (redirects are returned, not followed) after validating the target.
 * The resolved addresses are checked at connect time when no operator allowlist is configured.
 */
export const webhookRequest = async (
  rawUrl: string,
  { method = 'GET', headers = {}, body }: WebhookRequestOptions = {},
  guard: WebhookGuardOptions,
  timeoutMs = 30_000,
): Promise<WebhookResponse> => {
  const url = new URL(rawUrl);
  assertWebhookTarget(url, guard);

  const requestHeaders: Record<string, string> = Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'content-length'),
  );
  if (Object.keys(requestHeaders).every((key) => key.toLowerCase() !== 'user-agent')) {
    requestHeaders['User-Agent'] = `immich-server/${serverVersion}`;
  }
  if (body !== undefined) {
    requestHeaders['Content-Length'] = String(Buffer.byteLength(body));
  }

  const client = url.protocol === 'https:' ? https : http;

  return new Promise<WebhookResponse>((resolve, reject) => {
    const request = client.request(
      url,
      {
        method,
        headers: requestHeaders,
        lookup: guard.operatorAllowedHosts ? undefined : guardedLookup,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );

    request.on('timeout', () => request.destroy(new Error('Webhook request timed out')));
    request.on('error', reject);
    request.end(body);
  });
};
