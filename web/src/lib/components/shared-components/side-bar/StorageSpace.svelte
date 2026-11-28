<script lang="ts">
  import { getStorageQuery } from '#lib/queries/server-info.query.ts';
  import { locale } from '#lib/stores/preferences.store.ts';
  import { getByteUnitString } from '#lib/utils/byte-units.ts';
  import { getStorageUsage, STORAGE_METER_THRESHOLDS } from '#lib/utils/storage-warning.ts';
  import { LoadingSpinner, Meter } from '@immich/ui';
  import { createQuery } from '@tanstack/svelte-query';
  import { t } from 'svelte-i18n';

  const query = createQuery(getStorageQuery);
  const serverInfo = $derived(query.data);

  let usage = $derived(getStorageUsage(serverInfo));
  let availableBytes = $derived(usage?.totalBytes ?? 0);
  let usedBytes = $derived(usage?.usedBytes ?? 0);
</script>

<div
  class="min-w-52 bg-light-100 p-4 text-sm"
  title={$t('storage_usage', {
    values: {
      used: getByteUnitString(usedBytes, $locale, 3),
      available: getByteUnitString(availableBytes, $locale, 3),
    },
  })}
>
  {#if serverInfo}
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
