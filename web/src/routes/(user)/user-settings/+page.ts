import { getApiKeysQuery } from '#lib/queries/api-key.query.ts';
import { queryClient } from '#lib/queries/client.ts';
import { getSessionsQuery } from '#lib/queries/session.query.ts';
import { authenticate } from '#lib/utils/auth.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);

  const [$t] = await Promise.all([
    getFormatter(),
    queryClient.query({ ...getApiKeysQuery(), staleTime: 0 }),
    queryClient.query({ ...getSessionsQuery(), staleTime: 0 }),
    // PixelUnion: no passkey preload. /api/passkeys is a blocked route on this fork (404), and a
    // failed preload would keep the whole settings page from loading.
  ]);

  return {
    meta: {
      title: $t('settings'),
    },
  };
}) satisfies PageLoad;
