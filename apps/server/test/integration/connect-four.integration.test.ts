import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { type ConnectFourState } from '@gamehall/game-core';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import { TEST_ORIGIN, gameAction, rematch, startTwoPlayerRoom, waitFor, type TestPeer } from '../helpers';

const servers: RunningGameHallServer[] = [];
const peers: TestPeer[] = [];
afterEach(async () => {
  for (const peer of peers.splice(0)) peer.socket.disconnect();
  for (const server of servers.splice(0)) await server.close();
});

describe('四子连线真实 Socket 房间', () => {
  it('权威落子、重复回执、过期版本、终局和交换先手复赛', async () => {
    const server = createGameHallServer({ databasePath: ':memory:', host: '127.0.0.1', port: 0, isProduction: false, isTest: true,
      publicOrigin: TEST_ORIGIN, allowedOrigins: new Set([TEST_ORIGIN]), webDistPath: 'missing-web-dist' });
    const running = await server.start(); servers.push(running);
    const started = await startTwoPlayerRoom(running.url, 'connect-four');
    peers.push(started.host, started.guest);
    const state = started.host.game!.view as ConnectFourState;
    const bySeat = [started.host, started.guest];
    const first = bySeat[state.firstPlayer]!;
    const second = bySeat[state.firstPlayer === 0 ? 1 : 0]!;
    let version = started.host.room!.version;
    const actionId = randomUUID();
    const initial = await gameAction(first, started.roomId, version, { type: 'drop', col: 0 }, actionId);
    expect(initial).toMatchObject({ ok: true });
    expect(await gameAction(first, started.roomId, version, { type: 'drop', col: 0 }, actionId)).toEqual(initial);
    expect(await gameAction(second, started.roomId, version, { type: 'drop', col: 1 })).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    if (!initial.ok) return;
    version = initial.version!;
    for (const col of [6, 1, 6, 2, 6, 3]) {
      const actor = col === 6 ? second : first;
      const outcome = await gameAction(actor, started.roomId, version, { type: 'drop', col });
      expect(outcome).toMatchObject({ ok: true });
      if (!outcome.ok) return;
      version = outcome.version!;
    }
    await waitFor(() => started.guest.room?.status === 'finished');
    expect((started.host.game!.view as ConnectFourState).result).toEqual({ type: 'win', winner: state.firstPlayer, reason: 'line' });
    expect(await rematch(started.host, started.roomId)).toMatchObject({ ok: true });
    expect(await rematch(started.guest, started.roomId)).toMatchObject({ ok: true });
    await waitFor(() => started.host.room?.status === 'active');
    expect((started.host.game!.view as ConnectFourState).firstPlayer).toBe(state.firstPlayer === 0 ? 1 : 0);
  });
});
