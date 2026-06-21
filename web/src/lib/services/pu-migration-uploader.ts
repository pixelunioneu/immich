import { migrationUploadStore, MigrationUploadState } from '$lib/stores/migration-upload';
import {
  getMigrationUploadAuthHeader,
  getMigrationUploadUrl,
  MigratorApiError,
} from '$lib/services/pu-migrator.service';
import { PuReauthRequiredError } from '$lib/services/pu-email-change';
import { clearPuOidcAccessTokenCache } from '$lib/utils/pu-oidc';
import { uploadRequest } from '$lib/utils';
import { ExecutorQueue } from '$lib/utils/executor-queue';
import { toastManager } from '@immich/ui';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

export const migrationUploadQueue = new ExecutorQueue({ concurrency: 1 });

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replaceAll(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function formatMigrationUploadBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const isUnauthorized = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'statusCode' in error &&
  (error as { statusCode: number }).statusCode === 401;

export type EnqueueMigrationUploadsOptions = {
  files: File[];
  filenamePattern?: string;
  maxBytes?: number;
  existingUploadKeys?: Set<string>;
  onReauthRequired?: () => void;
  onUploadComplete?: () => void | Promise<void>;
};

async function uploadMigrationFile(
  file: File,
  itemId: string,
  options: Pick<EnqueueMigrationUploadsOptions, 'onReauthRequired' | 'onUploadComplete'>,
  retryOn401 = true,
): Promise<void> {
  const $t = get(t);

  migrationUploadStore.updateItem(itemId, {
    state: MigrationUploadState.UPLOADING,
    progress: 0,
    error: undefined,
  });

  try {
    await uploadRequest<{ status: string; id: string; filename: string }>({
      url: getMigrationUploadUrl(),
      method: 'POST',
      data: file,
      headers: {
        ...(await getMigrationUploadAuthHeader()),
        'X-Filename': file.name,
        'Content-Type': 'application/octet-stream',
      },
      onUploadProgress: (event) => {
        if (event.lengthComputable) {
          migrationUploadStore.updateItem(itemId, { progress: event.loaded / event.total });
        }
      },
    });

    migrationUploadStore.updateItem(itemId, { state: MigrationUploadState.DONE, progress: 1 });
    await options.onUploadComplete?.();
  } catch (error) {
    if (retryOn401 && isUnauthorized(error)) {
      clearPuOidcAccessTokenCache();
      return uploadMigrationFile(file, itemId, options, false);
    }

    if (error instanceof PuReauthRequiredError) {
      options.onReauthRequired?.();
      migrationUploadStore.updateItem(itemId, {
        state: MigrationUploadState.ERROR,
        error: $t('google_photos_migration_reauth_required'),
      });
      return;
    }

    const message =
      error instanceof MigratorApiError
        ? error.detail || error.message
        : error instanceof Error
          ? error.message
          : $t('google_photos_migration_upload_failed');

    migrationUploadStore.updateItem(itemId, {
      state: MigrationUploadState.ERROR,
      error: message,
    });
  }
}

export async function enqueueMigrationUploads({
  files,
  filenamePattern = 'takeout-*.zip',
  maxBytes = 12 * 1024 ** 3,
  existingUploadKeys = new Set<string>(),
  onReauthRequired,
  onUploadComplete,
}: EnqueueMigrationUploadsOptions): Promise<void> {
  const $t = get(t);
  const filenameRegex = patternToRegex(filenamePattern);
  const uploadOptions = { onReauthRequired, onUploadComplete };
  const tasks: Promise<void>[] = [];

  for (const file of files) {
    const key = `${file.name}\t${file.size}`;
    if (existingUploadKeys.has(key)) {
      toastManager.primary($t('google_photos_migration_already_uploaded', { values: { name: file.name } }));
      continue;
    }

    if (!filenameRegex.test(file.name)) {
      toastManager.warning($t('google_photos_migration_invalid_filename', { values: { pattern: filenamePattern } }));
      continue;
    }

    if (file.size > maxBytes) {
      toastManager.warning(
        $t('google_photos_migration_file_too_large', { values: { size: formatMigrationUploadBytes(maxBytes) } }),
      );
      continue;
    }

    const itemId = migrationUploadStore.addItem(file);
    tasks.push(migrationUploadQueue.addTask(() => uploadMigrationFile(file, itemId, uploadOptions)));
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

export function retryMigrationUpload(
  file: File,
  itemId: string,
  options: Pick<EnqueueMigrationUploadsOptions, 'onReauthRequired' | 'onUploadComplete'>,
): Promise<void> {
  return migrationUploadQueue.addTask(() => uploadMigrationFile(file, itemId, options));
}
