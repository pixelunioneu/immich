/**
PixelUnion fork e2e helpers. Kept apart from src/utils.ts on purpose: upstream's
helpers set up the first admin with password sign-up and configure OAuth through
/api/system-config, neither of which exists on the fork.
*/
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import request from 'supertest';

export const host = process.env.PU_E2E_HOST ?? '127.0.0.1';
export const baseUrl = `http://${host}:2285`;
export const app = `${baseUrl}/api`;
export const webUrl = `http://${host}:2287`;
export const frontdoorUrl = `http://${host}:2288`;
/** The front door takes the tenant from the Host header; `immich` maps to the e2e database. */
export const frontdoorTenantHost = 'immich.e2e.test';
export const dbUrl = `postgres://postgres:postgres@${host}:5435/immich`;

export const containers = {
  server: 'immich-e2e-server',
  database: 'immich-e2e-postgres',
};

const authServer = {
  internal: 'http://e2e-auth-server:2286',
  external: `http://${host}:2286`,
};
export const authServerUrl = authServer.external;

/** Mock users, see packages/e2e-auth-server/auth-server.ts. `with-role` carries `immich_role: admin`. */
export const OAuthAdmin = 'with-role';

export const repoRoot = resolve(import.meta.dirname, '../../..');
export const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');

export const asBearerAuth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

export type LoginResponse = {
  accessToken: string;
  userId: string;
  userEmail: string;
  name: string;
  isAdmin: boolean;
};

const redirect = async (url: string, cookies?: string[]) => {
  const { headers } = await request(url)
    .get('')
    .set('Cookie', cookies || []);
  return { cookies: (headers['set-cookie'] as unknown as string[]) || [], location: headers.location as string };
};

/**
Drive the OIDC authorization code flow through the e2e-auth-server mock, the way a
browser would, and complete it at /api/oauth/callback. Mirrors upstream's
oauth.e2e-spec.ts, which is the reference for the mock's interaction pages.
*/
export const loginWithOAuth = async (sub: string): Promise<LoginResponse> => {
  const redirectUri = `${baseUrl}/auth/login`;
  const state = randomBytes(16).toString('base64url');
  const codeVerifier = randomBytes(64).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest().toString('base64url');

  const authorize = await request(app).post('/oauth/authorize').send({ redirectUri, state, codeChallenge });
  if (authorize.status !== 201) {
    throw new Error(`POST /oauth/authorize failed: ${authorize.status} ${JSON.stringify(authorize.body)}`);
  }
  const url = (authorize.body.url as string).replace(authServer.internal, () => authServer.external);

  // login
  const response1 = await redirect(url);
  const response2 = await request(authServer.external + response1.location)
    .post('')
    .set('Cookie', response1.cookies)
    .type('form')
    .send({ prompt: 'login', login: sub, password: 'password' });

  // consent
  const response3 = await redirect(response2.header.location, response1.cookies);
  const response4 = await request(authServer.external + response3.location)
    .post('')
    .type('form')
    .set('Cookie', response3.cookies)
    .send({ prompt: 'consent' });

  const response5 = await redirect(response4.header.location, response3.cookies.slice(1));
  const callbackUrl = response5.location;
  if (!callbackUrl || new URL(callbackUrl).searchParams.get('state') !== state) {
    throw new Error(`OAuth flow did not return to the redirect uri: ${callbackUrl}`);
  }

  const callback = await request(app).post('/oauth/callback').send({ url: callbackUrl, state, codeVerifier });
  if (callback.status !== 201) {
    throw new Error(`POST /oauth/callback failed: ${callback.status} ${JSON.stringify(callback.body)}`);
  }
  return callback.body as LoginResponse;
};

/** A sub the mock has never seen, so the server auto-registers a new user for it. */
export const newOAuthSub = () => `pu-e2e-${randomBytes(6).toString('hex')}`;

const database: { client: pg.Client | null } = { client: null };

export const db = async () => {
  if (!database.client) {
    const client = new pg.Client(dbUrl);
    client.on('end', () => (database.client = null));
    client.on('error', () => (database.client = null));
    await client.connect();
    database.client = client;
  }
  return database.client;
};

export const closeDb = async () => {
  const { client } = database;
  database.client = null;
  await client?.end();
};

export type ExecResult = { exitCode: number; stdout: string; stderr: string };

const execFileAsync = promisify(execFile);

export const run = async (command: string, args: string[], options: { input?: string } = {}): Promise<ExecResult> => {
  if (options.input === undefined) {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, { maxBuffer: 64 * 1024 * 1024 });
      return { exitCode: 0, stdout, stderr };
    } catch (error: any) {
      return { exitCode: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) };
    }
  }

  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data.toString()));
    child.stderr.on('data', (data) => (stderr += data.toString()));
    child.on('close', (exitCode) => resolvePromise({ exitCode: exitCode ?? 1, stdout, stderr }));
    child.stdin.end(options.input);
  });
};

/** `docker exec` into a container, with optional environment overrides. */
export const dockerExec = (
  container: string,
  command: string[],
  options: { env?: Record<string, string>; input?: string } = {},
) => {
  const envArgs = Object.entries(options.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return run('docker', ['exec', '-i', ...envArgs, container, ...command], { input: options.input });
};

export const waitFor = async (
  description: string,
  check: () => Promise<boolean>,
  { timeoutMs = 90_000, intervalMs = 500 } = {},
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${description}`);
};

/**
Pull a `export const NAME = [ '...', ... ];` string array out of a TypeScript source file.
The e2e package cannot import server code (it has none of the server's dependencies),
so the specs read the list from source and follow it when it changes.
*/
export const parseStringArray = (source: string, name: string): string[] => {
  const match = new RegExp(String.raw`export const ${name}\s*=\s*\[([^\]]*)\]`).exec(source);
  if (!match) {
    throw new Error(`Could not find ${name}`);
  }
  return match[1]
    .matchAll(/'([^']*)'/g)
    .map(([, value]) => value)
    .toArray();
};
