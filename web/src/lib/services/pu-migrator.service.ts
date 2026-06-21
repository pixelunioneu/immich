import { PuReauthRequiredError } from '$lib/services/pu-email-change';
import { clearPuOidcAccessTokenCache, getPuOidcAccessToken } from '$lib/utils/pu-oidc';

export class MigratorApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'MigratorApiError';
  }
}

export interface MigratorConfig {
  upload_filename_pattern: string;
  upload_max_bytes: number;
  migration_statuses: string[];
}

export interface MigrationUpload {
  id: string;
  filename: string;
  filesize: number | null;
  created_at: string | null;
}

export interface EventReportMetric {
  count: number;
  size?: string;
}

export type EventReport = Record<string, Record<string, EventReportMetric> | string>;

export interface Migration {
  username: string;
  id: string;
  options: Record<string, unknown> | null;
  status: string;
  uploads: MigrationUpload[];
  event_report?: EventReport | null;
}

export interface CreateMigrationBody {
  username: string;
  apiKey: string;
  options?: Record<string, unknown> | null;
}

export interface UpdateMigrationBody {
  username?: string;
  apiKey?: string;
  options?: Record<string, unknown> | null;
}

export interface MigrationStorageResponse {
  storage: { diskAvailableRaw?: number; diskUseRaw?: number; diskSizeRaw?: number } | null;
  totalUploadBytes: number;
}

export type StartMigrationResult =
  | { status: 'started' }
  | { status: 'insufficient_storage'; detail: string };

function getPuMigratorBaseUrl(): string {
  const hostname = globalThis.location?.hostname ?? '';
  if (hostname.includes('nonprd.tech.pixelunion.eu')) {
    return 'https://api.nonprd.tech.pixelunion.eu/api/migrator/google-photos';
  }
  return 'https://api.prd.tech.pixelunion.eu/api/migrator/google-photos';
}

/** Tenant subdomain derived from the current Immich host. */
export function getTenantUsername(): string {
  const hostname = globalThis.location.hostname;
  const nonprdSuffix = '.nonprd.tech.pixelunion.eu';
  const prdSuffix = '.pixelunion.eu';

  if (hostname.endsWith(nonprdSuffix)) {
    return hostname.slice(0, -nonprdSuffix.length);
  }
  if (hostname.endsWith(prdSuffix)) {
    return hostname.slice(0, -prdSuffix.length);
  }

  return hostname.split('.')[0] ?? hostname;
}

function getBase(): string {
  return getPuMigratorBaseUrl();
}

async function requireOidcAccessToken(): Promise<string> {
  const token = await getPuOidcAccessToken();
  if (!token) {
    throw new PuReauthRequiredError();
  }
  return token;
}

async function fetchWithAuth(
  url: string,
  init: RequestInit & { skipRetry?: boolean } = {},
): Promise<Response> {
  const { skipRetry, ...rest } = init;
  const token = await requireOidcAccessToken();
  const headers = new Headers(rest.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...rest, headers });

  if (response.status === 401 && !skipRetry) {
    clearPuOidcAccessTokenCache();
    const newToken = await getPuOidcAccessToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      return fetch(url, { ...rest, headers });
    }
    throw new PuReauthRequiredError();
  }

  return response;
}

async function ensureOk(response: Response): Promise<void> {
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = await response.json();
      const d = body.detail;
      detail =
        typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: unknown) => JSON.stringify(x)).join(', ') : undefined;
    } catch {
      detail = (await response.text()) || undefined;
    }
    throw new MigratorApiError(detail || `Request failed: ${response.status}`, response.status, detail);
  }
}

export async function getMigratorConfig(): Promise<MigratorConfig> {
  const response = await fetchWithAuth(`${getBase()}/config`);
  await ensureOk(response);
  return response.json();
}

export async function getMigration(): Promise<Migration> {
  const response = await fetchWithAuth(`${getBase()}/`);
  await ensureOk(response);
  return response.json();
}

export async function getMigrationStorage(): Promise<MigrationStorageResponse> {
  const response = await fetchWithAuth(`${getBase()}/storage`);
  await ensureOk(response);
  return response.json();
}

export async function createMigration(body: CreateMigrationBody): Promise<{ status: string }> {
  const response = await fetchWithAuth(`${getBase()}/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await ensureOk(response);
  return response.json();
}

export async function updateMigration(body: UpdateMigrationBody): Promise<{ status: string }> {
  const response = await fetchWithAuth(`${getBase()}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await ensureOk(response);
  return response.json();
}

export async function deleteMigration(): Promise<{ status: string }> {
  const response = await fetchWithAuth(`${getBase()}/`, { method: 'DELETE' });
  await ensureOk(response);
  return response.json();
}

export async function deleteUpload(uploadId: string): Promise<{ status: string }> {
  const response = await fetchWithAuth(`${getBase()}/upload/${encodeURIComponent(uploadId)}`, {
    method: 'DELETE',
  });
  await ensureOk(response);
  return response.json();
}

export async function validateCredentials(
  username: string,
  apiKey: string,
): Promise<{ valid: true; storage?: { diskAvailableRaw?: number } }> {
  const response = await fetchWithAuth(`${getBase()}/validate-credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim().toLowerCase(), apiKey: apiKey.trim() }),
  });
  await ensureOk(response);
  return response.json();
}

export async function startMigration(force = false): Promise<StartMigrationResult> {
  const url = `${getBase()}/start${force ? '?force=true' : ''}`;
  const response = await fetchWithAuth(url, { method: 'POST' });

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = await response.json();
      if (response.status === 400 && body?.code === 'insufficient_storage') {
        return {
          status: 'insufficient_storage',
          detail: body.detail || 'There may not be enough storage on your Immich instance.',
        };
      }
      detail = typeof body?.detail === 'string' ? body.detail : undefined;
    } catch {
      detail = undefined;
    }
    throw new MigratorApiError(detail || `Request failed: ${response.status}`, response.status, detail);
  }

  return response.json();
}

export async function cancelMigration(): Promise<{ status: string }> {
  const response = await fetchWithAuth(`${getBase()}/cancel`, { method: 'POST' });
  await ensureOk(response);
  return response.json();
}

export async function resetMigration(): Promise<{ status: string }> {
  const response = await fetchWithAuth(`${getBase()}/reset`, { method: 'POST' });
  await ensureOk(response);
  return response.json();
}

export async function downloadJobLog(): Promise<void> {
  const response = await fetchWithAuth(`${getBase()}/job-log`);
  await ensureOk(response);
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition');
  const match = disposition?.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? 'migration-job.log';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function getMigrationUploadUrl(): string {
  return `${getBase()}/upload`;
}

export async function getMigrationUploadAuthHeader(): Promise<Record<string, string>> {
  const token = await requireOidcAccessToken();
  return { Authorization: `Bearer ${token}` };
}
