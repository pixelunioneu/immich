import { readFile } from 'node:fs/promises';
import { ConfigRepository } from 'src/repositories/config.repository';
import { PuApiRepository } from 'src/repositories/pu-api.repository';
import { Mocked, vitest } from 'vitest';

vitest.mock('node:fs/promises', () => ({
  readFile: vitest.fn(),
}));

describe(PuApiRepository.name, () => {
  let sut: PuApiRepository;
  let configRepository: Mocked<Pick<ConfigRepository, 'getEnv'>>;
  let logger: {
    setContext: ReturnType<typeof vitest.fn>;
    debug: ReturnType<typeof vitest.fn>;
    warn: ReturnType<typeof vitest.fn>;
    error: ReturnType<typeof vitest.fn>;
  };

  beforeEach(() => {
    configRepository = {
      getEnv: vitest.fn().mockReturnValue({
        puApiHost: 'http://pu-api',
        puTenantName: 'pond',
        puServiceAccountTokenPath: '/var/run/secrets/kubernetes.io/serviceaccount/token',
      }),
    };
    logger = {
      setContext: vitest.fn(),
      debug: vitest.fn(),
      warn: vitest.fn(),
      error: vitest.fn(),
    };
    sut = new PuApiRepository(configRepository as unknown as ConfigRepository, logger as never);
    vitest.mocked(readFile).mockResolvedValue('service-token');
    vitest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve({ ok: true }),
      status: 200,
      statusText: 'OK',
    } as Response);
  });

  afterEach(() => {
    vitest.restoreAllMocks();
  });

  it('should sync tenant users with bearer token auth', async () => {
    await sut.syncTenantUsers();

    expect(readFile).toHaveBeenCalledWith('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
    expect(fetch).toHaveBeenCalledWith(
      new URL('/internal/api/immich/tenant-users/sync?tenant=pond', 'http://pu-api'),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer service-token' },
      }),
    );
  });

  it('should skip sync when host or tenant is missing', async () => {
    configRepository.getEnv.mockReturnValue({
      puApiHost: null,
      puTenantName: null,
      puServiceAccountTokenPath: '/var/run/secrets/kubernetes.io/serviceaccount/token',
    } as never);

    await sut.syncTenantUsers();

    expect(fetch).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Skipping PU API tenant sync, PU_API_HOST or PU_TENANT_NAME is not configured',
    );
  });

  it('should return null reverse geocode when token cannot be read', async () => {
    vitest.mocked(readFile).mockRejectedValue(new Error('not found'));

    const result = await sut.reverseGeocode<{ country: string; state: string; city: string }>({
      latitude: 1.23,
      longitude: 4.56,
    });

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('should return reverse geocode payload', async () => {
    vitest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          country: 'NL',
          state: 'North Holland',
          city: 'Amsterdam',
        }),
      status: 200,
      statusText: 'OK',
    } as Response);

    const result = await sut.reverseGeocode<{ country: string; state: string; city: string }>({
      latitude: 52.37,
      longitude: 4.89,
    });

    expect(result).toEqual({ country: 'NL', state: 'North Holland', city: 'Amsterdam' });
    expect(fetch).toHaveBeenCalledWith(
      new URL('/internal/api/map/reverse-geocode?lat=52.37&lon=4.89', 'http://pu-api'),
      expect.anything(),
    );
  });

  it('should call reverse geocode endpoint', async () => {
    vitest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve({ country: null, state: null, city: null }),
      status: 200,
      statusText: 'OK',
    } as Response);

    await sut.reverseGeocode({ latitude: 52.37, longitude: 4.89 });

    expect(fetch).toHaveBeenCalledWith(
      new URL('/internal/api/map/reverse-geocode?lat=52.37&lon=4.89', 'http://pu-api'),
      expect.anything(),
    );
  });

  it('should call search places endpoint', async () => {
    vitest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve([]),
      status: 200,
      statusText: 'OK',
    } as Response);

    await sut.searchPlaces('amst');

    expect(fetch).toHaveBeenCalledWith(
      new URL('/internal/api/map/search-places?q=amst', 'http://pu-api'),
      expect.anything(),
    );
  });
});
