import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameHallClient } from './gamehall-client';
import { NICKNAME_STORAGE_KEY } from './client-preferences';

const mocks = vi.hoisted(() => ({ useClient: vi.fn() }));

vi.mock('./gamehall-client', () => ({ useGameHallClient: mocks.useClient }));
vi.mock('./HomePage', () => ({ HomePage: ({ onPractice }: { onPractice: (game: 'connect-four') => void }) => <main><h1 tabIndex={-1}>home</h1><button onClick={() => onPractice('connect-four')}>practice</button></main> }));
vi.mock('./RoomPage', () => ({ RoomPage: () => <main><h1>room</h1></main> }));
vi.mock('./SoloPracticePage', () => ({ SoloPracticePage: ({ gameId, recoveredRoom, onExit }: { gameId: string; recoveredRoom: boolean; onExit: () => void }) => <main><h1 tabIndex={-1}>solo {gameId}</h1>{recoveredRoom && <p>recovered</p>}<button onClick={onExit}>exit</button></main> }));

import { App } from './App';

describe('App nickname persistence', () => {
  afterEach(() => {
    window.localStorage.clear();
    mocks.useClient.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('房间快照出现后保存服务端确认的本人昵称', async () => {
    mocks.useClient.mockReturnValue({
      loading: false,
      room: {
        roomId: 'room', code: 'ABC234', gameId: 'gomoku', status: 'waiting', version: 1,
        hostSeat: 0, mySeat: 1, pauseReason: null, restartDeadlineMs: null, serverTimeMs: 1_000,
        members: [
          { seat: 0, nickname: '好友', ready: false, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
          { seat: 1, nickname: '规范化昵称', ready: false, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
        ],
      },
    } as unknown as GameHallClient);

    render(<App />);
    await waitFor(() => expect(window.localStorage.getItem(NICKNAME_STORAGE_KEY)).toBe('规范化昵称'));
  });

  it('会话尚在加载时仍能练习；迟到的好友房恢复不会打断已选择的练习', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    window.history.replaceState({ previous: 7 }, '', '/?room=ABC234&theme=dark#top');
    vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState({ previous: 7 }, '', '/?room=ABC234&theme=dark#top');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    mocks.useClient.mockReturnValue({ loading: true, room: null } as unknown as GameHallClient);
    const { rerender } = render(<App />);
    expect(screen.getByRole('heading', { name: 'home' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'practice' }));
    expect(screen.getByRole('heading', { name: 'solo connect-four' })).toHaveFocus();
    expect(window.location.search).toBe('?room=ABC234&theme=dark&practice=connect-four');
    expect(window.location.hash).toBe('#top');
    expect(window.history.state.previous).toBe(7);
    const room = { roomId: 'late', members: [], mySeat: 0 };
    mocks.useClient.mockReturnValue({ loading: false, room } as unknown as GameHallClient);
    rerender(<App />);
    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'room' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'exit' }));
    expect(screen.getByRole('heading', { name: 'room' })).toBeInTheDocument();
    expect(window.location.search).toBe('?room=ABC234&theme=dark');
    act(() => { window.history.replaceState({ forwarded: true }, '', '/?room=ABC234&theme=dark&practice=connect-four#top'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('heading', { name: 'solo connect-four' })).toBeInTheDocument();
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('直接练习链接可刷新进入，返回时仅移除 practice；未知值回首页', () => {
    vi.stubGlobal('scrollTo', vi.fn());
    const back = vi.spyOn(window.history, 'back');
    window.history.replaceState({ source: 'external' }, '', '/?room=ZZZ234&practice=reversi&theme=dark#board');
    mocks.useClient.mockReturnValue({ loading: false, room: null } as unknown as GameHallClient);
    const { rerender } = render(<App />);
    expect(screen.getByRole('heading', { name: 'solo reversi' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'exit' }));
    expect(screen.getByRole('heading', { name: 'home' })).toBeInTheDocument();
    expect(window.location.search).toBe('?room=ZZZ234&theme=dark');
    expect(window.location.hash).toBe('#board');
    expect(window.history.state).toEqual({ source: 'external' });
    expect(back).not.toHaveBeenCalled();
    act(() => { window.history.replaceState(null, '', '/?practice=unknown'); window.dispatchEvent(new PopStateEvent('popstate')); });
    rerender(<App />);
    expect(screen.getByRole('heading', { name: 'home' })).toBeInTheDocument();
  });

  it('浏览器返回恢复原滚动，不触发页面切换的置顶动作', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState(null, '', '/#top');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    window.history.replaceState(null, '', '/#top');
    mocks.useClient.mockReturnValue({ loading: false, room: null } as unknown as GameHallClient);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'practice' }));
    expect(scrollTo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'exit' }));
    expect(screen.getByRole('heading', { name: 'home' })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it('离开房间回首页只在页面切换时重置滚动和标题焦点', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    mocks.useClient.mockReturnValue({ loading: false, room: { roomId: 'one', members: [], mySeat: 0 } } as unknown as GameHallClient);
    const { rerender } = render(<App />);
    mocks.useClient.mockReturnValue({ loading: false, room: null } as unknown as GameHallClient);
    rerender(<App />);
    expect(screen.getByRole('heading', { name: 'home' })).toHaveFocus();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
    scrollTo.mockClear();
    rerender(<App />);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
