<script lang="ts">
  import { getCurrentStorageLevel, getStorageUsage } from '$lib/utils/storage-warning';
  import { openStorageWarningModal } from '$lib/utils/storage-warning-modal';
  import { StorageWarningLevel } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight, mdiDatabaseAlertOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  let usage = $derived(getStorageUsage());
  let level = $derived(getCurrentStorageLevel());
  let isFull = $derived(level === StorageWarningLevel.Full);

  const onclick = () => {
    if (usage && level !== StorageWarningLevel.None) {
      void openStorageWarningModal(level, usage);
    }
  };
</script>

{#if level !== StorageWarningLevel.None}
  <div class="ps-4 text-sm">
    <button
      type="button"
      {onclick}
      class="mt-2 flex w-full min-w-52 place-items-center justify-between rounded-lg border border-immich-primary/20 p-2 shadow-md dark:border-immich-dark-primary/10 dark:bg-immich-dark-primary/10"
    >
      <span class="flex place-items-center gap-1">
        <Icon icon={mdiDatabaseAlertOutline} class={isFull ? 'text-danger' : 'text-warning'} size="18" />
        <span class="flex font-medium text-primary">
          {isFull ? $t('storage_warning_sidebar_full') : $t('storage_warning_sidebar_almost_full')}
        </span>
      </span>

      <Icon icon={mdiChevronRight} class="hidden text-primary sidebar:flex" size="18" />
    </button>
  </div>
{/if}
