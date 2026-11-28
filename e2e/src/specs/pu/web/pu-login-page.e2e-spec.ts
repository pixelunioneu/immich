import { expect, test } from '@playwright/test';

/**
Hosts the page is meant to call. The requests are still answered locally and never
leave the machine; anything not on this list (an API, an error tracker) fails the test.
*/
const EXPECTED_EXTERNAL_HOSTS = new Set([
  // Status widget embedded in web/src/app.html.
  'status.pixelunion.eu',
]);

/**
The login page served by the fork's nginx web image (Dockerfile.pu), with the API
behind it. Login is OIDC-only on the fork: the page must offer the OIDC button and
no password form, and carry PixelUnion branding rather than the Immich logo.
*/
test.describe('PixelUnion login page', () => {
  /** Requests to other hosts, answered locally. */
  let external: string[];

  // Nothing may leave the machine: answer every request to another host locally and
  // record it, so a baked-in production URL can neither be reached nor fail loudly.
  test.beforeEach(async ({ page, baseURL }) => {
    const local = new URL(baseURL!).host;
    external = [];
    await page.route(
      (url) => url.host !== local,
      (route) => {
        external.push(route.request().url());
        return route.fulfill({ status: 200, body: '' });
      },
    );
  });

  test('shows PixelUnion branding and only the OIDC login, without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto('/auth/login');

    const oauthButton = page.getByRole('button', { name: 'Login with PixelUnion' });
    await expect(oauthButton).toBeVisible();
    await expect(oauthButton).toBeEnabled();

    const logo = page.getByAltText('PixelUnion Logo').first();
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('src', /pixelunion/);
    // Every image on the page is a PixelUnion asset; nothing loads Immich's logo.
    // (The backdrop image is the PixelUnion logo but still has upstream's alt text.)
    const imageSources = await page
      .locator('img')
      .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
    expect(imageSources.length).toBeGreaterThan(0);
    for (const src of imageSources) {
      expect(new URL(src).pathname).toMatch(/^\/pixelunion[\w-]*\.svg$/);
    }
    await expect(page.locator('svg[aria-label*="immich" i]')).toHaveCount(0);

    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('#email')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toHaveCount(0);

    await page.waitForLoadState('networkidle');
    expect(consoleErrors).toEqual([]);
    expect(external.filter((url) => !EXPECTED_EXTERNAL_HOSTS.has(new URL(url).host))).toEqual([]);
  });

  test('starts the OIDC flow at the provider', async ({ page }) => {
    await page.goto('/auth/login');
    const origin = new URL(page.url()).origin;
    const authorize = page.waitForRequest((request) => request.url().startsWith('http://e2e-auth-server:2286/auth'));
    await page.getByRole('button', { name: 'Login with PixelUnion' }).click();

    const authorizeRequest = await authorize;
    const url = new URL(authorizeRequest.url());
    expect(url.searchParams.get('client_id')).toBe('client-pixelunion');
    expect(url.searchParams.get('redirect_uri')).toBe(`${origin}/auth/login`);
  });
});
