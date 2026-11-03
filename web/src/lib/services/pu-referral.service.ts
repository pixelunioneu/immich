import { getPuApiBaseUrl } from '$lib/utils/pu-api';

export interface Referral {
  referral_id: string;
  referral_url: string;
}

/**
 * - `ok`: the tenant has a referral link.
 * - `none`: the tenant has no referral link (404); hide the referral UI.
 * - `unavailable`: rate limited, Stripe down or network error; worth a retry later.
 */
export type ReferralResult = { status: 'ok'; referral: Referral } | { status: 'none' } | { status: 'unavailable' };

/**
 * The referral link of the subscription behind this Immich host. The endpoint is
 * unauthenticated and looked up by host, so every user on the tenant gets the same link.
 */
export async function getReferral(): Promise<ReferralResult> {
  const hostname = location.hostname;
  let response: Response;
  try {
    response = await fetch(`${getPuApiBaseUrl()}/api/referral/${encodeURIComponent(hostname)}`);
  } catch {
    return { status: 'unavailable' };
  }

  if (response.status === 404) {
    return { status: 'none' };
  }
  if (!response.ok) {
    return { status: 'unavailable' };
  }

  try {
    const body = await response.json();
    if (typeof body?.referral_id !== 'string' || typeof body?.referral_url !== 'string') {
      return { status: 'unavailable' };
    }
    return { status: 'ok', referral: { referral_id: body.referral_id, referral_url: body.referral_url } };
  } catch {
    return { status: 'unavailable' };
  }
}
