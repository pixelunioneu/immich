import { fileURLToPath } from 'node:url';
import { defineConfig, UserConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      // `src/*` resolves into the server package: see the note in tsconfig.json.
      src: fileURLToPath(new URL('../../server/src', import.meta.url)),
      // The server sources pulled in above resolve their own imports against
      // server/node_modules, which the Docker build never installs. Every runtime
      // dependency they reach for is declared by this package, so point them here.
      'ua-parser-js': fileURLToPath(import.meta.resolve('ua-parser-js')),
    },
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
  },
} as UserConfig);
