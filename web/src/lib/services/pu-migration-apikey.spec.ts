import {
  createApiKey,
  deleteApiKey,
  getApiKeys,
  Permission,
  type ApiKeyCreateResponseDto,
  type ApiKeyResponseDto,
} from '@immich/sdk';
import {
  createMigrationApiKey,
  deleteMigrationApiKey,
  getStoredMigrationApiKeyId,
  MIGRATION_API_KEY_NAME,
  MIGRATION_API_KEY_PERMISSIONS,
  storeMigrationApiKeyId,
} from '$lib/services/pu-migration-apikey';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  getApiKeys: vi.fn(),
}));

const apiKey = (id: string, name: string) => ({ id, name }) as ApiKeyResponseDto;

describe('pu-migration-apikey', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(createApiKey).mockReset();
    vi.mocked(deleteApiKey)
      .mockReset()
      .mockResolvedValue(undefined as never);
    vi.mocked(getApiKeys).mockReset().mockResolvedValue([]);
  });

  it('requests only the permissions immich-go needs', () => {
    expect(MIGRATION_API_KEY_PERMISSIONS).not.toContain(Permission.All);
    expect(MIGRATION_API_KEY_PERMISSIONS).toEqual(
      expect.arrayContaining([Permission.AssetUpload, Permission.AlbumCreate]),
    );
  });

  describe('createMigrationApiKey', () => {
    it('replaces existing migration keys, creates a new one and remembers its id', async () => {
      vi.mocked(getApiKeys).mockResolvedValue([
        apiKey('old-1', MIGRATION_API_KEY_NAME),
        apiKey('other', 'my phone'),
        apiKey('old-2', MIGRATION_API_KEY_NAME),
      ]);
      vi.mocked(createApiKey).mockResolvedValue({
        apiKey: apiKey('new', MIGRATION_API_KEY_NAME),
        secret: 's3cret',
      } as ApiKeyCreateResponseDto);

      await expect(createMigrationApiKey()).resolves.toEqual({ id: 'new', secret: 's3cret' });

      expect(deleteApiKey).toHaveBeenCalledTimes(2);
      expect(deleteApiKey).toHaveBeenCalledWith({ id: 'old-1' });
      expect(deleteApiKey).toHaveBeenCalledWith({ id: 'old-2' });
      expect(createApiKey).toHaveBeenCalledWith({
        apiKeyCreateDto: { name: MIGRATION_API_KEY_NAME, permissions: MIGRATION_API_KEY_PERMISSIONS },
      });
      expect(getStoredMigrationApiKeyId()).toBe('new');
    });
  });

  describe('deleteMigrationApiKey', () => {
    it('deletes the stored key and any leftovers by name', async () => {
      storeMigrationApiKeyId('stored');
      vi.mocked(getApiKeys).mockResolvedValue([apiKey('leftover', MIGRATION_API_KEY_NAME), apiKey('other', 'x')]);

      await deleteMigrationApiKey();

      expect(deleteApiKey).toHaveBeenCalledWith({ id: 'stored' });
      expect(deleteApiKey).toHaveBeenCalledWith({ id: 'leftover' });
      expect(deleteApiKey).not.toHaveBeenCalledWith({ id: 'other' });
      expect(getStoredMigrationApiKeyId()).toBeNull();
    });

    it('falls back to the name lookup when the stored key is already gone', async () => {
      storeMigrationApiKeyId('stored');
      vi.mocked(deleteApiKey).mockRejectedValueOnce(new Error('not found'));
      vi.mocked(getApiKeys).mockResolvedValue([apiKey('leftover', MIGRATION_API_KEY_NAME)]);

      await expect(deleteMigrationApiKey()).resolves.toBeUndefined();

      expect(deleteApiKey).toHaveBeenCalledWith({ id: 'leftover' });
      expect(getStoredMigrationApiKeyId()).toBeNull();
    });

    it('never throws', async () => {
      vi.mocked(getApiKeys).mockRejectedValue(new Error('offline'));

      await expect(deleteMigrationApiKey()).resolves.toBeUndefined();
    });
  });
});
