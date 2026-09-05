import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canAffordSplendorCard, createSplendorState, gemColors, tokenColors, type SplendorState, type SplendorView, type TokenCounts } from '@gamehall/game-core';
import type { CommandAck, GameActionCommand } from '@gamehall/protocol';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import { TEST_ORIGIN, createPeer, createRoom, gameAction, joinRoom, leaveRoom, reconnectPeer, sendMessage, setReady, waitFor, type TestPeer } from '../helpers';

const servers: RunningGameHallServer[] = [];
const peers: TestPeer[] = [];
const dirs: string[] = [];
const zero = (): TokenCounts => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });
async function server(databasePath = ':memory:') {
  const running = await createGameHallServer({ databasePath, host: '127.0.0.1', port: 0, isProduction: false, isTest: true, publicOrigin: TEST_ORIGIN, allowedOrigins: new Set([TEST_ORIGIN]), webDistPath: path.resolve('test/missing-web-dist') }).start();
  servers.push(running); return running;
}
async function peer(running: RunningGameHallServer, cookie?: string) { const value = await createPeer(running.url, cookie); peers.push(value); return value; }
function read(running: RunningGameHallServer, roomId: string) {
  const row = running.database.raw.prepare('SELECT version,state_json,status,round_no FROM rooms WHERE id=?').get(roomId) as { version: number; state_json: string; status: string; round_no: number };
  return { ...row, state: JSON.parse(row.state_json) as SplendorState };
}
function command(who: TestPeer, event: 'room:start' | 'room:reopen', roomId: string, expectedVersion = who.room!.version, commandId = randomUUID()): Promise<CommandAck> {
  return new Promise((resolve) => who.socket.emit(event, { roomId, expectedVersion, commandId }, resolve));
}
async function lobby(running: RunningGameHallServer, count: number) {
  const players: TestPeer[] = [];
  for (let index = 0; index < count; index++) players.push(await peer(running));
  const created = await createRoom(players[0]!, '商人0', 'splendor');
  if (!created.ok || !created.roomId || !created.code) throw new Error('create failed');
  const { roomId, code } = created;
  for (let index = 1; index < count; index++) expect(await joinRoom(players[index]!, `商人${index}`, code)).toMatchObject({ ok: true });
  for (const player of players) expect(await setReady(player, roomId)).toMatchObject({ ok: true });
  await waitFor(() => players.every((player) => player.room?.members.every((member) => member.ready)));
  return { players, roomId, code };
}
async function start(running: RunningGameHallServer, count: number) {
  const room = await lobby(running, count);
  expect(await command(room.players[0]!, 'room:start', room.roomId)).toMatchObject({ ok: true });
  await waitFor(() => room.players.every((player) => player.room?.status === 'active' && player.game !== null));
  return room;
}
function privacy(players: TestPeer[], state: SplendorState) {
  for (const player of players) {
    const view = player.game!.view as SplendorView;
    expect(view).not.toHaveProperty('decks');
    for (const visible of view.players) {
      if (visible.seat === player.room!.mySeat) expect(visible.reserved).toEqual(state.players.find((item) => item.seat === visible.seat)!.reserved);
      else expect(visible).not.toHaveProperty('reserved');
    }
    for (const hidden of [...Object.values(state.decks).flat(), ...state.players.filter((item) => item.seat !== player.room!.mySeat).flatMap((item) => item.reserved)]) expect(JSON.stringify(view)).not.toContain(`"${hidden.id}"`);
  }
}
afterEach(async () => {
  for (const player of peers.splice(0)) player.socket.disconnect();
  for (const running of servers.splice(0).reverse()) await running.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('Splendor real clients', () => {
  it('准备不自动开局、房主权限、第五人拒绝、开始和重开命令幂等与跨局过期请求', async () => {
    const running = await server(); const { players, roomId, code } = await lobby(running, 4); const host = players[0]!;
    expect(host.room!.status).toBe('waiting');
    const outsider = await peer(running);
    expect(await joinRoom(outsider, '第五人', code)).toMatchObject({ ok: false, error: { code: 'ROOM_FULL' } });
    expect(await command(players[1]!, 'room:start', roomId)).toMatchObject({ ok: false, error: { code: 'HOST_ONLY' } });
    await setReady(players[2]!, roomId, false);
    expect(await command(host, 'room:start', roomId, read(running, roomId).version)).toMatchObject({ ok: false, error: { code: 'PLAYERS_NOT_READY' } });
    await setReady(players[2]!, roomId);
    const initialVersion = read(running, roomId).version; const id = randomUUID();
    const begun = await command(host, 'room:start', roomId, initialVersion, id);
    expect(begun).toMatchObject({ ok: true }); const initial = read(running, roomId);
    expect(await command(host, 'room:start', roomId, initialVersion, id)).toEqual(begun);
    expect(await command(host, 'room:start', roomId, initial.version, id)).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_REUSED' } });
    expect(read(running, roomId)).toEqual(initial);
    expect(await gameAction(host, roomId, initial.version, { type: 'resign' }, id)).toMatchObject({ ok: false, error: { code: 'ACTION_ID_REUSED' } });
    expect(await joinRoom(outsider, '第五人', code)).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_JOINABLE' } });
    const actor = players[initial.state.turn]!; const actionId = randomUUID();
    const action = { type: 'reserve', source: { kind: 'deck', tier: 3 } } as const;
    const reserved = await gameAction(actor, roomId, initial.version, action, actionId); expect(reserved.ok).toBe(true);
    expect(await gameAction(actor, roomId, initial.version, action, actionId)).toEqual(reserved);
    expect(await gameAction(actor, roomId, initial.version, action)).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    await waitFor(() => players.every((player) => player.game?.version === initial.version + 1)); privacy(players, read(running, roomId).state);
    expect(await gameAction(host, roomId, read(running, roomId).version, { type: 'resign' })).toMatchObject({ ok: true });
    await waitFor(() => players.every((player) => player.room?.status === 'finished')); privacy(players, read(running, roomId).state);
    expect(read(running, roomId).state.result).toMatchObject({ type: 'aborted', reason: 'resign' });
    expect(await createRoom(players[1]!, '另开', 'gomoku')).toMatchObject({ ok: false, error: { code: 'ALREADY_IN_ROOM' } });
    expect(await command(players[1]!, 'room:reopen', roomId)).toMatchObject({ ok: false, error: { code: 'HOST_ONLY' } });
    const endVersion = read(running, roomId).version; const reopenId = randomUUID();
    const reopened = await command(host, 'room:reopen', roomId, endVersion, reopenId); expect(reopened).toMatchObject({ ok: true, code });
    expect(await command(host, 'room:reopen', roomId, endVersion, reopenId)).toEqual(reopened);
    expect(read(running, roomId).state).toBeNull();
    for (const player of players) await setReady(player, roomId);
    await command(host, 'room:start', roomId, read(running, roomId).version);
    const second = read(running, roomId); expect(second.round_no).toBe(2); expect(second.state.decks).not.toEqual(initial.state.decks);
    expect(await command(host, 'room:start', roomId, initialVersion, id)).toEqual(begun);
    expect(await command(host, 'room:reopen', roomId, endVersion, reopenId)).toEqual(reopened);
    expect(await gameAction(actor, roomId, initial.version, action, actionId)).toEqual(reserved);
    expect(read(running, roomId)).toEqual(second);
  });

  it.each([2, 3, 4] as const)('%i 个真实客户端从初始状态完整玩到十五分结算', async (count) => {
    const running = await server(); const { players, roomId } = await start(running, count);
    // Reproducible legal opening deals keep the test driver independent of luck.
    // Production shuffle/first-player selection is exercised by the lifecycle test.
    let seed = count;
    const opening = createSplendorState({ playerCount: count, rng: () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; } });
    running.database.raw.prepare('UPDATE rooms SET state_json=? WHERE id=?').run(JSON.stringify(opening), roomId);
    for (let turn = 0; turn < 500; turn++) {
      const { state, version } = read(running, roomId); if (state.result) break;
      const me = state.players.find((item) => item.seat === state.turn)!;
      let action: GameActionCommand['action'];
      if (state.phase === 'return-tokens') {
        let extra = tokenColors.reduce((sum, color) => sum + me.tokens[color], 0) - 10; const tokens = zero();
        for (const color of tokenColors) { tokens[color] = Math.min(extra, me.tokens[color]); extra -= tokens[color]; }
        action = { type: 'returnTokens', tokens };
      } else if (state.phase === 'choose-noble') action = { type: 'chooseNoble', nobleId: state.nobles.find((noble) => gemColors.every((color) => me.bonuses[color] >= noble.requirement[color]))!.id };
      else {
        const card = [...me.reserved, ...Object.values(state.market).flat()].filter((item) => canAffordSplendorCard(me, item)).sort((a, b) => b.points - a.points)[0];
        if (card) {
          const payment = zero(); for (const color of gemColors) { const need = Math.max(0, card.cost[color] - me.bonuses[color]); payment[color] = Math.min(need, me.tokens[color]); payment.gold += need - payment[color]; }
          action = { type: 'purchase', source: me.reserved.includes(card) ? { kind: 'reserved', cardId: card.id } : { kind: 'market', tier: card.tier, cardId: card.id }, payment };
        } else {
          const colors = gemColors.filter((color) => state.supply[color] > 0).sort((a, b) => me.tokens[a] - me.tokens[b]).slice(0, 3);
          const reservable = Object.values(state.market).flat()[0];
          action = colors.length ? { type: 'takeTokens', colors } : me.reserved.length < 3 && reservable ? { type: 'reserve', source: { kind: 'market', tier: reservable.tier, cardId: reservable.id } } : { type: 'pass' };
        }
      }
      const ack = await gameAction(players[state.turn]!, roomId, version, action);
      expect(ack, JSON.stringify({ turn, action, ack })).toMatchObject({ ok: true });
    }
    const final = read(running, roomId); expect(final.state.result?.type).toBe('completed');
    await waitFor(() => players.every((player) => player.game?.version === final.version)); privacy(players, final.state);
  });

  it('房主离开交接，空座循环行动，中止后同码补人且旧消息不会认错发送者', async () => {
    const running = await server(); const { players, roomId, code } = await lobby(running, 4);
    await sendMessage(players[0]!, roomId, '旧房主消息');
    expect(await leaveRoom(players[0]!, roomId)).toMatchObject({ ok: true });
    await leaveRoom(players[2]!, roomId);
    await waitFor(() => players[1]!.room?.hostSeat === 1 && players[1]!.room.members.length === 2);
    expect(await command(players[1]!, 'room:start', roomId)).toMatchObject({ ok: true });
    const state = read(running, roomId); expect(state.state.players.map((item) => item.seat)).toEqual([1, 3]);
    expect(await gameAction(players[state.state.turn]!, roomId, state.version, { type: 'takeTokens', colors: ['white', 'blue', 'red'] })).toMatchObject({ ok: true });
    expect([1, 3]).toContain(read(running, roomId).state.turn);
    expect(read(running, roomId).state.turn).not.toBe(state.state.turn);
    await leaveRoom(players[1]!, roomId);
    await waitFor(() => players[3]!.room?.status === 'finished' && players[3]!.room.hostSeat === 3);
    expect(read(running, roomId).state.result).toMatchObject({ type: 'aborted', reason: 'leave' });
    await command(players[3]!, 'room:reopen', roomId);
    const newcomer = await peer(running); await joinRoom(newcomer, '新商人', code);
    await waitFor(() => newcomer.messages.length === 1);
    expect(newcomer.room!.mySeat).toBe(0); expect(newcomer.messages[0]).toMatchObject({ seat: 0, isMine: false, nickname: '商人0' });
    await setReady(newcomer, roomId); await setReady(players[3]!, roomId);
    expect(await command(players[3]!, 'room:start', roomId, read(running, roomId).version)).toMatchObject({ ok: true });
  });

  it('任一人断线暂停全桌，全员恢复才继续；六十秒截止后中止并交接离线房主', async () => {
    const running = await server(); const { players, roomId } = await start(running, 3); const [host, guest, third] = players as [TestPeer, TestPeer, TestPeer];
    host.socket.disconnect(); guest.socket.disconnect();
    await waitFor(() => third.room?.status === 'paused' && third.room.members.filter((item) => !item.online).length === 2);
    expect(await gameAction(third, roomId, third.room!.version, { type: 'takeTokens', colors: ['white', 'blue', 'red'] })).toMatchObject({ ok: false, error: { code: 'ROOM_PAUSED' } });
    await reconnectPeer(guest); await waitFor(() => third.room!.members.find((item) => item.seat === 1)!.online);
    expect(third.room!.status).toBe('paused');
    await reconnectPeer(host); await waitFor(() => third.room!.status === 'active');
    host.socket.disconnect(); await waitFor(() => third.room!.status === 'paused');
    running.database.raw.prepare('UPDATE room_members SET disconnect_deadline_ms=? WHERE room_id=? AND seat=0').run(Date.now() - 1, roomId);
    running.roomService.sweep();
    await waitFor(() => third.room!.status === 'finished' && third.room!.hostSeat === 1);
    expect(read(running, roomId).state.result).toMatchObject({ type: 'aborted', reason: 'disconnect' });
    expect(read(running, roomId).state.result).not.toHaveProperty('winners');
    await command(guest, 'room:reopen', roomId, read(running, roomId).version);
    expect(running.database.raw.prepare('SELECT seat FROM room_members WHERE room_id=? ORDER BY seat').all(roomId)).toEqual([{ seat: 1 }, { seat: 2 }]);
  });

  it.each(['action', 'return-tokens', 'choose-noble'] as const)('%s 阶段普通重连和文件数据库重启保持必选状态及私牌', async (phase) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'splendor-restart-')); dirs.push(dir); const file = path.join(dir, 'game.sqlite');
    let running = await server(file); const { players, roomId } = await start(running, 2);
    const initial = read(running, roomId); const actor = players[initial.state.turn]!;
    await gameAction(actor, roomId, initial.version, { type: 'reserve', source: { kind: 'deck', tier: 3 } });
    const scenario = read(running, roomId).state; scenario.turn = 0; scenario.phase = phase;
    if (phase === 'return-tokens') scenario.players[0]!.tokens = { white: 3, blue: 2, green: 2, red: 2, black: 2, gold: 0 };
    if (phase === 'choose-noble') scenario.players[0]!.bonuses = { white: 4, blue: 4, green: 4, red: 4, black: 4 };
    running.database.raw.prepare('UPDATE rooms SET state_json=? WHERE id=?').run(JSON.stringify(scenario), roomId);
    players[0]!.socket.disconnect(); await waitFor(() => players[1]!.room?.status === 'paused');
    await reconnectPeer(players[0]!); await waitFor(() => players[1]!.room?.status === 'active');
    expect(read(running, roomId).state).toEqual(scenario);
    await running.close(); servers.splice(servers.indexOf(running), 1);
    running = await server(file);
    const returning = await peer(running, players[0]!.cookie);
    await waitFor(() => returning.room?.status === 'paused'); expect(returning.room!.pauseReason).toBe('restart');
    const second = await peer(running, players[1]!.cookie);
    await waitFor(() => returning.room?.status === 'active' && second.room?.status === 'active');
    expect(read(running, roomId).state).toEqual(scenario); privacy([returning, second], scenario);
    const action: GameActionCommand['action'] = phase === 'return-tokens' ? { type: 'returnTokens', tokens: { ...zero(), white: 1 } } : phase === 'choose-noble' ? { type: 'chooseNoble', nobleId: scenario.nobles[0]!.id } : { type: 'takeTokens', colors: ['white', 'blue', 'red'] };
    expect(await gameAction(returning, roomId, read(running, roomId).version, action)).toMatchObject({ ok: true });
    expect(read(running, roomId).state.turn).toBe(1);
  });

  it('重启十分钟窗口超时中止，无赢家，并由已回来的在线成员接任', async () => {
    const running = await server(); const { players, roomId } = await start(running, 2);
    players[0]!.socket.disconnect(); await waitFor(() => players[1]!.room?.status === 'paused');
    running.roomService.recoverAfterRestart(Date.now() - 600_001);
    running.roomService.sweep(); await waitFor(() => players[1]!.room?.status === 'finished');
    expect(read(running, roomId).state.result).toMatchObject({ type: 'aborted', reason: 'restart_timeout' });
    expect(players[1]!.room!.hostSeat).toBe(1);
  });

  it('状态写入后回执插入失败会回滚整个行动和开局事务', async () => {
    const running = await server(); const { players, roomId } = await lobby(running, 2);
    running.database.raw.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON processed_actions BEGIN SELECT RAISE(ABORT, 'receipt failure'); END;");
    const before = read(running, roomId);
    expect(() => running.roomService.startRoom(players[0]!.session.sessionId, { commandId: randomUUID(), roomId, expectedVersion: before.version })).toThrow('receipt failure');
    expect(read(running, roomId)).toEqual(before);
    running.database.raw.exec('DROP TRIGGER fail_receipt');
    await command(players[0]!, 'room:start', roomId, before.version);
    const initial = read(running, roomId);
    running.database.raw.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON processed_actions BEGIN SELECT RAISE(ABORT, 'receipt failure'); END;");
    expect(() => running.roomService.applyGameAction(players[initial.state.turn]!.session.sessionId, { actionId: randomUUID(), roomId, expectedVersion: initial.version, action: { type: 'reserve', source: { kind: 'deck', tier: 3 } } })).toThrow('receipt failure');
    expect(read(running, roomId)).toEqual(initial);
  });

  it('同一版本的并发开局和动作只有一个生效', async () => {
    const running = await server(); const { players, roomId } = await lobby(running, 2);
    const version = read(running, roomId).version;
    const starts = await Promise.all([command(players[0]!, 'room:start', roomId, version), command(players[0]!, 'room:start', roomId, version)]);
    expect(starts.filter((ack) => ack.ok)).toHaveLength(1);
    expect(read(running, roomId).round_no).toBe(1);
    const initial = read(running, roomId);
    const actions = await Promise.all([1, 2].map(() => gameAction(players[initial.state.turn]!, roomId, initial.version, { type: 'reserve', source: { kind: 'deck', tier: 3 } })));
    expect(actions.filter((ack) => ack.ok)).toHaveLength(1);
    expect(read(running, roomId).version).toBe(initial.version + 1);
    expect(read(running, roomId).state.players.find((player) => player.seat === initial.state.turn)!.reserved).toHaveLength(1);
  });
});
