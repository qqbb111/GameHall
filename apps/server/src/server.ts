import fs from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as cookie from 'cookie';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import {
  createRoomSchema,
  gameActionSchema,
  joinRoomSchema,
  leaveRoomSchema,
  reactionSchema,
  readyRoomSchema,
  rematchSchema,
  type ClientToServerEvents,
  type CommandAck,
  type CommandError,
  type ServerToClientEvents,
  type SessionResponse,
} from '@gamehall/protocol';
import { loadConfig, type ServerConfig } from './config';
import { GameHallDatabase } from './database';
import { RoomService, type GameHallIo, type GameHallSocket, type SocketData } from './room-service';
import { createSessionToken, hashToken, SlidingWindowLimiter } from './security';

type InterServerEvents = Record<string, never>;
type SessionRow = { id: string; expires_at_ms: number };

const SESSION_COOKIE = 'gamehall_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

function parseCookieToken(header: string | undefined): string | null {
  if (!header) return null;
  try {
    return cookie.parse(header)[SESSION_COOKIE] ?? null;
  } catch {
    return null;
  }
}

function commandError(event: string, commandId: string | null, code: string, message: string, retryable = false): CommandError {
  return { event, commandId, code, message, retryable };
}

export type RunningGameHallServer = {
  url: string;
  port: number;
  close: () => Promise<void>;
  database: GameHallDatabase;
  roomService: RoomService;
};

