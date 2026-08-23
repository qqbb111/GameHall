import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { legalQuoridorMoves, type GomokuState, type QuoridorState, type QuoridorView, type TwentyFourState, type TwentyFourView } from '@gamehall/game-core';
import type { Reaction } from '@gamehall/protocol';
import { GameHallDatabase } from '../../src/database';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import {
  TEST_ORIGIN,
  createPeer,
  createRoom,
  gameAction,
  joinRoom,
  leaveRoom,
  reconnectPeer,
  rematch,
  sendReaction,
  setReady,
  startTwoPlayerRoom,
  waitFor,
  type TestPeer,
} from '../helpers';

const servers: RunningGameHallServer[] = [];
const peers: TestPeer[] = [];
const temporaryDirectories: string[] = [];

async function startServer(databasePath = ':memory:'): Promise<RunningGameHallServer> {
  const application = createGameHallServer({
    databasePath,
    host: '127.0.0.1',
    port: 0,
    isProduction: false,
    isTest: true,
    publicOrigin: TEST_ORIGIN,
    allowedOrigins: new Set([TEST_ORIGIN]),
    webDistPath: path.resolve('test', 'missing-web-dist'),
  });
  const running = await application.start();
  servers.push(running);
  return running;
}

function track<T extends readonly TestPeer[]>(...items: T): T {
  peers.push(...items);
  return items;
}

