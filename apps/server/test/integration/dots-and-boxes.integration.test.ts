import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDotsAndBoxesAction, type DotsAndBoxesState, type EdgeOrientation } from '@gamehall/game-core';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import { TEST_ORIGIN, gameAction, rematch, startTwoPlayerRoom, waitFor, type TestPeer } from '../helpers';

const servers: RunningGameHallServer[] = [];
const peers: TestPeer[] = [];
afterEach(async () => { for (const peer of peers.splice(0)) peer.socket.disconnect(); for (const server of servers.splice(0)) await server.close(); });

describe('点格棋真实 Socket 房间', () => {
  it('服务端封格续走、动作幂等/版本保护、结算与交换先手复赛', async () => {
    const server = createGameHallServer({ databasePath: ':memory:', host: '127.0.0.1', port: 0, isProduction: false, isTest: true,
      publicOrigin: TEST_ORIGIN, allowedOrigins: new Set([TEST_ORIGIN]), webDistPath: 'missing-web-dist' });
    const running = await server.start(); servers.push(running);
    const started = await startTwoPlayerRoom(running.url, 'dots-and-boxes'); peers.push(started.host, started.guest);
    const bySeat = [started.host, started.guest];
    let state = started.host.game!.view as DotsAndBoxesState;
    const firstPlayer = state.firstPlayer;
    let version = started.host.room!.version;
    const actionId = randomUUID();
    const firstAction = { type: 'drawEdge' as const, orientation: 'H' as EdgeOrientation, row: 0, col: 0 };
    const first = await gameAction(bySeat[state.turn]!, started.roomId, version, firstAction, actionId);
    expect(first).toMatchObject({ ok: true });
    expect(await gameAction(bySeat[state.turn]!, started.roomId, version, firstAction, actionId)).toEqual(first);
    expect(await gameAction(bySeat[1 - state.turn]!, started.roomId, version, { type: 'drawEdge', orientation: 'V', row: 0, col: 0 })).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    if (!first.ok) return;
    const advanced = applyDotsAndBoxesAction(state, state.turn, firstAction);
    if (!advanced.ok) throw new Error(advanced.error.code);
    state = advanced.state; version = first.version!;
    for (const orientation of ['H', 'V'] as const) {
      const rows = orientation === 'H' ? 4 : 3;
      const cols = orientation === 'H' ? 3 : 4;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        if (orientation === 'H' && row === 0 && col === 0) continue;
        const actor = state.turn;
        const result = await gameAction(bySeat[actor]!, started.roomId, version, { type: 'drawEdge', orientation, row, col });
        expect(result).toMatchObject({ ok: true });
        if (!result.ok) return;
        version = result.version!;
        const next = applyDotsAndBoxesAction(state, actor, { type: 'drawEdge', orientation, row, col });
        if (!next.ok) throw new Error(next.error.code);
        state = next.state;
      }
    }
    expect(state.edgeCount).toBe(24);
    expect(state.scores[0] + state.scores[1]).toBe(9);
    await waitFor(() => started.host.room?.status === 'finished' && started.guest.game?.version === version);
    expect((started.guest.game!.view as DotsAndBoxesState).result).toEqual(state.result);
    expect(await rematch(started.host, started.roomId)).toMatchObject({ ok: true });
    expect(await rematch(started.guest, started.roomId)).toMatchObject({ ok: true });
    await waitFor(() => started.host.room?.status === 'active');
    expect((started.host.game!.view as DotsAndBoxesState).firstPlayer).toBe(firstPlayer === 0 ? 1 : 0);
  });
});
