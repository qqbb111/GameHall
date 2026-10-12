import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameHallClient } from './gamehall-client';
import { NICKNAME_STORAGE_KEY } from './client-preferences';

const mocks = vi.hoisted(() => ({ useClient: vi.fn() }));

vi.mock('./gamehall-client', () => ({ useGameHallClient: mocks.useClient }));
vi.mock('./HomePage', () => ({ HomePage: ({ onPractice }: { onPractice: (game: 'connect-four') => void }) => <main><h1 tabIndex={-1}>home</h1><button onClick={() => onPractice('connect-four')}>practice</button></main> }));
vi.mock('./RoomPage', () => ({ RoomPage: () => <main><h1>room</h1></main> }));
vi.mock('./SoloPracticePage', () => ({ SoloPracticePage: ({ recoveredRoom, onExit }: { recoveredRoom: boolean; onExit: () => void }) => <main><h1 tabIndex={-1}>solo</h1>{recoveredRoom && <p>recovered</p>}<button onClick={onExit}>exit</button></main> }));

import { App } from './App';

describe('App nickname persistence', () => {
  afterEach(() => {
    window.localStorage.clear();
    mocks.useClient.mockReset();
    vi.unstubAllGlobals();
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
    mocks.useClient.mockReturnValue({ loading: true, room: null } as unknown as GameHallClient);
    const { rerender } = render(<App />);
    expect(screen.getByRole('heading', { name: 'home' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'practice' }));
    expect(screen.getByRole('heading', { name: 'solo' })).toHaveFocus();
    const room = { roomId: 'late', members: [], mySeat: 0 };
    mocks.useClient.mockReturnValue({ loading: false, room } as unknown as GameHallClient);
    rerender(<App />);
    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'room' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'exit' }));
    expect(screen.getByRole('heading', { name: 'room' })).toBeInTheDocument();
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
