#!/usr/bin/env node
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const distDir = join(import.meta.dirname, '..', 'dist');

// app.module.js pulls in ~the entire shared dependency graph (repositories, services,
// Kysely, BullMQ, OpenTelemetry, sharp, onnxruntime-node, all controllers). The three
// worker entry files add only their small worker-specific extras on top.
// Deliberately NOT importing dist/main.js: it has no import.meta.main guard and
// unconditionally calls a live-DB isMaintenanceMode() check at import time.
const modulesToWarm = [
  'app.module.js',
  join('workers', 'api.js'),
  join('workers', 'maintenance.js'),
  join('workers', 'microservices.js'),
];

let failures = 0;

for (const relPath of modulesToWarm) {
  const fullPath = join(distDir, relPath);
  try {
    await import(pathToFileURL(fullPath).href);
    console.log(`[warm-compile-cache] warmed ${relPath}`);
  } catch (error) {
    failures += 1;
    console.error(`[warm-compile-cache] FAILED to warm ${relPath}:`, error);
  }
}

if (failures > 0) {
  console.error(`[warm-compile-cache] ${failures} module(s) failed to warm`);
  process.exit(1);
}

console.log('[warm-compile-cache] done');
