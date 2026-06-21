<script lang="ts">
  import { Alert, Button, Modal, ModalBody } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const TAKEOUT_HELP_URL = 'https://pixelunion.eu/help/immich/migrate-google-photos/';
</script>

<Modal title={$t('google_photos_migration_cancel_help_title')} {onClose} size="medium">
  <ModalBody>
    <div class="space-y-4">
      <p class="text-sm leading-relaxed text-immich-fg/75 dark:text-immich-dark-fg/75">
        {$t('google_photos_migration_cancel_help_intro')}
      </p>
      <Alert color="warning" size="small" title={$t('google_photos_migration_cancel_help_warning')} />
      <Button
        shape="round"
        color="secondary"
        variant="ghost"
        fullWidth
        href={TAKEOUT_HELP_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {$t('google_photos_migration_takeout_help')}
      </Button>
    </div>
  </ModalBody>
</Modal>
