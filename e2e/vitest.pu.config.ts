import { defineConfig } from 'vitest/config';

// PixelUnion fork e2e (API). Runs only the fork's specs, against the stack that
// `mise run //e2e:pu-up` starts (docker-compose.yml + docker-compose.pu.yml).
// No retries: these specs must pass on the first attempt.
export default defineConfig({
  test: {
    name: 'e2e:pu',
    include: ['src/specs/pu/server/**/pu-*.e2e-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'threads',
    maxWorkers: 1,
    isolate: false,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
