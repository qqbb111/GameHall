import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  CommandAck,
  GameActionCommand,
  GameId,
  GameSnapshot,
  Reaction,
  RoomSnapshot,
  ServerToClientEvents,
  SessionResponse,
} from '@gamehall/protocol';

export const TEST_ORIGIN = 'http://gamehall.test';
export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type TestPeer = {
  socket: TestSocket;
  cookie: string;
  session: SessionResponse;
  room: RoomSnapshot | null;
  game: GameSnapshot | null;
};

export async function createPeer(url: string, cookie?: string): Promise<TestPeer> {
  const request: RequestInit = { method: 'POST' };
  if (cookie) request.headers = { Cookie: cookie };
  const response = await fetch(`${url}/api/session`, request);
  if (!response.ok) throw new Error(`session endpoint returned ${response.status}`);
  const session = await response.json() as SessionResponse;
  const setCookie = response.headers.getSetCookie()[0];
  const activeCookie = (setCookie ?? cookie)?.split(';', 1)[0];
  if (!activeCookie) throw new Error('session cookie was not returned');
  const socket: TestSocket = io(url, {
    path: '/socket.io',
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: activeCookie, Origin: TEST_ORIGIN },
  });
  const peer: TestPeer = { socket, cookie: activeCookie, session, room: null, game: null };
  socket.on('room:snapshot', (snapshot) => { peer.room = snapshot; });
  socket.on('presence:update', (snapshot) => { peer.room = snapshot; });
  socket.on('game:snapshot', (snapshot) => { peer.game = snapshot; });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  return peer;
}

export async function reconnectPeer(peer: TestPeer): Promise<void> {
  if (peer.socket.connected) return;
  await new Promise<void>((resolve, reject) => {
    peer.socket.once('connect', resolve);
    peer.socket.once('connect_error', reject);
    peer.socket.connect();
  });
}

export function createRoom(peer: TestPeer, nickname: string, gameId: GameId): Promise<CommandAck> {
  return new Promise((resolve) => peer.socket.emit('room:create', { commandId: randomUUID(), nickname, gameId }, resolve));
}

export function joinRoom(peer: TestPeer, nickname: string, code: string): Promise<CommandAck> {
  return new Promise((resolve) => peer.socket.emit('room:join', { commandId: randomUUID(), nickname, code }, resolve));
}

export function setReady(peer: TestPeer, roomId: string, ready = true): Promise<CommandAck> {
  return new Promise((resolve) => peer.socket.emit('room:ready', { commandId: randomUUID(), roomId, ready }, resolve));
}

export function leaveRoom(peer: TestPeer, roomId: string): Promise<CommandAck> {
  return new Promise((resolve) => peer.socket.emit('room:leave', { commandId: randomUUID(), roomId }, resolve));
}

export function gameAction(peer: TestPeer, roomId: string, expectedVersion: number, action: GameActionCommand['action'], actionId = randomUUID()): Promise<CommandAck> {
  const command: GameActionCommand = { actionId, roomId, expectedVersion, action };
  return new Promise((resolve) => peer.socket.emit('game:action', command, resolve));
}

export function rematch(peer: TestPeer, roomId: string, requested = true): Promise<CommandAck> {
  return new Promise((resolve) => peer.socket.emit('game:rematch', { commandId: randomUUID(), roomId, requested }, resolve));
}

export function sendReaction(peer: TestPeer, roomId: string, reaction: Reaction): Promise<CommandAck> {
  return new Promise((resolve) => peer.socket.emit('reaction:send', { roomId, reaction }, resolve));
}

export async function waitFor(check: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for socket state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function startTwoPlayerRoom(url: string, gameId: GameId): Promise<{ host: TestPeer; guest: TestPeer; roomId: string }> {
  const host = await createPeer(url);
  const guest = await createPeer(url);
  const created = await createRoom(host, '木纹棋手', gameId);
  if (!created.ok || !created.roomId || !created.code) throw new Error('room creation failed');
  const joined = await joinRoom(guest, '墨绿棋手', created.code);
  if (!joined.ok) throw new Error('room join failed');
  await setReady(host, created.roomId);
  await setReady(guest, created.roomId);
  await waitFor(() => host.room?.status === 'active' && guest.room?.status === 'active' && host.game !== null && guest.game !== null);
  return { host, guest, roomId: created.roomId };
}
