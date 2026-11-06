<script lang="ts">
  import { isReferralEligible, loadReferral } from '$lib/services/pu-referral.service';
  import { Route } from '$lib/route';
  import { getStorageUsage } from '$lib/utils/storage-warning';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight, mdiGiftOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  // The same total the storage meter shows: the user's quota, or else the server disk size.
  let eligible = $derived(isReferralEligible(getStorageUsage()?.totalBytes));
  let hasReferral = $state(false);

  $effect(() => {
    if (!eligible) {
      return;
    }
    let cancelled = false;
    void loadReferral().then((result) => {
      if (!cancelled) {
        hasReferral = result.status === 'ok';
      }
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if eligible && hasReferral}
  <div class="ps-4 text-sm">
    <a
      href={Route.referral()}
      class="mt-2 flex w-full min-w-52 place-items-center justify-between rounded-lg border border-immich-primary/20 p-2 shadow-md dark:border-immich-dark-primary/10 dark:bg-immich-dark-primary/10"
    >
      <div class="flex place-items-center gap-1">
        <Icon icon={mdiGiftOutline} class="text-primary" size="18" />
        <p class="flex font-medium text-primary">
          {$t('referral_sidebar_link')}
        </p>
      </div>

      <Icon icon={mdiChevronRight} class="hidden text-primary sidebar:flex" size="18" />
    </a>
  </div>
{/if}
