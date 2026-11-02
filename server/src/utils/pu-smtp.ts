import { ForbiddenException } from '@nestjs/common';
import type { EnvData } from 'src/repositories/config.repository.js';

// PixelUnion: the SMTP test endpoint connects to any host:port supplied by the caller. On hosted
// tenants (PU_TENANT_NAME set) admins must not be able to probe arbitrary hosts from the server.
export const assertSmtpTestAllowed = ({ puTenantName }: Pick<EnvData, 'puTenantName'>) => {
  if (puTenantName) {
    throw new ForbiddenException('Sending test emails with custom SMTP settings is not available on this server');
  }
};
