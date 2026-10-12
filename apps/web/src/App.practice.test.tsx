import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameHallClient } from './gamehall-client';
import type { SoloWorkerRequest, SoloWorkerResponse } from './solo-ai.worker';

const mocks = vi.hoisted(() => ({ useClient: vi.fn() }));
vi.mock('./gamehall-client', () => ({ useGameHallClient: mocks.useClient }));
vi.mock('./HomePage', () => ({ HomePage: ({ onPractice }: { onPractice: (game: 'connect-four') => void }) => <main><h1 tabIndex={-1}>home</h1><button onClick={() => onPractice('connect-four')}>practice</button></main> }));
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
});
