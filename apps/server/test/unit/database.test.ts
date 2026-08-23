import { describe, expect, it } from 'vitest';
import { GameHallDatabase } from '../../src/database';

describe('GameHallDatabase', () => {
  it('启用 WAL、外键并只执行一次版本迁移', () => {
    const database = new GameHallDatabase(':memory:');
    try {
      expect((database.raw.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('memory');
      expect((database.raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
      expect(database.raw.prepare('SELECT version, name FROM schema_migrations').all()).toEqual([
        { version: 1, name: 'initial_schema' },
        { version: 2, name: 'server_runtime_heartbeat' },
      ]);
      expect(database.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='server_runtime'").get()).toEqual({ name: 'server_runtime' });
    } finally {
      database.close();
    }
  });
});
