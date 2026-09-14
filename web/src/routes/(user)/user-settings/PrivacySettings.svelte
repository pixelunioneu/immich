<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import SentryConsentConfirmModal from '$lib/modals/SentryConsentConfirmModal.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { updateMyPreferences } from '@immich/sdk';
  import { Field, modalManager, Switch, toastManager } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  let telemetryEnabled = $state(authManager.preferences.telemetry?.enabled ?? false);

  const save = async (enabled: boolean) => {
    try {
      const response = await updateMyPreferences({
        userPreferencesUpdateDto: { telemetry: { enabled } },
      });

      authManager.setPreferences(response);
      toastManager.primary($t('saved_settings'));
      // Enabling/disabling Sentry requires a reload, since the SDK is only ever
      // initialized once at app bootstrap (see sentry-manager.svelte.ts).
      globalThis.location.reload();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_settings'));
    }
  };

  const onCheckedChange = async (next: boolean) => {
    if (!next) {
      await save(false);
      return;
    }

    const confirmed = await modalManager.show(SentryConsentConfirmModal, {});
    if (confirmed) {
      await save(true);
    }
  };
</script>

<section class="my-4">
  <div in:fade={{ duration: 500 }}>
    <div class="flex flex-col gap-6 sm:ms-8">
      <Field label={$t('error_tracking_setting_title')} description={$t('error_tracking_setting_description')}>
        <Switch checked={telemetryEnabled} {onCheckedChange} />
      </Field>
    </div>
  </div>
</section>
