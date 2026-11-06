<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { requestServerInfo } from '$lib/utils/auth';
  import {
    decideStorageWarning,
    getStorageLevel,
    getStorageUsage,
    type StorageUsage,
  } from '$lib/utils/storage-warning';
  import { openStorageWarningModal } from '$lib/utils/storage-warning-modal';
  import { StorageWarningLevel, updateMyPreferences } from '@immich/sdk';

  // Not reactive on purpose: check once per app load, not on every preference or storage update.
  let checked = false;

  $effect(() => {
    if (checked || !authManager.authenticated) {
      return;
    }
    const usage = getStorageUsage();
    if (!usage) {
      if (!userInteraction.serverInfo) {
        void requestServerInfo();
      }
      return;
    }
    checked = true;
    void check(usage);
  });

  async function check(usage: StorageUsage) {
    const level = getStorageLevel(usage.usedBytes, usage.totalBytes);
    // Optional chaining: e2e mocks and older servers don't send this preference.
    const shownLevel = authManager.preferences.storageWarning?.shownLevel ?? StorageWarningLevel.None;
    const { show, persist } = decideStorageWarning(level, shownLevel);

    if (persist) {
      try {
        // Stored before showing, so a reload or a second tab doesn't show it again.
        const preferences = await updateMyPreferences({
          userPreferencesUpdateDto: { storageWarning: { shownLevel: persist } },
        });
        authManager.setPreferences(preferences);
      } catch (error) {
        // Without the stored level the popup would come back on every load; skip it this time.
        console.error('Error [StorageWarning]:', error);
        return;
      }
    }

    if (show) {
      await openStorageWarningModal(show, usage);
    }
  }
</script>
