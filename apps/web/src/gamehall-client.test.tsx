import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import { useGameHallClient } from './gamehall-client';

type Handler = (...args: never[]) => void;
type Ack = (error: Error | null, result?: { ok: boolean; roomId?: string; code?: string; version?: number }) => void;

const socketMocks = vi.hoisted(() => ({
  sockets: [] as Array<{
    connected: boolean;
    handlers: Map<string, Handler>;
    managerHandlers: Map<string, Handler>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    timedEmits: Array<{ event: string; payload: unknown; ack: Ack }>;
    trigger: (event: string, payload?: unknown) => void;
    io: { on: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> };
  }>,
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const handlers = new Map<string, Handler>();
    const managerHandlers = new Map<string, Handler>();
    const timedEmits: Array<{ event: string; payload: unknown; ack: Ack }> = [];
    const socket = {
      connected: false,
      handlers,
      managerHandlers,
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, handler);
        return socket;
      }),
      connect: vi.fn(() => socket),
      disconnect: vi.fn(() => socket),
      timeout: vi.fn(() => ({ emit: vi.fn((event: string, payload: unknown, ack: Ack) => { timedEmits.push({ event, payload, ack }); }) })),
      timedEmits,
      trigger: (event: string, payload?: unknown) => (handlers.get(event) as unknown as ((value?: unknown) => void) | undefined)?.(payload),
      io: {
        on: vi.fn((event: string, handler: Handler) => {
          managerHandlers.set(event, handler);
          return socket.io;
        }),
        open: vi.fn(),
      },
    };
    socketMocks.sockets.push(socket);
    return socket;
  }),
}));

