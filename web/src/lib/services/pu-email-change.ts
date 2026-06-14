import { getPuOidcAccessToken } from '$lib/utils/pu-oidc';

export const PU_MGMT_API_BASE = 'https://api.mgmt.tech.pixelunion.eu';

export class PuReauthRequiredError extends Error {
  constructor() {
    super('OIDC auth unavailable — OAuth re-login required');
    this.name = 'PuReauthRequiredError';
  }
}

export class PuEmailChangeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PuEmailChangeError';
  }
}

export type EmailChangeRequestResult = {
  message: string;
  oldEmail: string;
  newEmail: string;
};

export type EmailChangeTenantFailure = {
  tenantSlug?: string;
  cluster?: string;
  status?: string;
  error?: string;
};

export type EmailChangeSummary = {
  oldEmail: string;
  newEmail: string;
  keycloakUpdated?: boolean;
  stripeCustomersUpdated?: Array<{ customerId: string; oldEmail: string; newEmail: string }>;
  tenantUpdates?: Array<{ tenantSlug: string; cluster: string; status: string }>;
  tenantFailures?: EmailChangeTenantFailure[];
  indexUpdated?: { rowsAffected: number };
};

export type EmailChangeConfirmResult = {
  message: string;
  summary: EmailChangeSummary;
};

type ApiErrorBody = {
  detail?: string | Array<{ msg?: string }>;
  message?: string;
};

async function requireOidcAccessToken(): Promise<string> {
  const token = await getPuOidcAccessToken();
  if (!token) {
    throw new PuReauthRequiredError();
  }
  return token;
}

function parseErrorMessage(body: ApiErrorBody, status: number): string {
  if (typeof body.detail === 'string') {
    return body.detail;
  }

  if (Array.isArray(body.detail) && body.detail.length > 0) {
    return body.detail.map((item) => item.msg).filter(Boolean).join(', ') || 'Request failed';
  }

  if (body.message) {
    return body.message;
  }

  switch (status) {
    case 400: {
      return 'Invalid request';
    }
    case 401: {
      return 'Authentication required';
    }
    case 409: {
      return 'Email address already in use';
    }
    case 429: {
      return 'Too many verification attempts';
    }
    default: {
      return 'Email change request failed';
    }
  }
}

async function postEmailChange<T>(path: string, body: Record<string, string>): Promise<T> {
  const token = await requireOidcAccessToken();

  const response = await fetch(`${PU_MGMT_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseBody = (await response.json().catch(() => ({}))) as ApiErrorBody & T;

  if (!response.ok) {
    throw new PuEmailChangeError(parseErrorMessage(responseBody, response.status), response.status);
  }

  return responseBody;
}

export async function requestEmailChange(newEmail: string): Promise<EmailChangeRequestResult> {
  return postEmailChange<EmailChangeRequestResult>('/api/user/email-change/request', {
    new_email: newEmail.trim().toLowerCase(),
  });
}

export async function confirmEmailChange(code: string): Promise<EmailChangeConfirmResult> {
  return postEmailChange<EmailChangeConfirmResult>('/api/user/email-change/confirm', {
    code: code.trim().toUpperCase(),
  });
}
