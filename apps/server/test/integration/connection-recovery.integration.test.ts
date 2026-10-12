import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandAck, RoomSnapshot } from '@gamehall/protocol';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import { TEST_ORIGIN, createPeer, createRoom, leaveRoom, sendMessage, startTwoPlayerRoom, waitFor, type TestPeer } from '../helpers';

const servers: RunningGameHallServer[] = [];
const peers: TestPeer[] = [];
const extraSockets: Array<ReturnType<typeof io>> = [];

async function startServer(): Promise<RunningGameHallServer> {
  const running = await createGameHallServer({
    databasePath: ':memory:', host: '127.0.0.1', port: 0, isProduction: false, isTest: true,
    publicOrigin: TEST_ORIGIN, allowedOrigins: new Set([TEST_ORIGIN]),
    webDistPath: path.resolve('test', 'missing-web-dist'),
  }).start();
  servers.push(running);
  return running;
}

afterEach(async () => {
  for (const socket of extraSockets.splice(0)) socket.disconnect();
  for (const peer of peers.splice(0)) peer.socket.disconnect();
  for (const server of servers.splice(0).reverse()) await server.close();
});

function sync(peer: TestPeer, roomId: string, extra: Record<string, unknown> = {}): Promise<CommandAck> {
  return new Promise((resolve) => peer.socket.emit('room:sync', { commandId: randomUUID(), roomId, ...extra }, resolve));
}

describe('connection recovery', () => {
  it('room:sync 重发权威快照与消息，拒绝非成员、额外字段和过量请求', async () => {
    const running = await startServer();
    const started = await startTwoPlayerRoom(running.url, 'gomoku');
    const { host, guest, roomId } = started;
    const outsider = await createPeer(running.url);
    peers.push(host, guest, outsider);
    expect(await sendMessage(guest, roomId, '同步后仍在')).toMatchObject({ ok: true });
    await waitFor(() => host.messages.length === 1);

    const snapshots: string[] = [];
    const histories: string[] = [];
    host.socket.on('room:snapshot', (snapshot) => snapshots.push(snapshot.roomId));
    host.socket.on('room:message:history', (history) => histories.push(history.roomId));
    expect(await sync(host, roomId)).toMatchObject({ ok: true, roomId });
    await waitFor(() => snapshots.includes(roomId) && histories.includes(roomId));
    expect(host.messages[0]?.content).toBe('同步后仍在');
    expect(await sync(outsider, roomId)).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
    expect(await sync(host, roomId, { unexpected: true })).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    for (let index = 0; index < 28; index++) expect(await sync(host, roomId)).toMatchObject({ ok: true });
    expect(await sync(host, roomId)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });

  it('同一会话保留旧已结束房时，刷新只恢复最新可进入房间', async () => {
    const running = await startServer();
    const { host, guest, roomId: oldRoomId } = await startTwoPlayerRoom(running.url, 'gomoku');
    peers.push(host, guest);
    expect(await leaveRoom(guest, oldRoomId)).toMatchObject({ ok: true });
    await waitFor(() => host.room?.status === 'finished');
    const newer = await createRoom(host, '木纹棋手', 'connect-four');
    expect(newer).toMatchObject({ ok: true });
    if (!newer.ok || !newer.roomId || !newer.code) throw new Error('new room missing');
    host.socket.disconnect();

    const sessionResponse = await fetch(`${running.url}/api/session`, { method: 'POST', headers: { Cookie: host.cookie } });
    expect(await sessionResponse.json()).toMatchObject({ reconnectableRoomCode: newer.code });
    const socket = io(running.url, { path: '/socket.io', autoConnect: false, forceNew: true,
      reconnection: false, transports: ['websocket'], extraHeaders: { Cookie: host.cookie, Origin: TEST_ORIGIN } });
    extraSockets.push(socket);
    const roomIds: string[] = [];
    const historyRoomIds: string[] = [];
    socket.on('room:snapshot', (snapshot: RoomSnapshot) => roomIds.push(snapshot.roomId));
    socket.on('room:message:history', (history) => historyRoomIds.push(history.roomId));
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    await waitFor(() => roomIds.includes(newer.roomId!));
    expect(roomIds).toEqual([newer.roomId]);
    expect(historyRoomIds).toEqual([newer.roomId]);
    expect(roomIds).not.toContain(oldRoomId);
  });
});
