import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGomokuState, createQuoridorState, createTwentyFourState, viewTwentyFourState } from '@gamehall/game-core';
import type { GameId, GameSnapshot, RoomSnapshot } from '@gamehall/protocol';
import type { GameHallClient } from './gamehall-client';
import { RoomPage } from './RoomPage';
import { resultMessage } from './room-result';

const state = createTwentyFourState([
  { id: 0, suit: 'S', rank: 1 },
  { id: 14, suit: 'H', rank: 2 },
  { id: 28, suit: 'D', rank: 3 },
  { id: 42, suit: 'C', rank: 4 },
], '1*2*3*4', 1_000);
const base = viewTwentyFourState(state, 1_000);

const finishedViews = {
  gomoku: { ...createGomokuState(0), phase: 'finished', result: { type: 'win', winner: 0, reason: 'disconnect' } },
  quoridor: { ...createQuoridorState(0), phase: 'finished', result: { type: 'win', winner: 0, reason: 'goal' }, legalMoves: [] },
  'twenty-four': { ...base, phase: 'finished', winner: 0, finishReason: 'score' },
} as const;

function finishedClient(gameId: GameId, rematchReady: [boolean, boolean] = [false, false], requestRematch = vi.fn().mockResolvedValue({ ok: true })): GameHallClient {
  const room: RoomSnapshot = {
    roomId: 'room', code: 'ABC234', gameId, status: 'finished', version: 7,
    hostSeat: 0, mySeat: 0, pauseReason: null, restartDeadlineMs: null, serverTimeMs: 1_000,
    members: [
      { seat: 0, nickname: '我', ready: true, rematchReady: rematchReady[0], online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
      { seat: 1, nickname: '好友', ready: true, rematchReady: rematchReady[1], online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
    ],
  };
  const game: GameSnapshot = {
    roomId: 'room', gameId, status: 'finished', version: 7, mySeat: 0,
    view: finishedViews[gameId], serverTimeMs: 1_000,
  };
  return {
    loading: false, connection: 'online', session: { sessionId: 'session', reconnectableRoomCode: null },
    room, game, error: null, messages: [], messageToasts: [], clearError: vi.fn(), reconnect: vi.fn(),
    createRoom: vi.fn(), joinRoom: vi.fn(), setReady: vi.fn(), leaveRoom: vi.fn(),
    submitGameAction: vi.fn(), requestRematch, sendMessage: vi.fn(),
  } as GameHallClient;
}

describe('RoomPage result copy', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('24 点按真实终局原因展示胜负，恢复超时仍产生可见结果', () => {
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: 0, finishReason: 'score' }, 0)).toContain('5 分');
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: 1, finishReason: 'resign' }, 0)).toContain('认输');
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: 0, finishReason: 'disconnect' }, 0)).toContain('超时未重连');
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: null, finishReason: 'restart_timeout' }, 0)).toContain('和局');
  });

  it.each([
    ['gomoku', '五子棋对局'],
    ['quoridor', '路墙棋对局'],
    ['twenty-four', '24点速度对决'],
  ] as const)('%s 终局结算覆盖在对应棋盘舞台内', (gameId, surfaceLabel) => {
    const rendered = render(<RoomPage client={finishedClient(gameId)} />);
    const resultPanel = screen.getByText('GAME COMPLETE').closest('[role="status"]');
    const stage = resultPanel?.closest('.game-stage');
    expect(stage).toHaveClass('has-result');
    expect(stage).toContainElement(screen.getByLabelText(surfaceLabel));
    rendered.unmount();
  });

  it('复赛按钮常驻显示双方同意人数，并支持本端同意与撤回', async () => {
    const requestRematch = vi.fn().mockResolvedValue({ ok: true });
    const rendered = render(<RoomPage client={finishedClient('gomoku', [false, false], requestRematch)} />);
    const initialButton = screen.getByRole('button', { name: /再来一局.*同意人数 0\/2/ });
    expect(initialButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(initialButton);
    await waitFor(() => expect(requestRematch).toHaveBeenLastCalledWith(true));

    rendered.rerender(<RoomPage client={finishedClient('gomoku', [false, true], requestRematch)} />);
    expect(screen.getByRole('button', { name: /再来一局.*同意人数 1\/2/ })).toHaveAttribute('aria-pressed', 'false');

    rendered.rerender(<RoomPage client={finishedClient('gomoku', [true, false], requestRematch)} />);
    const readyButton = screen.getByRole('button', { name: /已同意再来一局.*同意人数 1\/2/ });
    expect(readyButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(readyButton);
    await waitFor(() => expect(requestRematch).toHaveBeenLastCalledWith(false));
  });

  it('本端重连到仍暂停的 24 点房时按权威快照重锚并冻结题钟', () => {
    vi.useFakeTimers();
    const room = (status: RoomSnapshot['status'], serverTimeMs: number): RoomSnapshot => ({
      roomId: 'room', code: 'ABC234', gameId: 'twenty-four', status, version: 1,
      hostSeat: 0, mySeat: 0, pauseReason: status === 'paused' ? 'disconnect' : null,
      restartDeadlineMs: null, serverTimeMs,
      members: [
        { seat: 0, nickname: '我', ready: true, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
        { seat: 1, nickname: '好友', ready: true, rematchReady: false, online: status !== 'paused', disconnectedAtMs: status === 'paused' ? serverTimeMs : null, disconnectDeadlineMs: status === 'paused' ? serverTimeMs + 60_000 : null },
      ],
    });
    const game = (status: GameSnapshot['status'], serverTimeMs: number): GameSnapshot => ({
      roomId: 'room', gameId: 'twenty-four', status, version: 1, mySeat: 0,
      view: { ...base, deadlineAtMs: 31_000, serverNowMs: serverTimeMs }, serverTimeMs,
    });
    const client = (connection: GameHallClient['connection'], roomValue: RoomSnapshot, gameValue: GameSnapshot): GameHallClient => ({
      loading: false, connection, session: { sessionId: 'session', reconnectableRoomCode: null },
      room: roomValue, game: gameValue, error: null, messages: [], messageToasts: [], clearError: vi.fn(), reconnect: vi.fn(),
      createRoom: vi.fn(), joinRoom: vi.fn(), setReady: vi.fn(), leaveRoom: vi.fn(),
      submitGameAction: vi.fn(), requestRematch: vi.fn(), sendMessage: vi.fn(),
    }) as GameHallClient;

    const activeRoom = room('active', 1_000);
    const activeGame = game('active', 1_000);
    const rendered = render(<RoomPage client={client('online', activeRoom, activeGame)} />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('timer')).toHaveAccessibleName('本题剩余 29 秒');

    rendered.rerender(<RoomPage client={client('offline', activeRoom, activeGame)} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('timer')).toHaveAccessibleName('本题剩余 29 秒');

    rendered.rerender(<RoomPage client={client('online', room('paused', 11_000), game('paused', 11_000))} />);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('timer')).toHaveAccessibleName('本题剩余 20 秒');
  });

  it('分别复制完整邀请链接和六位房间码', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const room: RoomSnapshot = {
      roomId: 'room', code: 'ABC234', gameId: 'gomoku', status: 'waiting', version: 1,
      hostSeat: 0, mySeat: 0, pauseReason: null, restartDeadlineMs: null, serverTimeMs: 1_000,
      members: [
        { seat: 0, nickname: '我', ready: false, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
      ],
    };
    const client = {
      loading: false, connection: 'online', session: { sessionId: 'session', reconnectableRoomCode: null },
      room, game: null, error: null, messages: [], messageToasts: [], clearError: vi.fn(), reconnect: vi.fn(),
      createRoom: vi.fn(), joinRoom: vi.fn(), setReady: vi.fn(), leaveRoom: vi.fn(),
      submitGameAction: vi.fn(), requestRematch: vi.fn(), sendMessage: vi.fn(),
    } as GameHallClient;

    render(<RoomPage client={client} />);
    fireEvent.click(screen.getByRole('button', { name: '复制邀请链接' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}?room=ABC234`));
    fireEvent.click(screen.getByRole('button', { name: '复制六位房间码' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('ABC234'));
  });

  it('品牌与离开按钮复用同一确认流程，并支持 Escape 与焦点恢复', async () => {
    const room: RoomSnapshot = {
      roomId: 'room', code: 'ABC234', gameId: 'gomoku', status: 'waiting', version: 1,
      hostSeat: 0, mySeat: 0, pauseReason: null, restartDeadlineMs: null, serverTimeMs: 1_000,
      members: [{ seat: 0, nickname: '我', ready: false, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null }],
    };
    const leaveRoom = vi.fn().mockResolvedValue({ ok: true });
    const client = {
      loading: false, connection: 'online', session: { sessionId: 'session', reconnectableRoomCode: null },
      room, game: null, error: null, messages: [], messageToasts: [], clearError: vi.fn(), reconnect: vi.fn(),
      createRoom: vi.fn(), joinRoom: vi.fn(), setReady: vi.fn(), leaveRoom,
      submitGameAction: vi.fn(), requestRematch: vi.fn(), sendMessage: vi.fn(),
    } as GameHallClient;

    render(<RoomPage client={client} />);
    const brand = screen.getByRole('button', { name: '返回主界面并离开房间' });
    fireEvent.click(brand);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('确认离开房间');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(brand).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '离开房间' }));
    fireEvent.click(screen.getByRole('button', { name: '确认离开' }));
    await waitFor(() => expect(leaveRoom).toHaveBeenCalledTimes(1));
  });

  it('认输只提交 resign，并支持八个快捷表情和 100 字自定义消息', async () => {
    const room: RoomSnapshot = {
      roomId: 'room', code: 'ABC234', gameId: 'gomoku', status: 'active', version: 3,
      hostSeat: 0, mySeat: 0, pauseReason: null, restartDeadlineMs: null, serverTimeMs: 1_000,
      members: [
        { seat: 0, nickname: '我', ready: true, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
        { seat: 1, nickname: '好友', ready: true, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
      ],
    };
    const submitGameAction = vi.fn().mockResolvedValue({ ok: true });
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const client = {
      loading: false, connection: 'online', session: { sessionId: 'session', reconnectableRoomCode: null },
      room, game: null, error: null, messages: [], messageToasts: [], clearError: vi.fn(), reconnect: vi.fn(),
      createRoom: vi.fn(), joinRoom: vi.fn(), setReady: vi.fn(), leaveRoom: vi.fn(),
      submitGameAction, requestRematch: vi.fn(), sendMessage,
    } as GameHallClient;

    render(<RoomPage client={client} />);
    expect(screen.getAllByRole('button', { name: /发送 [👍👏😄🤔🔥🎉😮😭]/u })).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: '认输' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('你仍会留在房间查看结算');
    fireEvent.click(screen.getByRole('button', { name: '确认认输' }));
    await waitFor(() => expect(submitGameAction).toHaveBeenCalledWith({ type: 'resign' }));

    fireEvent.click(screen.getByRole('button', { name: '发送 🎉' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('🎉'));
    const input = screen.getByLabelText('发一条消息');
    fireEvent.change(input, { target: { value: '棋'.repeat(101) } });
    expect(screen.getByText('100 / 100')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('棋'.repeat(100)));
  });
});
