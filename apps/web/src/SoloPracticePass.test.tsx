import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SoloWorkerRequest, SoloWorkerResponse } from './solo-ai.worker';

vi.mock('@gamehall/game-core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@gamehall/game-core')>();
  return {
    ...core,
    createReversiState(firstPlayer: 0 | 1) {
      const state = core.createReversiState(firstPlayer);
      if (firstPlayer !== 1) return state;
      const board = Array<0 | 1 | null>(64).fill(1);
      board[0] = null; board[1] = 0; board[63] = null; board[62] = 0;
      return { ...state, board, counts: [2, 60] as [number, number], moveCount: 58 };
    },
  };
});

import { SoloPracticePage } from './SoloPracticePage';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<SoloWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: SoloWorkerRequest | null = null;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: SoloWorkerRequest) { this.request = request; }
  terminate() { /* The test still delivers late messages to exercise the component guard. */ }
  reply(action: SoloWorkerResponse['action']) {
    this.onmessage?.({ data: { requestId: this.request!.requestId, action } } as MessageEvent<SoloWorkerResponse>);
  }
}

describe('Reversi practice auto-pass', () => {
  afterEach(() => {
    FakeWorker.instances = [];
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('玩家无合法步时组件继续请求电脑第二手并显示最终结算', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: '电脑先手' }));
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0]!.reply({ type: 'placeDisc', row: 0, col: 0 }));
    expect(screen.getByText(/你暂无合法步，已自动跳过/)).toBeInTheDocument();
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    expect(FakeWorker.instances[1]!.request?.stateJson).toContain('"lastPass":0');
    act(() => FakeWorker.instances[1]!.reply({ type: 'placeDisc', row: 7, col: 7 }));
    expect(screen.getByText('电脑赢了，再试一次？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '悔棋' })).toBeDisabled();
  });
});
