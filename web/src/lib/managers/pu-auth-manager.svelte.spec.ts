import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/common/factories.ts';
import { getAboutInfo, getAdminConfig, getMyPreferences, getMyUser, getUserConfig } from '@immich/sdk';
import { describe, expect, it, vi } from 'vitest';

vi.mock(import('@immich/sdk'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMyUser: vi.fn(),
  getMyPreferences: vi.fn(),
  getUserConfig: vi.fn(),
  getAdminConfig: vi.fn(),
  getAboutInfo: vi.fn(),
}));

const userConfig = {
  machineLearning: {
    enabled: false,
    clip: { enabled: false },
    facialRecognition: { enabled: false },
    ocr: { enabled: false },
    duplicateDetection: { enabled: false },
  },
};

// PixelUnion: /api/admin/config is a blocked route on the fork (404). Upstream preloads it when an
// admin's session is set up, which left every admin signed out on the web (v3.4.2-pu1).
describe('AuthManager (PixelUnion)', () => {
  it('signs an admin in without asking for the admin config', async () => {
    vi.mocked(getMyUser).mockResolvedValue(factory.user({ isAdmin: true }));
    vi.mocked(getMyPreferences).mockResolvedValue(factory.preferences());
    vi.mocked(getUserConfig).mockResolvedValue(userConfig as never);
    vi.mocked(getAboutInfo).mockResolvedValue({ licensed: false } as never);
    vi.mocked(getAdminConfig).mockRejectedValue(new Error('Not Found'));

    await authManager.refresh();

    expect(authManager.authenticated).toBe(true);
    expect(authManager.user.isAdmin).toBe(true);
    expect(getAdminConfig).not.toHaveBeenCalled();
  });
});
