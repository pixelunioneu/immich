type OidcTokenResponse = {
  accessToken?: string;
  reauth?: boolean;
};

let cachedToken: string | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 50 * 60 * 1000;

export function clearPuOidcAccessTokenCache(): void {
  cachedToken = null;
  cacheExpiry = 0;
}

/**
 * Returns a Keycloak access token for PixelUnion backend API calls, or null if re-auth is needed.
 * Caches the token in memory for ~50 minutes (access tokens live ~1h).
 */
export async function getPuOidcAccessToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cacheExpiry) {
    return cachedToken;
  }

  const response = await fetch('/api/auth/oidc-token', {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    return null;
  }

  const data: OidcTokenResponse = await response.json();

  if (data.reauth) {
    clearPuOidcAccessTokenCache();
    return null;
  }

  if (data.accessToken) {
    cachedToken = data.accessToken;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return data.accessToken;
  }

  return null;
}
