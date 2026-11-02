import { ForbiddenException } from '@nestjs/common';
import { MaintenanceAction } from 'src/enum.js';
import { MaintenanceHealthRepository } from 'src/maintenance/maintenance-health.repository.js';
import { MaintenanceWebsocketRepository } from 'src/maintenance/maintenance-websocket.repository.js';
import { MaintenanceWorkerController } from 'src/maintenance/maintenance-worker.controller.js';
import { MaintenanceWorkerService } from 'src/maintenance/maintenance-worker.service.js';
import { DatabaseBackupService } from 'src/services/database-backup.service.js';
import { MaintenanceService } from 'src/services/maintenance.service.js';
import { DATABASE_RESTORE_DISABLED_MESSAGE } from 'src/utils/pu-database-restore.js';
import { AutoMocked, ServiceMocks, automock, getMocks, newTestService } from 'test/utils.js';

// PixelUnion: database backup upload and restore must be refused server-side, even when a
// request gets past the route guard (an uploaded .sql file is piped into psql, whose
// meta-commands can run shell commands).
const refused = new ForbiddenException(DATABASE_RESTORE_DISABLED_MESSAGE);

describe('PixelUnion: database restore disabled', () => {
  describe(DatabaseBackupService.name, () => {
    let sut: DatabaseBackupService;
    let mocks: ServiceMocks;

    beforeEach(() => {
      mocks = getMocks();
      sut = new DatabaseBackupService(
        mocks.logger as never,
        mocks.storage as never,
        mocks.config,
        mocks.systemMetadata as never,
        mocks.process,
        mocks.database as never,
        mocks.user as never,
        mocks.cron as never,
        mocks.job as never,
        automock(MaintenanceHealthRepository, { args: [mocks.logger], strict: false }) as never,
      );
    });

    it('should refuse to store an uploaded backup', async () => {
      await expect(
        sut.uploadBackup({ originalname: 'immich-db-backup-1.sql', buffer: Buffer.from(String.raw`\! id`) } as never),
      ).rejects.toThrowError(refused);
      expect(mocks.storage.createOrOverwriteFile).not.toHaveBeenCalled();
    });

    it('should refuse to restore a backup without spawning psql', async () => {
      await expect(sut.restoreDatabaseBackup('immich-db-backup-1.sql')).rejects.toThrowError(refused);
      expect(mocks.process.spawnDuplexStream).not.toHaveBeenCalled();
      expect(mocks.storage.createPlainReadStream).not.toHaveBeenCalled();
    });

    it('should still allow downloading a backup', () => {
      expect(sut.downloadBackup('immich-db-backup-1.sql.gz')).toEqual(
        expect.objectContaining({ fileName: 'immich-db-backup-1.sql.gz' }),
      );
    });
  });

  describe(MaintenanceService.name, () => {
    let sut: MaintenanceService;
    let mocks: ServiceMocks;

    beforeEach(() => {
      ({ sut, mocks } = newTestService(MaintenanceService));
    });

    it('should refuse to start the restore flow', async () => {
      await expect(sut.startRestoreFlow()).rejects.toThrowError(refused);
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      expect(mocks.event.emit).not.toHaveBeenCalled();
    });

    it.each([MaintenanceAction.RestoreDatabase, MaintenanceAction.SelectDatabaseRestore])(
      'should refuse to enter maintenance mode with action %s',
      async (action) => {
        await expect(
          sut.startMaintenance({ action, restoreBackupFilename: 'immich-db-backup-1.sql' }, 'admin'),
        ).rejects.toThrowError(refused);
        expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
        expect(mocks.event.emit).not.toHaveBeenCalled();
      },
    );

    it('should still allow a plain maintenance start', async () => {
      await expect(sut.startMaintenance({ action: MaintenanceAction.Start }, 'admin')).resolves.toMatchObject({
        jwt: expect.any(String),
      });
    });
  });

  describe(MaintenanceWorkerService.name, () => {
    let sut: MaintenanceWorkerService;
    let mocks: ServiceMocks;
    let databaseBackupServiceMock: AutoMocked<DatabaseBackupService>;
    let maintenanceWebsocketRepositoryMock: AutoMocked<MaintenanceWebsocketRepository>;

    beforeEach(() => {
      mocks = getMocks();
      const maintenanceHealthRepositoryMock = automock(MaintenanceHealthRepository, {
        args: [mocks.logger],
        strict: false,
      });
      maintenanceWebsocketRepositoryMock = automock(MaintenanceWebsocketRepository, {
        args: [mocks.logger],
        strict: false,
      });
      databaseBackupServiceMock = automock(DatabaseBackupService, {
        args: [
          mocks.logger,
          mocks.storage,
          mocks.config,
          mocks.systemMetadata,
          mocks.process,
          mocks.database,
          mocks.cron,
          mocks.job,
          maintenanceHealthRepositoryMock,
        ],
        strict: false,
      });
      sut = new MaintenanceWorkerService(
        mocks.logger as never,
        mocks.app,
        mocks.config,
        mocks.systemMetadata as never,
        maintenanceWebsocketRepositoryMock,
        maintenanceHealthRepositoryMock,
        mocks.storage as never,
        mocks.process,
        mocks.database as never,
        databaseBackupServiceMock,
      );
      sut.mock({ active: true, action: MaintenanceAction.Start });
    });

    it.each([MaintenanceAction.RestoreDatabase, MaintenanceAction.SelectDatabaseRestore])(
      'should refuse setAction(%s)',
      async (action) => {
        await expect(sut.setAction({ action, restoreBackupFilename: 'immich-db-backup-1.sql' })).rejects.toThrowError(
          refused,
        );
        expect(maintenanceWebsocketRepositoryMock.clientSend).not.toHaveBeenCalled();
        expect(databaseBackupServiceMock.restoreDatabaseBackup).not.toHaveBeenCalled();
      },
    );

    it('should not run a restore action persisted in maintenance state', async () => {
      await sut.runAction({
        action: MaintenanceAction.RestoreDatabase,
        restoreBackupFilename: 'immich-db-backup-1.sql',
      });

      expect(mocks.database.tryLock).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      expect(databaseBackupServiceMock.restoreDatabaseBackup).not.toHaveBeenCalled();
      expect(mocks.logger.error).toHaveBeenCalledWith(DATABASE_RESTORE_DISABLED_MESSAGE);
    });

    describe(MaintenanceWorkerController.name, () => {
      it('should refuse a restore action synchronously', () => {
        const setAction = vi.spyOn(sut, 'setAction');
        const controller = new MaintenanceWorkerController(mocks.logger as never, sut, databaseBackupServiceMock);

        expect(() =>
          controller.setMaintenanceMode({
            action: MaintenanceAction.RestoreDatabase,
            restoreBackupFilename: 'immich-db-backup-1.sql',
          }),
        ).toThrowError(refused);
        expect(setAction).not.toHaveBeenCalled();
      });
    });
  });
});
