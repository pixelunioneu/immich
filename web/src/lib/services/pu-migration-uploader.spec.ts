import { PuReauthRequiredError } from '#lib/services/pu-email-change.ts';
import {
  enqueueMigrationUploads,
  formatMigrationUploadBytes,
  retryMigrationUpload,
} from '#lib/services/pu-migration-uploader.ts';
import { MigratorApiError, getMigrationUploadAuthHeader } from '#lib/services/pu-migrator.service.ts';
import { MigrationUploadState, migrationUploadStore } from '#lib/stores/migration-upload.ts';
import { clearPuOidcAccessTokenCache } from '#lib/utils/pu-oidc.ts';
import { toastManager } from '@immich/ui';
import { get } from 'svelte/store';

vi.mock('#lib/utils/pu-oidc.ts', () => ({
  getPuOidcAccessToken: vi.fn(),
  clearPuOidcAccessTokenCache: vi.fn(),
}));

vi.mock('#lib/services/pu-migrator.service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/services/pu-migrator.service.ts')>()),
  getMigrationUploadUrl: () => 'https://migrator.test/upload',
  getMigrationUploadAuthHeader: vi.fn(),
}));

/**
`uploadRequest` (in `#lib/utils.ts`) is a thin wrapper around XMLHttpRequest. Browser mode cannot mock that
module (it is part of an import cycle, and mocking it hangs the run), so the upload is observed one level
lower: a fake XMLHttpRequest that records the request and answers as the next queued outcome says.
*/
type Outcome = (xhr: FakeXhr) => void;

class FakeXhr {
  static requests: FakeXhr[] = [];
  static outcomes: Outcome[] = [];

  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  responseType = '';
  readyState = 4;
  status = 0;
  statusText = '';
  response: unknown = { status: 'ok' };
  private readonly listeners = new Map<string, Array<(event: Event) => void>>();
  private readonly uploadListeners: Array<(event: Event) => void> = [];
  readonly upload = {
    addEventListener: (_type: string, listener: (event: Event) => void) => {
      this.uploadListeners.push(listener);
    },
  };

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  abort() {}

  send(body: unknown) {
    this.body = body;
    FakeXhr.requests.push(this);
    const outcome = FakeXhr.outcomes.shift() ?? respond(200, 'OK');
    queueMicrotask(() => outcome(this));
  }

  progress(loaded: number, total: number) {
    const event = new ProgressEvent('progress', { lengthComputable: true, loaded, total });
    for (const listener of this.uploadListeners) {
      listener(event);
    }
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }
}

const respond =
  (status: number, statusText: string): Outcome =>
  (xhr) => {
    xhr.status = status;
    xhr.statusText = statusText;
    xhr.emit('load');
  };

const networkError: Outcome = (xhr) => xhr.emit('error');

const uploads = () => FakeXhr.requests;

const takeout = (name = 'takeout-20260101T000000Z-001.zip', size = 10) =>
  new File([new Uint8Array(size)], name, { type: 'application/zip' });

const items = () => get(migrationUploadStore);

