import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import { useGameHallClient } from './gamehall-client';

type Handler = (...args: never[]) => void;

const socketMocks = vi.hoisted(() => ({
  sockets: [] as Array<{
    connected: boolean;
    handlers: Map<string, Handler>;
    managerHandlers: Map<string, Handler>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    trigger: (event: string) => void;
    io: { on: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> };
  }>,
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const handlers = new Map<string, Handler>();
    const managerHandlers = new Map<string, Handler>();
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
      timeout: vi.fn(() => ({ emit: vi.fn() })),
      trigger: (event: string) => handlers.get(event)?.(),
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

function sessionResponse() {
  return new Response(JSON.stringify({ sessionId: 'session-1', reconnectableRoomCode: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useGameHallClient connection recovery', () => {
  it('重开清除旧对局并拒绝上一局的延迟房间和游戏快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse()));
    const { result } = renderHook(() => useGameHallClient());
    await waitFor(() => expect(socketMocks.sockets).toHaveLength(1));
    const deliver = (event: string, payload: unknown) => act(() => { (socketMocks.sockets[0]!.handlers.get(event) as unknown as (value: unknown) => void)(payload); });
    const room = { roomId: 'room', gameId: 'splendor', version: 10, status: 'finished', members: [] };
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
});
