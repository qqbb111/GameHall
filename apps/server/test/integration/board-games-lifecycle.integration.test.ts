import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { connectFourDefinition, dotsAndBoxesDefinition, reversiDefinition } from '@gamehall/game-core';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import { TEST_ORIGIN, createPeer, gameAction, leaveRoom, reconnectPeer, startTwoPlayerRoom, waitFor, type TestPeer } from '../helpers';

const games = [
  { id: 'connect-four', definition: connectFourDefinition, firstAction: { type: 'drop', col: 0 } as const },
  { id: 'reversi', definition: reversiDefinition, firstAction: { type: 'placeDisc', row: 2, col: 3 } as const },
  { id: 'dots-and-boxes', definition: dotsAndBoxesDefinition, firstAction: { type: 'drawEdge', orientation: 'H', row: 0, col: 0 } as const },
] as const;
const servers: RunningGameHallServer[] = [];
const peers: TestPeer[] = [];
const directories: string[] = [];
async function start(file: string) {
  const server = createGameHallServer({ databasePath: file, host: '127.0.0.1', port: 0, isProduction: false, isTest: true,
    publicOrigin: TEST_ORIGIN, allowedOrigins: new Set([TEST_ORIGIN]), webDistPath: 'missing-web-dist' });
  const running = await server.start(); servers.push(running); return running;
}
async function filePath() {
  const dir = await mkdtemp(path.join(tmpdir(), 'gamehall-board-life-')); directories.push(dir);
  return path.join(dir, 'gamehall.sqlite');
}
afterEach(async () => {
  for (const peer of peers.splice(0)) peer.socket.disconnect();
  for (const server of servers.splice(0).reverse()) await server.close();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe.each(games)('$id 持久房间生命周期', ({ id, definition, firstAction }) => {
  it('断线重连和文件 SQLite 重启保留棋局，离房终态可恢复', async () => {
    const file = await filePath();
    const firstServer = await start(file);
    const started = await startTwoPlayerRoom(firstServer.url, id); peers.push(started.host, started.guest);
    const opening = started.host.game!.view as { turn: 0 | 1 };
    const actor = opening.turn === 0 ? started.host : started.guest;
    expect(await gameAction(actor, started.roomId, started.host.room!.version, firstAction)).toMatchObject({ ok: true });
    const before = firstServer.database.raw.prepare('SELECT state_json FROM rooms WHERE id=?').get(started.roomId) as { state_json: string };
    started.guest.socket.disconnect();
    await waitFor(() => started.host.room?.status === 'paused');
    await reconnectPeer(started.guest);
    await waitFor(() => started.host.room?.status === 'active' && started.guest.room?.status === 'active');
    await firstServer.close();
    const secondServer = await start(file);
    const newHost = await createPeer(secondServer.url, started.host.cookie);
    const newGuest = await createPeer(secondServer.url, started.guest.cookie);
    peers.push(newHost, newGuest);
    await waitFor(() => newHost.room?.status === 'active' && newGuest.room?.status === 'active');
    const after = secondServer.database.raw.prepare('SELECT state_json FROM rooms WHERE id=?').get(started.roomId) as { state_json: string };
    expect(after.state_json).toBe(before.state_json);
    expect(await leaveRoom(newGuest, started.roomId)).toMatchObject({ ok: true });
    await waitFor(() => newHost.room?.status === 'finished');
    const terminal = secondServer.database.raw.prepare('SELECT state_json FROM rooms WHERE id=?').get(started.roomId) as { state_json: string };
    const restored = definition.deserialize(terminal.state_json);
    expect(restored.phase).toBe('finished');
    expect(restored.result).toMatchObject({ type: 'win', reason: 'leave' });
  });

  it('重启恢复窗口过期后和局收尾，持久终态可反序列化', async () => {
    const file = await filePath();
    const firstServer = await start(file);
    const started = await startTwoPlayerRoom(firstServer.url, id); peers.push(started.host, started.guest);
    await firstServer.close();
    const secondServer = await start(file);
    secondServer.database.raw.prepare('UPDATE rooms SET restart_deadline_ms=? WHERE id=?').run(Date.now() - 1, started.roomId);
    const newHost = await createPeer(secondServer.url, started.host.cookie);
    const newGuest = await createPeer(secondServer.url, started.guest.cookie);
    peers.push(newHost, newGuest);
    await waitFor(() => newHost.room?.status === 'finished' && newGuest.room?.status === 'finished');
    const row = secondServer.database.raw.prepare('SELECT finish_reason,state_json FROM rooms WHERE id=?').get(started.roomId) as { finish_reason: string; state_json: string };
    expect(row.finish_reason).toBe('restart_timeout');
    const restored = definition.deserialize(row.state_json);
    expect(restored.phase).toBe('finished');
    expect(restored.result).toEqual({ type: 'draw' });
  });
});
