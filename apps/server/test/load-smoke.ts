import path from 'node:path';
import { createGameHallServer } from '../src/server';
import { TEST_ORIGIN, createPeer, createRoom, joinRoom, sendReaction, setReady, waitFor, type TestPeer } from './helpers';

const startedAt = Date.now();
const application = createGameHallServer({
  databasePath: ':memory:',
  host: '127.0.0.1',
  port: 0,
  isProduction: false,
  isTest: true,
  publicOrigin: TEST_ORIGIN,
  allowedOrigins: new Set([TEST_ORIGIN]),
  webDistPath: path.resolve('test', 'missing-web-dist'),
});
const running = await application.start();
const peers: TestPeer[] = [];

try {
  peers.push(...await Promise.all(Array.from({ length: 50 }, () => createPeer(running.url))));
  const roomResults = await Promise.all(Array.from({ length: 25 }, async (_, index) => {
    const host = peers[index * 2]!;
    const created = await createRoom(host, `棋手${index + 1}甲`, index % 3 === 0 ? 'gomoku' : index % 3 === 1 ? 'quoridor' : 'twenty-four');
    if (!created.ok || !created.roomId || !created.code) throw new Error(`room ${index} was not created`);
    return { roomId: created.roomId, code: created.code, host, guest: peers[index * 2 + 1]!, index };
  }));
  await Promise.all(roomResults.map(async ({ code, guest, index }) => {
    const joined = await joinRoom(guest, `棋手${index + 1}乙`, code);
    if (!joined.ok) throw new Error(`room ${index} was not joined`);
  }));
  await Promise.all(roomResults.flatMap(({ roomId, host, guest }) => [
    setReady(host, roomId),
    setReady(guest, roomId),
  ]));
  await waitFor(() => roomResults.every(({ host, guest }) => host.room?.status === 'active' && guest.room?.status === 'active'), 8_000);
  await Promise.all(roomResults.map(({ roomId, host }) => sendReaction(host, roomId, '👍')));

  const roomCount = running.database.raw.prepare("SELECT COUNT(*) AS count FROM rooms WHERE status='active'").get() as { count: number };
  if (roomCount.count !== 25) throw new Error(`expected 25 active rooms, got ${roomCount.count}`);
  console.log(JSON.stringify({
    level: 'info',
    event: 'load_smoke_passed',
    connections: peers.filter((peer) => peer.socket.connected).length,
    activeRooms: roomCount.count,
    elapsedMs: Date.now() - startedAt,
  }));
} finally {
  for (const peer of peers) peer.socket.disconnect();
  await running.close();
}
