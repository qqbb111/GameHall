import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  CommandAck,
  CommandError,
  GameActionCommand,
  GameId,
  GameSnapshot,
  RoomMessage,
  RoomSnapshot,
  ServerToClientEvents,
  SessionResponse,
} from '@gamehall/protocol';
import { secureUuid } from './secure-id';

type GameHallSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckEmitter = {
  timeout: (timeoutMs: number) => {
    emit: (event: string, payload: unknown, callback: (error: Error | null, result?: CommandAck) => void) => void;
  };
};

const ACK_TIMEOUT_MS = 8_000;
const SESSION_TIMEOUT_MS = 7_000;
const SESSION_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 8_000, 8_000] as const;

export type MessageToast = {
  id: string;
  nickname: string;
  content: string;
};

export function useGameHallClient() {
  const socketRef = useRef<GameHallSocket | null>(null);
  const mountedRef = useRef(false);
  const bootstrapRef = useRef<() => Promise<void>>(async () => undefined);
  const bootstrapInFlightRef = useRef<Promise<void> | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const sessionRefreshAttemptsRef = useRef(0);
  const connectionBlockedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const admissionGenerationRef = useRef(0);
  const expectedRoomRef = useRef<{ roomId?: string; code?: string; anyNew?: boolean; previousRoomId?: string } | null>(null);
  const abandonedRoomsRef = useRef(new Set<string>());
  const roomEpochRef = useRef(0);
  const uncertainActionRef = useRef<{ command: GameActionCommand; epoch: number; socket: GameHallSocket | null } | null>(null);
  const inFlightActionRef = useRef<{ roomId: string; epoch: number } | null>(null);
  const syncRoomRef = useRef<(roomId: string) => Promise<CommandAck>>(async () => ({ ok: false } as CommandAck));
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const latestRoomRef = useRef<RoomSnapshot | null>(null);
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<CommandError | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [messageToasts, setMessageToasts] = useState<MessageToast[]>([]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current === null) return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;

    function bindSocket(socket: GameHallSocket) {
      const isCurrent = () => active && mountedRef.current && socketRef.current === socket;
      function syncCurrentRoom() {
        const current = latestRoomRef.current;
        if (isCurrent() && socket.connected && current) void syncRoomRef.current(current.roomId);
      }
      socket.on('connect', () => {
        if (!isCurrent()) return;
        retryAttemptRef.current = 0;
        sessionRefreshAttemptsRef.current = 0;
        connectionBlockedRef.current = false;
        clearRetryTimer();
        setConnection('online');
        setError(null);
        syncCurrentRoom();
      });
      socket.on('connect_error', (cause) => {
        if (!isCurrent()) return;
        if (cause.message === 'SESSION_REQUIRED' && sessionRefreshAttemptsRef.current < 2) {
          sessionRefreshAttemptsRef.current++;
          void bootstrapRef.current();
          return;
        }
        setConnection('offline');
        const blocked = cause.message === 'ORIGIN_NOT_ALLOWED' || cause.message === 'RATE_LIMITED';
        connectionBlockedRef.current = blocked;
        if (blocked) socket.disconnect();
        setError({ event: 'connection', commandId: null, code: blocked ? cause.message : 'CONNECT_FAILED',
          message: blocked ? '当前连接请求被服务端拒绝，请稍后再试' : '实时服务连接失败，正在自动重试', retryable: !blocked });
      });
      socket.on('disconnect', () => {
        if (isCurrent()) setConnection('offline');
      });
      socket.io.on('reconnect_attempt', () => {
        if (isCurrent()) setConnection('connecting');
      });
      socket.io.on('reconnect_failed', () => {
        if (!isCurrent()) return;
        setConnection('offline');
        setError({ event: 'connection', commandId: null, code: 'RECONNECT_FAILED', message: '自动重连未成功，请点击重新连接', retryable: true });
      });
      function receiveRoom(snapshot: RoomSnapshot) {
        if (!isCurrent() || abandonedRoomsRef.current.has(snapshot.roomId)) return;
        const current = latestRoomRef.current;
        if (!current || current.roomId !== snapshot.roomId) {
          const expected = expectedRoomRef.current;
          const admitted = expected && (expected.roomId === snapshot.roomId || expected.code === snapshot.code
            || (expected.anyNew === true && expected.previousRoomId !== snapshot.roomId));
          if (!admitted) return;
          expectedRoomRef.current = null;
          roomEpochRef.current++;
          uncertainActionRef.current = null;
        }
        if (current?.roomId === snapshot.roomId && current.version > snapshot.version) return;
        latestRoomRef.current = snapshot;
        setRoom(snapshot);
        if (snapshot.status === 'waiting' || (current && current.roomId !== snapshot.roomId)) setGame(null);
        setMessages((current) => current.length > 0 && current[0]?.roomId !== snapshot.roomId ? [] : current);
      }
      socket.on('room:snapshot', receiveRoom);
      socket.on('game:snapshot', (snapshot) => {
        if (!isCurrent()) return;
        const latest = latestRoomRef.current;
        if (!latest || latest.roomId !== snapshot.roomId || latest.status === 'waiting' || latest.version > snapshot.version) return;
        setGame((current) => current && current.roomId === snapshot.roomId && current.version > snapshot.version ? current : snapshot);
      });
      socket.on('presence:update', receiveRoom);
      socket.on('command:error', (commandError) => {
        // Commands sent by this client always have ACK callbacks, which also
        // know whether their room/connection is still current. The parallel
        // error event must not reintroduce an old room's error after its ACK
        // was discarded. Only room:closed is an unsolicited system event.
        if (!isCurrent() || commandError.event !== 'room:closed' || commandError.roomId !== latestRoomRef.current?.roomId) return;
        setError(commandError);
        abandonedRoomsRef.current.add(commandError.roomId!);
        admissionGenerationRef.current++;
        roomEpochRef.current++;
        uncertainActionRef.current = null;
        latestRoomRef.current = null;
        setRoom(null);
        setGame(null);
        setMessages([]);
        setSession((current) => current ? { ...current, reconnectableRoomCode: null } : current);
      });
      socket.on('room:message:history', (payload) => {
        if (!isCurrent() || payload.roomId !== latestRoomRef.current?.roomId) return;
        setMessages(payload.messages.slice(-100));
      });
      socket.on('room:message', (message) => {
        if (!isCurrent() || message.roomId !== latestRoomRef.current?.roomId) return;
        setMessages((current) => current.some((item) => item.messageId === message.messageId)
          ? current
          : [...current, message].slice(-100));
        let id: string;
        try { id = secureUuid(); }
        catch { return; }
        setMessageToasts((current) => [...current.slice(-2), { id, nickname: message.nickname, content: message.content }]);
        window.setTimeout(() => {
          if (isCurrent()) setMessageToasts((current) => current.filter((item) => item.id !== id));
        }, 2_600);
      });
    }

    function scheduleSessionRetry() {
      clearRetryTimer();
      const attempt = retryAttemptRef.current;
      const delay = SESSION_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !active || !mountedRef.current) return;
      retryAttemptRef.current = attempt + 1;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void bootstrapRef.current();
      }, delay);
    }

    async function bootstrapConnection() {
      if (bootstrapInFlightRef.current) return bootstrapInFlightRef.current;

      clearRetryTimer();
      setConnection('connecting');
      setError(null);
      const operation = (async () => {
        try {
          const response = await fetch('/api/session', { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(SESSION_TIMEOUT_MS) });
          if (!response.ok) throw new Error('SESSION_FAILED');
          const value = await response.json() as SessionResponse;
          if (!active || !mountedRef.current) return;

          if (sessionIdRef.current && sessionIdRef.current !== value.sessionId) {
            admissionGenerationRef.current++;
            roomEpochRef.current++;
            latestRoomRef.current = null;
            uncertainActionRef.current = null;
            expectedRoomRef.current = null;
            setRoom(null); setGame(null); setMessages([]);
          }
          sessionIdRef.current = value.sessionId;
          setSession(value);
          if (!latestRoomRef.current && !expectedRoomRef.current && value.reconnectableRoomCode) expectedRoomRef.current = { code: value.reconnectableRoomCode };
          const previousSocket = socketRef.current;
          if (previousSocket) previousSocket.disconnect();
          const socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], tryAllTransports: true,
            timeout: SESSION_TIMEOUT_MS, reconnectionAttempts: 6, reconnectionDelayMax: 8_000 });
          socketRef.current = socket;
          bindSocket(socket);
          setLoading(false);
        } catch {
          if (!active || !mountedRef.current) return;
          setLoading(false);
          setConnection('offline');
          setError({ event: 'session', commandId: null, code: 'SESSION_FAILED', message: '暂时无法连接服务，正在自动重试', retryable: true });
          scheduleSessionRetry();
        }
      })();

      bootstrapInFlightRef.current = operation;
      try {
        await operation;
      } finally {
        if (bootstrapInFlightRef.current === operation) bootstrapInFlightRef.current = null;
      }
    }

    bootstrapRef.current = bootstrapConnection;
    void bootstrapConnection();

    return () => {
      active = false;
      mountedRef.current = false;
      bootstrapRef.current = async () => undefined;
      clearRetryTimer();
      socketRef.current?.disconnect();
      socketRef.current = null;
      bootstrapInFlightRef.current = null;
    };
  }, [clearRetryTimer]);

  const requireSocket = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) throw new Error('服务连接尚未恢复');
    return socket;
  }, []);

  const failCommand = useCallback((event: string, commandId: string | null, code: string, message: string): CommandAck => {
    const commandError: CommandError = { event, commandId, code, message, retryable: true };
    setError(commandError);
    return { ok: false, error: commandError };
  }, []);

  const commandIdentity = useCallback((event: string): { id: string } | { failure: CommandAck } => {
    try { return { id: secureUuid() }; }
    catch { return { failure: failCommand(event, null, 'SECURE_RANDOM_UNAVAILABLE', '当前浏览器无法生成安全操作编号，请换用支持安全随机数的浏览器或 HTTPS。') }; }
  }, [failCommand]);

  const emitWithAck = useCallback(async (event: string, payload: unknown, commandId: string | null = null, relevant: () => boolean = () => true): Promise<CommandAck> => {
    try {
      const socket = requireSocket();
      const issuedSessionId = sessionIdRef.current;
      const issuedRoomId = payload && typeof payload === 'object' && 'roomId' in payload && typeof payload.roomId === 'string'
        ? payload.roomId : null;
      const issuedRoomEpoch = roomEpochRef.current;
      const isRelevant = () => relevant() && issuedSessionId === sessionIdRef.current &&
        (issuedRoomId === null || (latestRoomRef.current?.roomId === issuedRoomId && roomEpochRef.current === issuedRoomEpoch));
      return await new Promise<CommandAck>((resolve) => {
        (socket as unknown as AckEmitter).timeout(ACK_TIMEOUT_MS).emit(event, payload, (timeoutError, result) => {
          if (!isRelevant()) {
            resolve({ ok: false, error: { event, commandId, code: 'STALE_OPERATION', message: '已切换房间', retryable: false } });
            return;
          }
          if (socketRef.current !== socket) {
            resolve({ ok: false, error: { event, commandId, code: 'CONNECTION_CHANGED', message: '连接已经更新，请查看最新房间状态', retryable: true } });
            return;
          }
          if (timeoutError || !result) {
            resolve(failCommand(event, commandId, 'ACK_TIMEOUT', '服务器未及时确认操作，请先查看最新房间状态'));
            return;
          }
          if (!result.ok) setError(result.error);
          else setError(null);
          resolve(result);
        });
      });
    } catch (cause) {
      if (!relevant()) return { ok: false, error: { event, commandId, code: 'STALE_OPERATION', message: '已切换房间', retryable: false } };
      return failCommand(event, commandId, 'OFFLINE', cause instanceof Error ? cause.message : '服务离线');
    }
  }, [failCommand, requireSocket]);

  const syncRoomById = useCallback(async (roomId: string): Promise<CommandAck> => {
    if (latestRoomRef.current?.roomId !== roomId) return { ok: false, error: { event: 'room:sync', commandId: null, code: 'STALE_OPERATION', message: '已切换房间', retryable: false } };
    const pending = uncertainActionRef.current;
    if (pending?.command.roomId === roomId && pending.socket !== socketRef.current) {
      const replay = await emitWithAck('game:action', pending.command, pending.command.actionId,
        () => roomEpochRef.current === pending.epoch && latestRoomRef.current?.roomId === roomId);
      if (!replay.ok && ['ACK_TIMEOUT', 'CONNECTION_CHANGED', 'OFFLINE', 'STALE_OPERATION'].includes(replay.error.code)) return replay;
      pending.socket = socketRef.current;
    }
    const epoch = roomEpochRef.current;
    const identity = commandIdentity('room:sync');
    if ('failure' in identity) return identity.failure;
    const result = await emitWithAck('room:sync', { commandId: identity.id, roomId }, identity.id,
      () => roomEpochRef.current === epoch && latestRoomRef.current?.roomId === roomId);
    if (result.ok && uncertainActionRef.current?.command.roomId === roomId && uncertainActionRef.current.epoch === epoch) uncertainActionRef.current = null;
    return result;
  }, [commandIdentity, emitWithAck]);
  useEffect(() => { syncRoomRef.current = syncRoomById; }, [syncRoomById]);

  const createRoom = useCallback(async (nickname: string, gameId: GameId): Promise<CommandAck> => {
    setError(null);
    const identity = commandIdentity('room:create');
    if ('failure' in identity) return identity.failure;
    const commandId = identity.id;
    const generation = ++admissionGenerationRef.current;
    const issuedSessionId = sessionIdRef.current;
    const isCurrentAdmission = () => generation === admissionGenerationRef.current && issuedSessionId === sessionIdRef.current;
    expectedRoomRef.current = { anyNew: true, ...(latestRoomRef.current ? { previousRoomId: latestRoomRef.current.roomId } : {}) };
    const result = await emitWithAck('room:create', { commandId, nickname, gameId }, commandId, isCurrentAdmission);
    if (!isCurrentAdmission()) return result;
    if (result.ok) {
      expectedRoomRef.current = latestRoomRef.current?.roomId === result.roomId ? null : result.roomId ? { roomId: result.roomId } : { anyNew: true };
    } else if (result.error.code !== 'ACK_TIMEOUT' && result.error.code !== 'CONNECTION_CHANGED') expectedRoomRef.current = null;
    return result;
  }, [commandIdentity, emitWithAck]);

  const joinRoom = useCallback(async (nickname: string, code: string): Promise<CommandAck> => {
    setError(null);
    const identity = commandIdentity('room:join');
    if ('failure' in identity) return identity.failure;
    const commandId = identity.id;
    const generation = ++admissionGenerationRef.current;
    const issuedSessionId = sessionIdRef.current;
    const isCurrentAdmission = () => generation === admissionGenerationRef.current && issuedSessionId === sessionIdRef.current;
    expectedRoomRef.current = { code };
    const result = await emitWithAck('room:join', { commandId, nickname, code }, commandId, isCurrentAdmission);
    if (!isCurrentAdmission()) return result;
    if (result.ok) {
      expectedRoomRef.current = latestRoomRef.current?.roomId === result.roomId ? null : result.roomId ? { roomId: result.roomId } : { code };
    } else if (result.error.code !== 'ACK_TIMEOUT' && result.error.code !== 'CONNECTION_CHANGED') expectedRoomRef.current = null;
    return result;
  }, [commandIdentity, emitWithAck]);

  const setReady = useCallback(async (ready: boolean): Promise<CommandAck> => {
    if (!room) return failCommand('room:ready', null, 'NO_ROOM', '当前不在房间中');
    const identity = commandIdentity('room:ready');
    if ('failure' in identity) return identity.failure;
    const commandId = identity.id;
    return emitWithAck('room:ready', { commandId, roomId: room.roomId, ready }, commandId);
  }, [commandIdentity, emitWithAck, failCommand, room]);

  const leaveRoom = useCallback(async (): Promise<CommandAck> => {
    if (!room) return { ok: true };
    const identity = commandIdentity('room:leave');
    if ('failure' in identity) return identity.failure;
    const commandId = identity.id;
    const result = await emitWithAck('room:leave', { commandId, roomId: room.roomId }, commandId);
    if (result.ok && latestRoomRef.current?.roomId === room.roomId) {
      abandonedRoomsRef.current.add(room.roomId);
      admissionGenerationRef.current++;
      roomEpochRef.current++;
      expectedRoomRef.current = null;
      uncertainActionRef.current = null;
      latestRoomRef.current = null;
      setRoom(null);
      setGame(null);
      setMessages([]);
      setSession((current) => current ? { ...current, reconnectableRoomCode: null } : current);
    }
    return result;
  }, [commandIdentity, emitWithAck, room]);

  const submitGameAction = useCallback(async (action: GameActionCommand['action']): Promise<CommandAck> => {
    if (!room) return failCommand('game:action', null, 'NO_ROOM', '当前不在房间中');
    if (uncertainActionRef.current?.command.roomId === room.roomId) return failCommand('game:action', uncertainActionRef.current.command.actionId, 'ACTION_PENDING_SYNC', '上一操作尚未核对，请先重新连接并同步棋盘');
    if (inFlightActionRef.current?.roomId === room.roomId) return failCommand('game:action', null, 'ACTION_IN_FLIGHT', '上一操作正在确认，请稍候');
    const identity = commandIdentity('game:action');
    if ('failure' in identity) return identity.failure;
    const epoch = roomEpochRef.current;
    inFlightActionRef.current = { roomId: room.roomId, epoch };
    const actionSocket = socketRef.current;
    const relevant = () => roomEpochRef.current === epoch && latestRoomRef.current?.roomId === room.roomId;
    const command: GameActionCommand = {
      actionId: identity.id,
      roomId: room.roomId,
      expectedVersion: room.version,
      action,
    };
    try {
      let result = await emitWithAck('game:action', command, command.actionId, relevant);
      if (!relevant()) return result;
      if (!result.ok && result.error.code === 'ACK_TIMEOUT' && socketRef.current?.connected) {
        // The same actionId has a durable server receipt. A lost ACK cannot turn
        // this second send into a second move, including scoring chains.
        result = await emitWithAck('game:action', command, command.actionId, relevant);
      }
      if (!relevant()) return result;
      if (!result.ok && (result.error.code === 'ACK_TIMEOUT' || result.error.code === 'CONNECTION_CHANGED')) {
        uncertainActionRef.current = { command, epoch, socket: actionSocket };
        if (socketRef.current?.connected) await syncRoomById(command.roomId);
        if (!relevant()) return { ok: false, error: { event: 'game:action', commandId: command.actionId, code: 'STALE_OPERATION', message: '已切换房间', retryable: false } };
        return failCommand('game:action', command.actionId, 'ACTION_UNCERTAIN', '操作结果尚未确认，已请求同步棋盘；确认局面后再行动');
      }
      return result;
    } finally {
      if (inFlightActionRef.current?.roomId === room.roomId && inFlightActionRef.current.epoch === epoch) inFlightActionRef.current = null;
    }
  }, [commandIdentity, emitWithAck, failCommand, room, syncRoomById]);

  const requestRematch = useCallback(async (requested = true): Promise<CommandAck> => {
    if (!room) return failCommand('game:rematch', null, 'NO_ROOM', '当前不在房间中');
    const identity = commandIdentity('game:rematch');
    if ('failure' in identity) return identity.failure;
    const commandId = identity.id;
    return emitWithAck('game:rematch', { commandId, roomId: room.roomId, requested }, commandId);
  }, [commandIdentity, emitWithAck, failCommand, room]);

  const startRoom = useCallback(async (): Promise<CommandAck> => {
    if (!room) return failCommand('room:start', null, 'NO_ROOM', '当前不在房间中');
    const identity = commandIdentity('room:start');
    if ('failure' in identity) return identity.failure;
    const commandId = identity.id;
    return emitWithAck('room:start', { commandId, roomId: room.roomId, expectedVersion: room.version }, commandId);
  }, [commandIdentity, emitWithAck, failCommand, room]);

  const reopenRoom = useCallback(async (): Promise<CommandAck> => {
    if (!room) return failCommand('room:reopen', null, 'NO_ROOM', '当前不在房间中');
    const identity = commandIdentity('room:reopen');
    if ('failure' in identity) return identity.failure;
    const commandId = identity.id;
    return emitWithAck('room:reopen', { commandId, roomId: room.roomId, expectedVersion: room.version }, commandId);
  }, [commandIdentity, emitWithAck, failCommand, room]);

  const sendMessage = useCallback(async (content: string): Promise<CommandAck> => {
    if (!room) return failCommand('room:message:send', null, 'NO_ROOM', '当前不在房间中');
    const identity = commandIdentity('room:message:send');
    if ('failure' in identity) return identity.failure;
    const messageId = identity.id;
    return emitWithAck('room:message:send', { messageId, roomId: room.roomId, content }, messageId);
  }, [commandIdentity, emitWithAck, failCommand, room]);

  const reconnect = useCallback(() => {
    connectionBlockedRef.current = false;
    setError(null);
    setConnection('connecting');
    clearRetryTimer();
    const socket = socketRef.current;
    if (!socket) {
      void bootstrapRef.current();
      return;
    }
    if (socket.connected) {
      if (latestRoomRef.current) void syncRoomById(latestRoomRef.current.roomId);
      setConnection('online');
      return;
    }
    socket.connect();
  }, [clearRetryTimer, syncRoomById]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      if (connectionBlockedRef.current) return;
      const current = latestRoomRef.current;
      if (socketRef.current?.connected && current) void syncRoomById(current.roomId);
      else if (!socketRef.current?.connected) reconnect();
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [reconnect, syncRoomById]);

  return {
    loading,
    connection,
    session,
    room,
    game,
    error,
    messages,
    messageToasts,
    clearError: () => setError(null),
    reconnect,
    createRoom,
    joinRoom,
    setReady,
    leaveRoom,
    submitGameAction,
    requestRematch,
    startRoom,
    reopenRoom,
    sendMessage,
  };
}

export type GameHallClient = ReturnType<typeof useGameHallClient>;
