import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  Table,
  type Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { SessionTable } from 'src/schema/tables/session.table.js';

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

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
