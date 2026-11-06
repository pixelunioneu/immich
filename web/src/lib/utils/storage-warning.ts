import { StorageWarningLevel } from '@immich/sdk';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';

export const STORAGE_ALMOST_FULL_RATIO = 0.8;
export const STORAGE_FULL_RATIO = 0.95;

/** Storage meter colours; the same ratios as the popup levels, so the two can't drift apart. */
export const STORAGE_METER_THRESHOLDS = [
  { from: STORAGE_ALMOST_FULL_RATIO, className: 'bg-warning' },
  { from: STORAGE_FULL_RATIO, className: 'bg-danger' },
];

export type StorageUsage = { usedBytes: number; totalBytes: number };

/**
 * What the storage meter shows: the user's quota if they have one, or else the server disk.
 * `undefined` until that is known. Reactive when called inside `$derived`.
 */
export function getStorageUsage(): StorageUsage | undefined {
  if (!authManager.authenticated) {
    return undefined;
  }
  const { quotaSizeInBytes, quotaUsageInBytes } = authManager.user;
  if (quotaSizeInBytes !== null && quotaSizeInBytes !== undefined) {
    return { usedBytes: quotaUsageInBytes ?? 0, totalBytes: quotaSizeInBytes };
  }
  const serverInfo = userInteraction.serverInfo;
  if (!serverInfo) {
    return undefined;
  }
  return { usedBytes: serverInfo.diskUseRaw, totalBytes: serverInfo.diskSizeRaw };
}

const rank: Record<StorageWarningLevel, number> = {
  [StorageWarningLevel.None]: 0,
  [StorageWarningLevel.AlmostFull]: 1,
  [StorageWarningLevel.Full]: 2,
};

export function getStorageLevel(usedBytes: number, totalBytes: number): StorageWarningLevel {
  if (!totalBytes || totalBytes <= 0) {
    return StorageWarningLevel.None;
  }
  const ratio = usedBytes / totalBytes;
  if (ratio >= STORAGE_FULL_RATIO) {
    return StorageWarningLevel.Full;
  }
  if (ratio >= STORAGE_ALMOST_FULL_RATIO) {
    return StorageWarningLevel.AlmostFull;
  }
  return StorageWarningLevel.None;
}

/** Level of the current storage usage; `none` while it is unknown. Reactive inside `$derived`. */
export function getCurrentStorageLevel(): StorageWarningLevel {
  const usage = getStorageUsage();
  return usage ? getStorageLevel(usage.usedBytes, usage.totalBytes) : StorageWarningLevel.None;
}

export type StorageWarningDecision = {
  /** Level to show the popup for, if any. */
  show?: StorageWarningLevel;
  /** New `storageWarning.shownLevel` preference to store, if it changes. */
  persist?: StorageWarningLevel;
};

/**
 * Each level is shown once. Dropping back below the almost-full threshold re-arms the
 * popup, so filling up again later (for example after an upgrade) warns again.
 */
export function decideStorageWarning(
  level: StorageWarningLevel,
  shownLevel: StorageWarningLevel,
): StorageWarningDecision {
  if (level === StorageWarningLevel.None) {
    return shownLevel === StorageWarningLevel.None ? {} : { persist: StorageWarningLevel.None };
  }
  if (rank[level] > rank[shownLevel]) {
    return { show: level, persist: level };
  }
  return {};
}
