<script lang="ts">
  import ReferralInfo from './ReferralInfo.svelte';
  import ServerStatus from './ServerStatus.svelte';
  import StorageSpace from './StorageSpace.svelte';
</script>

<div class="mt-auto">
  <StorageSpace />
  <ReferralInfo />
</div>

<div class="mt-2 mb-6">
  <ServerStatus />
</div>
