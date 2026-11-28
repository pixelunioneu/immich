import { ServerVersionResponseDto } from 'src/dtos/server.dto';
import { describe, expect, it, vi } from 'vitest';
import { buildServerInfo } from '../src/handlers/server-info.js';

// The decorators shim stubs only what the bundled sync code needs. server.dto.ts also
// calls `HistoryBuilder.v3().getExtensions()` (and upstream may add more builders), so
// stand in a builder that accepts any chain. This only feeds OpenAPI metadata; the
// field names under test come from the real zod schema.
vi.mock('src/decorators', async (importOriginal) => {
  const extensions = () => ({});
  const builder: unknown = new Proxy(() => builder, {
    get: (_target, property) =>
      property === 'getExtensions' ? extensions : builder,
    apply: () => builder,
  });
  return { ...(await importOriginal<object>()), HistoryBuilder: builder };
});

describe('/api/server/version parity (idle tenants must answer exactly like a running server)', () => {
  it("frontdoor's version answer has exactly the fields of the server's ServerVersionResponseDto", () => {
    const frontdoorFields = Object.keys(
      buildServerInfo('3.2.1').version,
    ).toSorted();
    const serverFields = Object.keys(
      ServerVersionResponseDto.schema.shape,
    ).toSorted();

    expect(
      frontdoorFields,
      'ServerVersionResponseDto changed upstream: update buildServerInfo in packages/frontdoor/src/handlers/server-info.ts ' +
        'so the front door answers /api/server/version with the same fields as the server.',
    ).toEqual(serverFields);
  });
});
