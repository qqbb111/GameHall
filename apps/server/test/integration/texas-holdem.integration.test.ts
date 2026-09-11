import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TexasHoldemState, TexasHoldemView } from '@gamehall/game-core';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import { TEST_ORIGIN, createPeer, createRoom, gameAction, joinRoom, setReady, waitFor, type TestPeer } from '../helpers';

const servers: RunningGameHallServer[] = [];
const peers: TestPeer[] = [];

async function server() {
  const running = await createGameHallServer({ databasePath: ':memory:', host: '127.0.0.1', port: 0, isProduction: false, isTest: true, publicOrigin: TEST_ORIGIN, allowedOrigins: new Set([TEST_ORIGIN]), webDistPath: path.resolve('test/missing-web-dist') }).start();
  servers.push(running);
  return running;
}

async function peer(running: RunningGameHallServer) {
  const value = await createPeer(running.url);
  peers.push(value);
  return value;
}

function read(running: RunningGameHallServer, roomId: string) {
  const row = running.database.raw.prepare('SELECT version, state_json, status FROM rooms WHERE id=?').get(roomId) as { version: number; state_json: string; status: string };
  return { ...row, state: JSON.parse(row.state_json) as TexasHoldemState };
}

function command(who: TestPeer, event: 'room:start' | 'room:reopen', roomId: string, expectedVersion: number): Promise<{ ok: boolean; version?: number; code?: string }> {
  return new Promise((resolve) => who.socket.emit(event, { roomId, expectedVersion, commandId: randomUUID() }, resolve));
}

afterEach(async () => {
  for (const peerItem of peers.splice(0)) peerItem.socket.disconnect();
  for (const running of servers.splice(0).reverse()) await running.close();
});

describe('Texas Hold’em real clients', () => {
  it('supports a 2–4 player private table, server-authoritative actions, fold settlement and host reopen', async () => {
    const running = await server();
    const players = await Promise.all([0, 1, 2, 3].map(() => peer(running)));
    const created = await createRoom(players[0]!, '庄家', 'texas-holdem');
    expect(created).toMatchObject({ ok: true });
    if (!created.ok || !created.roomId || !created.code) return;
    const { roomId, code } = created;
    for (let index = 1; index < players.length; index += 1) expect(await joinRoom(players[index]!, `玩家${index}`, code)).toMatchObject({ ok: true });
    const outsider = await peer(running);
    expect(await joinRoom(outsider, '第五人', code)).toMatchObject({ ok: false, error: { code: 'ROOM_FULL' } });
    for (const player of players.slice(1)) expect(await setReady(player, roomId)).toMatchObject({ ok: true });
    expect(await command(players[0]!, 'room:start', roomId, read(running, roomId).version)).toMatchObject({ ok: true });
    await waitFor(() => players.every((player) => player.room?.status === 'active' && player.game !== null));

    const initial = read(running, roomId);
    expect(initial.state.players).toHaveLength(4);
    for (const player of players) {
      const view = player.game!.view as TexasHoldemView;
      expect(view.players.find((item) => item.seat === view.mySeat)?.holeCards).toHaveLength(2);
      expect(view.players.filter((item) => item.seat !== view.mySeat).every((item) => item.holeCards === null)).toBe(true);
    }

    const bySeat = new Map(players.map((player) => [player.room!.mySeat, player]));
    const firstActor = bySeat.get(initial.state.turn!);
    if (!firstActor) throw new Error('first actor not found');
    const actionId = randomUUID();
    const firstFold = await gameAction(firstActor, roomId, initial.version, { type: 'fold' }, actionId);
    expect(firstFold).toMatchObject({ ok: true });
    expect(await gameAction(firstActor, roomId, initial.version, { type: 'fold' }, actionId)).toEqual(firstFold);
    expect(await gameAction(firstActor, roomId, initial.version, { type: 'fold' })).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });

    for (let turn = 0; turn < 3; turn += 1) {
      const current = read(running, roomId);
      if (current.state.phase === 'finished') break;
      const actor = bySeat.get(current.state.turn!);
      if (!actor) throw new Error('next actor not found');
      expect(await gameAction(actor, roomId, current.version, { type: 'fold' })).toMatchObject({ ok: true });
    }
    await waitFor(() => players.every((player) => player.room?.status === 'finished'));
    expect(read(running, roomId).state.result).toMatchObject({ type: 'completed', reason: 'fold' });

    const finishedVersion = read(running, roomId).version;
    expect(await command(players[0]!, 'room:reopen', roomId, finishedVersion)).toMatchObject({ ok: true, code });
    await waitFor(() => players[0]!.room?.status === 'waiting');
    expect(read(running, roomId).state_json).toBeNull();
  });
});
