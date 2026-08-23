import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  CommandAck,
  CommandError,
  GameActionCommand,
  GameId,
  GameSnapshot,
  Reaction,
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

export type ReactionToast = {
  id: string;
  nickname: string;
  reaction: Reaction;
};

export function useGameHallClient() {
  const socketRef = useRef<GameHallSocket | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<CommandError | null>(null);
  const [reactions, setReactions] = useState<ReactionToast[]>([]);

  useEffect(() => {
    let cancelled = false;
    let socket: GameHallSocket | null = null;
    void fetch('/api/session', { method: 'POST', credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('SESSION_FAILED');
        return response.json() as Promise<SessionResponse>;
      })
      .then((value) => {
        if (cancelled) return;
        setSession(value);
        socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
        socketRef.current = socket;
        socket.on('connect', () => {
          setConnection('online');
          setError(null);
        });
        socket.on('connect_error', () => {
          setConnection('offline');
          setError({ event: 'connection', commandId: null, code: 'CONNECT_FAILED', message: '实时服务连接失败，正在自动重试', retryable: true });
        });
        socket.on('disconnect', () => setConnection('offline'));
        socket.io.on('reconnect_attempt', () => setConnection('connecting'));
        socket.io.on('reconnect_failed', () => {
          setConnection('offline');
          setError({ event: 'connection', commandId: null, code: 'RECONNECT_FAILED', message: '自动重连未成功，请点击重新连接', retryable: true });
        });
        socket.on('room:snapshot', (snapshot) => {
          setRoom((current) => current && current.roomId === snapshot.roomId && current.version > snapshot.version ? current : snapshot);
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
          }
        });
        socket.on('reaction:received', (message) => {
          const id = crypto.randomUUID();
          setReactions((current) => [...current.slice(-2), { id, nickname: message.nickname, reaction: message.reaction }]);
          window.setTimeout(() => setReactions((current) => current.filter((item) => item.id !== id)), 2_600);
        });
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setConnection('offline');
        setError({ event: 'session', commandId: null, code: 'SESSION_FAILED', message: '无法连接服务，请稍后刷新重试', retryable: true });
      });
    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, []);

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

  const sendReaction = useCallback(async (reaction: Reaction): Promise<CommandAck> => {
    if (!room) return failCommand('reaction:send', null, 'NO_ROOM', '当前不在房间中');
    return emitWithAck('reaction:send', { roomId: room.roomId, reaction });
  }, [emitWithAck, failCommand, room]);

  const reconnect = useCallback(() => {
    setError(null);
    setConnection('connecting');
    const socket = socketRef.current;
    if (!socket) return;
    socket.connect();
    socket.io.open();
  }, []);

  return {
    loading,
    connection,
    session,
    room,
    game,
    error,
    reactions,
    clearError: () => setError(null),
    reconnect,
    createRoom,
    joinRoom,
    setReady,
    leaveRoom,
    submitGameAction,
    requestRematch,
    sendReaction,
  };
}

export type GameHallClient = ReturnType<typeof useGameHallClient>;
