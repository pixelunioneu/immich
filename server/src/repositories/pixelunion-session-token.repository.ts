import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB } from 'src/schema';
import { asUuid } from 'src/utils/database';

@Injectable()
export class PixelUnionSessionTokenRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  get(sessionId: string) {
    return this.db
      .selectFrom('pixelunion_session_token')
      .select('keycloakRefreshToken')
      .where('sessionId', '=', asUuid(sessionId))
      .executeTakeFirst();
  }

  upsert(sessionId: string, keycloakRefreshToken: Buffer) {
    return this.db
      .insertInto('pixelunion_session_token')
      .values({ sessionId, keycloakRefreshToken })
      .onConflict((oc) => oc.column('sessionId').doUpdateSet({ keycloakRefreshToken }))
      .execute();
  }

  delete(sessionId: string) {
    return this.db.deleteFrom('pixelunion_session_token').where('sessionId', '=', asUuid(sessionId)).execute();
  }
}
