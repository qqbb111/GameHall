import { loadConfig } from './config';
import { GameHallDatabase } from './database';

const config = loadConfig();
const database = new GameHallDatabase(config.databasePath);

try {
  const applied = database.raw.prepare('SELECT version, name, applied_at_ms FROM schema_migrations ORDER BY version').all();
  console.log(JSON.stringify({ level: 'info', event: 'database_migrated', databasePath: config.databasePath, migrations: applied }));
} finally {
  database.close();
}
