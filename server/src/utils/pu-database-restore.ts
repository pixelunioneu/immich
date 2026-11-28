import { ForbiddenException } from '@nestjs/common';
import { MaintenanceAction } from 'src/enum.js';

/**
PixelUnion: database backup upload and restore are disabled.

A restore pipes an uploaded SQL file into `psql`, which also executes psql
meta-commands, so anyone able to upload and restore a backup can run arbitrary
commands inside the server container. On a hosted deployment the database is
managed by the operator, so upload and restore are refused outright, even if a
request makes it past the route guard. Scheduled `pg_dump` backups, listing,
downloading and deleting backups are unaffected.
*/
export const DATABASE_RESTORE_DISABLED_MESSAGE = 'Database backup upload and restore are disabled on this server';

// Rollback (upstream v3.4, FUTO Backups) restores a snapshot and then the database, so it is
// refused the same way. FUTO Backups itself is not part of this server.
const DATABASE_RESTORE_ACTIONS = new Set<MaintenanceAction | undefined>([
  MaintenanceAction.RestoreDatabase,
  MaintenanceAction.SelectDatabaseRestore,
  MaintenanceAction.Rollback,
]);

export const isDatabaseRestoreAction = (action?: MaintenanceAction): boolean => DATABASE_RESTORE_ACTIONS.has(action);

export const refuseDatabaseRestore = (): never => {
  throw new ForbiddenException(DATABASE_RESTORE_DISABLED_MESSAGE);
};

export const assertNotDatabaseRestoreAction = (action?: MaintenanceAction): void => {
  if (isDatabaseRestoreAction(action)) {
    refuseDatabaseRestore();
  }
};
