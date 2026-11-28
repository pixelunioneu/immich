import { expect, test } from '@playwright/test';

// The server hands out the OIDC provider's in-stack address (e2e-auth-server:2286), which the
// browser on the host cannot resolve. Its port is published on the host, so map the name there.
test.use({ launchOptions: { args: ['--host-resolver-rules=MAP e2e-auth-server 127.0.0.1'] } });

/** Mock user with `immich_role: admin`, see packages/e2e-auth-server/auth-server.ts. */
const ADMIN = 'with-role';

/**
A full login in the browser as a tenant admin, on the fork's nginx web image.

The web app sets up the session after the OIDC callback and again on every page load.
Upstream preloads /api/admin/config there for admins, and /api/passkeys on the settings page.
Both routes are blocked on the fork: the first left every admin on the login page, the
second kept the settings page from loading (v3.4.2-pu1).
*/
test.describe('PixelUnion admin login', () => {
  test('an admin gets past the login page, stays signed in after a reload and can open the settings', async ({
    page,
  }) => {
    // The web app must not depend on a route the fork blocks: any API call answered 404 fails the test.
    const notFound: string[] = [];
    page.on('response', (response) => {
      if (response.status() === 404 && new URL(response.url()).pathname.startsWith('/api/')) {
        notFound.push(`${response.request().method()} ${new URL(response.url()).pathname}`);
      }
    });

    await page.goto('/auth/login');
    await page.getByRole('button', { name: 'Login with PixelUnion' }).click();

    // The mock's login and consent pages.
    await page.locator('input[name="login"]').fill(ADMIN);
    await page.locator('input[name="password"]').fill('password');
    await page.locator('button[type="submit"]').click();
    await page.locator('button[type="submit"]').click();

    // A new admin lands on the onboarding, a returning one on the timeline.
    const signedIn = /\/(auth\/onboarding|photos)(\?|$)/;
    await expect(page).toHaveURL(signedIn);

    const me = await page.request.get('/api/users/me');
    expect(me.status()).toBe(200);
    const { isAdmin } = await me.json();
    expect(isAdmin).toBe(true);

    // Every page load sets the session up again; a signed-out admin would be sent to the login page.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(signedIn);

    // The settings page loads its data up front; one failed call there shows an error page instead.
    await page.goto('/user-settings');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/user-settings(\?|$)/);
    await expect(page.getByRole('heading', { name: 'API Keys', exact: true })).toBeVisible();

    expect(notFound).toEqual([]);
  });
});
