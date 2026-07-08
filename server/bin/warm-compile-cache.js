#!/usr/bin/env node
'use strict';

const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');

// app.module.js pulls in ~the entire shared dependency graph (repositories, services,
// Kysely, BullMQ, OpenTelemetry, sharp, onnxruntime-node, all controllers). The three
// worker entry files add only their small worker-specific extras on top.
// Deliberately NOT requiring dist/main.js: it has no require.main guard and
// unconditionally calls a live-DB isMaintenanceMode() check at import time.
const modulesToWarm = [
  'app.module.js',
  path.join('workers', 'api.js'),
  path.join('workers', 'maintenance.js'),
  path.join('workers', 'microservices.js'),
];

let failures = 0;

for (const relPath of modulesToWarm) {
  const fullPath = path.join(distDir, relPath);
  try {
    require(fullPath);
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