afterEach(async () => {
  for (const peer of peers.splice(0)) peer.socket.disconnect();
  for (const server of servers.splice(0).reverse()) await server.close();
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('GameHall realtime rooms', () => {
  it('两个真实客户端完成五子棋整局、幂等/乱序校验、表情和交换阵营复赛', async () => {
    const running = await startServer();
    const started = await startTwoPlayerRoom(running.url, 'gomoku');
    const [host, guest] = track(started.host, started.guest);
    const roomId = started.roomId;
    const initial = host.game!.view as GomokuState;
    const bySeat: Record<0 | 1, TestPeer> = { 0: host, 1: guest };
    const black = bySeat[initial.blackPlayer];
    const white = bySeat[initial.blackPlayer === 0 ? 1 : 0];
    let version = host.room!.version;

    const unacknowledgedReaction = new Promise<{ reaction: Reaction }>((resolve) => {
      guest.socket.once('reaction:received', resolve);
    });
    (host.socket as unknown as { emit: (event: string, payload: unknown) => void })
      .emit('reaction:send', { roomId, reaction: '👍' });
    await expect(unacknowledgedReaction).resolves.toMatchObject({ reaction: '👍' });
    expect((await fetch(`${running.url}/healthz`)).ok).toBe(true);

    const reactionReceived = new Promise<{ reaction: Reaction; nickname: string }>((resolve) => {
      guest.socket.once('reaction:received', resolve);
    });
    expect(await sendReaction(host, roomId, '👏')).toMatchObject({ ok: true });
    await expect(reactionReceived).resolves.toMatchObject({ reaction: '👏', nickname: '木纹棋手' });

    const firstActionId = randomUUID();
    const first = await gameAction(black, roomId, version, { type: 'place', row: 0, col: 0 }, firstActionId);
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) return;
    version = first.version!;
    expect(await gameAction(black, roomId, version - 1, { type: 'place', row: 0, col: 0 }, firstActionId)).toEqual(first);
    const storedAfterFirst = running.database.raw.prepare('SELECT version FROM rooms WHERE id=?').get(roomId) as { version: number };
    expect(storedAfterFirst.version).toBe(version);

    const stale = await gameAction(white, roomId, version - 1, { type: 'place', row: 1, col: 0 });
    expect(stale).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT', currentVersion: version } });

    for (let col = 0; col < 4; col += 1) {
      const whiteMove = await gameAction(white, roomId, version, { type: 'place', row: 1, col });
      expect(whiteMove).toMatchObject({ ok: true });
      if (!whiteMove.ok) return;
      version = whiteMove.version!;
      const blackMove = await gameAction(black, roomId, version, { type: 'place', row: 0, col: col + 1 });
      expect(blackMove).toMatchObject({ ok: true });
      if (!blackMove.ok) return;
      version = blackMove.version!;
    }

    await waitFor(() => host.room?.status === 'finished' && guest.room?.status === 'finished');
    const finished = host.game!.view as GomokuState;
    expect(finished.result).toEqual({ type: 'win', winner: initial.blackPlayer, reason: 'line' });
    expect(finished.winningLine).toHaveLength(5);

    expect(await rematch(host, roomId)).toMatchObject({ ok: true });
    expect(await rematch(guest, roomId)).toMatchObject({ ok: true });
    await waitFor(() => host.room?.status === 'active' && (host.game!.view as GomokuState).phase === 'playing');
    expect((host.game!.view as GomokuState).blackPlayer).toBe(initial.blackPlayer === 0 ? 1 : 0);
  });

  it('断线后暂停并可凭原 Cookie 恢复，超时后由服务器判负', async () => {
    const running = await startServer();
    const started = await startTwoPlayerRoom(running.url, 'gomoku');
    const [host, guest] = track(started.host, started.guest);

    running.database.raw.prepare('UPDATE rooms SET cleanup_at_ms=? WHERE id=?').run(Date.now() - 1, started.roomId);
    guest.socket.disconnect();
    await waitFor(() => host.room?.status === 'paused' && host.room.members.some((member) => member.seat === 1 && !member.online));
    expect(host.room?.pauseReason).toBe('disconnect');
    const pausedVersion = host.room!.version;

    await reconnectPeer(guest);
    await waitFor(() => host.room?.status === 'active' && guest.room?.status === 'active');
    expect(host.room!.version).toBeGreaterThan(pausedVersion);

    guest.socket.disconnect();
    await waitFor(() => host.room?.status === 'paused');
    const nowMs = Date.now();
    running.database.raw.prepare('UPDATE room_members SET disconnect_deadline_ms=? WHERE room_id=? AND seat=1')
      .run(nowMs - 1, started.roomId);
    await reconnectPeer(guest);
    await waitFor(() => host.room?.status === 'finished');
    expect((host.game!.view as GomokuState).result).toEqual({ type: 'win', winner: 0, reason: 'disconnect' });
  });

  it('等待开局与复赛都不会把离线玩家带入新局', async () => {
    const running = await startServer();
    const [host, guest] = track(await createPeer(running.url), await createPeer(running.url));
    const created = await createRoom(host, '先手', 'gomoku');
    expect(created).toMatchObject({ ok: true });
    if (!created.ok || !created.roomId || !created.code) return;
    expect(await joinRoom(guest, '后手', created.code)).toMatchObject({ ok: true });
    expect(await setReady(host, created.roomId)).toMatchObject({ ok: true });
    host.socket.disconnect();
    await waitFor(() => guest.room?.members.some((member) => member.seat === 0 && !member.online) === true);
    expect(guest.room?.members.find((member) => member.seat === 0)?.ready).toBe(false);
    expect(await setReady(guest, created.roomId)).toMatchObject({ ok: true });
    expect((running.database.raw.prepare('SELECT status FROM rooms WHERE id=?').get(created.roomId) as { status: string }).status).toBe('waiting');

    await reconnectPeer(host);
    await waitFor(() => host.room?.members.every((member) => member.online) === true);
    expect(await setReady(host, created.roomId)).toMatchObject({ ok: true });
    await waitFor(() => host.room?.status === 'active' && guest.room?.status === 'active');

    expect(await gameAction(host, created.roomId, host.room!.version, { type: 'resign' })).toMatchObject({ ok: true });
    await waitFor(() => host.room?.status === 'finished' && guest.room?.status === 'finished');
    expect(await rematch(host, created.roomId)).toMatchObject({ ok: true });
    host.socket.disconnect();
    await waitFor(() => guest.room?.members.some((member) => member.seat === 0 && !member.online) === true);
    expect(guest.room?.members.find((member) => member.seat === 0)?.rematchReady).toBe(false);
    expect(await rematch(guest, created.roomId)).toMatchObject({ ok: true });
    expect((running.database.raw.prepare('SELECT status FROM rooms WHERE id=?').get(created.roomId) as { status: string }).status).toBe('finished');

    await reconnectPeer(host);
    await waitFor(() => host.room?.members.every((member) => member.online) === true);
    expect(await rematch(host, created.roomId)).toMatchObject({ ok: true });
    await waitFor(() => host.room?.status === 'active' && guest.room?.status === 'active');
  });

  it('活跃房离开会判负并真正退出成员与推送范围', async () => {
    const running = await startServer();
    const started = await startTwoPlayerRoom(running.url, 'gomoku');
    const [host, guest] = track(started.host, started.guest);
    expect(await leaveRoom(guest, started.roomId)).toMatchObject({ ok: true });
    await waitFor(() => host.room?.status === 'finished' && host.room.members.length === 1);
    expect((host.game!.view as GomokuState).result).toEqual({ type: 'win', winner: 0, reason: 'leave' });
    expect(running.database.raw.prepare('SELECT COUNT(*) AS count FROM room_members WHERE room_id=?').get(started.roomId)).toEqual({ count: 1 });
    expect(await sendReaction(guest, started.roomId, '👍')).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
    guest.room = null;
    running.roomService.emitSnapshots(started.roomId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(guest.room).toBeNull();
    expect(await rematch(host, started.roomId)).toMatchObject({ ok: false, error: { code: 'REMATCH_UNAVAILABLE' } });
  });

  it('两个真实客户端完整走完路墙棋与 24 点五分赛，并覆盖墙、冷却和超时', async () => {
    const running = await startServer();
    const quoridor = await startTwoPlayerRoom(running.url, 'quoridor');
    const [qHost, qGuest] = track(quoridor.host, quoridor.guest);
    running.database.raw.prepare('UPDATE rooms SET cleanup_at_ms=? WHERE id=?').run(Date.now() - 1, quoridor.roomId);
    running.roomService.sweep();
    expect((running.database.raw.prepare('SELECT status FROM rooms WHERE id=?').get(quoridor.roomId) as { status: string }).status).toBe('active');
    const bySeat: Record<0 | 1, TestPeer> = { 0: qHost, 1: qGuest };
    const initialQuoridor = qHost.game!.view as QuoridorView;
    const wallActor = bySeat[initialQuoridor.turn];
    const wallPlaced = await gameAction(wallActor, quoridor.roomId, qHost.room!.version, {
      type: 'placeWall', row: 0, col: 0, orientation: 'H',
    });
    expect(wallPlaced).toMatchObject({ ok: true });
    if (!wallPlaced.ok) return;
    expect((JSON.parse((running.database.raw.prepare('SELECT state_json FROM rooms WHERE id=?').get(quoridor.roomId) as { state_json: string }).state_json) as QuoridorState).walls)
      .toContainEqual({ row: 0, col: 0, orientation: 'H' });
    const illegalRepeat = await gameAction(wallActor, quoridor.roomId, wallPlaced.version!, { type: 'move', row: 7, col: 4 });
    expect(illegalRepeat).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });

    let finalQuoridor: QuoridorState | null = null;
    for (let turn = 0; turn < 80; turn += 1) {
      const row = running.database.raw.prepare('SELECT version, state_json FROM rooms WHERE id=?').get(quoridor.roomId) as { version: number; state_json: string };
      const authoritative = JSON.parse(row.state_json) as QuoridorState;
      if (authoritative.phase === 'finished') {
        finalQuoridor = authoritative;
        break;
      }
      const actor = bySeat[authoritative.turn];
      const target = legalQuoridorMoves(authoritative, authoritative.turn)
        .sort((left, right) => Math.abs(left.row - authoritative.goalRows[authoritative.turn]) - Math.abs(right.row - authoritative.goalRows[authoritative.turn]))[0]!;
      const moved = await gameAction(actor, quoridor.roomId, row.version, { type: 'move', ...target });
      expect(moved).toMatchObject({ ok: true });
    }
    await waitFor(() => qHost.room?.status === 'finished');
    expect(finalQuoridor?.result).toMatchObject({ type: 'win', reason: 'goal' });

    const twentyFour = await startTwoPlayerRoom(running.url, 'twenty-four');
    const [tHost, tGuest] = track(twentyFour.host, twentyFour.guest);
    const publicView = tHost.game!.view as TwentyFourView;
    expect(publicView.solution).toBeNull();
    expect(publicView.cards).toHaveLength(4);
    const row = running.database.raw.prepare('SELECT state_json FROM rooms WHERE id=?').get(twentyFour.roomId) as { state_json: string };
    const authoritative = JSON.parse(row.state_json) as TwentyFourState;
    const expectedVersion = tHost.room!.version;
    const outcomes = await Promise.all([
      gameAction(tHost, twentyFour.roomId, expectedVersion, { type: 'submit', expression: authoritative.canonicalSolution }),
      gameAction(tGuest, twentyFour.roomId, expectedVersion, { type: 'submit', expression: authoritative.canonicalSolution }),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    await waitFor(() => (tHost.game!.view as TwentyFourView).phase === 'revealing');
    const revealed = tHost.game!.view as TwentyFourView;
    expect(revealed.scores[0] + revealed.scores[1]).toBe(1);
    expect(revealed.solution).toBe(authoritative.canonicalSolution);

    const firstScorer = revealed.roundOutcome?.winner;
    expect(firstScorer).not.toBeNull();
    if (firstScorer === null || firstScorer === undefined) return;
    const twentyFourBySeat: Record<0 | 1, TestPeer> = { 0: tHost, 1: tGuest };
    const scorer = twentyFourBySeat[firstScorer];
    const opponent = twentyFourBySeat[firstScorer === 0 ? 1 : 0];

    const advanceRound = async (): Promise<TwentyFourState> => {
      running.database.raw.prepare('UPDATE rooms SET next_round_at_ms=? WHERE id=?').run(Date.now() - 1, twentyFour.roomId);
      running.roomService.sweep();
      await waitFor(() => (tHost.game!.view as TwentyFourView).phase === 'answering');
      const nextRow = running.database.raw.prepare('SELECT state_json FROM rooms WHERE id=?').get(twentyFour.roomId) as { state_json: string };
      return JSON.parse(nextRow.state_json) as TwentyFourState;
    };

    let current = await advanceRound();
    const badExpression = `${current.cards[0].rank}^${current.cards[1].rank}+${current.cards[2].rank}+${current.cards[3].rank}`;
    const wrong = await gameAction(opponent, twentyFour.roomId, tHost.room!.version, { type: 'submit', expression: badExpression });
    expect(wrong).toMatchObject({ ok: false });
    if (wrong.ok || wrong.error.currentVersion === undefined) return;
    const wrongVersion = wrong.error.currentVersion;
    const coolingDown = await gameAction(opponent, twentyFour.roomId, wrongVersion, { type: 'submit', expression: current.canonicalSolution });
    expect(coolingDown).toMatchObject({ ok: false, error: { code: 'COOLDOWN' } });
    const secondPoint = await gameAction(scorer, twentyFour.roomId, wrongVersion, { type: 'submit', expression: current.canonicalSolution });
    expect(secondPoint).toMatchObject({ ok: true });
    await waitFor(() => (tHost.game!.view as TwentyFourView).phase === 'revealing');

    current = await advanceRound();
    current.deadlineAtMs = Date.now() - 1;
    running.database.raw.prepare('UPDATE rooms SET state_json=? WHERE id=?').run(JSON.stringify(current), twentyFour.roomId);
    running.roomService.sweep();
    await waitFor(() => (tHost.game!.view as TwentyFourView).roundOutcome?.type === 'timeout');
    expect((tHost.game!.view as TwentyFourView).scores[firstScorer]).toBe(2);

    while (true) {
      current = await advanceRound();
      const point = await gameAction(scorer, twentyFour.roomId, tHost.room!.version, { type: 'submit', expression: current.canonicalSolution });
      expect(point).toMatchObject({ ok: true });
      const afterPointRow = running.database.raw.prepare('SELECT state_json FROM rooms WHERE id=?').get(twentyFour.roomId) as { state_json: string };
      const afterPoint = JSON.parse(afterPointRow.state_json) as TwentyFourState;
      if (afterPoint.winner !== null) {
        await waitFor(() => tHost.room?.status === 'finished');
        break;
      }
      await waitFor(() => (tHost.game!.view as TwentyFourView).phase === 'revealing');
    }
    const finishedTwentyFour = tHost.game!.view as TwentyFourView;
    expect(finishedTwentyFour.scores[firstScorer]).toBe(5);
    expect(finishedTwentyFour.winner).toBe(firstScorer);
  });

  it('服务重启后从 SQLite 恢复暂停房，双方十分钟窗口内回来后继续', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gamehall-restart-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'gamehall.sqlite');
    const firstServer = await startServer(databasePath);
    const started = await startTwoPlayerRoom(firstServer.url, 'gomoku');
    const [oldHost, oldGuest] = track(started.host, started.guest);
    const originalState = oldHost.game!.view as GomokuState;

    await firstServer.close();
    const secondServer = await startServer(databasePath);
    const [newHost, newGuest] = track(
      await createPeer(secondServer.url, oldHost.cookie),
      await createPeer(secondServer.url, oldGuest.cookie),
    );
    await waitFor(() => newHost.room?.status === 'active' && newGuest.room?.status === 'active');
    expect(newHost.room?.code).toBe(oldHost.room?.code);
    expect((newHost.game!.view as GomokuState).blackPlayer).toBe(originalState.blackPlayer);
    expect(newHost.room!.version).toBeGreaterThan(oldHost.room!.version);
  });

  it('24 点服务重启后恢复同一权威题面、分数和剩余计时', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gamehall-24-restart-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'gamehall.sqlite');
    const firstServer = await startServer(databasePath);
    const started = await startTwoPlayerRoom(firstServer.url, 'twenty-four');
    const [oldHost, oldGuest] = track(started.host, started.guest);
    const before = JSON.parse((firstServer.database.raw.prepare('SELECT state_json FROM rooms WHERE id=?').get(started.roomId) as { state_json: string }).state_json) as TwentyFourState;

    await firstServer.close();
    // Model a hard process loss: the durable room row remained active, and the
    // last heartbeat says exactly 15 seconds of the question were unspent.
    const crashSnapshot = new GameHallDatabase(databasePath);
    const oldDeadlineAtMs = Date.now() - 60_000;
    crashSnapshot.raw.prepare(`
      UPDATE rooms SET status='active', pause_reason=NULL, paused_remaining_ms=NULL,
        restart_deadline_ms=NULL, state_json=? WHERE id=?
    `).run(JSON.stringify({ ...before, deadlineAtMs: oldDeadlineAtMs }), started.roomId);
    crashSnapshot.raw.prepare(`
      INSERT INTO server_runtime(singleton, heartbeat_at_ms) VALUES (1, ?)
      ON CONFLICT(singleton) DO UPDATE SET heartbeat_at_ms=excluded.heartbeat_at_ms
    `).run(oldDeadlineAtMs - 15_000);
    crashSnapshot.close();
    const secondServer = await startServer(databasePath);
    const [newHost, newGuest] = track(
      await createPeer(secondServer.url, oldHost.cookie),
      await createPeer(secondServer.url, oldGuest.cookie),
    );
    await waitFor(() => newHost.room?.status === 'active' && newGuest.room?.status === 'active');
    const after = JSON.parse((secondServer.database.raw.prepare('SELECT state_json FROM rooms WHERE id=?').get(started.roomId) as { state_json: string }).state_json) as TwentyFourState;
    expect(after.cards).toEqual(before.cards);
    expect(after.canonicalSolution).toBe(before.canonicalSolution);
    expect(after.round).toBe(before.round);
    expect(after.scores).toEqual(before.scores);
    const restoredRemainingMs = after.deadlineAtMs - Date.now();
    expect(restoredRemainingMs).toBeGreaterThan(12_000);
    expect(restoredRemainingMs).toBeLessThanOrEqual(15_500);
  });

  it('服务重启恢复窗口耗尽后结束权威状态并允许房间进入收尾', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gamehall-restart-timeout-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'gamehall.sqlite');
    const firstServer = await startServer(databasePath);
    const started = await startTwoPlayerRoom(firstServer.url, 'gomoku');
    track(started.host, started.guest);
    await firstServer.close();

    const secondServer = await startServer(databasePath);
    secondServer.database.raw.prepare('UPDATE rooms SET restart_deadline_ms=? WHERE id=?').run(Date.now() - 1, started.roomId);
    const [lateHost, lateGuest] = track(
      await createPeer(secondServer.url, started.host.cookie),
      await createPeer(secondServer.url, started.guest.cookie),
    );
    await waitFor(() => lateHost.room?.status === 'finished' && lateGuest.room?.status === 'finished');
    const row = secondServer.database.raw.prepare('SELECT status, state_json, finish_reason FROM rooms WHERE id=?').get(started.roomId) as {
      status: string;
      state_json: string;
      finish_reason: string;
    };
    const state = JSON.parse(row.state_json) as GomokuState;
    expect(row).toMatchObject({ status: 'finished', finish_reason: 'restart_timeout' });
    expect(state.phase).toBe('finished');
    expect(state.result).toEqual({ type: 'draw' });
  });
});
