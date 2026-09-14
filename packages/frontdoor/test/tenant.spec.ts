import { describe, expect, it } from 'vitest';
import { databaseForTenant, tenantFromHost } from '../src/tenant.js';

describe('tenantFromHost', () => {
  const base = 'example.com';

  it('reads the tenant from a single label', () => {
    expect(tenantFromHost('acme.example.com', base)).toBe('acme');
  });

  it('ignores a port and normalises case', () => {
    expect(tenantFromHost('ACME.Example.com:443', base)).toBe('acme');
  });

  it('accepts hyphens and digits', () => {
    expect(tenantFromHost('acme-2.example.com', base)).toBe('acme-2');
  });

  it.each([
    ['missing host', undefined],
    ['the apex itself', 'example.com'],
    ['a nested label', 'a.b.example.com'],
    ['a host under a different domain', 'acme.elsewhere.test'],
    ['a suffix that only looks right', 'acme.notexample.com'],
    ['a leading hyphen', '-acme.example.com'],
    ['an underscore', 'a_b.example.com'],
  ])('rejects %s', (_label, host) => {
    expect(tenantFromHost(host, base)).toBeNull();
  });
});

describe('databaseForTenant', () => {
  it('prefixes a validated tenant', () => {
    expect(databaseForTenant('acme', 'db-')).toBe('db-acme');
  });

  it('refuses anything that did not come from tenantFromHost', () => {
    expect(() =>
      databaseForTenant('acme"; DROP DATABASE x --', 'db-'),
    ).toThrow();
  });
});
