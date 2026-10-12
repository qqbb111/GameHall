import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameHallClient } from './gamehall-client';
import type { SoloWorkerRequest, SoloWorkerResponse } from './solo-ai.worker';

const mocks = vi.hoisted(() => ({ useClient: vi.fn() }));
vi.mock('./gamehall-client', () => ({ useGameHallClient: mocks.useClient }));
vi.mock('./HomePage', () => ({ HomePage: ({ onPractice }: { onPractice: (game: 'connect-four' | 'twenty-four') => void }) => <main><h1 tabIndex={-1}>home</h1><button onClick={() => onPractice('connect-four')}>practice</button><button data-practice-game="twenty-four" onClick={() => onPractice('twenty-four')}>practice 24</button></main> }));
vi.mock('./RoomPage', () => ({ RoomPage: () => <main><h1>room</h1></main> }));

import { App } from './App';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<SoloWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: SoloWorkerRequest | null = null;
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: SoloWorkerRequest) { this.request = request; }
  terminate() { this.terminated = true; }
  reply(response: Omit<SoloWorkerResponse, 'requestId'>) {
    this.onmessage?.({ data: { requestId: this.request!.requestId, ...response } } as MessageEvent<SoloWorkerResponse>);
  }
}

describe('practice browser navigation with real board', () => {
  afterEach(() => {
    FakeWorker.instances = [];
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    mocks.useClient.mockReset();
    vi.unstubAllGlobals();
  });

  it('Back 卸载旧电脑请求，Forward 从存档继续且忽略旧回包', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('scrollTo', vi.fn());
    window.history.replaceState(null, '', '/?room=ABC234#top');
    mocks.useClient.mockReturnValue({ loading: true, room: null } as unknown as GameHallClient);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'practice' }));
    fireEvent.click(await screen.findByRole('button', { name: '开始练习' }));
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const old = FakeWorker.instances[0]!;

    act(() => { window.history.replaceState(null, '', '/?room=ABC234#top'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('heading', { name: 'home' })).toBeInTheDocument();
    expect(old.terminated).toBe(true);
    act(() => { window.history.replaceState(null, '', '/?room=ABC234&practice=connect-four#top'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(await screen.findByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    act(() => old.reply({ action: { type: 'drop', col: 2 } }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    act(() => FakeWorker.instances[1]!.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
  });

  it('点格棋直达地址与浏览器前进后退恢复练习入口', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('scrollTo', vi.fn());
    window.history.replaceState(null, '', '/?room=ABC234&practice=dots-and-boxes#board');
    mocks.useClient.mockReturnValue({ loading: true, room: null } as unknown as GameHallClient);
    render(<App />);
    expect(await screen.findByRole('heading', { name: '与电脑练习 · 点格棋' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '开始练习' }));
    expect(screen.getByRole('group', { name: '4乘4点、3乘3格子的点格棋棋盘' })).toBeInTheDocument();
    act(() => { window.history.replaceState(null, '', '/?room=ABC234#board'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('heading', { name: 'home' })).toBeInTheDocument();
    act(() => { window.history.replaceState(null, '', '/?room=ABC234&practice=dots-and-boxes#board'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(await screen.findByRole('group', { name: '4乘4点、3乘3格子的点格棋棋盘' })).toBeInTheDocument();
    expect(window.location.search).toBe('?room=ABC234&practice=dots-and-boxes');
  });

  it('24 点可离线直达、前进后退返回原 URL，已恢复房间时提示返回对局', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    window.history.replaceState(null, '', '/?room=ABC234&practice=twenty-four#board');
    mocks.useClient.mockReturnValue({ loading: true, room: { roomId: 'room', members: [], mySeat: 0 } } as unknown as GameHallClient);
    render(<App />);
    expect(await screen.findByRole('heading', { name: '24 点 · 单人练习' })).toBeInTheDocument();
    expect(screen.getByText(/已恢复你的好友房/)).toBeInTheDocument();
    act(() => { window.history.replaceState(null, '', '/?room=ABC234#board'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('heading', { name: 'room' })).toBeInTheDocument();
    act(() => { window.history.replaceState(null, '', '/?room=ABC234&practice=twenty-four#board'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(await screen.findByRole('heading', { name: '24 点 · 单人练习' })).toBeInTheDocument();
    expect(window.location.search).toBe('?room=ABC234&practice=twenty-four');
  });
});
