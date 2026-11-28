import { app, metricsUrl, waitFor } from 'src/pu/helpers.js';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

/**
The stack runs the server with SENTRY_DSN set (see docker-compose.pu.yml). Sentry brings
its own OpenTelemetry setup and loads before anything else. If Sentry and Immich end up
on two copies of @opentelemetry/api, Immich cannot register its meter provider and the
Prometheus endpoint only exports `target_info`. That happened in the v3.4.2 merge, and
nothing else notices: the server starts and answers as usual.
*/
describe('PixelUnion Sentry and metrics', () => {
  it('still exports Immich metrics with Sentry enabled', async () => {
    const ping = await request(app).get('/server/ping');
    expect(ping.status).toBe(200);

    let status = 0;
    let body = '';
    try {
      await waitFor(
        'Immich metrics on the Prometheus endpoint',
        async () => {
          const response = await request(metricsUrl).get('/metrics');
          status = response.status;
          body = response.text;
          return status === 200 && body.includes('immich_');
        },
        { timeoutMs: 30_000 },
      );
    } catch {
      // fall through to the assertions below, which say what was wrong
    }

    expect(status).toBe(200);
    expect(body).toContain('immich_');
  });
});
