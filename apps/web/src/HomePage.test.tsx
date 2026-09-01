import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameHallClient } from './gamehall-client';
import { HomePage } from './HomePage';
import { NICKNAME_STORAGE_KEY } from './client-preferences';

function clientStub(overrides: Partial<GameHallClient> = {}): GameHallClient {
  return {
    loading: false,
    connection: 'online',
    session: { sessionId: 'session', reconnectableRoomCode: null },
    room: null,
    game: null,
    error: null,
    messages: [],
    messageToasts: [],
    clearError: vi.fn(),
    reconnect: vi.fn(),
    createRoom: vi.fn().mockResolvedValue({ ok: true }),
    joinRoom: vi.fn().mockResolvedValue({ ok: true }),
    setReady: vi.fn(),
    leaveRoom: vi.fn(),
    submitGameAction: vi.fn(),
    requestRematch: vi.fn(),
    sendMessage: vi.fn(),
    ...overrides,
  } as GameHallClient;
}

describe('HomePage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('只允许进入三款已确认游戏，开发中卡片不可点击', () => {
    const { container } = render(<HomePage client={clientStub()} />);
    expect(screen.getByRole('button', { name: '围棋尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '关牌尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '炸金花尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '罗松尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '牛牛尚未开放' })).toBeDisabled();
    expect(screen.getAllByText('开发中')).toHaveLength(5);
    expect(container.querySelector('.mini-quoridor')).toBeInTheDocument();
  });

  it('不再展示首屏冗余装饰和重复的游戏单选', () => {
    const { container } = render(<HomePage client={clientStub()} />);
    expect(screen.queryByText('私人好友房 · 纯娱乐')).not.toBeInTheDocument();
    expect(screen.queryByText('NO. 01')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE GAME SALON · 2026')).not.toBeInTheDocument();
    expect(container.querySelector('.game-marquee')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('新玩法即将入席')).toBeInTheDocument();
    expect(container.querySelector('.editorial-path')).not.toBeInTheDocument();
    expect(container.querySelector('.editorial-numbers')).not.toBeInTheDocument();
    expect(container.querySelector('.grand-board')).toBeInTheDocument();
  });

  it('连接中的提示延迟显示且没有无效重连按钮', () => {
    vi.useFakeTimers();
    render(<HomePage client={clientStub({ connection: 'connecting' })} />);
    expect(screen.queryByText('正在连接实时服务')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_199));
    expect(screen.queryByText('正在连接实时服务')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('正在连接实时服务')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新连接' })).not.toBeInTheDocument();
  });

  it('离线时立即显示错误和可访问的重连按钮', () => {
    const reconnect = vi.fn();
    render(<HomePage client={clientStub({
      connection: 'offline',
      reconnect,
      error: { event: 'session', commandId: null, code: 'SESSION_FAILED', message: '服务暂不可用', retryable: true },
    })} />);
    expect(screen.getByRole('status')).toHaveTextContent('服务暂不可用');
    fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('昵称区域只负责取名，不再包含创建、加入或在线徽标', () => {
    render(<HomePage client={clientStub()} />);
    const panel = screen.getByLabelText('你的昵称').closest('.identity-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('加入房间');
    expect(panel).not.toHaveTextContent('服务在线');
    expect(panel?.querySelector('button[aria-label^="创建"]')).not.toBeInTheDocument();
  });

  it('点击游戏卡会使用昵称直接创建对应房间', async () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '木纹棋手' } });
    fireEvent.click(screen.getByRole('button', { name: '创建路墙棋房间' }));
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith('木纹棋手', 'quoridor'));
  });

  it('游戏卡使用可聚焦的原生按钮直接开房', async () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom })} />);
    const nickname = screen.getByLabelText('你的昵称');
    fireEvent.change(nickname, { target: { value: '键盘棋手' } });
    const quoridor = screen.getByRole('button', { name: '创建路墙棋房间' });
    quoridor.focus();
    expect(quoridor).toHaveFocus();
    expect(quoridor).toHaveAttribute('type', 'button');
    fireEvent.click(quoridor);
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith('键盘棋手', 'quoridor'));
  });

  it('昵称为空时不会创建房间，并返回聚焦昵称输入', () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom })} />);
    const nickname = screen.getByLabelText('你的昵称');
    fireEvent.click(screen.getByRole('button', { name: '创建五子棋房间' }));
    expect(createRoom).not.toHaveBeenCalled();
    expect(nickname).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('先留下昵称');
  });

  it('创建过程中禁用全部开房入口，避免重复创建', async () => {
    let finish!: (value: { ok: true }) => void;
    const createRoom = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<HomePage client={clientStub({ createRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '稳坐棋手' } });
    fireEvent.click(screen.getByRole('button', { name: '创建五子棋房间' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '创建路墙棋房间' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '创建路墙棋房间' }));
    expect(createRoom).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await waitFor(() => expect(screen.getByRole('button', { name: '创建路墙棋房间' })).not.toBeDisabled());
  });

  it('随机昵称按钮生成雅致昵称并允许继续手动编辑', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<HomePage client={clientStub()} />);
    const nickname = screen.getByLabelText('你的昵称');
    fireEvent.click(screen.getByRole('button', { name: '随机昵称' }));
    expect(nickname).toHaveValue('竹影棋客');
    fireEvent.click(screen.getByRole('button', { name: '随机昵称' }));
    expect(nickname).toHaveValue('竹影闲家');
    fireEvent.change(nickname, { target: { value: '自定义棋手' } });
    expect(nickname).toHaveValue('自定义棋手');
  });

  it('邀请码输入会转大写并过滤易混淆字符', () => {
    render(<HomePage client={clientStub()} />);
    const input = screen.getByLabelText('六位房间邀请码');
    fireEvent.change(input, { target: { value: 'ab201-z9' } });
    expect(input).toHaveValue('AB2Z9');
  });

  it('完整邀请链接会提取 room 参数而不是保留 HTTP 前缀', () => {
    render(<HomePage client={clientStub()} />);
    const input = screen.getByLabelText('六位房间邀请码');
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:5173/?room=35c3ty' } });
    expect(input).toHaveValue('35C3TY');
  });

  it('会预填上一次成功使用的昵称', () => {
    window.localStorage.setItem(NICKNAME_STORAGE_KEY, '常胜棋手');
    render(<HomePage client={clientStub()} />);
    expect(screen.getByLabelText('你的昵称')).toHaveValue('常胜棋手');
  });

  it('邀请码回车只加入房间，不会创建新房间', async () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    const joinRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom, joinRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '来客' } });
    const code = screen.getByLabelText('六位房间邀请码');
    fireEvent.change(code, { target: { value: 'ABC234' } });
    fireEvent.submit(code.closest('form')!);
    await waitFor(() => expect(joinRoom).toHaveBeenCalledWith('来客', 'ABC234'));
    expect(joinRoom).toHaveBeenCalledTimes(1);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('展示加入房间失败的服务端错误', async () => {
    const joinRoom = vi.fn().mockResolvedValue({ ok: false, error: { message: '邀请码不存在' } });
    render(<HomePage client={clientStub({ joinRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '来客' } });
    fireEvent.change(screen.getByLabelText('六位房间邀请码'), { target: { value: 'ABC234' } });
    fireEvent.click(screen.getByRole('button', { name: '加入房间' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('邀请码不存在');
  });
});
