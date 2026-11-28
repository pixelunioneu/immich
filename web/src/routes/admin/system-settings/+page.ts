import { queryClient } from '#lib/queries/client.ts';
import { getAdminConfigDefaultsQuery, getAdminConfigQuery } from '#lib/queries/config-admin.query.ts';
import { authenticate } from '#lib/utils/auth.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url, { admin: true });
  // PixelUnion: the session setup no longer preloads the admin config (see auth-manager), so this
  // page, the only one that uses it, loads it itself.
  await Promise.all([queryClient.query(getAdminConfigQuery()), queryClient.query(getAdminConfigDefaultsQuery())]);
  const $t = await getFormatter();

  return {
    meta: {
      title: $t('admin.system_settings'),
    },
  };
}) satisfies PageLoad;
