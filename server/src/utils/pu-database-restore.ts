import { ForbiddenException } from '@nestjs/common';
import { MaintenanceAction } from 'src/enum.js';

/**
 * PixelUnion: database backup upload and restore are disabled.
 *
 * A restore pipes an uploaded SQL file into `psql`, which also executes psql
 * meta-commands, so anyone able to upload and restore a backup can run arbitrary
 * commands inside the server container. On a hosted deployment the database is
 * managed by the operator, so upload and restore are refused outright, even if a
 * request makes it past the route guard. Scheduled `pg_dump` backups, listing,
 * downloading and deleting backups are unaffected.
 */
export const DATABASE_RESTORE_DISABLED_MESSAGE = 'Database backup upload and restore are disabled on this server';

export const isDatabaseRestoreAction = (action?: MaintenanceAction): boolean =>
  action === MaintenanceAction.RestoreDatabase || action === MaintenanceAction.SelectDatabaseRestore;

export const refuseDatabaseRestore = (): never => {
  throw new ForbiddenException(DATABASE_RESTORE_DISABLED_MESSAGE);
};

export const assertNotDatabaseRestoreAction = (action?: MaintenanceAction): void => {
  if (isDatabaseRestoreAction(action)) {
    refuseDatabaseRestore();
  }
};
