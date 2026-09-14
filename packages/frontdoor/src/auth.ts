import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Kysely } from 'kysely';
import type { DB } from 'src/schema';
// Reused so device metadata is parsed exactly as the server parses it: the session
// refresh below writes these columns and they surface in the device-management UI.
import { getUserAgentDetails } from 'src/utils/request';

/**
 * Session authentication, mirroring `AuthService.validate` and
 * `AuthService.validateSession`. Only the session branch is implemented: API keys
 * and shared links are recognised so the caller can answer the way the server
 * would, but are never validated here.
 */

export type Auth =
  /** A valid, unexpired session belonging to a live user. */
  | { kind: 'session'; sessionId: string; userId: string }
  /** An API key or shared-link token was presented. No session, so sync endpoints refuse. */
  | { kind: 'no-session' }
  /** A session token was presented but is unknown, expired, or the user is deleted. */
  | { kind: 'invalid' }
  /** No credentials at all. */
  | { kind: 'anonymous' };

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const bearerToken = (headers: IncomingHttpHeaders): string | undefined => {
  const [scheme, token] = (headers.authorization ?? '').split(' ', 2);
  return scheme?.toLowerCase() === 'bearer' ? token : undefined;
};

const cookieToken = (headers: IncomingHttpHeaders): string | undefined => {
  for (const part of (headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    if (part.slice(0, index).trim() === 'immich_access_token') {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
};

export type Credentials = { session?: string; hasOtherScheme: boolean };

/** Precedence follows `AuthService.validate`. */
export const readCredentials = (
  headers: IncomingHttpHeaders,
  query: URLSearchParams,
): Credentials => {
  const hasOtherScheme = Boolean(
    headers['x-immich-share-key'] ||
    headers['x-immich-share-slug'] ||
    headers['x-api-key'] ||
    query.get('key') ||
    query.get('slug') ||
    query.get('apiKey'),
  );

  const session =
    first(headers['x-immich-user-token']) ??
    first(headers['x-immich-session-token']) ??
    query.get('sessionKey') ??
    bearerToken(headers) ??
    cookieToken(headers) ??
    undefined;

  return { session: session || undefined, hasOtherScheme };
};

export const hashToken = (token: string): Buffer =>
  createHash('sha256').update(token).digest();

export const authenticate = async (
  db: Kysely<DB>,
  headers: IncomingHttpHeaders,
  query: URLSearchParams,
): Promise<Auth> => {
  const { session: token, hasOtherScheme } = readCredentials(headers, query);

  // A shared link key takes precedence over a session token in the server, so a
  // request carrying both is not a session request.
  if (
    hasOtherScheme &&
    (headers['x-immich-share-key'] ||
      headers['x-immich-share-slug'] ||
      query.get('key') ||
      query.get('slug'))
  ) {
    return { kind: 'no-session' };
  }

  if (!token) {
    return hasOtherScheme ? { kind: 'no-session' } : { kind: 'anonymous' };
  }

  const row = await db
    .selectFrom('session')
    .innerJoin('user', (join) =>
      join
        .onRef('user.id', '=', 'session.userId')
        .on('user.deletedAt', 'is', null),
    )
    .select([
      'session.id as id',
      'session.userId as userId',
      'session.appVersion as appVersion',
      'session.updatedAt as updatedAt',
    ])
    .where('session.token', '=', hashToken(token))
    .where((eb) =>
      eb.or([
        eb('session.expiresAt', 'is', null),
        eb('session.expiresAt', '>', new Date()),
      ]),
    )
    .executeTakeFirst();

  if (!row) {
    return { kind: 'invalid' };
  }

  await refreshSession(db, headers, row);

  return { kind: 'session', sessionId: row.id, userId: row.userId };
};

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * `validateSession` refreshes device metadata when the session has been quiet for
 * more than an hour or the client's app version changed. Without this, "last seen"
 * and the device list go stale for every request the front door answers.
 */
const refreshSession = async (
  db: Kysely<DB>,
  headers: IncomingHttpHeaders,
  session: { id: string; appVersion: string | null; updatedAt: Date | string },
) => {
  const { appVersion, deviceOS, deviceType } = getUserAgentDetails(headers);
  const updatedAt =
    session.updatedAt instanceof Date
      ? session.updatedAt
      : new Date(session.updatedAt);
  const stale = Date.now() - updatedAt.getTime() > ONE_HOUR_MS;

  if (!stale && appVersion === session.appVersion) {
    return;
  }

  await db
    .updateTable('session')
    .set({ updatedAt: new Date(), appVersion, deviceOS, deviceType })
    .where('id', '=', session.id)
    .execute();
};
