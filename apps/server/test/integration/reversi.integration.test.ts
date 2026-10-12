import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { applyReversiAction, legalReversiMoves, type ReversiState } from '@gamehall/game-core';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import { TEST_ORIGIN, gameAction, rematch, startTwoPlayerRoom, waitFor, type TestPeer } from '../helpers';

const servers: RunningGameHallServer[] = [];
const peers: TestPeer[] = [];
afterEach(async () => { for (const peer of peers.splice(0)) peer.socket.disconnect(); for (const server of servers.splice(0)) await server.close(); });

describe('黑白棋真实 Socket 房间', () => {
  it('服务端翻面、拒绝非法/过期步、完整结算并交换黑方复赛', async () => {
    const server = createGameHallServer({ databasePath: ':memory:', host: '127.0.0.1', port: 0, isProduction: false, isTest: true,
      publicOrigin: TEST_ORIGIN, allowedOrigins: new Set([TEST_ORIGIN]), webDistPath: 'missing-web-dist' });
    const running = await server.start(); servers.push(running);
    const started = await startTwoPlayerRoom(running.url, 'reversi'); peers.push(started.host, started.guest);
    const bySeat = [started.host, started.guest];
    let state = started.host.game!.view as ReversiState;
    const initialBlack = state.blackPlayer;
    let version = started.host.room!.version;
    expect(await gameAction(bySeat[state.turn]!, started.roomId, version, { type: 'placeDisc', row: 0, col: 0 })).toMatchObject({ ok: false, error: { code: 'NO_CAPTURE' } });
    const firstMove = legalReversiMoves(state.board, state.turn)[0]!;
    const actionId = randomUUID();
    const first = await gameAction(bySeat[state.turn]!, started.roomId, version, { type: 'placeDisc', ...firstMove }, actionId);
    expect(first).toMatchObject({ ok: true });
    expect(await gameAction(bySeat[state.turn]!, started.roomId, version, { type: 'placeDisc', ...firstMove }, actionId)).toEqual(first);
    expect(await gameAction(bySeat[state.turn === 0 ? 1 : 0]!, started.roomId, version, { type: 'placeDisc', row: 2, col: 2 })).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    if (!first.ok) return;
    const advanced = applyReversiAction(state, state.turn, { type: 'placeDisc', ...firstMove });
    if (!advanced.ok) throw new Error(advanced.error.code);
    state = advanced.state; version = first.version!;
    await waitFor(() => started.host.game?.version === version);
    expect((started.host.game!.view as ReversiState).board).toEqual(state.board);
    for (let index = 0; state.phase === 'playing' && index < 60; index++) {
      const move = legalReversiMoves(state.board, state.turn)[0]!;
      const result = await gameAction(bySeat[state.turn]!, started.roomId, version, { type: 'placeDisc', ...move });
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      version = result.version!;
      const next = applyReversiAction(state, state.turn, { type: 'placeDisc', ...move });
      if (!next.ok) throw new Error(next.error.code);
      state = next.state;
    }
    expect(state.phase).toBe('finished');
    await waitFor(() => started.host.room?.status === 'finished' && started.guest.game?.version === version);
    expect((started.guest.game!.view as ReversiState).result).toEqual(state.result);
    expect(await rematch(started.host, started.roomId)).toMatchObject({ ok: true });
    expect(await rematch(started.guest, started.roomId)).toMatchObject({ ok: true });
    await waitFor(() => started.host.room?.status === 'active');
    expect((started.host.game!.view as ReversiState).blackPlayer).toBe(initialBlack === 0 ? 1 : 0);
  });
});
