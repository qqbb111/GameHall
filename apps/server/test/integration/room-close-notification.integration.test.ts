import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandError } from '@gamehall/protocol';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import { TEST_ORIGIN, createPeer, createRoom, gameAction, joinRoom, leaveRoom, startTwoPlayerRoom, waitFor, type TestPeer } from '../helpers';

const servers: RunningGameHallServer[] = [];
const peers: TestPeer[] = [];

async function startServer(): Promise<RunningGameHallServer> {
  const running = await createGameHallServer({
    databasePath: ':memory:', host: '127.0.0.1', port: 0, isProduction: false, isTest: true,
    publicOrigin: TEST_ORIGIN, allowedOrigins: new Set([TEST_ORIGIN]),
    webDistPath: path.resolve('test', 'missing-web-dist'),
  }).start();
  servers.push(running);
  return running;
}

function closedEvents(peer: TestPeer): CommandError[] {
  const events: CommandError[] = [];
  peer.socket.on('command:error', (error) => { if (error.event === 'room:closed') events.push(error); });
  return events;
}

afterEach(async () => {
  for (const peer of peers.splice(0)) peer.socket.disconnect();
  for (const server of servers.splice(0).reverse()) await server.close();
});

describe('room close notifications', () => {
  it('等待房主主动离开时，房主的全部标签都安静退出，仍在房间的客人收到关闭通知', async () => {
    const running = await startServer();
    const host = await createPeer(running.url);
    const guest = await createPeer(running.url);
    peers.push(host, guest);
    const created = await createRoom(host, '房主', 'dots-and-boxes');
    if (!created.ok || !created.roomId || !created.code) throw new Error('room creation failed');
    expect(await joinRoom(guest, '客人', created.code)).toMatchObject({ ok: true });
    const secondHostTab = await createPeer(running.url, host.cookie);
    peers.push(secondHostTab);
    await waitFor(() => secondHostTab.room?.roomId === created.roomId);
    const hostClosed = closedEvents(host);
    const secondTabClosed = closedEvents(secondHostTab);
    const guestClosed = closedEvents(guest);

    expect(await leaveRoom(host, created.roomId)).toMatchObject({ ok: true });
    await waitFor(() => guestClosed.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hostClosed).toHaveLength(0);
    expect(secondTabClosed).toHaveLength(0);
    expect(guestClosed[0]).toMatchObject({ roomId: created.roomId, code: 'room_closed' });
    expect(running.database.raw.prepare('SELECT COUNT(*) AS count FROM rooms WHERE id=?').get(created.roomId)).toEqual({ count: 0 });
  });

  it('已结束房间主动离开时，同会话多标签不收到异常通知，对手仍收到', async () => {
    const running = await startServer();
    const { host, guest, roomId } = await startTwoPlayerRoom(running.url, 'dots-and-boxes');
    peers.push(host, guest);
    const secondHostTab = await createPeer(running.url, host.cookie);
    peers.push(secondHostTab);
    await waitFor(() => secondHostTab.room?.roomId === roomId);
    expect(await gameAction(host, roomId, host.room!.version, { type: 'resign' })).toMatchObject({ ok: true });
    await waitFor(() => host.room?.status === 'finished' && guest.room?.status === 'finished' && secondHostTab.room?.status === 'finished');
    const hostClosed = closedEvents(host);
    const secondTabClosed = closedEvents(secondHostTab);
    const guestClosed = closedEvents(guest);

    expect(await leaveRoom(host, roomId)).toMatchObject({ ok: true });
    await waitFor(() => guestClosed.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hostClosed).toHaveLength(0);
    expect(secondTabClosed).toHaveLength(0);
    expect(guestClosed[0]).toMatchObject({ roomId, code: 'room_closed' });
    expect(running.database.raw.prepare('SELECT COUNT(*) AS count FROM rooms WHERE id=?').get(roomId)).toEqual({ count: 0 });
  });

  it('房间到期属于服务端关闭，所有仍在房间的标签都收到通知', async () => {
    const running = await startServer();
    const host = await createPeer(running.url);
    peers.push(host);
    const created = await createRoom(host, '房主', 'gomoku');
    if (!created.ok || !created.roomId) throw new Error('room creation failed');
    const secondHostTab = await createPeer(running.url, host.cookie);
    peers.push(secondHostTab);
    await waitFor(() => secondHostTab.room?.roomId === created.roomId);
    const hostClosed = closedEvents(host);
    const secondTabClosed = closedEvents(secondHostTab);
    running.database.raw.prepare('UPDATE rooms SET cleanup_at_ms=? WHERE id=?').run(Date.now() - 1, created.roomId);
    running.roomService.sweep();
    await waitFor(() => hostClosed.length === 1 && secondTabClosed.length === 1);
    expect(hostClosed[0]).toMatchObject({ roomId: created.roomId, code: 'room_expired' });
    expect(secondTabClosed[0]).toMatchObject({ roomId: created.roomId, code: 'room_expired' });
  });
});
