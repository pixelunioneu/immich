import {
  app,
  asBearerAuth,
  closeDb,
  containers,
  db,
  dockerExec,
  LoginResponse,
  loginWithOAuth,
  OAuthAdmin,
  readRepoFile,
  run,
  waitFor,
} from 'src/pu/helpers.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The server logs this when it refuses a restore (server/src/utils/pu-database-restore.ts).
const DATABASE_RESTORE_DISABLED_MESSAGE = /DATABASE_RESTORE_DISABLED_MESSAGE\s*=\s*'([^']+)'/.exec(
  readRepoFile('server/src/utils/pu-database-restore.ts'),
)![1];

const expectNotFound = (response: request.Response) => {
  expect(response.status).toBe(404);
  expect(response.body).toEqual(expect.objectContaining({ message: 'Not Found' }));
};

const isServing = async (accessToken: string) => {
  try {
    const { status } = await request(app).get('/users/me').set(asBearerAuth(accessToken));
    return status === 200;
  } catch {
    return false;
  }
};

const leaveMaintenanceMode = async (accessToken: string) => {
  const client = await db();
  await client.query(`DELETE FROM "system_metadata" WHERE "key" = 'maintenance-mode'`);
  await run('docker', ['restart', containers.server]);
  await waitFor('the server to leave maintenance mode', () => isServing(accessToken));
};

const userCount = async () => {
  const client = await db();
  const { rows } = await client.query('SELECT count(*) FROM "user"');
  return Number(rows[0].count);
};

/**
 * Database upload and restore are disabled on the fork: a restore pipes an uploaded
 * file into psql. The HTTP entry points are all under blocked prefixes, and the
 * services refuse on their own as well, which the persisted-action test reaches.
 */
describe('PixelUnion database restore', () => {
  let admin: LoginResponse;

  beforeAll(async () => {
    admin = await loginWithOAuth(OAuthAdmin);
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('HTTP entry points', () => {
    it('refuses to start maintenance with a restore action', async () => {
      for (const dto of [
        { action: 'restore_database', restoreBackupFilename: 'immich-db-backup-pu-e2e.sql.gz' },
        { action: 'select_database_restore' },
      ]) {
        for (const path of ['/admin/maintenance', '/Admin/Maintenance/']) {
          expectNotFound(await request(app).post(path).set(asBearerAuth(admin.accessToken)).send(dto));
        }
      }
    });

    it('refuses to start the restore flow', async () => {
      expectNotFound(
        await request(app).post('/admin/database-backups/start-restore').set(asBearerAuth(admin.accessToken)),
      );
    });

    it('refuses a backup upload', async () => {
      const { status, body } = await request(app)
        .post('/admin/database-backups/upload')
        .set(asBearerAuth(admin.accessToken))
        .attach('file', Buffer.from('SELECT 1;\n'), 'immich-db-backup-pu-e2e.sql');
      expect(status).toBe(404);
      expect(body).toEqual(expect.objectContaining({ message: 'Not Found' }));
    });

    it('leaves the server out of maintenance mode', async () => {
      const { body } = await request(app).get('/admin/maintenance/status');
      expect(body).toEqual(expect.objectContaining({ active: false }));
    });
  });

  /**
   * A restore action stored in system metadata is picked up by the maintenance worker
   * when the server boots. No HTTP route leads there on the fork, so the test stores it
   * directly, restarts the server, and checks that the worker refuses it and the data
   * is still there. The CLI then takes the server out of maintenance mode.
   */
  describe('restore action persisted in system metadata', () => {
    afterAll(async () => {
      // Whatever happened above, hand the next spec a normal server.
      if (!(await isServing(admin.accessToken))) {
        await leaveMaintenanceMode(admin.accessToken);
      }
    });

    it('is refused by the maintenance worker on boot, and the CLI ends maintenance mode', async () => {
      const usersBefore = await userCount();

      const client = await db();
      await client.query(
        `INSERT INTO "system_metadata" ("key", "value") VALUES ('maintenance-mode', $1)
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`,
        [
          JSON.stringify({
            isMaintenanceMode: true,
            secret: 'pu-e2e-maintenance-secret',
            action: { action: 'restore_database', restoreBackupFilename: 'immich-db-backup-pu-e2e.sql.gz' },
          }),
        ],
      );
      await closeDb();

      // Container logs survive a restart, so only look at what this boot logs.
      const restartedAt = new Date();
      const restart = await run('docker', ['restart', containers.server]);
      expect(restart.exitCode).toBe(0);

      await waitFor('the maintenance worker to log the refusal', async () => {
        const logs = await run('docker', ['logs', '--since', restartedAt.toISOString(), containers.server]);
        return (logs.stdout + logs.stderr).includes(DATABASE_RESTORE_DISABLED_MESSAGE);
      });

      const status = await request(app).get('/admin/maintenance/status');
      expect(status.status).toBe(200);
      expect(status.body).toEqual(expect.objectContaining({ active: true }));

      const disable = await dockerExec(containers.server, ['immich-admin', 'disable-maintenance-mode']);
      expect(disable.stdout).toContain('Maintenance mode has been disabled.');

      await waitFor('the server to leave maintenance mode', () => isServing(admin.accessToken));
      expect(await userCount()).toBe(usersBefore);
    });
  });
});
