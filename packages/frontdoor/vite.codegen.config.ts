import { fileURLToPath } from 'node:url';
import { defineConfig, UserConfig } from 'vite';

/**
 * Builds the contract generator. Kept separate from the service build so the
 * generator may pull in whatever server sources it needs without any of that
 * reaching the runtime bundle.
 */
export default defineConfig({
  resolve: {
    alias: { src: fileURLToPath(new URL('../../server/src', import.meta.url)) },
  },
  build: {
    ssr: 'scripts/generate-contract.ts',
    target: 'node22',
    outDir: 'dist-codegen',
    emptyOutDir: true,
    // CJS: the bundled server graph still contains __dirname/__filename usages.
    rollupOptions: {
      output: { format: 'cjs', entryFileNames: 'generate-contract.cjs' },
    },
  },
  ssr: { noExternal: /^(?!node:).*$/ },
} as UserConfig);
