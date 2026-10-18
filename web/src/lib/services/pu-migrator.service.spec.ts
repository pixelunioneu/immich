import { PuReauthRequiredError } from '$lib/services/pu-email-change';
import {
  createMigration,
  getMigration,
  getMigrationUploadAuthHeader,
  getMigrationUploadUrl,
  getTenantUsername,
  MigratorApiError,
  startMigration,
  validateCredentials,
} from '$lib/services/pu-migrator.service';
import { clearPuOidcAccessTokenCache, getPuOidcAccessToken } from '$lib/utils/pu-oidc';

vi.mock('$lib/utils/pu-oidc', () => ({
  getPuOidcAccessToken: vi.fn(),
  clearPuOidcAccessTokenCache: vi.fn(),
}));

const PRD_BASE = 'https://api.prd.tech.pixelunion.eu/api/migrator/google-photos';
const NONPRD_BASE = 'https://api.nonprd.tech.pixelunion.eu/api/migrator/google-photos';

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });

const setHostname = (hostname: string) => vi.stubGlobal('location', { hostname });

const authHeaderOf = (call: Parameters<typeof fetch>) => new Headers(call[1]?.headers).get('Authorization');

describe('pu-migrator.service', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.mocked(getPuOidcAccessToken).mockReset().mockResolvedValue('token-1');
    vi.mocked(clearPuOidcAccessTokenCache).mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setHostname('mytenant.pixelunion.eu');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getTenantUsername', () => {
    it.each([
      ['mytenant.pixelunion.eu', 'mytenant'],
      ['mytenant.nonprd.tech.pixelunion.eu', 'mytenant'],
      ['localhost', 'localhost'],
      ['foo.example.com', 'foo'],
    ])('derives %s -> %s', (hostname, expected) => {
      setHostname(hostname);
      expect(getTenantUsername()).toBe(expected);
    });
  });

  describe('base url', () => {
    it('targets production by default', () => {
      expect(getMigrationUploadUrl()).toBe(`${PRD_BASE}/upload`);
    });

    it('targets non-production from a non-production host', () => {
      setHostname('mytenant.nonprd.tech.pixelunion.eu');
      expect(getMigrationUploadUrl()).toBe(`${NONPRD_BASE}/upload`);
    });
  });

  describe('auth', () => {
    it('sends the OIDC bearer token', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 'm1' }));

      await expect(getMigration()).resolves.toEqual({ id: 'm1' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(`${PRD_BASE}/`);
      expect(authHeaderOf(fetchMock.mock.calls[0])).toBe('Bearer token-1');
    });

    it('throws PuReauthRequiredError without calling the API when no token is available', async () => {
      vi.mocked(getPuOidcAccessToken).mockResolvedValue(null);

      await expect(getMigration()).rejects.toBeInstanceOf(PuReauthRequiredError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('clears the token cache and retries once with a fresh token on 401', async () => {
      vi.mocked(getPuOidcAccessToken).mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh');
      const sentHeaders: Array<string | null> = [];
      const responses = [new Response(null, { status: 401 }), jsonResponse({ id: 'm1' })];
      fetchMock.mockImplementation((...args) => {
        // headers are mutated between calls, so capture them at call time
        sentHeaders.push(authHeaderOf(args));
        return Promise.resolve(responses.shift()!);
      });

      await expect(getMigration()).resolves.toEqual({ id: 'm1' });

      expect(clearPuOidcAccessTokenCache).toHaveBeenCalledTimes(1);
      expect(sentHeaders).toEqual(['Bearer stale', 'Bearer fresh']);
    });

    it('preserves method and body on the retry', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

      await createMigration({ username: 'mytenant', apiKey: 'secret' });

      expect(fetchMock.mock.calls[1][1]).toMatchObject({
        method: 'PUT',
        body: JSON.stringify({ username: 'mytenant', apiKey: 'secret' }),
      });
    });

    it('throws PuReauthRequiredError when no fresh token is available after a 401', async () => {
      vi.mocked(getPuOidcAccessToken).mockResolvedValueOnce('stale').mockResolvedValueOnce(null);
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

      await expect(getMigration()).rejects.toBeInstanceOf(PuReauthRequiredError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries only once', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'Unauthorized' }, 401));

      await expect(getMigration()).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('builds the upload auth header', async () => {
      await expect(getMigrationUploadAuthHeader()).resolves.toEqual({ Authorization: 'Bearer token-1' });
    });
  });

  describe('errors', () => {
    it('uses a string detail', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'Migration not found' }, 404));

      const error = await getMigration().catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(MigratorApiError);
      expect(error).toMatchObject({ message: 'Migration not found', status: 404, detail: 'Migration not found' });
    });

    it('serializes array details', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: [{ loc: 'x' }] }, 422));

      await expect(getMigration()).rejects.toMatchObject({ status: 422, detail: '{"loc":"x"}' });
    });

    it('falls back to the status when there is no detail', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 500));

      await expect(getMigration()).rejects.toMatchObject({ message: 'Request failed: 500', status: 500 });
    });

    // BUG (reported, not fixed): ensureOk reads the body with response.json() and on a parse
    // failure retries with response.text(), but the body is already consumed by then, so a
    // non-JSON error page (e.g. a 502 from a proxy) surfaces as a TypeError instead of a
    // MigratorApiError. Flip this to `it` once ensureOk reads the body once.
    it.fails('maps a non-JSON error body to MigratorApiError', async () => {
      fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));

      await expect(getMigration()).rejects.toBeInstanceOf(MigratorApiError);
    });
  });

  describe('startMigration', () => {
    it('posts to /start', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'started' }));

      await expect(startMigration()).resolves.toEqual({ status: 'started' });
      expect(fetchMock.mock.calls[0][0]).toBe(`${PRD_BASE}/start`);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    });

    it('passes force', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'started' }));

      await startMigration(true);
      expect(fetchMock.mock.calls[0][0]).toBe(`${PRD_BASE}/start?force=true`);
    });

    it('returns insufficient_storage instead of throwing', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: 'insufficient_storage', detail: 'Not enough space' }, 400));

      await expect(startMigration()).resolves.toEqual({ status: 'insufficient_storage', detail: 'Not enough space' });
    });

    it('throws on other errors', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'Already running' }, 409));

      await expect(startMigration()).rejects.toMatchObject({ message: 'Already running', status: 409 });
    });
  });

  it('validateCredentials normalizes input', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));

    await validateCredentials('  MyTenant ', ' key ');

    expect(fetchMock.mock.calls[0][0]).toBe(`${PRD_BASE}/validate-credentials`);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ username: 'mytenant', apiKey: 'key' }));
  });
});
