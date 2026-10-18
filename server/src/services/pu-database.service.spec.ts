import { DatabaseMigrateCommand } from 'src/commands/database-migrate.js';
import { commandsAndQuestions } from 'src/commands/index.js';
import { DatabaseExtension, DatabaseLock, VectorIndex } from 'src/enum.js';
import { DatabaseService } from 'src/services/database.service.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// PixelUnion: migrate() is split out of onBootstrap so the db-migrate CLI command can run it standalone.
describe(`${DatabaseService.name} (PixelUnion migrate)`, () => {
  let sut: DatabaseService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(DatabaseService));

    mocks.database.getVectorExtension.mockResolvedValue(DatabaseExtension.VectorChord);
    mocks.database.getExtensionVersionRange.mockReturnValue('0.2.x');
    mocks.database.getSchemaDrift.mockResolvedValue({ items: [], asSql: () => [], asHuman: () => [] });
    mocks.database.getExtensionVersions.mockResolvedValue([
      { name: DatabaseExtension.VectorChord, installedVersion: null, availableVersion: '0.2.0' },
    ]);
  });

  describe('migrate', () => {
    it('should run the migration sequence under the migrations lock without a Postgres version check', async () => {
      await sut.migrate();

      expect(mocks.database.withLock).toHaveBeenCalledWith(DatabaseLock.Migrations, expect.any(Function));
      expect(mocks.database.getPostgresVersion).not.toHaveBeenCalled();
      expect(mocks.database.createExtension).toHaveBeenCalledWith(DatabaseExtension.VectorChord);
      expect(mocks.database.reindexVectorsIfNeeded).toHaveBeenCalledWith([VectorIndex.Clip, VectorIndex.Face]);
      expect(mocks.database.runMigrations).toHaveBeenCalledTimes(1);
    });
  });

  describe('onBootstrap', () => {
    it('should call migrate after the version check passes', async () => {
      const migrate = vitest.spyOn(sut, 'migrate').mockResolvedValue();

      await sut.onBootstrap();

      expect(mocks.database.getPostgresVersion).toHaveBeenCalledTimes(1);
      expect(migrate).toHaveBeenCalledTimes(1);
    });

    it('should not call migrate when the version check fails', async () => {
      const migrate = vitest.spyOn(sut, 'migrate').mockResolvedValue();
      mocks.database.getPostgresVersion.mockResolvedValueOnce('13.10.0');

      await expect(sut.onBootstrap()).rejects.toThrow('Invalid PostgreSQL version');

      expect(migrate).not.toHaveBeenCalled();
    });
  });

  describe(DatabaseMigrateCommand.name, () => {
    it('should run DatabaseService.migrate', async () => {
      const migrate = vitest.spyOn(sut, 'migrate').mockResolvedValue();

      await new DatabaseMigrateCommand(sut).run();

      expect(migrate).toHaveBeenCalledTimes(1);
    });

    it('should be registered as an immich-admin command', () => {
      expect(commandsAndQuestions).toContain(DatabaseMigrateCommand);
    });
  });
});
