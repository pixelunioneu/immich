import { BadRequestException } from '@nestjs/common';
import { AssetFile } from 'src/database.js';
import { AssetMediaStatus } from 'src/dtos/asset-media-response.dto.js';
import { AssetMediaCreateDto } from 'src/dtos/asset-media.dto.js';
import { MapAsset } from 'src/dtos/asset-response.dto.js';
import { AssetType, JobName } from 'src/enum.js';
import { AssetMediaService } from 'src/services/asset-media.service.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { mockEnvData } from 'test/repositories/config.repository.mock.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const createDto = Object.freeze({
  fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
  fileModifiedAt: new Date('2022-06-19T23:41:36.910Z'),
  isFavorite: false,
}) as AssetMediaCreateDto;

const assetEntity = Object.freeze({
  id: 'id_1',
  ownerId: 'user_id_1',
  type: AssetType.Image,
  originalPath: 'fake_path/asset_1.jpeg',
  fileModifiedAt: new Date('2022-06-19T23:41:36.910Z'),
  fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
  updatedAt: new Date('2022-06-19T23:41:36.910Z'),
  isFavorite: false,
  duration: null,
  files: [] as AssetFile[],
  livePhotoVideoId: null,
} as MapAsset);

const file = {
  uuid: 'random-uuid',
  originalPath: 'fake_path/asset_1.jpeg',
  mimeType: 'image/jpeg',
  checksum: Buffer.from('file hash', 'utf8'),
  originalName: 'asset_1.jpeg',
  size: 42,
};

// PixelUnion: uploads are refused when the library volume is below IMMICH_MINIMUM_DISK_SPACE_BYTES.
describe(`${AssetMediaService.name} (PixelUnion disk space guard)`, () => {
  let sut: AssetMediaService;
  let mocks: ServiceMocks;
  const minimumDiskSpaceBytes = 50 * 1024 * 1024;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AssetMediaService));
    mocks.config.getEnv.mockReturnValue(
      mockEnvData({ storage: { ignoreMountCheckErrors: false, minimumDiskSpaceBytes } }),
    );
  });

  it('should reject uploads when available space is below the minimum', async () => {
    mocks.storage.checkDiskUsage.mockResolvedValue({
      available: minimumDiskSpaceBytes - 1,
      free: minimumDiskSpaceBytes - 1,
      total: 10 * minimumDiskSpaceBytes,
    });

    await expect(sut.uploadAsset(authStub.user1, createDto, file)).rejects.toThrow(
      new BadRequestException('Not enough storage'),
    );

    expect(mocks.storage.checkDiskUsage).toHaveBeenCalledWith(expect.stringContaining('/data/library'));
    expect(mocks.asset.create).not.toHaveBeenCalled();
    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.FileDelete,
      data: { files: [file.originalPath, undefined] },
    });
  });

  it('should accept uploads when available space equals the minimum', async () => {
    mocks.storage.checkDiskUsage.mockResolvedValue({
      available: minimumDiskSpaceBytes,
      free: minimumDiskSpaceBytes,
      total: 10 * minimumDiskSpaceBytes,
    });
    mocks.asset.create.mockResolvedValue(assetEntity);

    await expect(sut.uploadAsset(authStub.user1, createDto, file)).resolves.toEqual({
      id: 'id_1',
      status: AssetMediaStatus.CREATED,
    });
  });

  it('should honour a custom minimum', async () => {
    mocks.config.getEnv.mockReturnValue(
      mockEnvData({ storage: { ignoreMountCheckErrors: false, minimumDiskSpaceBytes: 1000 } }),
    );
    mocks.storage.checkDiskUsage.mockResolvedValue({ available: 999, free: 999, total: 10_000 });

    await expect(sut.uploadAsset(authStub.user1, createDto, file)).rejects.toBeInstanceOf(BadRequestException);
  });
});
