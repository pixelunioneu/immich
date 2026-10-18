import { clearPuOidcAccessTokenCache, getPuOidcAccessToken } from '$lib/utils/pu-oidc';

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });

describe('pu-oidc', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    clearPuOidcAccessTokenCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('requests a token from the server with the session cookie', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'token-1' }));

    await expect(getPuOidcAccessToken()).resolves.toBe('token-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/oidc-token', { method: 'POST', credentials: 'include' });
  });

  it('caches the token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'token-1' }));

    await getPuOidcAccessToken();
    await expect(getPuOidcAccessToken()).resolves.toBe('token-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache expires after ~50 minutes', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'token-1' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'token-2' }));

    await getPuOidcAccessToken();
    vi.advanceTimersByTime(49 * 60 * 1000);
    await expect(getPuOidcAccessToken()).resolves.toBe('token-1');
    vi.advanceTimersByTime(2 * 60 * 1000);
    await expect(getPuOidcAccessToken()).resolves.toBe('token-2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches after the cache is cleared', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'token-1' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'token-2' }));

    await getPuOidcAccessToken();
    clearPuOidcAccessTokenCache();

    await expect(getPuOidcAccessToken()).resolves.toBe('token-2');
  });

  it('returns null when the server asks for reauth', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reauth: true }));

    await expect(getPuOidcAccessToken()).resolves.toBeNull();
  });

  it('drops a cached token when the server asks for reauth', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'token-1' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ reauth: true }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ reauth: true }));

    await getPuOidcAccessToken();
    vi.advanceTimersByTime(51 * 60 * 1000);

    await expect(getPuOidcAccessToken()).resolves.toBeNull();
    await expect(getPuOidcAccessToken()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 400, 500])('returns null on HTTP %s without caching', async (status) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, status));
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'token-1' }));

    await expect(getPuOidcAccessToken()).resolves.toBeNull();
    await expect(getPuOidcAccessToken()).resolves.toBe('token-1');
  });

  it('returns null when the response has no token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await expect(getPuOidcAccessToken()).resolves.toBeNull();
  });
});
