import 'src/instrument.js';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { isMainThread } from 'node:worker_threads';
import { configureExpress, configureTelemetry } from 'src/app.common.js';
import { MaintenanceModule } from 'src/app.module.js';
import { MaintenanceWorkerService } from 'src/maintenance/maintenance-worker.service.js';
import { AppRepository } from 'src/repositories/app.repository.js';
import { isStartUpError } from 'src/utils/misc.js';

async function bootstrap() {
  process.title = 'immich-maintenance';
  configureTelemetry();

  const app = await NestFactory.create<NestExpressApplication>(MaintenanceModule, {
    bufferLogs: true,
    routeConflictPolicy: { duplicate: 'error' },
    routeResolutionStrategy: 'specificity',
  });
  app.get(AppRepository).setCloseFn(() => app.close());

  void configureExpress(app, {
    permitSwaggerWrite: false,
    ssr: MaintenanceWorkerService,
  });
}

if (!isMainThread) {
  bootstrap().catch((error) => {
    if (!isStartUpError(error)) {
      console.error(error);
    }
    process.exit(1);
  });
}
