import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GameHallDatabase } from '../../src/database';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const dirs: string[] = [];
const tables = ['rooms', 'room_members', 'processed_actions', 'room_messages'] as const;

function v5Fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gamehall-v5-')); dirs.push(dir);
  const file = path.join(dir, 'v5.sqlite');
  const db = new DatabaseSync(file);
  // Frozen v5 constraints and column order, independent of the migration being tested.
  db.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at_ms INTEGER NOT NULL) STRICT;
    INSERT INTO schema_migrations VALUES(1,'initial_schema',1),(2,'server_runtime_heartbeat',1),(3,'room_messages',1),(4,'splendor_multiplayer_rooms',1),(5,'texas_holdem_rooms',1);
    CREATE TABLE guest_sessions(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,created_at_ms INTEGER NOT NULL,last_seen_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL) STRICT;
    CREATE TABLE server_runtime(singleton INTEGER PRIMARY KEY CHECK(singleton=1),heartbeat_at_ms INTEGER NOT NULL) STRICT;
    CREATE TABLE rooms(
      id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,
      game_id TEXT NOT NULL CHECK(game_id IN ('gomoku','quoridor','twenty-four','splendor','texas-holdem')),
      status TEXT NOT NULL CHECK(status IN ('waiting','active','paused','finished')),
      version INTEGER NOT NULL DEFAULT 0,round_no INTEGER NOT NULL DEFAULT 0,state_schema_version INTEGER NOT NULL DEFAULT 1,
      state_json TEXT,pause_reason TEXT CHECK(pause_reason IS NULL OR pause_reason IN ('disconnect','restart')),
      paused_remaining_ms INTEGER,restart_deadline_ms INTEGER,next_round_at_ms INTEGER,finish_reason TEXT,
      host_seat INTEGER NOT NULL DEFAULT 0 CHECK(host_seat IN (0,1,2,3)),created_at_ms INTEGER NOT NULL,last_activity_ms INTEGER NOT NULL,cleanup_at_ms INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE room_members(
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,seat INTEGER NOT NULL CHECK(seat IN (0,1,2,3)),
      session_id TEXT NOT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT,nickname TEXT NOT NULL,nickname_key TEXT NOT NULL,
      ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1)),rematch_ready INTEGER NOT NULL DEFAULT 0 CHECK(rematch_ready IN (0,1)),
      joined_at_ms INTEGER NOT NULL,disconnected_at_ms INTEGER,disconnect_deadline_ms INTEGER,disconnect_order INTEGER,restart_rejoined_at_ms INTEGER,
      PRIMARY KEY(room_id,seat),UNIQUE(room_id,session_id),UNIQUE(room_id,nickname_key)
    ) STRICT;
    CREATE TABLE processed_actions(
      session_id TEXT NOT NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,action_id TEXT NOT NULL,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,request_hash TEXT NOT NULL,expected_version INTEGER NOT NULL,
      outcome_json TEXT NOT NULL,resulting_version INTEGER NOT NULL,created_at_ms INTEGER NOT NULL,PRIMARY KEY(session_id,action_id)
    ) STRICT;
    CREATE TABLE room_messages(
      sequence INTEGER PRIMARY KEY,message_id TEXT NOT NULL UNIQUE,room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_session_id TEXT NOT NULL,seat INTEGER NOT NULL CHECK(seat IN (0,1,2,3)),nickname TEXT NOT NULL,content TEXT NOT NULL,sent_at_ms INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX idx_sessions_expiry ON guest_sessions(expires_at_ms);
    CREATE INDEX idx_rooms_cleanup ON rooms(status,cleanup_at_ms);
    CREATE INDEX idx_members_session ON room_members(session_id);
    CREATE INDEX idx_members_disconnect ON room_members(disconnect_deadline_ms);
    CREATE INDEX idx_actions_room ON processed_actions(room_id);
    CREATE INDEX idx_room_messages_room_sequence ON room_messages(room_id,sequence);
  `);
  for (const game of ['splendor', 'texas-holdem']) {
    const state = JSON.stringify({ kind: game, privateReservedCard: 'L1-01', privateHoleCards: ['AS', 'KS'] });
    db.prepare('INSERT INTO rooms(id,code,game_id,status,version,round_no,state_json,host_seat,created_at_ms,last_activity_ms,cleanup_at_ms) VALUES(?,?,?,\'active\',12,3,?,3,1,2,9999)')
      .run(game, game === 'splendor' ? 'ABCD23' : 'ABCD24', game, state);
    for (let seat = 0; seat < 4; seat++) {
      const session = `${game}-${seat}`;
      db.prepare('INSERT INTO guest_sessions VALUES(?,?,?,?,?)').run(session, `hash-${session}`, 1, 2, 9999);
      db.prepare('INSERT INTO room_members(room_id,seat,session_id,nickname,nickname_key,joined_at_ms) VALUES(?,?,?,?,?,1)')
        .run(game, seat, session, `玩家${seat}`, `player-${seat}`);
    }
    db.prepare('INSERT INTO processed_actions VALUES(?,?,?,?,?,?,?,?)').run(`${game}-3`, `action-${game}`, game, 'hash', 11, '{"ok":true}', 12, 3);
    db.prepare('INSERT INTO room_messages(message_id,room_id,sender_session_id,seat,nickname,content,sent_at_ms) VALUES(?,?,?,3,?,?,3)')
      .run(`message-${game}`, game, `${game}-3`, '玩家3', '第四位的消息');
  }
  const before = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  db.close();
  return { file, before };
}

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('SQLite v5 → v6 board game upgrade', () => {
  it('保留四人桌及私有状态、消息和幂等回执，并开放新游戏约束', () => {
    const { file, before } = v5Fixture();
    for (let start = 0; start < 2; start++) {
      const db = new GameHallDatabase(file);
      try {
        for (const table of tables) expect(db.raw.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[table]);
        expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(db.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
        expect(db.raw.prepare('SELECT MAX(version) AS version,COUNT(*) AS count FROM schema_migrations').get()).toEqual({ version: 6, count: 6 });
        db.raw.prepare("INSERT OR IGNORE INTO rooms(id,code,game_id,status,created_at_ms,last_activity_ms,cleanup_at_ms) VALUES('new-game','ZZZZZZ','dots-and-boxes','waiting',1,1,9)").run();
        expect(db.raw.prepare("SELECT game_id FROM rooms WHERE id='new-game'").get()).toEqual({ game_id: 'dots-and-boxes' });
        db.raw.prepare("DELETE FROM rooms WHERE id='new-game'").run();
      } finally { db.close(); }
    }
  });

  it('v6 中断时回滚所有表，移除失败注入后可重启', () => {
    const { file, before } = v5Fixture();
    const original = new DatabaseSync(file);
    original.exec("CREATE TRIGGER reject_v6 BEFORE INSERT ON schema_migrations WHEN NEW.version=6 BEGIN SELECT RAISE(ABORT,'injected v6 failure'); END;");
    original.close();
    expect(() => new GameHallDatabase(file)).toThrow('injected v6 failure');
    const rolledBack = new DatabaseSync(file);
    try {
      for (const table of tables) expect(rolledBack.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[table]);
      expect(rolledBack.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 5 });
      expect(rolledBack.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%v6_backup'").all()).toEqual([]);
      rolledBack.exec('DROP TRIGGER reject_v6');
    } finally { rolledBack.close(); }
    const repaired = new GameHallDatabase(file);
    expect(repaired.raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 6 });
    repaired.close();
  });
});
