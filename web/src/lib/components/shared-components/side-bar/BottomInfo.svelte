<script lang="ts">
  import ReferralInfo from './ReferralInfo.svelte';
  import ServerStatus from './ServerStatus.svelte';
  import StorageSpace from './StorageSpace.svelte';
  import StorageWarningInfo from './StorageWarningInfo.svelte';
  import { getCurrentStorageLevel } from '$lib/utils/storage-warning';
  import { StorageWarningLevel } from '@immich/sdk';

  // At 80% or more the storage button takes this spot; its popup offers the referral too.
  let storageWarningShown = $derived(getCurrentStorageLevel() !== StorageWarningLevel.None);
</script>

<div class="ms-4 mt-auto overflow-hidden rounded-lg">
  <StorageSpace />
  <StorageWarningInfo />
  {#if !storageWarningShown}
    <ReferralInfo />
  {/if}
</div>

<div class="mt-2 mb-6">
  <ServerStatus />
</div>
