<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { requestServerInfo } from '$lib/utils/auth';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { getStorageUsage, STORAGE_METER_THRESHOLDS } from '$lib/utils/storage-warning';
  import { LoadingSpinner, Meter } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  let usage = $derived(getStorageUsage());
  let availableBytes = $derived(usage?.totalBytes ?? 0);
  let usedBytes = $derived(usage?.usedBytes ?? 0);

  onMount(async () => {
    if (userInteraction.serverInfo && authManager.authenticated) {
      return;
    }
    await requestServerInfo();
  });
</script>

<div
  class="ms-4 min-w-52 rounded-lg bg-light-100 p-4 text-sm"
  title={$t('storage_usage', {
    values: {
      used: getByteUnitString(usedBytes, $locale, 3),
      available: getByteUnitString(availableBytes, $locale, 3),
    },
  })}
>
  {#if userInteraction.serverInfo}
    <Meter
      size="tiny"
      class="bg-light-200"
      containerClass="gap-2 leading-6"
      label={$t('storage')}
      valueLabel={$t('storage_usage', {
        values: {
          used: getByteUnitString(usedBytes, $locale),
          available: getByteUnitString(availableBytes, $locale),
        },
      })}
      value={usedBytes / availableBytes}
      thresholds={STORAGE_METER_THRESHOLDS}
    />
  {:else}
    <p class="mb-4 font-medium text-immich-dark-gray dark:text-white">{$t('storage')}</p>
    <LoadingSpinner />
  {/if}
</div>
