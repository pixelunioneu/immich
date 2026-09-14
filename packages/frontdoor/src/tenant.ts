/**
 * A request's tenant is taken from the Host header and nothing else, matching how
 * the ingress routes it. The name is validated against a strict pattern before it
 * is ever used to select a database.
 */

const TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const tenantFromHost = (
  host: string | undefined,
  baseDomain: string,
): string | null => {
  if (!host) {
    return null;
  }

  // Strip a port, and normalise case: Host is case-insensitive.
  const hostname = host.split(':')[0]?.toLowerCase();
  if (!hostname) {
    return null;
  }

  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) {
    return null;
  }

  const name = hostname.slice(0, -suffix.length);
  // Exactly one label: `a.b.example.com` is not a tenant.
  if (!TENANT_PATTERN.test(name)) {
    return null;
  }

  return name;
};

export const databaseForTenant = (tenant: string, prefix: string): string => {
  if (!TENANT_PATTERN.test(tenant)) {
    throw new Error(
      'Refusing to build a database name from an unvalidated tenant',
    );
  }
  return `${prefix}${tenant}`;
};
