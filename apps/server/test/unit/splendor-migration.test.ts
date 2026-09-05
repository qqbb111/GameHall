import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGomokuState, createQuoridorState, createTwentyFourState } from '@gamehall/game-core';
import { afterEach, describe, expect, it } from 'vitest';
import { GameHallDatabase } from '../../src/database';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const dirs: string[] = [];
const tables = ['rooms', 'room_members', 'room_messages', 'processed_actions', 'guest_sessions'] as const;
const states = [createGomokuState(1), createQuoridorState(0), createTwentyFourState([{ id: 0, suit: 'S', rank: 1 }, { id: 1, suit: 'S', rank: 2 }, { id: 2, suit: 'S', rank: 3 }, { id: 3, suit: 'S', rank: 4 }], '1*2*3*4', 1000)];
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gamehall-v3-')); dirs.push(dir);
  const file = path.join(dir, 'v3.sqlite');
  const db = new DatabaseSync(file);
  // Frozen SQL from the repository's v3 release; independent of current migrations.
  db.exec(readFileSync(new URL('../fixtures/v3.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys=ON');
  for (const [index, state] of states.entries()) {
    const id = `room-${index}`;
    db.prepare(`INSERT INTO rooms(id,code,game_id,status,version,round_no,state_schema_version,state_json,created_at_ms,last_activity_ms,cleanup_at_ms) VALUES(?,?,?,'active',7,1,?,?,1000,1000,9000000)`)
      .run(id, `ABCD${index}X`, state.kind, state.kind === 'twenty-four' ? 2 : 1, JSON.stringify(state));
    for (const seat of [0, 1]) {
      const session = `${id}-${seat}`;
      db.prepare('INSERT INTO guest_sessions VALUES (?,?,1000,1000,9000000)').run(session, `hash-${session}`);
      db.prepare('INSERT INTO room_members(room_id,seat,session_id,nickname,nickname_key,joined_at_ms) VALUES(?,?,?,?,?,1000)').run(id, seat, session, `旧玩家${seat}`, `player-${seat}`);
    }
    db.prepare('INSERT INTO room_messages(message_id,room_id,sender_session_id,seat,nickname,content,sent_at_ms) VALUES(?,?,?,1,?,?,1001)').run(`message-${index}`, id, `${id}-1`, '旧玩家1', '保留旧消息');
    db.prepare('INSERT INTO processed_actions VALUES(?,?,?,?,7,?,8,1001)').run(`${id}-0`, `action-${index}`, id, 'original-hash', JSON.stringify({ ok: true, roomId: id, version: 8 }));
  }
  const before = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  db.close();
  return { file, before };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('SQLite v3 → v4 file upgrade', () => {
  it('保留全部旧游戏、成员、消息、回执、索引和外键，重复启动不再迁移', () => {
    const { file, before } = fixture();
    for (let startup = 0; startup < 2; startup++) {
      const db = new GameHallDatabase(file);
      try {
        for (const table of tables) {
          const rows = db.raw.prepare(`SELECT * FROM ${table}`).all();
          if (table === 'rooms') expect(rows).toEqual(before[table]!.map((row) => ({ ...row, host_seat: 0 })));
          else expect(rows).toEqual(before[table]);
        }
        expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(db.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
        expect(db.raw.prepare('SELECT MAX(version) AS version, COUNT(*) AS count FROM schema_migrations').get()).toEqual({ version: 4, count: 4 });
        expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all()).toHaveLength(6);
        const rooms = db.raw.prepare('SELECT state_json FROM rooms ORDER BY id').all() as { state_json: string }[];
        expect(rooms.map((room) => JSON.parse(room.state_json))).toEqual(states);
        expect(() => db.raw.prepare('UPDATE room_members SET seat=4 WHERE seat=1').run()).toThrow();
      } finally { db.close(); }
    }
  });

  it('在重建结束处注入失败，整次 v4 事务回滚并允许修复后重启', () => {
    const { file, before } = fixture();
    const original = new DatabaseSync(file);
    original.exec("CREATE TRIGGER reject_v4 BEFORE INSERT ON schema_migrations WHEN NEW.version=4 BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END;"); original.close();
    expect(() => new GameHallDatabase(file)).toThrow('injected migration failure');
    const rolledBack = new DatabaseSync(file);
    try {
      for (const table of tables) expect(rolledBack.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[table]);
      expect(rolledBack.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 3 });
      expect(rolledBack.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%v4_backup'").all()).toEqual([]);
      expect(rolledBack.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(() => rolledBack.prepare('UPDATE room_members SET seat=2 WHERE seat=1').run()).toThrow();
      rolledBack.exec('DROP TRIGGER reject_v4');
    } finally { rolledBack.close(); }
    const repaired = new GameHallDatabase(file); repaired.close();
  });
});
