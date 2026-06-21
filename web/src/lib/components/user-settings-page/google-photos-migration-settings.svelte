<script lang="ts">
  import { Route } from '$lib/route';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
</script>

<section class="my-4">
  <div class="sm:ms-8 flex flex-col gap-4" in:fade={{ duration: 500 }}>
    <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75">
      {$t('google_photos_migration_subtitle')}
    </p>
    <div>
      <Button shape="round" size="small" href={Route.googlePhotosMigration()}>
        {$t('google_photos_migration')}
      </Button>
    </div>
  </div>
</section>
