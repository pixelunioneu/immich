import type { AuthDto } from 'src/dtos/auth.dto';

/** The two ids the sync service reads from an authenticated session. */
export type SessionAuth = { sessionId: string; userId: string };

/**
 * The server's `AuthDto` carries the full user and session rows. The sync service
 * only reads `user.id` and `session.id`, so this is all the front door supplies;
 * the cast is deliberate and the typecheck of the bundled service is what keeps
 * it honest if upstream starts reading more.
 */
export const toAuthDto = ({ sessionId, userId }: SessionAuth): AuthDto =>
  ({ user: { id: userId }, session: { id: sessionId } }) as unknown as AuthDto;
