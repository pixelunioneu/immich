<script module lang="ts">
  import { getReferral, type ReferralResult } from '$lib/services/pu-referral.service';

  // Shared across sidebar mounts so navigating doesn't refetch. A failed lookup is
  // dropped so the next mount retries; "no referral" is kept, it won't change soon.
  let pending: Promise<ReferralResult> | undefined;

  function loadReferral(): Promise<ReferralResult> {
    pending ??= getReferral().then((result) => {
      if (result.status === 'unavailable') {
        pending = undefined;
      }
      return result;
    });
    return pending;
  }
</script>

<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight, mdiGiftOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  // Hidden once total storage is above the smallest plans.
  const MAX_TOTAL_STORAGE_BYTES = 16 * 1024 ** 3;

  // The same total the storage meter shows: the user's quota, or else the server disk size.
  let quota = $derived(authManager.authenticated ? authManager.user.quotaSizeInBytes : null);
  let totalBytes = $derived(quota ?? userInteraction.serverInfo?.diskSizeRaw);
  let eligible = $derived(totalBytes !== undefined && totalBytes <= MAX_TOTAL_STORAGE_BYTES);
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
