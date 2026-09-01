import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

// esbuild/tsup 8 currently rewrites an ESM `node:sqlite` import to the nonexistent
// `sqlite` package. Loading the built-in through createRequire keeps production
// bundles executable while preserving the native Node.js implementation.
const runtimeRequire = createRequire(import.meta.url);
const { DatabaseSync: NodeDatabaseSync } = runtimeRequire('node:sqlite') as typeof import('node:sqlite');

const migrations = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS guest_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        game_id TEXT NOT NULL CHECK (game_id IN ('gomoku', 'quoridor', 'twenty-four')),
        status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'paused', 'finished')),
        version INTEGER NOT NULL DEFAULT 0,
        round_no INTEGER NOT NULL DEFAULT 0,
        state_schema_version INTEGER NOT NULL DEFAULT 1,
        state_json TEXT,
        pause_reason TEXT CHECK (pause_reason IS NULL OR pause_reason IN ('disconnect', 'restart')),
        paused_remaining_ms INTEGER,
        restart_deadline_ms INTEGER,
        next_round_at_ms INTEGER,
        finish_reason TEXT,
        created_at_ms INTEGER NOT NULL,
        last_activity_ms INTEGER NOT NULL,
        cleanup_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS room_members (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
        session_id TEXT NOT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT,
        nickname TEXT NOT NULL,
        nickname_key TEXT NOT NULL,
        ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
        rematch_ready INTEGER NOT NULL DEFAULT 0 CHECK (rematch_ready IN (0, 1)),
        joined_at_ms INTEGER NOT NULL,
        disconnected_at_ms INTEGER,
        disconnect_deadline_ms INTEGER,
        disconnect_order INTEGER,
        restart_rejoined_at_ms INTEGER,
        PRIMARY KEY (room_id, seat),
        UNIQUE (room_id, session_id),
        UNIQUE (room_id, nickname_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS processed_actions (
        session_id TEXT NOT NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
        action_id TEXT NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        request_hash TEXT NOT NULL,
        expected_version INTEGER NOT NULL,
        outcome_json TEXT NOT NULL,
        resulting_version INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (session_id, action_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON guest_sessions(expires_at_ms);
      CREATE INDEX IF NOT EXISTS idx_rooms_cleanup ON rooms(status, cleanup_at_ms);
      CREATE INDEX IF NOT EXISTS idx_members_session ON room_members(session_id);
      CREATE INDEX IF NOT EXISTS idx_members_disconnect ON room_members(disconnect_deadline_ms);
      CREATE INDEX IF NOT EXISTS idx_actions_room ON processed_actions(room_id);
    `,
  },
  {
    version: 2,
    name: 'server_runtime_heartbeat',
    sql: `
      CREATE TABLE IF NOT EXISTS server_runtime (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        heartbeat_at_ms INTEGER NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: 'room_messages',
    sql: `
      CREATE TABLE IF NOT EXISTS room_messages (
        sequence INTEGER PRIMARY KEY,
        message_id TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        sender_session_id TEXT NOT NULL,
        seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
        nickname TEXT NOT NULL,
        content TEXT NOT NULL,
        sent_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_room_messages_room_sequence
        ON room_messages(room_id, sequence);
    `,
  },
] as const;

export class GameHallDatabase {
  readonly raw: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.raw = new NodeDatabaseSync(databasePath, { timeout: 5_000 });
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  transaction<T>(operation: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    if (this.raw.isOpen) this.raw.close();
  }

  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at_ms INTEGER NOT NULL
      ) STRICT;
    `);
    const applied = this.raw.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
    const versions = new Set(applied.map((row) => row.version));
    for (const migration of migrations) {
      if (versions.has(migration.version)) continue;
      this.transaction(() => {
        this.raw.exec(migration.sql);
        this.raw.prepare('INSERT INTO schema_migrations(version, name, applied_at_ms) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, Date.now());
      });
    }
    this.raw.exec('PRAGMA optimize;');
  }
}
