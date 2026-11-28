import { app, frontdoorTenantHost, frontdoorUrl, readRepoFile } from 'src/pu/helpers.js';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

/**
The front door answers /api/server/version for idle tenants, so clients must not be
able to tell it from the server. The stack gives the front door the version from
server/package.json (see e2e/pu/compose.sh), as a deployment gives it the server
image's version.
*/
describe('PixelUnion /api/server/version', () => {
  const { version } = JSON.parse(readRepoFile('server/package.json')) as { version: string };

  it('is the same from the server and the front door', async () => {
    const server = await request(app).get('/server/version');
    const frontdoor = await request(frontdoorUrl).get('/api/server/version').set('Host', frontdoorTenantHost);

    expect(server.status).toBe(200);
    expect(frontdoor.status).toBe(200);
    expect(frontdoor.body).toEqual(server.body);
  });

  it('reports the server package version', async () => {
    const [major, minor, patch] = version.split(/[.-]/).map(Number);
    const { body } = await request(app).get('/server/version');
    expect(body).toMatchObject({ major, minor, patch });
  });

  it('is the same for /api/server/ping', async () => {
    const server = await request(app).get('/server/ping');
    const frontdoor = await request(frontdoorUrl).get('/api/server/ping').set('Host', frontdoorTenantHost);
    expect(frontdoor.status).toBe(200);
    expect(frontdoor.body).toEqual(server.body);
  });
});
