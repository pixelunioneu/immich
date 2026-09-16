import { describe, expect, it } from 'vitest';
import { hashToken, readCredentials } from '../src/auth.js';

const query = (search = '') => new URLSearchParams(search);

describe('readCredentials', () => {
  it('prefers x-immich-user-token over every other source', () => {
    const result = readCredentials(
      {
        'x-immich-user-token': 'first',
        'x-immich-session-token': 'second',
        authorization: 'Bearer third',
        cookie: 'immich_access_token=fourth',
      },
      query('sessionKey=fifth'),
    );
    expect(result.session).toBe('first');
  });

  it('falls through the precedence order from AuthService.validate', () => {
    expect(
      readCredentials({ 'x-immich-session-token': 'b' }, query()).session,
    ).toBe('b');
    expect(readCredentials({}, query('sessionKey=c')).session).toBe('c');
    expect(
      readCredentials({ authorization: 'Bearer d' }, query()).session,
    ).toBe('d');
    expect(
      readCredentials({ cookie: 'other=x; immich_access_token=e' }, query())
        .session,
    ).toBe('e');
  });

  it('returns a malformed cookie value raw instead of throwing', () => {
    // decodeURIComponent('%') throws. The server's cookie parser falls back to
    // the raw value; so must this, or a garbage cookie from an unauthenticated
    // client would be recorded as a database failure and trip the tenant's
    // circuit breaker.
    expect(
      readCredentials({ cookie: 'immich_access_token=%' }, query()).session,
    ).toBe('%');
    expect(
      readCredentials({ cookie: 'immich_access_token=%E0%A4%A' }, query())
        .session,
    ).toBe('%E0%A4%A');
  });

  it('ignores a non-bearer authorization scheme', () => {
    expect(
      readCredentials({ authorization: 'Basic abc' }, query()).session,
    ).toBeUndefined();
  });

  it('flags API keys and shared links as a different scheme', () => {
    expect(readCredentials({ 'x-api-key': 'k' }, query()).hasOtherScheme).toBe(
      true,
    );
    expect(
      readCredentials({ 'x-immich-share-key': 'k' }, query()).hasOtherScheme,
    ).toBe(true);
    expect(readCredentials({}, query('slug=s')).hasOtherScheme).toBe(true);
    expect(
      readCredentials({ 'x-immich-user-token': 't' }, query()).hasOtherScheme,
    ).toBe(false);
  });
});

describe('hashToken', () => {
  it('produces the raw sha256 digest stored in session.token', () => {
    // session.token is bytea holding digest bytes, not a hex string.
    const digest = hashToken('token');
    expect(digest).toBeInstanceOf(Buffer);
    expect(digest).toHaveLength(32);
    expect(digest.toString('hex')).toBe(
      '3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0',
    );
  });
});
