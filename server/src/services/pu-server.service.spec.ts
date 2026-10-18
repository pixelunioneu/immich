import { vi } from 'vitest';
import { defaults } from 'src/dtos/config.dto.js';
import { ServerService } from 'src/services/server.service.js';
import { mockEnvData } from 'test/repositories/config.repository.mock.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// PixelUnion: getStorage reports against the server-wide upload quota when one is configured.
describe(`${ServerService.name} (PixelUnion upload quota)`, () => {
  let sut: ServerService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ServerService));
  });

  describe('getStorage', () => {
    it('should return configured server-wide quota when config file quota is set', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      vi.spyOn(sut, 'getConfig').mockResolvedValue({
        ...defaults,
        server: {
          ...defaults.server,
          uploadQuotaGb: 1,
        },
      });
      mocks.user.getQuotaUsage.mockResolvedValue(400_000_000);

      await expect(sut.getStorage()).resolves.toEqual({
        diskAvailable: '642.5 MiB',
        diskAvailableRaw: 673_741_824,
        diskSize: '1.0 GiB',
        diskSizeRaw: 1_073_741_824,
        diskUsagePercentage: 37.25,
        diskUse: '381.5 MiB',
        diskUseRaw: 400_000_000,
      });

      expect(mocks.user.getQuotaUsage).toHaveBeenCalled();
      expect(mocks.storage.checkDiskUsage).not.toHaveBeenCalled();
    });

    it('should fall back to disk usage when config file quota is not set', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      vi.spyOn(sut, 'getConfig').mockResolvedValue(defaults);
      mocks.storage.checkDiskUsage.mockResolvedValue({ free: 200, available: 300, total: 500 });

      await expect(sut.getStorage()).resolves.toEqual({
        diskAvailable: '300 B',
        diskAvailableRaw: 300,
        diskSize: '500 B',
        diskSizeRaw: 500,
        diskUsagePercentage: 60,
        diskUse: '300 B',
        diskUseRaw: 300,
      });

      expect(mocks.storage.checkDiskUsage).toHaveBeenCalledWith(expect.stringContaining('/data/library'));
    });
  });
});
