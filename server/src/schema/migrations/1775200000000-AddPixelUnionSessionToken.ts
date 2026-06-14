import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "pixelunion_session_token" (
  "sessionId" uuid NOT NULL,
  "keycloakRefreshToken" bytea NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pixelunion_session_token_pkey" PRIMARY KEY ("sessionId"),
  CONSTRAINT "pixelunion_session_token_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "pixelunion_session_token_updatedAt"
  BEFORE UPDATE ON "pixelunion_session_token"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_pixelunion_session_token_updatedAt', '{"type":"trigger","name":"pixelunion_session_token_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"pixelunion_session_token_updatedAt\\"\\n  BEFORE UPDATE ON \\"pixelunion_session_token\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER "pixelunion_session_token_updatedAt" ON "pixelunion_session_token";`.execute(db);
  await sql`DROP TABLE "pixelunion_session_token";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_pixelunion_session_token_updatedAt';`.execute(db);
}
