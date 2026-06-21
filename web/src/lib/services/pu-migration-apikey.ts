import { createApiKey, deleteApiKey, getApiKeys, Permission } from '@immich/sdk';

export const MIGRATION_API_KEY_NAME = 'google-photos-migration';

const MIGRATION_API_KEY_ID_STORAGE_KEY = 'pu-google-photos-migration-api-key-id';

/** Permissions required by immich-go upload from-google-photos (see migrate-google-photos help). */
export const MIGRATION_API_KEY_PERMISSIONS: Permission[] = [
  Permission.AssetRead,
  Permission.AssetStatistics,
  Permission.AssetUpdate,
  Permission.AssetUpload,
  Permission.AssetCopy,
  Permission.AssetReplace,
  Permission.AssetDelete,
  Permission.AssetDownload,
  Permission.AlbumCreate,
  Permission.AlbumRead,
  Permission.AlbumAssetCreate,
  Permission.ServerAbout,
  Permission.StackCreate,
  Permission.TagAsset,
  Permission.TagCreate,
  Permission.UserRead,
  Permission.ServerStorage,
];

export function getStoredMigrationApiKeyId(): string | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  return sessionStorage.getItem(MIGRATION_API_KEY_ID_STORAGE_KEY);
}

export function storeMigrationApiKeyId(id: string): void {
  sessionStorage.setItem(MIGRATION_API_KEY_ID_STORAGE_KEY, id);
}

export function clearStoredMigrationApiKeyId(): void {
  sessionStorage.removeItem(MIGRATION_API_KEY_ID_STORAGE_KEY);
}

async function deleteExistingMigrationApiKeys(): Promise<void> {
  const keys = await getApiKeys();
  const existing = keys.filter((key) => key.name === MIGRATION_API_KEY_NAME);
  await Promise.all(existing.map((key) => deleteApiKey({ id: key.id })));
}

export async function createMigrationApiKey(): Promise<{ id: string; secret: string }> {
  await deleteExistingMigrationApiKeys();

  const response = await createApiKey({
    apiKeyCreateDto: {
      name: MIGRATION_API_KEY_NAME,
      permissions: MIGRATION_API_KEY_PERMISSIONS,
    },
  });

  storeMigrationApiKeyId(response.apiKey.id);

  return {
    id: response.apiKey.id,
    secret: response.secret,
  };
}

export async function deleteMigrationApiKey(): Promise<void> {
  const storedId = getStoredMigrationApiKeyId();

  if (storedId) {
    try {
      await deleteApiKey({ id: storedId });
    } catch {
      // Fall through to name-based lookup.
    }
    clearStoredMigrationApiKeyId();
  }

  try {
    await deleteExistingMigrationApiKeys();
  } catch {
    // Best-effort cleanup.
  }
}
