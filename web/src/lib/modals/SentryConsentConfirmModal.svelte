<script lang="ts">
  import { ConfirmModal } from '@immich/ui';
  import { mdiShieldAlertOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    onClose: (confirmed: boolean) => void;
  };

  let { onClose }: Props = $props();
</script>

<ConfirmModal
  icon={mdiShieldAlertOutline}
  title={$t('sentry_consent_title')}
  confirmText={$t('sentry_consent_confirm')}
  prompt={$t('sentry_consent_description')}
  {onClose}
/>