export function createGameHallServer(configOverrides: Partial<ServerConfig> = {}) {
  const config = loadConfig(configOverrides);
  const database = new GameHallDatabase(config.databasePath);
  const app = express();
  const httpServer = createServer(app);
  const io: GameHallIo = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    cors: {
      origin(origin, callback) {
        if ((!origin && config.isTest) || (origin && config.allowedOrigins.has(origin))) callback(null, true);
        else callback(new Error('origin not allowed'));
      },
      credentials: true,
    },
  });
  const roomService = new RoomService(database, io);
  const limiter = new SlidingWindowLimiter();
  let closing = false;

  function writeRuntimeHeartbeat(nowMs: number): void {
    database.raw.prepare(`
      INSERT INTO server_runtime(singleton, heartbeat_at_ms) VALUES (1, ?)
      ON CONFLICT(singleton) DO UPDATE SET heartbeat_at_ms=excluded.heartbeat_at_ms
    `).run(nowMs);
  }

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
      },
    },
  }));
  app.use(express.json({ limit: '8kb' }));

  function sessionForToken(token: string | null, nowMs: number): SessionRow | undefined {
    if (!token) return undefined;
    return database.raw.prepare('SELECT id, expires_at_ms FROM guest_sessions WHERE token_hash=? AND expires_at_ms>?')
      .get(hashToken(token), nowMs) as SessionRow | undefined;
  }

  app.get('/healthz', (_request, response) => {
    if (closing) response.status(503).json({ ok: false });
    else response.json({ ok: true });
  });

  app.post('/api/session', (request, response) => {
    const nowMs = Date.now();
    const address = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const perMinute = limiter.allow(`http:${address}:session:minute`, 60, 60_000, nowMs);
    const perHour = limiter.allow(`http:${address}:session:hour`, 500, 60 * 60_000, nowMs);
    if (!perMinute || !perHour) {
      response.setHeader('Retry-After', '60');
      response.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }
    const token = parseCookieToken(request.headers.cookie);
    let session = sessionForToken(token, nowMs);
    let activeToken = token;
    if (!session) {
      activeToken = createSessionToken();
      session = { id: randomUUID(), expires_at_ms: nowMs + SESSION_TTL_MS };
      database.raw.prepare(`
        INSERT INTO guest_sessions(id, token_hash, created_at_ms, last_seen_at_ms, expires_at_ms)
        VALUES (?, ?, ?, ?, ?)
      `).run(session.id, hashToken(activeToken), nowMs, nowMs, session.expires_at_ms);
    } else {
      session.expires_at_ms = nowMs + SESSION_TTL_MS;
      database.raw.prepare('UPDATE guest_sessions SET last_seen_at_ms=?, expires_at_ms=? WHERE id=?')
        .run(nowMs, session.expires_at_ms, session.id);
    }
    response.setHeader('Set-Cookie', cookie.serialize(SESSION_COOKIE, activeToken!, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    }));
    const body: SessionResponse = {
      sessionId: session.id,
      reconnectableRoomCode: roomService.getReconnectableRoomCode(session.id),
    };
    response.json(body);
  });

  io.use((socket, next) => {
    if (!limiter.allow(`socket:${socketAddress(socket)}:handshake`, 80, 60_000)) {
      next(new Error('RATE_LIMITED'));
      return;
    }
    const origin = socket.handshake.headers.origin;
    if (origin ? !config.allowedOrigins.has(origin) : !config.isTest) {
      next(new Error('ORIGIN_NOT_ALLOWED'));
      return;
    }
    const token = parseCookieToken(socket.handshake.headers.cookie);
    const session = sessionForToken(token, Date.now());
    if (!session) {
      next(new Error('SESSION_REQUIRED'));
      return;
    }
    socket.data.sessionId = session.id;
    next();
  });

  function emitError(socket: GameHallSocket, ack: CommandAck): void {
    if (!ack.ok) socket.emit('command:error', ack.error);
  }

  function socketAddress(socket: GameHallSocket): string {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const forwardedText = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    // The app trusts exactly one Render reverse-proxy hop. With append-style
    // X-Forwarded-For, the nearest untrusted address is the rightmost value;
    // taking a client-controlled first value would make the IP bucket spoofable.
    const nearestAddress = forwardedText?.split(',').at(-1)?.trim();
    return nearestAddress || socket.handshake.address || 'unknown';
  }

  function rateLimitAck(socket: GameHallSocket, event: string, limit: number, windowMs: number, message: string): CommandAck | null {
    const sessionAllowed = limiter.allow(`session:${socket.data.sessionId}:${event}`, limit, windowMs);
    const addressAllowed = limiter.allow(`socket:${socketAddress(socket)}:${event}`, Math.max(40, limit * 4), windowMs);
    if (sessionAllowed && addressAllowed) return null;
    return { ok: false, error: commandError(event, null, 'RATE_LIMITED', message, true) };
  }

  function logSocketError(event: string, error: unknown): void {
    console.error(JSON.stringify({
      level: 'error',
      event: 'socket_command_error',
      command: event,
      message: error instanceof Error ? error.message : 'unknown error',
    }));
  }

  function dispatchSocketCommand(
    socket: GameHallSocket,
    event: string,
    callback: unknown,
    operation: () => CommandAck,
  ): void {
    let result: CommandAck;
    try {
      result = operation();
    } catch (error) {
      logSocketError(event, error);
      result = {
        ok: false,
        error: commandError(event, null, 'INTERNAL_ERROR', '服务暂时无法处理该操作，请稍后重试', true),
      };
    }
    if (typeof callback === 'function') (callback as (ack: CommandAck) => void)(result);
    emitError(socket, result);
  }

  io.on('connection', (socket) => {
    try {
      roomService.connect(socket);
    } catch (error) {
      logSocketError('connection', error);
      socket.emit('command:error', commandError('connection', null, 'INTERNAL_ERROR', '恢复房间失败，请重新连接', true));
      socket.disconnect(true);
      return;
    }

    socket.on('room:create', (payload, callback) => {
      dispatchSocketCommand(socket, 'room:create', callback, () => {
        const limited = rateLimitAck(socket, 'room:create', 8, 60_000, '创建房间太频繁');
        if (limited) return limited;
        const parsed = createRoomSchema.safeParse(payload);
        return parsed.success
          ? roomService.createRoom(socket.data.sessionId, parsed.data)
          : { ok: false, error: commandError('room:create', null, 'INVALID_PAYLOAD', '创建参数不合法') };
      });
    });

    socket.on('room:join', (payload, callback) => {
      dispatchSocketCommand(socket, 'room:join', callback, () => {
        const limited = rateLimitAck(socket, 'room:join', 20, 60_000, '邀请码尝试太频繁');
        if (limited) return limited;
        const parsed = joinRoomSchema.safeParse(payload);
        return parsed.success
          ? roomService.joinRoom(socket.data.sessionId, parsed.data)
          : { ok: false, error: commandError('room:join', null, 'INVALID_PAYLOAD', '邀请码或昵称格式不合法') };
      });
    });

    socket.on('room:ready', (payload, callback) => {
      dispatchSocketCommand(socket, 'room:ready', callback, () => {
        const limited = rateLimitAck(socket, 'room:ready', 30, 60_000, '准备状态切换太频繁');
        if (limited) return limited;
        const parsed = readyRoomSchema.safeParse(payload);
        return parsed.success
          ? roomService.setReady(socket.data.sessionId, parsed.data)
          : { ok: false, error: commandError('room:ready', null, 'INVALID_PAYLOAD', '准备状态不合法') };
      });
    });

    socket.on('room:leave', (payload, callback) => {
      dispatchSocketCommand(socket, 'room:leave', callback, () => {
        const limited = rateLimitAck(socket, 'room:leave', 10, 60_000, '离开请求太频繁');
        if (limited) return limited;
        const parsed = leaveRoomSchema.safeParse(payload);
        return parsed.success
          ? roomService.leaveRoom(socket.data.sessionId, parsed.data)
          : { ok: false, error: commandError('room:leave', null, 'INVALID_PAYLOAD', '离开房间参数不合法') };
      });
    });

    socket.on('game:action', (payload, callback) => {
      dispatchSocketCommand(socket, 'game:action', callback, () => {
        const limited = rateLimitAck(socket, 'game:action', 120, 60_000, '操作太频繁');
        if (limited) return limited;
        const parsed = gameActionSchema.safeParse(payload);
        return parsed.success
          ? roomService.applyGameAction(socket.data.sessionId, parsed.data)
          : { ok: false, error: commandError('game:action', null, 'INVALID_PAYLOAD', '游戏操作格式不合法') };
      });
    });

    socket.on('game:rematch', (payload, callback) => {
      dispatchSocketCommand(socket, 'game:rematch', callback, () => {
        const limited = rateLimitAck(socket, 'game:rematch', 20, 60_000, '复赛请求太频繁');
        if (limited) return limited;
        const parsed = rematchSchema.safeParse(payload);
        return parsed.success
          ? roomService.requestRematch(socket.data.sessionId, parsed.data)
          : { ok: false, error: commandError('game:rematch', null, 'INVALID_PAYLOAD', '复赛请求不合法') };
      });
    });

    socket.on('reaction:send', (payload, callback) => {
      dispatchSocketCommand(socket, 'reaction:send', callback, () => {
        const limited = rateLimitAck(socket, 'reaction:send', 12, 10_000, '表情发送太频繁');
        if (limited) return limited;
        const parsed = reactionSchema.safeParse(payload);
        return parsed.success
          ? roomService.sendReaction(socket.data.sessionId, parsed.data.roomId, parsed.data.reaction)
          : { ok: false, error: commandError('reaction:send', null, 'INVALID_REACTION', '不支持这个表情') };
      });
    });

    socket.on('disconnect', () => {
      try {
        roomService.disconnect(socket);
      } catch (error) {
        logSocketError('disconnect', error);
      }
    });
  });

  if (fs.existsSync(config.webDistPath)) {
    app.use(express.static(config.webDistPath, { index: false, maxAge: config.isProduction ? '1h' : 0 }));
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api/') || request.path === '/healthz') return next();
      response.sendFile(path.join(config.webDistPath, 'index.html'));
    });
  }

  app.use('/api', (_request, response) => response.status(404).json({ error: 'NOT_FOUND' }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    console.error(JSON.stringify({ level: 'error', event: 'http_error', message: error instanceof Error ? error.message : 'unknown error' }));
    response.status(500).json({ error: 'INTERNAL_ERROR' });
  });

  const startupNowMs = Date.now();
  const previousRuntime = database.raw.prepare('SELECT heartbeat_at_ms FROM server_runtime WHERE singleton=1')
    .get() as { heartbeat_at_ms: number } | undefined;
  roomService.recoverAfterRestart(startupNowMs, previousRuntime?.heartbeat_at_ms ?? startupNowMs);
  writeRuntimeHeartbeat(startupNowMs);
  let lastSweepErrorAtMs = 0;
  const sweepTimer = setInterval(() => {
    try {
      roomService.sweep();
    } catch (error) {
      const nowMs = Date.now();
      if (nowMs - lastSweepErrorAtMs >= 5_000) {
        lastSweepErrorAtMs = nowMs;
        logSocketError('room_sweep', error);
      }
    }
  }, 250);
  sweepTimer.unref();
  const limiterTimer = setInterval(() => limiter.sweep(), 60_000);
  limiterTimer.unref();
  let lastHeartbeatErrorAtMs = 0;
  const heartbeatTimer = setInterval(() => {
    try {
      writeRuntimeHeartbeat(Date.now());
    } catch (error) {
      const nowMs = Date.now();
      if (nowMs - lastHeartbeatErrorAtMs >= 5_000) {
        lastHeartbeatErrorAtMs = nowMs;
        logSocketError('runtime_heartbeat', error);
      }
    }
  }, 1_000);
  heartbeatTimer.unref();

  async function start(): Promise<RunningGameHallServer> {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.host, () => resolve());
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('server did not expose a TCP port');
    const url = `http://127.0.0.1:${address.port}`;
    return {
      url,
      port: address.port,
      database,
      roomService,
      close: async () => {
        if (closing) return;
        closing = true;
        clearInterval(sweepTimer);
        clearInterval(limiterTimer);
        clearInterval(heartbeatTimer);
        const shutdownNowMs = Date.now();
        roomService.recoverAfterRestart(shutdownNowMs, shutdownNowMs);
        writeRuntimeHeartbeat(shutdownNowMs);
        await new Promise<void>((resolve) => io.close(() => resolve()));
        if ((httpServer as HttpServer).listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        database.close();
      },
    };
  }

  return { app, httpServer, io, database, roomService, start };
}
