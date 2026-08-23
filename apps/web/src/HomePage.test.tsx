import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameHallClient } from './gamehall-client';
import { HomePage } from './HomePage';

function clientStub(overrides: Partial<GameHallClient> = {}): GameHallClient {
  return {
    loading: false,
    connection: 'online',
    session: { sessionId: 'session', reconnectableRoomCode: null },
    room: null,
    game: null,
    error: null,
    reactions: [],
    clearError: vi.fn(),
    reconnect: vi.fn(),
    createRoom: vi.fn().mockResolvedValue({ ok: true }),
    joinRoom: vi.fn().mockResolvedValue({ ok: true }),
    setReady: vi.fn(),
    leaveRoom: vi.fn(),
    submitGameAction: vi.fn(),
    requestRematch: vi.fn(),
    sendReaction: vi.fn(),
    ...overrides,
  } as GameHallClient;
}

describe('HomePage', () => {
  it('只允许进入三款已确认游戏，开发中卡片不可点击', () => {
    render(<HomePage client={clientStub()} />);
    expect(screen.getByRole('button', { name: '围棋尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '关牌尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '炸金花尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '罗松尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '牛牛尚未开放' })).toBeDisabled();
    expect(screen.getAllByText('开发中')).toHaveLength(5);
  });

  it('使用昵称和选择的游戏创建房间', async () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '木纹棋手' } });
    fireEvent.click(screen.getByRole('radio', { name: '路墙棋' }));
    fireEvent.click(screen.getByRole('button', { name: '创建 路墙棋 房间' }));
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith('木纹棋手', 'quoridor'));
  });

  it('游戏单选支持方向键，昵称输入所在表单可直接提交', async () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom })} />);
    const nickname = screen.getByLabelText('你的昵称');
    fireEvent.change(nickname, { target: { value: '键盘棋手' } });
    const gomoku = screen.getByRole('radio', { name: '五子棋' });
    gomoku.focus();
    fireEvent.keyDown(gomoku, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: '路墙棋' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: '路墙棋' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.submit(nickname.closest('form')!);
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith('键盘棋手', 'quoridor'));
  });

  it('邀请码输入会转大写并过滤易混淆字符', () => {
    render(<HomePage client={clientStub()} />);
    const input = screen.getByLabelText('六位房间邀请码');
    fireEvent.change(input, { target: { value: 'ab201-z9' } });
    expect(input).toHaveValue('AB2Z9');
  });

  it('邀请码回车只加入房间，不会同时提交创建表单', async () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    const joinRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom, joinRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '来客' } });
    const code = screen.getByLabelText('六位房间邀请码');
    fireEvent.change(code, { target: { value: 'ABC234' } });
    fireEvent.keyDown(code, { key: 'Enter', code: 'Enter' });
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