function sessionResponse(reconnectableRoomCode: string | null = null, sessionId = 'session-1') {
  return new Response(JSON.stringify({ sessionId, reconnectableRoomCode }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useGameHallClient connection recovery', () => {
  it('重开清除旧对局并拒绝上一局的延迟房间和游戏快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse('ABC234')));
    const { result } = renderHook(() => useGameHallClient());
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(1));
    const deliver = (event: string, payload: unknown) => act(() => { (socketMocks.sockets[0]!.handlers.get(event) as unknown as (value: unknown) => void)(payload); });
    const room = { roomId: 'room', code: 'ABC234', gameId: 'splendor', version: 10, status: 'finished', members: [] };
    const game = { roomId: 'room', gameId: 'splendor', version: 10, status: 'finished', view: { phase: 'finished' } };
    deliver('room:snapshot', room); deliver('game:snapshot', game);
    expect(result.current.game?.version).toBe(10);
    deliver('room:snapshot', { ...room, version: 11, status: 'waiting' });
    expect(result.current.game).toBeNull();
    deliver('game:snapshot', game); deliver('presence:update', room);
    expect(result.current.game).toBeNull(); expect(result.current.room?.status).toBe('waiting');
    deliver('room:snapshot', { ...room, version: 14, status: 'active' });
    deliver('game:snapshot', { ...game, version: 14, status: 'active', view: { phase: 'action' } });
    deliver('game:snapshot', game);
    expect(result.current.game?.version).toBe(14);
  });
  beforeEach(() => {
    socketMocks.sockets.length = 0;
    vi.mocked(io).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('首次会话失败后，手动重连会重新获取会话并创建 Socket', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('server not ready'))
      .mockResolvedValueOnce(sessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGameHallClient());

    await waitFor(() => expect(result.current.connection).toBe('offline'));
    act(() => result.current.reconnect());
    await waitFor(() => expect(io).toHaveBeenCalledTimes(1));

    act(() => socketMocks.sockets[0]?.trigger('connect'));
    expect(result.current.connection).toBe('online');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('自动退避后可在服务恢复时建立连接', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('server not ready'))
      .mockResolvedValueOnce(sessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGameHallClient());

    await act(async () => Promise.resolve());
    expect(result.current.connection).toBe('offline');
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(io).toHaveBeenCalledTimes(1);
    act(() => socketMocks.sockets[0]?.trigger('connect'));
    expect(result.current.connection).toBe('online');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('并发重连复用同一个会话请求，不会创建多个 Socket', async () => {
    let resolveSession!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveSession = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGameHallClient());

    act(() => {
      result.current.reconnect();
      result.current.reconnect();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => resolveSession(sessionResponse()));
    await waitFor(() => expect(io).toHaveBeenCalledTimes(1));
  });

  it('卸载时清理自动重试计时器和已创建的 Socket', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('server not ready'));
    vi.stubGlobal('fetch', fetchMock);
    const first = renderHook(() => useGameHallClient());
    await act(async () => Promise.resolve());
    expect(vi.getTimerCount()).toBe(1);
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
    fetchMock.mockResolvedValueOnce(sessionResponse());
    const second = renderHook(() => useGameHallClient());
    await waitFor(() => expect(io).toHaveBeenCalledTimes(1));
    second.unmount();
    expect(socketMocks.sockets[0]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it('只接受当前房间的快照与消息，离房后旧快照不能复活', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse('ABC234')));
    const { result } = renderHook(() => useGameHallClient());
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(1));
    const socket = socketMocks.sockets[0]!;
    const firstRoom = { roomId: 'old', code: 'ABC234', gameId: 'gomoku', version: 1, status: 'finished', members: [] };
    act(() => { socket.connected = true; socket.trigger('connect'); socket.trigger('room:snapshot', firstRoom); });
    expect(result.current.room?.roomId).toBe('old');
    act(() => socket.trigger('room:message:history', { roomId: 'old', messages: [{ roomId: 'old', messageId: 'first', content: '旧消息' }] }));
    expect(result.current.messages).toHaveLength(1);

    let create!: Promise<unknown>;
    act(() => { create = result.current.createRoom('棋手', 'gomoku'); });
    const createEmit = socket.timedEmits.find((item) => item.event === 'room:create')!;
    act(() => {
      socket.trigger('room:snapshot', { ...firstRoom, roomId: 'new', code: 'XYZ789', status: 'waiting' });
      createEmit.ack(null, { ok: true, roomId: 'new', code: 'XYZ789' });
    });
    await act(async () => { await create; });
    expect(result.current.room?.roomId).toBe('new');
    act(() => {
      socket.trigger('room:snapshot', { ...firstRoom, version: 99 });
      socket.trigger('room:message:history', { roomId: 'old', messages: [{ roomId: 'old', messageId: 'late' }] });
      socket.trigger('room:message', { roomId: 'old', messageId: 'late', content: '迟到' });
      socket.trigger('command:error', { event: 'room:closed', roomId: 'old', commandId: null, code: 'room_closed', message: '旧房间关闭', retryable: false });
    });
    expect(result.current.room?.roomId).toBe('new');
    expect(result.current.messages).toHaveLength(0);

    let leave!: Promise<unknown>;
    act(() => { leave = result.current.leaveRoom(); });
    act(() => socket.timedEmits.find((item) => item.event === 'room:leave')!.ack(null, { ok: true }));
    await act(async () => { await leave; });
    act(() => socket.trigger('room:snapshot', { ...firstRoom, roomId: 'new', code: 'XYZ789', version: 2 }));
    expect(result.current.room).toBeNull();
  });

  it('会话过期后重建 Socket 并忽略旧 Socket 的迟到事件', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sessionResponse('ABC234'))
      .mockResolvedValueOnce(sessionResponse(null, 'session-2'));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGameHallClient());
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(1));
    const oldSocket = socketMocks.sockets[0]!;
    act(() => oldSocket.trigger('room:snapshot', { roomId: 'old', code: 'ABC234', version: 1, status: 'waiting' }));
    expect(result.current.room?.roomId).toBe('old');
    act(() => oldSocket.trigger('connect_error', new Error('SESSION_REQUIRED')));
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(2));
    expect(oldSocket.disconnect).toHaveBeenCalled();
    expect(result.current.room).toBeNull();
    act(() => oldSocket.trigger('room:snapshot', { roomId: 'old', code: 'ABC234', version: 20, status: 'active' }));
    expect(result.current.room).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(io).mock.calls[0]?.[0]).toMatchObject({ tryAllTransports: true, timeout: 7_000 });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('连接被服务端拒绝后，页面唤醒不自动重试，手动重连仍可用', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse()));
    const { result } = renderHook(() => useGameHallClient());
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(1));
    const socket = socketMocks.sockets[0]!;
    act(() => socket.trigger('connect_error', new Error('ORIGIN_NOT_ALLOWED')));
    expect(result.current.error?.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event('online')));
    expect(socket.connect).not.toHaveBeenCalled();
    act(() => result.current.reconnect());
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('动作 ACK 丢失后用相同 actionId 重发，并在权威同步前拦截下一步', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse('ABC234')));
    const { result } = renderHook(() => useGameHallClient());
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(1));
    const socket = socketMocks.sockets[0]!;
    act(() => { socket.connected = true; socket.trigger('connect'); socket.trigger('room:snapshot', { roomId: 'room', code: 'ABC234', version: 5, status: 'active' }); });
    let first!: Promise<unknown>;
    act(() => { first = result.current.submitGameAction({ type: 'drop', col: 0 }); });
    const moves = () => socket.timedEmits.filter((item) => item.event === 'game:action');
    expect(moves()).toHaveLength(1);
    expect(await result.current.submitGameAction({ type: 'drop', col: 1 })).toMatchObject({ ok: false, error: { code: 'ACTION_IN_FLIGHT' } });
    expect(moves()).toHaveLength(1);
    act(() => moves()[0]!.ack(new Error('timeout')));
    await waitFor(() => expect(moves()).toHaveLength(2));
    expect((moves()[1]!.payload as { actionId: string }).actionId).toBe((moves()[0]!.payload as { actionId: string }).actionId);
    act(() => moves()[1]!.ack(new Error('timeout')));
    await waitFor(() => expect(socket.timedEmits.some((item) => item.event === 'room:sync')).toBe(true));
    const blocked = await result.current.submitGameAction({ type: 'drop', col: 1 });
    expect(blocked).toMatchObject({ ok: false, error: { code: 'ACTION_PENDING_SYNC' } });
    expect(moves()).toHaveLength(2);
    act(() => socket.timedEmits.find((item) => item.event === 'room:sync')!.ack(null, { ok: true, version: 6 }));
    await act(async () => { await first; });
    let next!: Promise<unknown>;
    act(() => { next = result.current.submitGameAction({ type: 'drop', col: 1 }); });
    expect(moves()).toHaveLength(3);
    act(() => moves()[2]!.ack(null, { ok: true, version: 7 }));
    await act(async () => { await next; });
  });

  it('旧动作未确认期间离房进入新房，旧同步回执不锁住或污染新房', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse('ABC234')));
    const { result } = renderHook(() => useGameHallClient());
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(1));
    const socket = socketMocks.sockets[0]!;
    act(() => { socket.connected = true; socket.trigger('connect'); socket.trigger('room:snapshot', { roomId: 'old', code: 'ABC234', version: 5, status: 'active' }); });
    let oldAction!: Promise<unknown>;
    act(() => { oldAction = result.current.submitGameAction({ type: 'drop', col: 0 }); });
    const emits = (event: string) => socket.timedEmits.filter((item) => item.event === event);
    act(() => emits('game:action')[0]!.ack(new Error('timeout')));
    await waitFor(() => expect(emits('game:action')).toHaveLength(2));
    act(() => emits('game:action')[1]!.ack(new Error('timeout')));
    await waitFor(() => expect(emits('room:sync')).toHaveLength(1));

    let leave!: Promise<unknown>;
    act(() => { leave = result.current.leaveRoom(); });
    act(() => emits('room:leave')[0]!.ack(null, { ok: true }));
    await act(async () => { await leave; });
    let create!: Promise<unknown>;
    act(() => { create = result.current.createRoom('棋手', 'connect-four'); });
    act(() => {
      socket.trigger('room:snapshot', { roomId: 'new', code: 'XYZ789', version: 1, status: 'active' });
      emits('room:create')[0]!.ack(null, { ok: true, roomId: 'new', code: 'XYZ789' });
      emits('room:sync')[0]!.ack(null, { ok: true });
      socket.trigger('command:error', { event: 'game:action', commandId: (emits('game:action')[0]!.payload as { actionId: string }).actionId, code: 'VERSION_CONFLICT', message: '旧房间错误', retryable: true });
      socket.trigger('command:error', { event: 'room:sync', commandId: null, code: 'NOT_A_MEMBER', message: '旧房间同步错误', retryable: false });
    });
    await act(async () => { await Promise.all([create, oldAction]); });
    expect(result.current.room?.roomId).toBe('new');
    expect(result.current.error?.event).not.toBe('game:action');
    let newAction!: Promise<unknown>;
    act(() => { newAction = result.current.submitGameAction({ type: 'drop', col: 2 }); });
    expect(emits('game:action')).toHaveLength(3);
    act(() => emits('game:action')[2]!.ack(null, { ok: true, version: 2 }));
    await act(async () => { await newAction; });
  });

  it('连接切换后先用原 actionId 核对，再解除未确认动作锁', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(sessionResponse('ABC234'))));
    const { result } = renderHook(() => useGameHallClient());
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(1));
    const oldSocket = socketMocks.sockets[0]!;
    act(() => { oldSocket.connected = true; oldSocket.trigger('connect'); oldSocket.trigger('room:snapshot', { roomId: 'room', code: 'ABC234', version: 5, status: 'active' }); });
    let action!: Promise<unknown>;
    act(() => { action = result.current.submitGameAction({ type: 'drop', col: 0 }); });
    const original = oldSocket.timedEmits.find((item) => item.event === 'game:action')!;
    await act(async () => { await Promise.resolve(); });
    act(() => oldSocket.trigger('connect_error', new Error('SESSION_REQUIRED')));
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(2));
    const newSocket = socketMocks.sockets[1]!;
    act(() => original.ack(new Error('old connection gone')));
    await act(async () => { await action; });
    act(() => { newSocket.connected = true; newSocket.trigger('connect'); });
    await waitFor(() => expect(newSocket.timedEmits.some((item) => item.event === 'game:action')).toBe(true));
    const replay = newSocket.timedEmits.find((item) => item.event === 'game:action')!;
    expect((replay.payload as { actionId: string }).actionId).toBe((original.payload as { actionId: string }).actionId);
    expect(await result.current.submitGameAction({ type: 'drop', col: 1 })).toMatchObject({ ok: false, error: { code: 'ACTION_PENDING_SYNC' } });
    act(() => replay.ack(null, { ok: true, version: 6 }));
    await waitFor(() => expect(newSocket.timedEmits.some((item) => item.event === 'room:sync')).toBe(true));
    act(() => newSocket.timedEmits.find((item) => item.event === 'room:sync')!.ack(null, { ok: true, version: 6 }));
    await waitFor(() => expect(result.current.error?.code).not.toBe('ACTION_PENDING_SYNC'));
  });
});
