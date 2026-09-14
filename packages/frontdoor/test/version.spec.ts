import { describe, expect, it } from 'vitest';
import { parseVersion } from '../src/config.js';

describe('parseVersion', () => {
  it('reports a release with a null prerelease, as the server does', () => {
    expect(parseVersion('3.2.1')).toEqual({
      major: 3,
      minor: 2,
      patch: 1,
      prerelease: null,
    });
  });

  it('tolerates a leading v from an image tag', () => {
    expect(parseVersion('v3.2.1')).toEqual({
      major: 3,
      minor: 2,
      patch: 1,
      prerelease: null,
    });
  });

  it('mirrors semver: the prerelease reported is the second identifier', () => {
    expect(parseVersion('3.2.1-beta.4').prerelease).toBe(4);
    // A single non-numeric identifier has no second element, so the server reports null.
    expect(parseVersion('3.2.1-pu3').prerelease).toBeNull();
  });

  it('throws on anything unparseable rather than guessing', () => {
    expect(() => parseVersion('not-a-version')).toThrow();
  });
});
