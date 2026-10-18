import { toastManager } from '@immich/ui';
import { get } from 'svelte/store';
import { PuReauthRequiredError } from '$lib/services/pu-email-change';
import {
  enqueueMigrationUploads,
  formatMigrationUploadBytes,
  retryMigrationUpload,
} from '$lib/services/pu-migration-uploader';
import { getMigrationUploadAuthHeader, MigratorApiError } from '$lib/services/pu-migrator.service';
import { migrationUploadStore, MigrationUploadState } from '$lib/stores/migration-upload';
import { uploadRequest } from '$lib/utils';
import { clearPuOidcAccessTokenCache } from '$lib/utils/pu-oidc';

vi.mock('$lib/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils')>()),
  uploadRequest: vi.fn(),
}));

vi.mock('$lib/utils/pu-oidc', () => ({
  getPuOidcAccessToken: vi.fn(),
  clearPuOidcAccessTokenCache: vi.fn(),
}));

vi.mock('$lib/services/pu-migrator.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/pu-migrator.service')>()),
  getMigrationUploadUrl: () => 'https://migrator.test/upload',
  getMigrationUploadAuthHeader: vi.fn(),
}));

vi.mock('@immich/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/ui')>()),
  toastManager: { primary: vi.fn(), warning: vi.fn(), danger: vi.fn(), success: vi.fn() },
}));

const takeout = (name = 'takeout-20260101T000000Z-001.zip', size = 10) =>
  new File([new Uint8Array(size)], name, { type: 'application/zip' });

const items = () => get(migrationUploadStore);

describe('pu-migration-uploader', () => {
  beforeEach(() => {
    migrationUploadStore.reset();
    vi.mocked(uploadRequest)
      .mockReset()
      .mockResolvedValue({ data: { status: 'ok' }, status: 200 });
    vi.mocked(getMigrationUploadAuthHeader).mockReset().mockResolvedValue({ Authorization: 'Bearer token-1' });
    vi.mocked(clearPuOidcAccessTokenCache).mockReset();
    vi.mocked(toastManager.primary).mockReset();
    vi.mocked(toastManager.warning).mockReset();
  });

  it('uploads takeout archives to the migrator, not the Immich asset endpoint', async () => {
    const file = takeout();
    const onUploadComplete = vi.fn();

    await enqueueMigrationUploads({ files: [file], onUploadComplete });

    expect(uploadRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://migrator.test/upload',
        method: 'POST',
        data: file,
        headers: {
          Authorization: 'Bearer token-1',
          'X-Filename': file.name,
          'Content-Type': 'application/octet-stream',
        },
      }),
    );
    expect(items()).toEqual([expect.objectContaining({ state: MigrationUploadState.DONE, progress: 1 })]);
    expect(onUploadComplete).toHaveBeenCalledTimes(1);
  });

  it('reports progress', async () => {
    vi.mocked(uploadRequest).mockImplementation(({ onUploadProgress }) => {
      onUploadProgress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent<XMLHttpRequestEventTarget>);
      expect(items()[0]).toMatchObject({ state: MigrationUploadState.UPLOADING, progress: 0.5 });
      return Promise.resolve({ data: {}, status: 200 });
    });

    await enqueueMigrationUploads({ files: [takeout()] });

    expect(uploadRequest).toHaveBeenCalledTimes(1);
  });

  describe('validation', () => {
    it('rejects files that do not match the filename pattern', async () => {
      await enqueueMigrationUploads({ files: [takeout('photos.zip')] });

      expect(uploadRequest).not.toHaveBeenCalled();
      expect(toastManager.warning).toHaveBeenCalledTimes(1);
      expect(items()).toEqual([]);
    });

    it('matches the pattern case-insensitively and honours a custom pattern', async () => {
      await enqueueMigrationUploads({ files: [takeout('TAKEOUT-1.ZIP')] });
      await enqueueMigrationUploads({ files: [takeout('export-1.tgz')], filenamePattern: 'export-*.tgz' });

      expect(uploadRequest).toHaveBeenCalledTimes(2);
    });

    it('treats regex characters in the pattern literally', async () => {
      await enqueueMigrationUploads({ files: [takeout('takeout-1Xzip')] });

      expect(uploadRequest).not.toHaveBeenCalled();
    });

    it('rejects files above the size limit', async () => {
      await enqueueMigrationUploads({ files: [takeout(undefined, 11)], maxBytes: 10 });

      expect(uploadRequest).not.toHaveBeenCalled();
      expect(toastManager.warning).toHaveBeenCalledTimes(1);
    });

    it('skips files that were already uploaded', async () => {
      const file = takeout();

      await enqueueMigrationUploads({ files: [file], existingUploadKeys: new Set([`${file.name}\t${file.size}`]) });

      expect(uploadRequest).not.toHaveBeenCalled();
      expect(toastManager.primary).toHaveBeenCalledTimes(1);
    });
  });

  describe('errors', () => {
    it('clears the token cache and retries once on 401', async () => {
      vi.mocked(uploadRequest)
        .mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))
        .mockResolvedValueOnce({ data: {}, status: 200 });

      await enqueueMigrationUploads({ files: [takeout()] });

      expect(clearPuOidcAccessTokenCache).toHaveBeenCalledTimes(1);
      expect(getMigrationUploadAuthHeader).toHaveBeenCalledTimes(2);
      expect(uploadRequest).toHaveBeenCalledTimes(2);
      expect(items()[0].state).toBe(MigrationUploadState.DONE);
    });

    it('does not retry a second 401', async () => {
      vi.mocked(uploadRequest).mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));

      await enqueueMigrationUploads({ files: [takeout()] });

      expect(uploadRequest).toHaveBeenCalledTimes(2);
      expect(items()[0]).toMatchObject({ state: MigrationUploadState.ERROR, error: 'Unauthorized' });
    });

    it('asks for reauth when no OIDC token is available', async () => {
      vi.mocked(getMigrationUploadAuthHeader).mockRejectedValue(new PuReauthRequiredError());
      const onReauthRequired = vi.fn();

      await enqueueMigrationUploads({ files: [takeout()], onReauthRequired });

      expect(onReauthRequired).toHaveBeenCalledTimes(1);
      expect(uploadRequest).not.toHaveBeenCalled();
      expect(items()[0].state).toBe(MigrationUploadState.ERROR);
    });

    it('shows the migrator error detail', async () => {
      vi.mocked(uploadRequest).mockRejectedValue(new MigratorApiError('Request failed: 413', 413, 'File too large'));

      await enqueueMigrationUploads({ files: [takeout()] });

      expect(items()[0]).toMatchObject({ state: MigrationUploadState.ERROR, error: 'File too large' });
    });

    it('can retry a failed upload', async () => {
      const file = takeout();
      vi.mocked(uploadRequest).mockRejectedValueOnce(new Error('network'));
      await enqueueMigrationUploads({ files: [file] });
      expect(items()[0].state).toBe(MigrationUploadState.ERROR);

      await retryMigrationUpload(file, items()[0].id, {});

      expect(items()[0]).toMatchObject({ state: MigrationUploadState.DONE, error: undefined });
    });
  });

  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [12 * 1024 ** 3, '12.0 GB'],
  ])('formats %s bytes as %s', (bytes, expected) => {
    expect(formatMigrationUploadBytes(bytes)).toBe(expected);
  });
});
