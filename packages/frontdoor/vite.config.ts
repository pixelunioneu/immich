import { fileURLToPath } from 'node:url';
import { defineConfig, UserConfig } from 'vite';

export default defineConfig({
  resolve: {
    // `src/*` resolves into the server package: see the note in tsconfig.json.
    alias: { src: fileURLToPath(new URL('../../server/src', import.meta.url)) },
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
    // Bundle everything except Node built-ins and the native driver.
    noExternal: /^(?!node:|pg$).*$/,
    external: ['pg'],
  },
  test: {
    name: 'frontdoor:unit',
    globals: true,
  },
} as UserConfig);
