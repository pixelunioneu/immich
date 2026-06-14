import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "pixelunion_session_token" ADD "updateId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(db);
  await sql`CREATE INDEX "IDX_pixelunion_session_token_update_id" ON "pixelunion_session_token" ("updateId")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "IDX_pixelunion_session_token_update_id";`.execute(db);
  await sql`ALTER TABLE "pixelunion_session_token" DROP COLUMN "updateId";`.execute(db);
}
