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

type GameHallSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckEmitter = {
  timeout: (timeoutMs: number) => {
    emit: (event: string, payload: unknown, callback: (error: Error | null, result?: CommandAck) => void) => void;
  };
};

const ACK_TIMEOUT_MS = 8_000;
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
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
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
      socket.on('connect', () => {
        if (!active || !mountedRef.current || socketRef.current !== socket) return;
        retryAttemptRef.current = 0;
        clearRetryTimer();
        setConnection('online');
        setError(null);
      });
      socket.on('connect_error', () => {
        if (!active || !mountedRef.current || socketRef.current !== socket) return;
        setConnection('offline');
        setError({ event: 'connection', commandId: null, code: 'CONNECT_FAILED', message: '实时服务连接失败，正在自动重试', retryable: true });
      });
      socket.on('disconnect', () => {
        if (active && mountedRef.current && socketRef.current === socket) setConnection('offline');
      });
      socket.io.on('reconnect_attempt', () => {
        if (active && mountedRef.current && socketRef.current === socket) setConnection('connecting');
      });
      socket.io.on('reconnect_failed', () => {
        if (!active || !mountedRef.current || socketRef.current !== socket) return;
        setConnection('offline');
        setError({ event: 'connection', commandId: null, code: 'RECONNECT_FAILED', message: '自动重连未成功，请点击重新连接', retryable: true });
      });
      socket.on('room:snapshot', (snapshot) => {
        setRoom((current) => current && current.roomId === snapshot.roomId && current.version > snapshot.version ? current : snapshot);
        setMessages((current) => current.length > 0 && current[0]?.roomId !== snapshot.roomId ? [] : current);
      });
      socket.on('game:snapshot', (snapshot) => {
        setGame((current) => current && current.roomId === snapshot.roomId && current.version > snapshot.version ? current : snapshot);
      });
      socket.on('presence:update', (snapshot) => {
        setRoom((current) => current && current.roomId === snapshot.roomId && current.version > snapshot.version ? current : snapshot);
      });
      socket.on('command:error', (commandError) => {
        setError(commandError);
        if (commandError.event === 'room:closed') {
          setRoom(null);
          setGame(null);
          setMessages([]);
          setSession((current) => current ? { ...current, reconnectableRoomCode: null } : current);
        }
      });
      socket.on('room:message:history', (payload) => {
        setMessages(payload.messages.slice(-100));
      });
      socket.on('room:message', (message) => {
        setMessages((current) => current.some((item) => item.messageId === message.messageId)
          ? current
          : [...current, message].slice(-100));
        const id = crypto.randomUUID();
        setMessageToasts((current) => [...current.slice(-2), { id, nickname: message.nickname, content: message.content }]);
        window.setTimeout(() => {
          if (active && mountedRef.current) setMessageToasts((current) => current.filter((item) => item.id !== id));
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
          const response = await fetch('/api/session', { method: 'POST', credentials: 'include' });
          if (!response.ok) throw new Error('SESSION_FAILED');
          const value = await response.json() as SessionResponse;
          if (!active || !mountedRef.current) return;

          setSession(value);
          const previousSocket = socketRef.current;
          if (previousSocket) previousSocket.disconnect();
          const socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
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

  const emitWithAck = useCallback(async (event: string, payload: unknown, commandId: string | null = null): Promise<CommandAck> => {
    try {
      const socket = requireSocket();
      return await new Promise<CommandAck>((resolve) => {
        (socket as unknown as AckEmitter).timeout(ACK_TIMEOUT_MS).emit(event, payload, (timeoutError, result) => {
          if (timeoutError || !result) {
            resolve(failCommand(event, commandId, 'ACK_TIMEOUT', '服务器未及时确认操作，请检查连接后重试'));
            return;
          }
          if (!result.ok) setError(result.error);
          resolve(result);
        });
      });
    } catch (cause) {
      return failCommand(event, commandId, 'OFFLINE', cause instanceof Error ? cause.message : '服务离线');
    }
  }, [failCommand, requireSocket]);

  const createRoom = useCallback(async (nickname: string, gameId: GameId): Promise<CommandAck> => {
    setError(null);
    const commandId = crypto.randomUUID();
    return emitWithAck('room:create', { commandId, nickname, gameId }, commandId);
  }, [emitWithAck]);

  const joinRoom = useCallback(async (nickname: string, code: string): Promise<CommandAck> => {
    setError(null);
    const commandId = crypto.randomUUID();
    return emitWithAck('room:join', { commandId, nickname, code }, commandId);
  }, [emitWithAck]);

  const setReady = useCallback(async (ready: boolean): Promise<CommandAck> => {
    if (!room) return failCommand('room:ready', null, 'NO_ROOM', '当前不在房间中');
    const commandId = crypto.randomUUID();
    return emitWithAck('room:ready', { commandId, roomId: room.roomId, ready }, commandId);
  }, [emitWithAck, failCommand, room]);

  const leaveRoom = useCallback(async (): Promise<CommandAck> => {
    if (!room) return { ok: true };
    const commandId = crypto.randomUUID();
    const result = await emitWithAck('room:leave', { commandId, roomId: room.roomId }, commandId);
    if (result.ok) {
      setRoom(null);
      setGame(null);
      setMessages([]);
      setSession((current) => current ? { ...current, reconnectableRoomCode: null } : current);
    }
    return result;
  }, [emitWithAck, room]);

  const submitGameAction = useCallback(async (action: GameActionCommand['action']): Promise<CommandAck> => {
    if (!room) return failCommand('game:action', null, 'NO_ROOM', '当前不在房间中');
    const command: GameActionCommand = {
      actionId: crypto.randomUUID(),
      roomId: room.roomId,
      expectedVersion: room.version,
      action,
    };
    return emitWithAck('game:action', command, command.actionId);
  }, [emitWithAck, failCommand, room]);

  const requestRematch = useCallback(async (requested = true): Promise<CommandAck> => {
    if (!room) return failCommand('game:rematch', null, 'NO_ROOM', '当前不在房间中');
    const commandId = crypto.randomUUID();
    return emitWithAck('game:rematch', { commandId, roomId: room.roomId, requested }, commandId);
  }, [emitWithAck, failCommand, room]);

  const sendMessage = useCallback(async (content: string): Promise<CommandAck> => {
    if (!room) return failCommand('room:message:send', null, 'NO_ROOM', '当前不在房间中');
    const messageId = crypto.randomUUID();
    return emitWithAck('room:message:send', { messageId, roomId: room.roomId, content }, messageId);
  }, [emitWithAck, failCommand, room]);

  const reconnect = useCallback(() => {
    setError(null);
    setConnection('connecting');
    clearRetryTimer();
    const socket = socketRef.current;
    if (!socket) {
      void bootstrapRef.current();
      return;
    }
    socket.connect();
    socket.io.open();
  }, [clearRetryTimer]);

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
    sendMessage,
  };
}

export type GameHallClient = ReturnType<typeof useGameHallClient>;
