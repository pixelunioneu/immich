import { OpenQueryParam } from '#lib/constants.ts';
import { Route } from '#lib/route.ts';
import { test } from '#test/unit/fixtures.ts';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { load } from './+page.ts';

// PixelUnion: upstream's test here is 'links to the OAuth account management page'. The fork
// removed the OAuth section from user settings (accounts are managed through the PixelUnion
// portal and Keycloak), so the same setup must not show that link.
test('does not show the OAuth account management link (PixelUnion has no OAuth settings section)', async ({
  data,
  router,
  render,
  app,
}) => {
  data.user.oauthId = 'oauth-user';
  data.userConfig.oauth.enabled = true;
  data.userConfig.oauth.accountManagementUrl = 'https://idp.example/account';
  await router.goto(Route.userSettings({ isOpen: OpenQueryParam.OAUTH }));

  await render(Page, load);

  await expect.element(page.getByText('app_settings', { exact: true })).toBeInTheDocument();
  await expect.element(app.settings.manageOauthAccountLink).not.toBeInTheDocument();
});
