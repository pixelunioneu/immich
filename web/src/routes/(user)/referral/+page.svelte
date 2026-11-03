<script lang="ts">
  import ReferralPage from '$lib/components/pu-referral/referral-page.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<ReferralPage title={data.meta.title} />
