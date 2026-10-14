import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameHallClient } from './gamehall-client';
import { NICKNAME_STORAGE_KEY } from './client-preferences';
import { useState } from 'react';

const mocks = vi.hoisted(() => ({ useClient: vi.fn(), hidePractice: false }));

vi.mock('./gamehall-client', () => ({ useGameHallClient: mocks.useClient }));
vi.mock('./HomePage', () => ({ HomePage: ({ onPractice, initialCatalog, onCatalogChange }: { onPractice: (game: 'connect-four' | 'sokoban') => void; initialCatalog: { search: string; filter: 'all' | 'strategy' }; onCatalogChange: (state: { search: string; filter: 'all' | 'strategy' }) => void }) => {
  const [search, setSearch] = useState(initialCatalog.search);
  const [filter, setFilter] = useState(initialCatalog.filter);
  return <main><h1 tabIndex={-1}>home</h1>
    <input placeholder="搜索游戏名称或玩法" value={search} onChange={(event) => { setSearch(event.target.value); onCatalogChange({ search: event.target.value, filter }); }} />
    <button aria-pressed={filter === 'strategy'} onClick={() => { setFilter('strategy'); onCatalogChange({ search, filter: 'strategy' }); }}>策略棋盘</button>
    {!mocks.hidePractice && <button data-practice-game="connect-four" onClick={() => onPractice('connect-four')}>practice</button>}
    {!mocks.hidePractice && (filter === 'all' || filter === 'strategy') && (search === '' || search === '推箱子') && <button data-practice-game="sokoban" onClick={() => onPractice('sokoban')}>进入推箱子</button>}
  </main>;
} }));
vi.mock('./RoomPage', () => ({ RoomPage: () => <main><h1>room</h1></main> }));
vi.mock('./SoloPracticePage', () => ({ SoloPracticePage: ({ gameId, recoveredRoom, onExit }: { gameId: string; recoveredRoom: boolean; onExit: () => void }) => <main><h1 tabIndex={-1}>solo {gameId}</h1>{recoveredRoom && <p>recovered</p>}<button onClick={onExit}>exit</button></main> }));
vi.mock('./SokobanPracticePage', () => ({ SokobanPracticePage: ({ onExit }: { onExit: () => void }) => <main><h1 tabIndex={-1}>sokoban</h1><button onClick={onExit}>exit sokoban</button></main> }));

import { App } from './App';

describe('App nickname persistence', () => {
  afterEach(() => {
    window.localStorage.clear();
    mocks.useClient.mockReset();
    mocks.hidePractice = false;
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
    expect(screen.getByRole('heading', { name: 'home' })).toHaveFocus();
    expect(window.location.search).toBe('?room=ZZZ234&theme=dark');
    expect(window.location.hash).toBe('#board');
    expect(window.history.state).toEqual({ source: 'external' });
    expect(back).not.toHaveBeenCalled();
    act(() => { window.history.replaceState(null, '', '/?practice=unknown'); window.dispatchEvent(new PopStateEvent('popstate')); });
    rerender(<App />);
    expect(screen.getByRole('heading', { name: 'home' })).toBeInTheDocument();
  });

  it('浏览器返回和前进保留原滚动，返回聚焦旧入口，前进聚焦练习标题', () => {
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
    expect(screen.getByRole('button', { name: 'practice' })).toHaveFocus();
    expect(scrollTo).toHaveBeenCalledOnce();
    act(() => { window.history.replaceState(null, '', '/?practice=connect-four#top'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('heading', { name: 'solo connect-four' })).toHaveFocus();
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it('从搜索与策略筛选进入推箱子后，返回和前进保留目录上下文并把旧入口滚入视野', () => {
    const scrollTo = vi.fn();
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    vi.stubGlobal('scrollTo', scrollTo);
    vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState({ previous: 7 }, '', '/?room=ABC234&theme=dark#board');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    try {
      window.history.replaceState({ previous: 7 }, '', '/?room=ABC234&theme=dark#board');
      mocks.useClient.mockReturnValue({ loading: false, room: null } as unknown as GameHallClient);
      render(<App />);
      fireEvent.change(screen.getByPlaceholderText('搜索游戏名称或玩法'), { target: { value: '推箱子' } });
      fireEvent.click(screen.getByRole('button', { name: '策略棋盘' }));
      fireEvent.click(screen.getByRole('button', { name: '进入推箱子' }));
      expect(screen.getByRole('heading', { name: 'sokoban' })).toHaveFocus();
      expect(window.location.search).toBe('?room=ABC234&theme=dark&practice=sokoban');
      expect(window.location.hash).toBe('#board');
      fireEvent.click(screen.getByRole('button', { name: 'exit sokoban' }));
      expect(screen.getByPlaceholderText('搜索游戏名称或玩法')).toHaveValue('推箱子');
      expect(screen.getByRole('button', { name: '策略棋盘' })).toHaveAttribute('aria-pressed', 'true');
      const entry = screen.getByRole('button', { name: '进入推箱子' });
      expect(entry).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      expect(scrollTo).toHaveBeenCalledTimes(1);
      act(() => { window.history.replaceState(null, '', '/?room=ABC234&theme=dark&practice=sokoban#board'); window.dispatchEvent(new PopStateEvent('popstate')); });
      expect(screen.getByRole('heading', { name: 'sokoban' })).toHaveFocus();
      act(() => { window.history.replaceState(null, '', '/?room=ABC234&theme=dark#board'); window.dispatchEvent(new PopStateEvent('popstate')); });
      expect(screen.getByPlaceholderText('搜索游戏名称或玩法')).toHaveValue('推箱子');
      expect(screen.getByRole('button', { name: '进入推箱子' })).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      fireEvent.change(screen.getByPlaceholderText('搜索游戏名称或玩法'), { target: { value: '' } });
      expect(screen.getByPlaceholderText('搜索游戏名称或玩法')).toHaveValue('');
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  it('返回大厅时原练习入口已被筛掉则聚焦标题，普通刷新不抢焦点', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    mocks.useClient.mockReturnValue({ loading: false, room: null } as unknown as GameHallClient);
    window.history.replaceState(null, '', '/');
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'practice' }));
    mocks.hidePractice = true;
    act(() => { window.history.replaceState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('heading', { name: 'home' })).toHaveFocus();
    mocks.hidePractice = false;
    act(() => { window.history.replaceState(null, '', '/?practice=connect-four'); window.dispatchEvent(new PopStateEvent('popstate')); });
    const heading = screen.getByRole('heading', { name: 'solo connect-four' });
    heading.focus();
    rerender(<App />);
    expect(heading).toHaveFocus();
    expect(scrollTo).toHaveBeenCalledTimes(1);
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
