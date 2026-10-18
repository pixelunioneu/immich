import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontdoorTest = resolve(serverRoot, '../packages/frontdoor/test');

// The front door's medium specs run on this package's harness: they import
// `src/*` and `test/*` through the server's tsconfig paths and use the
// testcontainers Postgres from ./medium/globalSetup.ts. So `root` stays the
// server and only the spec glob points at the front door. The config lives here,
// next to that harness, because it loads the server's vite plugins.
//
// This exists instead of running vitest.config.medium.mjs with
// `--dir ../packages/frontdoor`: that config pins `root` to the server, which
// `--dir` cannot move, so the include glob and the dir never intersect and
// vitest exits 1 with "No test files found".
export default defineConfig({
  resolve: {
    // The specs live outside the server, so the server's tsconfig paths do not
    // cover them (frontdoor's own tsconfig excludes test/medium). Map `src/*` and
    // `test/*` explicitly; tsconfigPaths still handles the server's own files.
    alias: [
      { find: /^src(?=\/)/, replacement: resolve(serverRoot, 'src') },
      { find: /^test(?=\/)/, replacement: resolve(serverRoot, 'test') },
    ],
    tsconfigPaths: true,
  },
  test: {
    name: 'frontdoor:medium',
    root: serverRoot,
    globals: true,
    include: [resolve(frontdoorTest, 'medium/**/*.spec.ts')],
    globalSetup: [resolve(serverRoot, 'test/medium/globalSetup.ts')],
  },
  plugins: [swc.vite()],
});
