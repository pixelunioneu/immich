<script lang="ts">
  import GooglePhotosMigrationCancelHelpModal from '$lib/components/google-photos-migration/google-photos-migration-cancel-help-modal.svelte';
  import GooglePhotosMigrationUpload from '$lib/components/google-photos-migration/google-photos-migration-upload.svelte';
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import { deleteMigrationApiKey, createMigrationApiKey } from '$lib/services/pu-migration-apikey';
  import { PuReauthRequiredError } from '$lib/services/pu-email-change';
  import {
    cancelMigration,
    createMigration,
    deleteMigration,
    deleteUpload,
    downloadJobLog,
    getMigratorConfig,
    getMigration,
    getTenantUsername,
    MigratorApiError,
    resetMigration,
    startMigration,
    type EventReport,
    type Migration,
    type MigratorConfig,
  } from '$lib/services/pu-migrator.service';
  import { migrationUploadStore } from '$lib/stores/migration-upload';
  import { locale } from '$lib/stores/preferences.store';
  import { Alert, Button, Icon, LoadingSpinner, modalManager, toastManager } from '@immich/ui';
  import { mdiAlertCircle, mdiCheckCircle, mdiInformationOutline } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    title: string;
  }

  let { title }: Props = $props();

  const CONCEPT = 'Concept';
  const PENDING = 'Pending';
  const RUNNING = 'Running';
  const COMPLETED = 'Completed';
  const FAILED = 'Failed';

  const TAKEOUT_HELP_URL = 'https://pixelunion.eu/help/immich/migrate-google-photos/';

  let config = $state<MigratorConfig | null>(null);
  let migration = $state<Migration | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let needsReauth = $state(false);
  let createInProgress = $state(false);
  let startInProgress = $state(false);
  let cancelInProgress = $state(false);
  let downloadLogsInProgress = $state(false);
  let insufficientStorageWarning = $state<{ detail: string } | null>(null);
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;

  const tenantUsername = $derived(getTenantUsername());
  const tenantDomainSuffix = $derived(
    globalThis.location.hostname.includes('nonprd.tech.pixelunion.eu')
      ? '.nonprd.tech.pixelunion.eu'
      : '.pixelunion.eu',
  );

  const existingUploadKeys = $derived.by(() => {
    const set = new Set<string>();
    for (const upload of migration?.uploads ?? []) {
      set.add(`${upload.filename}\t${upload.filesize ?? ''}`);
    }
    return set;
  });

  const shouldPoll = $derived(migration?.status === PENDING || migration?.status === RUNNING);
  const canStart = $derived(
    !!migration && migration.status === CONCEPT && (migration.uploads?.length ?? 0) > 0,
  );
  const canCancel = $derived(!!migration && (migration.status === PENDING || migration.status === RUNNING));

  const formatBytes = (bytes: number | null | undefined): string => {
    if (bytes == null) {
      return '—';
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const handleReauthRequired = () => {
    needsReauth = true;
  };

  const handleReauthenticate = () => {
    document.cookie = 'immich_is_authenticated=; max-age=0; path=/';
    globalThis.location.reload();
  };

  const loadConfig = async () => {
    config = await getMigratorConfig();
  };

  const loadMigration = async () => {
    try {
      migration = await getMigration();
    } catch (loadError) {
      if (loadError instanceof MigratorApiError && loadError.status === 404) {
        migration = null;
      } else {
        throw loadError;
      }
    }
  };

  const load = async () => {
    loading = true;
    error = null;
    try {
      await loadConfig();
      await loadMigration();
    } catch (loadError) {
      if (loadError instanceof PuReauthRequiredError) {
        handleReauthRequired();
      } else {
        error = loadError instanceof Error ? loadError.message : $t('google_photos_migration_load_failed');
      }
    } finally {
      loading = false;
    }
  };

  const handleCreateMigration = async () => {
    createInProgress = true;
    error = null;
    try {
      const { secret } = await createMigrationApiKey();
      await createMigration({
        username: tenantUsername.trim().toLowerCase(),
        apiKey: secret,
      });
      await loadMigration();
      toastManager.primary($t('google_photos_migration_created'));
    } catch (createError) {
      await deleteMigrationApiKey().catch(() => {});
      if (createError instanceof PuReauthRequiredError) {
        handleReauthRequired();
      } else {
        error =
          createError instanceof MigratorApiError
            ? createError.detail || createError.message
            : $t('google_photos_migration_create_failed');
      }
    } finally {
      createInProgress = false;
    }
  };

  const performDeleteMigration = async () => {
    await deleteMigration();
    await deleteMigrationApiKey().catch(() => {});
    migration = null;
    migrationUploadStore.reset();
  };

  const handleDeleteMigration = async () => {
    if (!migration || (migration.status !== CONCEPT && migration.status !== COMPLETED)) {
      return;
    }

    if (migration.status === CONCEPT) {
      const confirmed = await modalManager.showDialog({
        prompt: $t('google_photos_migration_delete_confirm'),
      });
      if (!confirmed) {
        return;
      }
    }

    error = null;
    try {
      await performDeleteMigration();
    } catch (deleteError) {
      error =
        deleteError instanceof MigratorApiError
          ? deleteError.detail || deleteError.message
          : $t('google_photos_migration_delete_failed');
    }
  };

  const handleFinishMigration = async () => {
    const confirmed = await modalManager.showDialog({
      prompt: $t('google_photos_migration_finish_confirm'),
    });
    if (!confirmed || !migration || migration.status !== COMPLETED) {
      return;
    }
    await handleDeleteMigration();
  };

  const handleDeleteUpload = async (uploadId: string) => {
    if (!migration || migration.status !== CONCEPT) {
      return;
    }
    error = null;
    try {
      await deleteUpload(uploadId);
      await loadMigration();
    } catch (deleteError) {
      error =
        deleteError instanceof MigratorApiError
          ? deleteError.detail || deleteError.message
          : $t('google_photos_migration_delete_upload_failed');
    }
  };

  const handleStart = async (force = false) => {
    if (!canStart) {
      return;
    }
    startInProgress = true;
    error = null;
    insufficientStorageWarning = null;
    try {
      const result = await startMigration(force);
      if (result.status === 'insufficient_storage') {
        insufficientStorageWarning = { detail: result.detail };
        return;
      }
      await loadMigration();
      migrationUploadStore.reset();
    } catch (startError) {
      error =
        startError instanceof MigratorApiError
          ? startError.detail || startError.message
          : $t('google_photos_migration_start_failed');
    } finally {
      startInProgress = false;
    }
  };

  const handleCancel = async () => {
    if (!canCancel) {
      return;
    }
    const confirmed = await modalManager.showDialog({
      prompt: $t('google_photos_migration_cancel_confirm'),
    });
    if (!confirmed) {
      return;
    }
    cancelInProgress = true;
    error = null;
    try {
      await cancelMigration();
      await loadMigration();
    } catch (cancelError) {
      error =
        cancelError instanceof MigratorApiError
          ? cancelError.detail || cancelError.message
          : $t('google_photos_migration_cancel_failed');
    } finally {
      cancelInProgress = false;
    }
  };

  const handleReset = async () => {
    if (!migration || (migration.status !== FAILED && migration.status !== COMPLETED)) {
      return;
    }
    error = null;
    try {
      await resetMigration();
      await loadMigration();
    } catch (resetError) {
      error =
        resetError instanceof MigratorApiError
          ? resetError.detail || resetError.message
          : $t('google_photos_migration_reset_failed');
    }
  };

  const handleDownloadLogs = async () => {
    if (!migration || (migration.status !== FAILED && migration.status !== COMPLETED)) {
      return;
    }
    downloadLogsInProgress = true;
    error = null;
    try {
      await downloadJobLog();
    } catch (downloadError) {
      error =
        downloadError instanceof MigratorApiError
          ? downloadError.detail || downloadError.message
          : $t('google_photos_migration_download_logs_failed');
    } finally {
      downloadLogsInProgress = false;
    }
  };

  const handleOpenCancelHelp = async () => {
    await modalManager.show(GooglePhotosMigrationCancelHelpModal);
  };

  const renderEventReport = (report: EventReport | null | undefined) => {
    if (!report) {
      return [];
    }
    return Object.entries(report).filter(
      ([key, value]) => key !== 'error' && typeof value === 'object' && value !== null,
    );
  };

  onMount(() => {
    void load();
  });

  onDestroy(() => {
    if (pollIntervalId != null) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  });

  $effect(() => {
    if (shouldPoll && pollIntervalId == null) {
      pollIntervalId = setInterval(() => {
        void loadMigration().catch(() => {});
      }, 4000);
    } else if (!shouldPoll && pollIntervalId != null) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  });
</script>

<UserPageLayout {title}>
  <div class="w-full max-w-3xl mx-auto px-4 py-6">
    <p class="mb-6 text-sm text-immich-fg/75 dark:text-immich-dark-fg/75">
      {$t('google_photos_migration_subtitle')}
    </p>

    {#if needsReauth}
      <div class="rounded-2xl border border-gray-200 dark:border-subtle p-6 bg-subtle">
        <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75 mb-4">
          {$t('google_photos_migration_reauth_description')}
        </p>
        <Button shape="round" size="small" onclick={() => handleReauthenticate()}>
          {$t('google_photos_migration_reauth_button')}
        </Button>
      </div>
    {:else if loading}
      <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75">{$t('loading')}</p>
    {:else if error}
      <div class="mb-4 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
        {error}
      </div>
      <Button shape="round" size="small" color="secondary" onclick={() => load()}>{$t('retry_upload')}</Button>
    {:else if !migration}
      <div class="rounded-2xl border border-gray-200 dark:border-subtle p-6 bg-subtle space-y-4">
        <p class="text-sm">{$t('google_photos_migration_create_intro')}</p>
        <p class="font-mono text-sm">
          {tenantUsername}<span class="text-immich-fg/50">{tenantDomainSuffix}</span>
        </p>
        <Button shape="round" size="small" disabled={createInProgress} onclick={() => handleCreateMigration()}>
          {$t('google_photos_migration_create_button')}
        </Button>
      </div>
    {:else}
      <div class="space-y-6">
        {#if migration.status === CONCEPT}
          <div class="rounded-2xl border border-gray-200 dark:border-subtle p-4 bg-subtle">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="font-mono text-lg">{migration.username}<span class="text-immich-fg/50">{tenantDomainSuffix}</span></p>
                <p class="text-sm text-immich-fg/60">{$t('status')}: {migration.status}</p>
              </div>
              <a
                href={TAKEOUT_HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm text-primary underline"
              >
                {$t('google_photos_migration_takeout_help')}
              </a>
            </div>
          </div>

          {#if migration.uploads?.length}
            <ul class="space-y-2">
              {#each migration.uploads as upload (upload.id)}
                <li class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-subtle px-4 py-3">
                  <div>
                    <p class="font-mono text-sm">{upload.filename}</p>
                    <p class="text-xs text-immich-fg/60">{formatBytes(upload.filesize)}</p>
                  </div>
                  <Button shape="round" size="tiny" color="secondary" onclick={() => handleDeleteUpload(upload.id)}>
                    {$t('remove')}
                  </Button>
                </li>
              {/each}
            </ul>
          {/if}

          <GooglePhotosMigrationUpload
            filenamePattern={config?.upload_filename_pattern ?? 'takeout-*.zip'}
            maxBytes={config?.upload_max_bytes ?? 12 * 1024 ** 3}
            existingUploadKeys={existingUploadKeys}
            onUploadComplete={loadMigration}
            onReauthRequired={handleReauthRequired}
          />

          {#if insufficientStorageWarning}
            <div class="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm" role="alert">
              <p>{insufficientStorageWarning.detail}</p>
              <div class="mt-3 flex gap-2">
                <Button shape="round" size="small" disabled={startInProgress} onclick={() => handleStart(true)}>
                  {$t('google_photos_migration_try_anyway')}
                </Button>
                <Button
                  shape="round"
                  size="small"
                  color="secondary"
                  onclick={() => (insufficientStorageWarning = null)}
                >
                  {$t('cancel')}
                </Button>
              </div>
            </div>
          {:else}
            <div class="flex flex-wrap gap-2">
              <Button shape="round" size="small" disabled={!canStart || startInProgress} onclick={() => handleStart(false)}>
                {$t('google_photos_migration_start')}
              </Button>
              <Button shape="round" size="small" color="secondary" onclick={() => handleDeleteMigration()}>
                {$t('google_photos_migration_delete')}
              </Button>
            </div>
          {/if}
        {:else}
          <div class="rounded-2xl border border-gray-200 dark:border-subtle p-4 bg-subtle">
            <p class="font-mono text-lg">
              {migration.username}<span class="text-immich-fg/50">{tenantDomainSuffix}</span>
            </p>
          </div>

          <Alert color="warning" size="small" title={$t('google_photos_migration_beta_notice')} />

          {#if canCancel}
            <section
              class="rounded-2xl border border-gray-200 dark:border-subtle p-6 bg-subtle"
              aria-live="polite"
              aria-busy={migration.status === PENDING}
            >
              <div class="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
                <div class="flex shrink-0 items-center justify-center" aria-hidden="true">
                  <LoadingSpinner size="large" />
                </div>
                <div class="flex flex-1 flex-col gap-1 text-center sm:text-left">
                  <h3 class="text-base font-semibold">
                    {migration.status === PENDING
                      ? $t('google_photos_migration_pending_title')
                      : $t('google_photos_migration_running_title')}
                  </h3>
                  <p class="text-sm leading-relaxed text-immich-fg/75 dark:text-immich-dark-fg/75">
                    {migration.status === PENDING
                      ? $t('google_photos_migration_pending_text')
                      : $t('google_photos_migration_running_text')}
                  </p>
                  {#if migration.status === RUNNING}
                    <p class="text-sm leading-relaxed text-immich-fg/60 dark:text-immich-dark-fg/60">
                      {$t('google_photos_migration_running_duration_hint')}
                    </p>
                  {/if}
                </div>
              </div>
            </section>
            <div class="flex flex-wrap items-center gap-3">
              <Button
                shape="round"
                size="small"
                color="secondary"
                disabled={cancelInProgress}
                loading={cancelInProgress}
                onclick={() => handleCancel()}
              >
                {$t('google_photos_migration_cancel')}
              </Button>
              <Button
                shape="round"
                size="tiny"
                variant="ghost"
                color="secondary"
                onclick={() => handleOpenCancelHelp()}
                aria-label={$t('google_photos_migration_cancel_help_aria')}
              >
                <Icon icon={mdiInformationOutline} size="14" aria-hidden />
                {$t('google_photos_migration_cancel_help')}
              </Button>
            </div>
          {:else if migration.status === FAILED}
            <section
              class="rounded-2xl border border-gray-200 dark:border-subtle p-6 bg-subtle"
              aria-live="polite"
            >
              <div class="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
                <Icon icon={mdiAlertCircle} size="56" class="shrink-0 text-danger" aria-hidden="true" />
                <div class="flex flex-1 flex-col gap-1 text-center sm:text-left">
                  <h3 class="text-base font-semibold">{$t('google_photos_migration_failed_title')}</h3>
                  <p class="text-sm leading-relaxed text-immich-fg/75 dark:text-immich-dark-fg/75">
                    {typeof migration.event_report?.error === 'string'
                      ? migration.event_report.error
                      : $t('google_photos_migration_failed_text')}
                  </p>
                </div>
              </div>
            </section>
            <div class="flex flex-wrap items-center gap-3">
              <Button shape="round" size="small" color="secondary" onclick={() => handleReset()}>
                {$t('google_photos_migration_reset')}
              </Button>
              <Button
                shape="round"
                size="small"
                color="secondary"
                loading={downloadLogsInProgress}
                disabled={downloadLogsInProgress}
                onclick={() => handleDownloadLogs()}
              >
                {$t('google_photos_migration_download_logs')}
              </Button>
            </div>
          {:else if migration.status === COMPLETED}
            {@const reportEntries = renderEventReport(migration.event_report)}
            <section class="rounded-2xl border border-gray-200 dark:border-subtle bg-subtle" aria-live="polite">
              <div class="flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-center sm:gap-8">
                <Icon icon={mdiCheckCircle} size="56" class="shrink-0 text-success" aria-hidden="true" />
                <div class="flex flex-1 flex-col gap-1 text-center sm:text-left">
                  <h3 class="text-base font-semibold">{$t('google_photos_migration_completed_title')}</h3>
                  <p class="text-sm leading-relaxed text-immich-fg/75 dark:text-immich-dark-fg/75">
                    {$t('google_photos_migration_completed_text')}
                  </p>
                </div>
              </div>
              {#if reportEntries.length > 0}
                <div class="border-t border-gray-200 dark:border-subtle px-6 py-5">
                  <h4 class="mb-4 text-sm font-semibold text-immich-fg/80 dark:text-immich-dark-fg/80">
                    {$t('google_photos_migration_statistics')}
                  </h4>
                  <div class="grid gap-4 sm:grid-cols-2">
                    {#each reportEntries as [sectionName, metrics] (sectionName)}
                      <div class="border bg-subtle dark:bg-black/30 dark:border-black p-4 rounded-2xl">
                        <p
                          class="mb-2 text-xs font-medium uppercase tracking-wider text-immich-fg/50 dark:text-immich-dark-fg/50"
                        >
                          {sectionName}
                        </p>
                        <dl class="space-y-1.5 text-sm">
                          {#each Object.entries(metrics as Record<string, { count: number; size?: string }>) as [metricName, data] (metricName)}
                            <div class="flex justify-between gap-2">
                              <dt class="text-immich-fg/75 dark:text-immich-dark-fg/75">{metricName}</dt>
                              <dd class="font-mono font-medium">
                                {data.count.toLocaleString($locale)}
                                {#if data.size}
                                  <span class="ml-1 font-normal text-immich-fg/50 dark:text-immich-dark-fg/50"
                                    >({data.size})</span
                                  >
                                {/if}
                              </dd>
                            </div>
                          {/each}
                        </dl>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </section>
            <div class="flex flex-wrap items-center gap-3">
              <Button shape="round" size="small" color="secondary" onclick={() => handleReset()}>
                {$t('google_photos_migration_reset')}
              </Button>
              <Button shape="round" size="small" onclick={() => handleFinishMigration()}>
                {$t('google_photos_migration_finish')}
              </Button>
              <Button
                shape="round"
                size="small"
                color="secondary"
                loading={downloadLogsInProgress}
                disabled={downloadLogsInProgress}
                onclick={() => handleDownloadLogs()}
              >
                {$t('google_photos_migration_download_logs')}
              </Button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</UserPageLayout>
