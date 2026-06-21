<script lang="ts">
  import GooglePhotosMigrationPage from '$lib/components/google-photos-migration/google-photos-migration-page.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<GooglePhotosMigrationPage title={data.meta.title} />
