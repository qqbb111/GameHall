import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameSnapshot, RoomSnapshot, SessionResponse } from '@gamehall/protocol';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';
import { TEST_ORIGIN, createRoom, gameAction, joinRoom, setReady, waitFor, type TestPeer } from '../helpers';

const servers: RunningGameHallServer[] = [];
const sockets: Array<ReturnType<typeof io>> = [];
const proofHeader = 'x-gamehall-socket-proof';

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  for (const server of servers.splice(0).reverse()) await server.close();
});

async function startServer(): Promise<RunningGameHallServer> {
  const server = await createGameHallServer({ databasePath: ':memory:', host: '127.0.0.1', port: 0,
    isProduction: false, isTest: false, publicOrigin: TEST_ORIGIN, allowedOrigins: new Set([TEST_ORIGIN]),
    webDistPath: 'missing-web-dist' }).start();
  servers.push(server);
  return server;
}

async function session(url: string, cookie?: string): Promise<{ cookie: string; body: SessionResponse; response: Response }> {
  const response = await fetch(`${url}/api/session`, { method: 'POST', headers: cookie ? { Cookie: cookie } : {} });
  expect(response.status).toBe(200);
  const activeCookie = response.headers.getSetCookie()[0]?.split(';', 1)[0];
  if (!activeCookie) throw new Error('missing session cookie');
  return { cookie: activeCookie, body: await response.json() as SessionResponse, response };
}

async function engineGet(url: string, headers: Record<string, string> = {}, suffix = ''): Promise<Response> {
  return fetch(`${url}/socket.io/?EIO=4&transport=polling${suffix}`, { headers });
}

async function pollingPeer(url: string): Promise<TestPeer> {
  const { cookie, body } = await session(url);
  const socket: TestPeer['socket'] = io(url, { path: '/socket.io', forceNew: true, autoConnect: false,
    reconnection: false, transports: ['polling'], auth: { socketProof: body.socketProof },
    transportOptions: { polling: { extraHeaders: { Cookie: cookie, [proofHeader]: body.socketProof } } } });
  sockets.push(socket);
  const peer: TestPeer = { socket, cookie, session: body, room: null, game: null, messages: [] };
  socket.on('room:snapshot', (room: RoomSnapshot) => { peer.room = room; });
  socket.on('presence:update', (room: RoomSnapshot) => { peer.room = room; });
  socket.on('game:snapshot', (game: GameSnapshot) => { peer.game = game; });
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
  return peer;
}

