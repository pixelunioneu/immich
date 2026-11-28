/**
 * The host this page is served from. Read it through this object rather than `location`, so a
 * test can replace `hostname`: a real browser does not allow `location` itself to be stubbed.
 */
export const puLocation = {
  hostname: (): string => globalThis.location?.hostname ?? '',
};

/** Base URL of the PixelUnion API for the environment this Immich tenant runs in. */
export function getPuApiBaseUrl(): string {
  const hostname = puLocation.hostname();
  if (hostname.includes('nonprd.tech.pixelunion.eu')) {
    return 'https://api.nonprd.tech.pixelunion.eu';
  }
  return 'https://api.prd.tech.pixelunion.eu';
}

/** Stripe customer portal where tenant owners manage and upgrade their subscription. */
export const PU_BILLING_PORTAL_URL = 'https://billing.stripe.com/p/login/14kaFHfe8aTHa2s5kk';