describe('pu-migration-uploader', () => {
  beforeEach(() => {
    migrationUploadStore.reset();
    FakeXhr.requests = [];
    FakeXhr.outcomes = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.mocked(getMigrationUploadAuthHeader).mockReset().mockResolvedValue({ Authorization: 'Bearer token-1' });
    vi.mocked(clearPuOidcAccessTokenCache).mockReset();
    // Spied on rather than module-mocked: mocking all of `@immich/ui` hangs the browser-mode test run.
    for (const toast of ['primary', 'warning', 'danger', 'success'] as const) {
      vi.spyOn(toastManager, toast).mockImplementation(() => undefined as never);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uploads takeout archives to the migrator, not the Immich asset endpoint', async () => {
    const file = takeout();
    const onUploadComplete = vi.fn();

    await enqueueMigrationUploads({ files: [file], onUploadComplete });

    expect(uploads()).toHaveLength(1);
    expect(uploads()[0]).toMatchObject({
      url: 'https://migrator.test/upload',
      method: 'POST',
      body: file,
      headers: {
        Authorization: 'Bearer token-1',
        'X-Filename': file.name,
        'Content-Type': 'application/octet-stream',
      },
    });
    expect(items()).toEqual([expect.objectContaining({ state: MigrationUploadState.DONE, progress: 1 })]);
    expect(onUploadComplete).toHaveBeenCalledTimes(1);
  });

  it('reports progress', async () => {
    FakeXhr.outcomes.push((xhr) => {
      xhr.progress(5, 10);
      expect(items()[0]).toMatchObject({ state: MigrationUploadState.UPLOADING, progress: 0.5 });
      respond(200, 'OK')(xhr);
    });

    await enqueueMigrationUploads({ files: [takeout()] });

    expect(uploads()).toHaveLength(1);
  });

  describe('validation', () => {
    it('rejects files that do not match the filename pattern', async () => {
      await enqueueMigrationUploads({ files: [takeout('photos.zip')] });

      expect(uploads()).toHaveLength(0);
      expect(toastManager.warning).toHaveBeenCalledTimes(1);
      expect(items()).toEqual([]);
    });

    it('matches the pattern case-insensitively and honours a custom pattern', async () => {
      await enqueueMigrationUploads({ files: [takeout('TAKEOUT-1.ZIP')] });
      await enqueueMigrationUploads({ files: [takeout('export-1.tgz')], filenamePattern: 'export-*.tgz' });

      expect(uploads()).toHaveLength(2);
    });

    it('treats regex characters in the pattern literally', async () => {
      await enqueueMigrationUploads({ files: [takeout('takeout-1Xzip')] });

      expect(uploads()).toHaveLength(0);
    });

    it('rejects files above the size limit', async () => {
      await enqueueMigrationUploads({ files: [takeout(undefined, 11)], maxBytes: 10 });

      expect(uploads()).toHaveLength(0);
      expect(toastManager.warning).toHaveBeenCalledTimes(1);
    });

    it('skips files that were already uploaded', async () => {
      const file = takeout();

      await enqueueMigrationUploads({ files: [file], existingUploadKeys: new Set([`${file.name}\t${file.size}`]) });

      expect(uploads()).toHaveLength(0);
      expect(toastManager.primary).toHaveBeenCalledTimes(1);
    });
  });

  describe('errors', () => {
    it('clears the token cache and retries once on 401', async () => {
      FakeXhr.outcomes.push(respond(401, 'Unauthorized'), respond(200, 'OK'));

      await enqueueMigrationUploads({ files: [takeout()] });

      expect(clearPuOidcAccessTokenCache).toHaveBeenCalledTimes(1);
      expect(getMigrationUploadAuthHeader).toHaveBeenCalledTimes(2);
      expect(uploads()).toHaveLength(2);
      expect(items()[0].state).toBe(MigrationUploadState.DONE);
    });

    it('does not retry a second 401', async () => {
      FakeXhr.outcomes.push(respond(401, 'Unauthorized'), respond(401, 'Unauthorized'), respond(401, 'Unauthorized'));

      await enqueueMigrationUploads({ files: [takeout()] });

      expect(uploads()).toHaveLength(2);
      expect(items()[0]).toMatchObject({ state: MigrationUploadState.ERROR, error: 'Unauthorized' });
    });

    it('asks for reauth when no OIDC token is available', async () => {
      vi.mocked(getMigrationUploadAuthHeader).mockRejectedValue(new PuReauthRequiredError());
      const onReauthRequired = vi.fn();

      await enqueueMigrationUploads({ files: [takeout()], onReauthRequired });

      expect(onReauthRequired).toHaveBeenCalledTimes(1);
      expect(uploads()).toHaveLength(0);
      expect(items()[0].state).toBe(MigrationUploadState.ERROR);
    });

    it('shows the migrator error detail', async () => {
      // The migrator service reports its errors from the auth header lookup and wraps its own requests.
      vi.mocked(getMigrationUploadAuthHeader).mockRejectedValue(
        new MigratorApiError('Request failed: 413', 413, 'File too large'),
      );

      await enqueueMigrationUploads({ files: [takeout()] });

      expect(items()[0]).toMatchObject({ state: MigrationUploadState.ERROR, error: 'File too large' });
    });

    it('can retry a failed upload', async () => {
      const file = takeout();
      FakeXhr.outcomes.push(networkError);
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
