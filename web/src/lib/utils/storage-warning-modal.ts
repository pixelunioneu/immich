import type { StorageWarningLevel } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import StorageFullModal from '#lib/modals/StorageFullModal.svelte';
import { isReferralEligible, loadReferral } from '#lib/services/pu-referral.service.ts';
import type { StorageUsage } from '#lib/utils/storage-warning.ts';

/**
 * Opens the storage popup. Used by the automatic once-per-level check and by the sidebar
 * button; it doesn't touch the `storageWarning` preference itself.
 */
export async function openStorageWarningModal(level: StorageWarningLevel, { usedBytes, totalBytes }: StorageUsage) {
  let showReferral = false;
  if (isReferralEligible(totalBytes)) {
    const referral = await loadReferral();
    showReferral = referral.status === 'ok';
  }

  await modalManager.show(StorageFullModal, {
    level,
    usedBytes,
    totalBytes,
    isAdmin: authManager.user.isAdmin,
    showReferral,
  });
}
