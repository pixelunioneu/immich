import { ConfigRepository, clearEnvCache } from 'src/repositories/config.repository.js';

const PU_ENV = ['PU_API_HOST', 'PU_TENANT_NAME', 'PU_SERVICE_ACCOUNT_TOKEN_PATH', 'IMMICH_MINIMUM_DISK_SPACE_BYTES'];

const getEnv = () => {
  clearEnvCache();
  return new ConfigRepository().getEnv();
};

// PixelUnion: env vars added by the fork.
describe(`${ConfigRepository.name} (PixelUnion env)`, () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of PU_ENV) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of PU_ENV) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
    clearEnvCache();
  });

  it('should default PU API values', () => {
    const { puApiHost, puTenantName, puServiceAccountTokenPath } = getEnv();
    expect(puApiHost).toBeNull();
    expect(puTenantName).toBeNull();
    expect(puServiceAccountTokenPath).toBe('/var/run/secrets/kubernetes.io/serviceaccount/token');
  });

  it('should map PU API env vars', () => {
    process.env.PU_API_HOST = 'http://pu-api';
    process.env.PU_TENANT_NAME = 'pond';
    process.env.PU_SERVICE_ACCOUNT_TOKEN_PATH = '/var/run/secrets/custom/token';
    const { puApiHost, puTenantName, puServiceAccountTokenPath } = getEnv();
    expect(puApiHost).toBe('http://pu-api');
    expect(puTenantName).toBe('pond');
    expect(puServiceAccountTokenPath).toBe('/var/run/secrets/custom/token');
  });

  it('should default the minimum disk space to 50 MB', () => {
    expect(getEnv().storage.minimumDiskSpaceBytes).toBe(50 * 1024 * 1024);
  });

  it('should read IMMICH_MINIMUM_DISK_SPACE_BYTES', () => {
    process.env.IMMICH_MINIMUM_DISK_SPACE_BYTES = '1000';
    expect(getEnv().storage.minimumDiskSpaceBytes).toBe(1000);
  });
});
