<script lang="ts">
  import PixelUnionLogo from '$lib/components/shared-components/pixelunion-logo.svelte';
  import { Route } from '$lib/route';
  import { locale } from '$lib/stores/preferences.store';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { PU_BILLING_PORTAL_URL } from '$lib/utils/pu-api';
  import { STORAGE_METER_THRESHOLDS } from '$lib/utils/storage-warning';
  import { StorageWarningLevel } from '@immich/sdk';
  import { Button, CloseButton, Icon, Meter, Modal, ModalBody, ModalFooter, ModalHeader } from '@immich/ui';
  import { mdiAccountTie, mdiArrowUpBoldCircleOutline, mdiBroom, mdiChevronRight, mdiGiftOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    level: StorageWarningLevel;
    usedBytes: number;
    totalBytes: number;
    isAdmin: boolean;
    showReferral: boolean;
    onClose: () => void;
  };

  let { level, usedBytes, totalBytes, isAdmin, showReferral, onClose }: Props = $props();

  let isFull = $derived(level === StorageWarningLevel.Full);
  let percent = $derived(Math.min(100, Math.round((usedBytes / totalBytes) * 100)));

  // Same look as the referral banner in the sidebar.
  const cardClass =
    'flex w-full items-center gap-3 rounded-lg border border-immich-primary/20 p-3 shadow-sm dark:border-immich-dark-primary/10 dark:bg-immich-dark-primary/10';
</script>

{#snippet option(icon: string, title: string, description: string, chevron: boolean)}
  <Icon {icon} class="shrink-0 text-primary" size="24" aria-hidden />
  <div class="grow">
    <p class="font-medium text-primary">{title}</p>
    <p class="text-sm text-gray-600 dark:text-gray-300">{description}</p>
  </div>
  {#if chevron}
    <Icon icon={mdiChevronRight} class="shrink-0 text-primary" size="20" aria-hidden />
  {/if}
{/snippet}

<Modal size="small" {onClose}>
  <ModalHeader>
    <div class="flex items-center justify-between gap-2">
      <PixelUnionLogo variant="icon" size="tiny" />
      <p class="grow text-lg font-semibold text-dark/90">
        {isFull ? $t('storage_warning_full_title') : $t('storage_warning_almost_full_title')}
      </p>
      <CloseButton class="-me-2" onclick={onClose} />
    </div>
  </ModalHeader>

  <ModalBody>
    <div class="rounded-lg bg-light-100 p-4 text-sm">
      <Meter
        size="tiny"
        class="bg-light-200"
        containerClass="gap-2 leading-6"
        label={$t('storage')}
        valueLabel={$t('storage_usage', {
          values: {
            used: getByteUnitString(usedBytes, $locale),
            available: getByteUnitString(totalBytes, $locale),
          },
        })}
        value={usedBytes / totalBytes}
        thresholds={STORAGE_METER_THRESHOLDS}
      />
    </div>
    <p class="mt-3 font-medium">{$t('storage_warning_usage', { values: { percent } })}</p>
    <p class="mt-1 text-sm">
      {isFull ? $t('storage_warning_full_body') : $t('storage_warning_almost_full_body')}
    </p>

    <div class="mt-4 flex flex-col gap-2 pb-2">
      {#if isAdmin}
        <a href={PU_BILLING_PORTAL_URL} target="_blank" rel="noopener noreferrer" class={cardClass} onclick={onClose}>
          {@render option(
            mdiArrowUpBoldCircleOutline,
            $t('storage_warning_upgrade_title'),
            $t('storage_warning_upgrade_description'),
            true,
          )}
        </a>
      {:else}
        <div class={cardClass}>
          {@render option(
            mdiAccountTie,
            $t('storage_warning_ask_admin_title'),
            $t('storage_warning_ask_admin_description'),
            false,
          )}
        </div>
      {/if}

      {#if showReferral}
        <a href={Route.referral()} class={cardClass} onclick={onClose}>
          {@render option(
            mdiGiftOutline,
            $t('storage_warning_invite_title'),
            $t('storage_warning_invite_description'),
            true,
          )}
        </a>
      {/if}

      <a href={Route.utilities()} class={cardClass} onclick={onClose}>
        {@render option(mdiBroom, $t('storage_warning_cleanup_title'), $t('storage_warning_cleanup_description'), true)}
      </a>
    </div>
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full justify-end">
      <Button shape="round" color="secondary" variant="ghost" onclick={onClose}>{$t('storage_warning_not_now')}</Button>
    </div>
  </ModalFooter>
</Modal>
