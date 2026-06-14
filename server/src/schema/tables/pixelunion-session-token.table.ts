import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp, UpdateDateColumn } from '@immich/sql-tools';
import { UpdatedAtTrigger } from 'src/decorators';
import { SessionTable } from 'src/schema/tables/session.table';

@Table('pixelunion_session_token')
@UpdatedAtTrigger('pixelunion_session_token_updatedAt')
export class PixelUnionSessionTokenTable {
  @ForeignKeyColumn(() => SessionTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  sessionId!: string;

  @Column({ type: 'bytea' })
  keycloakRefreshToken!: Buffer;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}
