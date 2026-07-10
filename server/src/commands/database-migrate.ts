import { Command, CommandRunner } from 'nest-commander';
import { DatabaseService } from 'src/services/database.service';

@Command({
  name: 'db-migrate',
  description: 'Run database extension setup, vector index reindexing, and schema migrations',
})
export class DatabaseMigrateCommand extends CommandRunner {
  constructor(private databaseService: DatabaseService) {
    super();
  }

  async run(): Promise<void> {
    await this.databaseService.migrate();
  }
}
