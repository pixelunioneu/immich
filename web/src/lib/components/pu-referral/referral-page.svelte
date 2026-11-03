<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { getReferral, type ReferralResult } from '$lib/services/pu-referral.service';
  import { copyToClipboard } from '$lib/utils';
  import { Alert, Button, HStack, Input, LoadingSpinner } from '@immich/ui';
  import { mdiContentCopy, mdiShareVariant } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    title: string;
  }

  let { title }: Props = $props();

  let result = $state<ReferralResult | null>(null);

  // Feature-detected: desktop Chrome lacks the Web Share API, so the button only shows where it works.
  // eslint-disable-next-line tscompat/tscompat
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const load = async () => {
    result = null;
    result = await getReferral();
  };

  const handleShare = async (url: string) => {
    try {
      // eslint-disable-next-line tscompat/tscompat
      await navigator.share({ title: $t('referral_share_title'), text: $t('referral_share_text'), url });
    } catch {
      // Dismissing the share sheet rejects too; nothing to report.
    }
  };

  onMount(load);
</script>

<UserPageLayout {title}>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
    <section class="flex flex-col gap-2">
      <h2 class="text-xl font-semibold">{$t('referral_heading')}</h2>
      <p class="text-sm/relaxed text-immich-fg/75 dark:text-immich-dark-fg/75">
        {$t('referral_description')}
      </p>
    </section>

    {#if result === null}
      <div class="flex justify-center py-8">
        <LoadingSpinner size="large" />
      </div>
    {:else if result.status === 'ok'}
      {@const url = result.referral.referral_url}
      <section class="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-subtle p-6 dark:border-subtle">
        <HStack class="w-full" gap={2}>
          <Input value={url} disabled class="flex flex-row" aria-label={$t('referral_link')} />
        </HStack>
        <div class="flex flex-wrap gap-2">
          <Button shape="round" size="small" leadingIcon={mdiContentCopy} onclick={() => copyToClipboard(url)}>
            {$t('copy_link')}
          </Button>
          {#if canShare}
            <Button
              shape="round"
              size="small"
              color="secondary"
              leadingIcon={mdiShareVariant}
              onclick={() => handleShare(url)}
            >
              {$t('share')}
            </Button>
          {/if}
        </div>
      </section>
    {:else if result.status === 'none'}
      <Alert color="info" size="small" title={$t('referral_none')} />
    {:else}
      <Alert color="warning" size="small" title={$t('referral_unavailable')} />
      <div>
        <Button shape="round" size="small" color="secondary" onclick={load}>{$t('retry')}</Button>
      </div>
    {/if}
  </div>
</UserPageLayout>
