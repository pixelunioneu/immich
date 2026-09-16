import { fileURLToPath } from 'node:url';
import { defineConfig, UserConfig } from 'vite';

/** Module specifier → shim file under src/shims. Shared with vitest. */
export const shims: Record<string, string> = {
  'src/services/base.service': 'base.service.ts',
  'src/decorators': 'decorators.ts',
  '@nestjs/common': 'nestjs-common.ts',
  'nestjs-kysely': 'nestjs-kysely.ts',
  'nestjs-zod': 'nestjs-zod.ts',
};

export default defineConfig({
  resolve: {
    // Order matters: the shims must match before the catch-all `src` alias.
    alias: [
      // The server's SyncService and SyncRepository are bundled as-is, but their
      // framework edges are not: the NestJS decorators, the DI markers and the
      // god-object BaseService are replaced with shims that keep the class shapes
      // and drop the framework. See src/shims/*.ts.
      ...Object.entries(shims).map(([find, file]) => ({
        find,
        replacement: fileURLToPath(
          new URL(`./src/shims/${file}`, import.meta.url),
        ),
      })),
      // `src/*` resolves into the server package: see the note in tsconfig.json.
      {
        find: /^src(?=\/)/,
        replacement: fileURLToPath(
          new URL('../../server/src', import.meta.url),
        ),
      },
      // `src/enum` imports one enum from the plugin SDK, a workspace package
      // whose build output the Docker image never has. Its types module is
      // self-contained source, so it is bundled from there.
      {
        find: '@immich/plugin-sdk',
        replacement: fileURLToPath(
          new URL('../plugin-sdk/src/types.ts', import.meta.url),
        ),
      },
      // The server sources pulled in above resolve their own imports against
      // server/node_modules, which the Docker build never installs. Every runtime
      // dependency they reach for is declared by this package, so point them here.
      ...['ua-parser-js', 'zod', 'luxon', 'validator', 'sanitize-filename'].map(
        (name) => ({
          find: name,
          replacement: fileURLToPath(import.meta.resolve(name)),
        }),
      ),
    ],
  },
  build: {
    ssr: 'src/index.ts',
    target: 'node22',
    outDir: 'dist',
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
  ssr: {
    // Bundle everything except Node built-ins, so the runtime image needs no
    // node_modules at all. pg-native is left out: pg only reaches for it when
    // explicitly asked, and we never ask.
    noExternal: /^(?!node:).*$/,
    external: ['pg-native'],
  },
  test: {
    name: 'frontdoor:unit',
    globals: true,
    // test/medium needs Docker and the server's harness: `mise run test-medium`.
    exclude: ['**/node_modules/**', 'test/medium/**'],
  },
} as UserConfig);
