import { StorageWarningLevel } from '@immich/sdk';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { decideStorageWarning, getStorageLevel, getStorageUsage } from '$lib/utils/storage-warning';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';

const { None, AlmostFull, Full } = StorageWarningLevel;

describe('getStorageLevel', () => {
  it.each([
    { used: 0, total: 100, expected: None },
    { used: 79, total: 100, expected: None },
    { used: 80, total: 100, expected: AlmostFull },
    { used: 94, total: 100, expected: AlmostFull },
    { used: 95, total: 100, expected: Full },
    { used: 120, total: 100, expected: Full },
  ])('returns $expected for $used of $total', ({ used, total, expected }) => {
    expect(getStorageLevel(used, total)).toBe(expected);
  });

  it('returns none when the total is unknown', () => {
    expect(getStorageLevel(50, 0)).toBe(None);
  });
});

describe('decideStorageWarning', () => {
  it('shows and stores the almost-full level the first time', () => {
    expect(decideStorageWarning(AlmostFull, None)).toEqual({ show: AlmostFull, persist: AlmostFull });
  });

  it('does not show the same level twice', () => {
    expect(decideStorageWarning(AlmostFull, AlmostFull)).toEqual({});
    expect(decideStorageWarning(Full, Full)).toEqual({});
  });

  it('escalates from almost full to full', () => {
    expect(decideStorageWarning(Full, AlmostFull)).toEqual({ show: Full, persist: Full });
  });

  it('jumps straight to full', () => {
    expect(decideStorageWarning(Full, None)).toEqual({ show: Full, persist: Full });
  });

  it('stays quiet when dropping from full to almost full', () => {
    expect(decideStorageWarning(AlmostFull, Full)).toEqual({});
  });

  it('re-arms once storage is below the threshold again', () => {
    expect(decideStorageWarning(None, Full)).toEqual({ persist: None });
    expect(decideStorageWarning(None, AlmostFull)).toEqual({ persist: None });
  });

  it('does nothing below the threshold when already armed', () => {
    expect(decideStorageWarning(None, None)).toEqual({});
  });
});

describe('getStorageUsage', () => {
  const serverInfo = { diskSizeRaw: 1000, diskUseRaw: 400 } as typeof userInteraction.serverInfo;

  afterEach(() => {
    authManager.reset();
    userInteraction.serverInfo = undefined;
  });

  const login = (quota: { quotaSizeInBytes: number | null; quotaUsageInBytes: number | null }) => {
    authManager.setUser(userAdminFactory.build(quota));
    authManager.setPreferences(preferencesFactory.build());
  };

  it('is unknown when not logged in', () => {
    userInteraction.serverInfo = serverInfo;
    expect(getStorageUsage()).toBeUndefined();
  });

  it('uses the user quota when there is one', () => {
    login({ quotaSizeInBytes: 100, quotaUsageInBytes: 85 });
    userInteraction.serverInfo = serverInfo;
    expect(getStorageUsage()).toEqual({ usedBytes: 85, totalBytes: 100 });
  });

  it('falls back to the server disk without a quota', () => {
    login({ quotaSizeInBytes: null, quotaUsageInBytes: null });
    userInteraction.serverInfo = serverInfo;
    expect(getStorageUsage()).toEqual({ usedBytes: 400, totalBytes: 1000 });
  });

  it('is unknown without a quota until the server disk is loaded', () => {
    login({ quotaSizeInBytes: null, quotaUsageInBytes: null });
    expect(getStorageUsage()).toBeUndefined();
  });
});
