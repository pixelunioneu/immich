/** Base URL of the PixelUnion API for the environment this Immich tenant runs in. */
export function getPuApiBaseUrl(): string {
  const hostname = globalThis.location?.hostname ?? '';
  if (hostname.includes('nonprd.tech.pixelunion.eu')) {
    return 'https://api.nonprd.tech.pixelunion.eu';
  }
  return 'https://api.prd.tech.pixelunion.eu';
}
