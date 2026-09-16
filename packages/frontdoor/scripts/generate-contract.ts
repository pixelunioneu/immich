/**
 * Extracts the constant parts of the Immich API contract from the server sources
 * into a JSON fixture the service reads at runtime.
 *
 * This runs at build time on purpose. Importing `src/utils/mime-types` directly
 * reaches `src/utils/file`, which pulls in NestJS, Express and the logging and
 * storage repositories; `src/enum` reaches zod and the plugin SDK. None of that
 * belongs in a process whose entire point is to be small. Generating instead keeps
 * the values authoritative while leaving the runtime bundle free of the framework.
 *
 * The output is committed. CI regenerates it and fails on a diff, so an upstream
 * change to either list is caught at build time rather than in production.
 *
 * The mise `codegen` task runs prettier over the result: the repo sorts JSON keys
 * with prettier-plugin-sort-json, and without that step the drift check would
 * fail on formatting alone.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyncRequestType } from 'src/enum';
import { mimeTypes } from 'src/utils/mime-types';

const contract = {
  // Mirrors ServerService.getSupportedMediaTypes.
  mediaTypes: {
    video: Object.keys(mimeTypes.video),
    image: Object.keys(mimeTypes.image),
    sidecar: Object.keys(mimeTypes.sidecar),
  },
  // The set the server's request validation accepts for sync/stream `types`.
  // `streamInternal` itself silently skips unknown types, so the front door has
  // to reject them the way the controller would before deciding anything.
  syncRequestTypes: Object.values(SyncRequestType),
};

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'generated',
  'contract.json',
);
writeFileSync(target, JSON.stringify(contract, null, 2) + '\n');
console.log(`Wrote ${target}`);
