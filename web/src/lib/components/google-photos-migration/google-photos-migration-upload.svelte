<script lang="ts">
  import { migrationUploadStore, MigrationUploadState } from '$lib/stores/migration-upload';
  import {
    enqueueMigrationUploads,
    formatMigrationUploadBytes,
    retryMigrationUpload,
  } from '$lib/services/pu-migration-uploader';
  import { PuReauthRequiredError } from '$lib/services/pu-email-change';
  import { openFilePicker } from '$lib/utils/file-uploader';
  import { Button, toastManager } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    filenamePattern?: string;
    maxBytes?: number;
    existingUploadKeys?: Set<string>;
    disabled?: boolean;
    onUploadComplete?: () => void | Promise<void>;
    onReauthRequired?: () => void;
  }

  let {
    filenamePattern = 'takeout-*.zip',
    maxBytes = 12 * 1024 ** 3,
    existingUploadKeys = new Set<string>(),
    disabled = false,
    onUploadComplete,
    onReauthRequired,
  }: Props = $props();

  let picking = $state(false);

  const uploadOptions = $derived({ onReauthRequired, onUploadComplete });

  const totalUploads = $derived($migrationUploadStore.length);
  const remainingUploads = migrationUploadStore.remainingUploads;
  const processedUploads = $derived(totalUploads - $remainingUploads);

  const handlePickFiles = async () => {
    if (disabled || picking) {
      return;
    }

    picking = true;
    try {
      const files = await openFilePicker({ multiple: true, extensions: ['.zip'] });
      if (files.length === 0) {
        return;
      }

      void enqueueMigrationUploads({
        files,
        filenamePattern,
        maxBytes,
        existingUploadKeys,
        ...uploadOptions,
      }).catch((error) => {
        if (error instanceof PuReauthRequiredError) {
          onReauthRequired?.();
          return;
        }
        toastManager.danger(error instanceof Error ? error.message : $t('google_photos_migration_upload_failed'));
      });
    } catch (error) {
      if (error instanceof PuReauthRequiredError) {
        onReauthRequired?.();
        return;
      }
      toastManager.danger(error instanceof Error ? error.message : $t('google_photos_migration_upload_failed'));
    } finally {
      picking = false;
    }
  };

  const handleRetry = (itemId: string, file: File) => {
    if (disabled) {
      return;
    }
    void retryMigrationUpload(file, itemId, uploadOptions);
  };
</script>

<div class="flex flex-col gap-4">
  <div class="rounded-2xl border border-gray-200 dark:border-subtle p-4 bg-subtle">
    <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75 mb-3">
      {$t('google_photos_migration_upload_intro', {
        values: { pattern: filenamePattern, size: formatMigrationUploadBytes(maxBytes) },
      })}
    </p>
    <Button shape="round" size="small" disabled={disabled || picking} onclick={() => handlePickFiles()}>
      {$t('google_photos_migration_select_files')}
    </Button>
  </div>

  {#if $migrationUploadStore.length > 0}
    {#if $remainingUploads > 0}
      <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75">
        {$t('upload_progress', {
          values: {
            remaining: $remainingUploads,
            processed: processedUploads,
            total: totalUploads,
          },
        })}
      </p>
    {/if}
    <ul class="space-y-2">
      {#each $migrationUploadStore as item (item.id)}
        <li class="rounded-xl border border-gray-200 dark:border-subtle px-4 py-3 bg-subtle">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="font-mono text-sm truncate">{item.file.name}</p>
              <p class="text-xs text-immich-fg/60 dark:text-immich-dark-fg/60">
                {formatMigrationUploadBytes(item.file.size)}
              </p>
            </div>
            {#if item.state === MigrationUploadState.PENDING}
              <span class="text-xs text-immich-fg/50 dark:text-immich-dark-fg/50">{$t('pending')}</span>
            {:else if item.state === MigrationUploadState.UPLOADING}
              <span class="text-xs text-primary">{Math.round(item.progress * 100)}%</span>
            {:else if item.state === MigrationUploadState.DONE}
              <span class="text-xs text-success">{$t('done')}</span>
            {:else if item.state === MigrationUploadState.ERROR}
              <Button shape="round" size="tiny" color="secondary" onclick={() => handleRetry(item.id, item.file)}>
                {$t('action_common_update')}
              </Button>
            {/if}
          </div>
          {#if item.state === MigrationUploadState.UPLOADING}
            <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div class="h-full rounded-full bg-primary transition-[width]" style={`width: ${item.progress * 100}%`}></div>
            </div>
          {/if}
          {#if item.error}
            <p class="mt-2 text-xs text-danger">{item.error}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
