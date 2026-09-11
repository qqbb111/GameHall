import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortSplendorState, createSplendorState, splendorDefinition, createGomokuState, createQuoridorState, createTwentyFourState, viewTwentyFourState } from '@gamehall/game-core';
import type { GameSnapshot, RoomSnapshot } from '@gamehall/protocol';
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

function finishedClient(gameId: keyof typeof finishedViews, rematchReady: [boolean, boolean] = [false, false], requestRematch = vi.fn().mockResolvedValue({ ok: true })): GameHallClient {
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
    createRoom: vi.fn(), joinRoom: vi.fn(), startRoom: vi.fn(), reopenRoom: vi.fn(), setReady: vi.fn(), leaveRoom: vi.fn(),
    submitGameAction: vi.fn(), requestRematch, sendMessage: vi.fn(),
  } as GameHallClient;
}

describe('RoomPage result copy', () => {
  it('璀璨宝石四座等待区由房主确认开局，中止可保留邀请码返回等待区', async () => {
    const client = finishedClient('gomoku');
    client.room = { ...client.room!, gameId: 'splendor', status: 'waiting', members: client.room!.members.map(member => ({ ...member, ready: member.seat !== 0 })) };
    client.game = null;
    client.startRoom = vi.fn().mockResolvedValue({ ok: true }); client.reopenRoom = vi.fn().mockResolvedValue({ ok: true });
    const rendered = render(<RoomPage client={client} />);
    expect(rendered.container.querySelectorAll('.waiting-seats .player-card')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: '我准备好了' })).not.toBeInTheDocument();
    expect(screen.getAllByText('房主 · 等待开局')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '开始游戏' }));
    await waitFor(() => expect(client.startRoom).toHaveBeenCalledTimes(1));
    client.room = { ...client.room!, status: 'finished' };
    const state = abortSplendorState(createSplendorState({ playerCount: 2 }), 'disconnect');
    client.game = { gameId: 'splendor', roomId: 'room', status: 'finished', version: 8, mySeat: 0, view: splendorDefinition.viewFor(state, 0, 0), serverTimeMs: 1000 };
    rendered.rerender(<RoomPage client={client} />);
    expect(screen.getByRole('heading', { name: /中止.*不计胜负/ })).toBeInTheDocument();
    expect(screen.getByLabelText('本局分数')).toHaveTextContent('0 分');
    fireEvent.click(screen.getByRole('button', { name: '保留邀请码，返回等待区' }));
    await waitFor(() => expect(client.reopenRoom).toHaveBeenCalledTimes(1));
    client.room = { ...client.room!, mySeat: 1 };
    rendered.rerender(<RoomPage client={client} />);
    expect(screen.queryByRole('button', { name: '保留邀请码，返回等待区' })).not.toBeInTheDocument();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('房主单按钮随人数、在线和准备状态变化，开局等待中防止重复提交', async () => {
    const client = finishedClient('gomoku');
    const members = client.room!.members.map(member => ({ ...member, ready: false }));
    client.room = { ...client.room!, gameId: 'splendor', status: 'waiting', members: members.slice(0, 1) };
    client.game = null;
    let finish!: () => void;
    client.startRoom = vi.fn(() => new Promise<{ ok: true }>(resolve => { finish = () => resolve({ ok: true }); }));
    const rendered = render(<RoomPage client={client} />);
    expect(screen.getByRole('button', { name: '等待好友加入' })).toBeDisabled();
    client.room = { ...client.room, members };
    rendered.rerender(<RoomPage client={client} />);
    expect(screen.getByRole('button', { name: '等待其他成员准备' })).toBeDisabled();
    client.room.members = members.map(member => ({ ...member, ready: true, online: member.seat === 0 }));
    rendered.rerender(<RoomPage client={client} />);
    expect(screen.getByRole('button', { name: '等待成员上线' })).toBeDisabled();
    client.connection = 'offline';
    rendered.rerender(<RoomPage client={client} />);
    expect(screen.getByRole('button', { name: '等待连接恢复' })).toBeDisabled();
    client.connection = 'online';
    client.room.members = members.map(member => ({ ...member, ready: member.seat !== 0 }));
    rendered.rerender(<RoomPage client={client} />);
    fireEvent.click(screen.getByRole('button', { name: '开始游戏' }));
    const pending = screen.getByRole('button', { name: '正在开局…' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(client.startRoom).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('普通成员可取消准备，房主交接后切换为单个开局按钮', async () => {
    const client = finishedClient('gomoku');
    client.room = { ...client.room!, gameId: 'splendor', status: 'waiting', hostSeat: 1 };
    client.game = null;
    client.setReady = vi.fn().mockResolvedValue({ ok: true });
    const rendered = render(<RoomPage client={client} />);
    fireEvent.click(screen.getByRole('button', { name: /已准备，点击取消/ }));
    await waitFor(() => expect(client.setReady).toHaveBeenCalledWith(false));
    client.room = { ...client.room, hostSeat: 0 };
    rendered.rerender(<RoomPage client={client} />);
    expect(screen.getByRole('button', { name: '开始游戏' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /已准备，点击取消/ })).not.toBeInTheDocument();
  });

  it('24 点按真实终局原因展示胜负，恢复超时仍产生可见结果', () => {
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: 0, finishReason: 'score' }, 0)).toContain('5 分');
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: 1, finishReason: 'resign' }, 0)).toContain('认输');
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: 0, finishReason: 'disconnect' }, 0)).toContain('超时未重连');
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: null, finishReason: 'restart_timeout' }, 0)).toContain('和局');
  });

  it('德州扑克只在整局冠军产生后显示终局文案', () => {
    expect(resultMessage('texas-holdem', { result: null }, 0)).toBeNull();
    expect(resultMessage('texas-holdem', { result: { type: 'completed', winner: 0, handsPlayed: 6, finalStacks: [] } }, 0)).toContain('6 手');
    expect(resultMessage('texas-holdem', { result: { type: 'completed', winner: 1, handsPlayed: 6, finalStacks: [] } }, 0)).toContain('最终冠军');
    expect(resultMessage('texas-holdem', { result: { type: 'aborted', reason: 'disconnect' } }, 0)).toContain('整局中止');
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
      createRoom: vi.fn(), joinRoom: vi.fn(), startRoom: vi.fn(), reopenRoom: vi.fn(), setReady: vi.fn(), leaveRoom: vi.fn(),
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
      createRoom: vi.fn(), joinRoom: vi.fn(), startRoom: vi.fn(), reopenRoom: vi.fn(), setReady: vi.fn(), leaveRoom: vi.fn(),
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
      createRoom: vi.fn(), joinRoom: vi.fn(), startRoom: vi.fn(), reopenRoom: vi.fn(), setReady: vi.fn(), leaveRoom,
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
      createRoom: vi.fn(), joinRoom: vi.fn(), startRoom: vi.fn(), reopenRoom: vi.fn(), setReady: vi.fn(), leaveRoom: vi.fn(),
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