async function rejectedUpgrade(url: string, sid: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/socket.io/?EIO=4&transport=websocket&sid=${sid}`, {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13', ...headers },
    });
    request.on('response', (response) => { response.resume(); resolve(response.statusCode ?? 0); });
    request.on('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('unexpected upgrade')); });
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET') resolve(0); else reject(error);
    });
    request.end();
  });
}

describe('Origin-free same-origin polling', () => {
  it('生产式配置下完成建房、入房、准备、落子、同步和重连', async () => {
    const { url } = await startServer();
    const host = await pollingPeer(url);
    const guest = await pollingPeer(url);
    const created = await createRoom(host, '木纹棋手', 'gomoku');
    expect(created).toMatchObject({ ok: true });
    if (!created.ok || !created.roomId || !created.code) throw new Error('missing room');
    expect(await joinRoom(guest, '墨绿棋手', created.code)).toMatchObject({ ok: true });
    expect(await setReady(host, created.roomId)).toMatchObject({ ok: true });
    expect(await setReady(guest, created.roomId)).toMatchObject({ ok: true });
    await waitFor(() => host.room?.status === 'active' && host.game !== null && guest.game !== null);
    const blackSeat = (host.game!.view as { blackPlayer: number }).blackPlayer;
    const black = host.room!.mySeat === blackSeat ? host : guest;
    expect(await gameAction(black, created.roomId, black.room!.version, { type: 'place', row: 0, col: 0 })).toMatchObject({ ok: true });
    expect(await new Promise((resolve) => host.socket.emit('room:sync', { commandId: randomUUID(), roomId: created.roomId! }, resolve)))
      .toMatchObject({ ok: true });
    host.socket.disconnect();
    await new Promise<void>((resolve, reject) => { host.socket.once('connect', resolve); host.socket.once('connect_error', reject); host.socket.connect(); });
    await waitFor(() => host.room?.roomId === created.roomId && host.game !== null);
  });

  it('缺失、错误、过长证明以及缺失、过期和错配 cookie 均在首个 transport 前拒绝', async () => {
    const server = await startServer();
    const first = await session(server.url);
    const second = await session(server.url);
    const correct = { Cookie: first.cookie, [proofHeader]: first.body.socketProof };
    expect((await engineGet(server.url, correct)).status).toBe(200);
    for (const headers of [
      {}, { Cookie: first.cookie }, { Cookie: first.cookie, [proofHeader]: 'x'.repeat(43) },
      { Cookie: first.cookie, [proofHeader]: 'x'.repeat(10_000) },
      { Cookie: `gamehall_session=${'A'.repeat(43)}`, [proofHeader]: first.body.socketProof },
      { Cookie: second.cookie, [proofHeader]: first.body.socketProof },
    ]) {
      const response = await engineGet(server.url, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ code: 'SESSION_REQUIRED' });
    }
    server.database.raw.prepare('UPDATE guest_sessions SET expires_at_ms=0 WHERE id=?').run(first.body.sessionId);
    expect((await engineGet(server.url, correct)).status).toBe(403);
  });

  it('显式空、null、外站 Origin 即使带正确证明也拒绝；白名单 WebSocket 无证明仍能连接', async () => {
    const server = await startServer();
    const established = await session(server.url);
    for (const origin of ['', 'null', 'https://other.example']) {
      const response = await engineGet(server.url, { Cookie: established.cookie, [proofHeader]: established.body.socketProof, Origin: origin });
      expect(response.ok).toBe(false);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    const socket = io(server.url, { path: '/socket.io', forceNew: true, autoConnect: false,
      reconnection: false, transports: ['websocket'], extraHeaders: { Cookie: established.cookie, Origin: TEST_ORIGIN } });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    expect(socket.connected).toBe(true);
  });

  it('合法 polling 请求头不能替代畸形的 namespace auth', async () => {
    const server = await startServer();
    const established = await session(server.url);
    const socket = io(server.url, { path: '/socket.io', forceNew: true, autoConnect: false,
      reconnection: false, transports: ['polling'], auth: { socketProof: `${established.body.socketProof}\n` },
      transportOptions: { polling: { extraHeaders: { Cookie: established.cookie, [proofHeader]: established.body.socketProof } } } });
    sockets.push(socket);
    const error = await new Promise<Error>((resolve) => { socket.once('connect_error', resolve); socket.connect(); });
    expect(error.message).toBe('SESSION_REQUIRED');
    expect(socket.connected).toBe(false);
  });

  it('已有 SID 的后续 GET、POST 和 WebSocket upgrade 仍要求正确证明', async () => {
    const server = await startServer();
    const established = await session(server.url);
    const other = await session(server.url);
    const headers = { Cookie: established.cookie, [proofHeader]: established.body.socketProof };
    const opened = await engineGet(server.url, headers);
    const packet = await opened.text();
    expect(packet.startsWith('0')).toBe(true);
    const sid = (JSON.parse(packet.slice(1)) as { sid: string }).sid;
    expect((await engineGet(server.url, { Cookie: established.cookie }, `&sid=${sid}`)).status).toBe(403);
    expect((await fetch(`${server.url}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
      method: 'POST', headers: { Cookie: established.cookie, 'Content-Type': 'text/plain' }, body: '40',
    })).status).toBe(403);
    expect(await rejectedUpgrade(server.url, sid)).not.toBe(101);
    const otherHeaders = { Cookie: other.cookie, [proofHeader]: other.body.socketProof };
    expect((await engineGet(server.url, otherHeaders, `&sid=${sid}`)).status).toBe(403);
    expect((await engineGet(server.url, { Cookie: other.cookie, Origin: TEST_ORIGIN }, `&sid=${sid}`)).status).toBe(403);
    expect((await fetch(`${server.url}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
      method: 'POST', headers: { ...otherHeaders, 'Content-Type': 'text/plain' }, body: '40',
    })).status).toBe(403);
    expect(await rejectedUpgrade(server.url, sid, otherHeaders)).not.toBe(101);
    expect((await fetch(`${server.url}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '40',
    })).status).toBe(200);
    expect((await engineGet(server.url, headers, `&sid=${sid}`)).status).toBe(200);
  });

  it('会话 JSON 禁止缓存，外站 POST 不获得可跨站读取的响应头；初始握手仍受限流', async () => {
    const server = await startServer();
    const response = await fetch(`${server.url}/api/session`, { method: 'POST', headers: { Origin: 'https://other.example' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const body = await response.json() as SessionResponse;
    expect(body.socketProof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (let index = 0; index < 80; index++) expect((await engineGet(server.url)).status).toBe(403);
    expect((await engineGet(server.url)).status).toBe(429);
  });
});
