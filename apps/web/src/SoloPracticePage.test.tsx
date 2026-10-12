import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoloWorkerRequest, SoloWorkerResponse } from './solo-ai.worker';
import { SoloPracticePage } from './SoloPracticePage';

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

function start(gameId: 'connect-four' | 'reversi' = 'connect-four', onExit = vi.fn()) {
  const view = render(<SoloPracticePage gameId={gameId} recoveredRoom={false} onExit={onExit} />);
  fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
  return { ...view, onExit };
}

describe('local computer practice', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('四子连线的人机两步可悔棋，重开只按明确设置生效', async () => {
    start();
    expect(screen.getByText('轮到你')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();

    fireEvent.click(screen.getByText('新一局设置'));
    fireEvent.click(screen.getByRole('radio', { name: '电脑先手' }));
    expect(screen.getByText('你先手 · 轻松')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    expect(screen.getByText('电脑先手 · 轻松')).toBeInTheDocument();
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    expect(FakeWorker.instances[1]!.request?.difficulty).toBe('easy');
  });

  it('计算中悔棋、重开与离开会取消旧请求，迟到回包不能改新局', async () => {
    const { onExit, unmount } = start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const old = FakeWorker.instances[0]!;
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(old.terminated).toBe(true);
    act(() => old.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '投放第 2 列' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const restarted = FakeWorker.instances[1]!;
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    act(() => restarted.reply({ action: { type: 'drop', col: 3 } }));
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '投放第 3 列' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(3));
    const exited = FakeWorker.instances[2]!;
    fireEvent.click(screen.getAllByRole('button', { name: '返回大厅' })[0]!);
    unmount();
    act(() => exited.reply({ action: { type: 'drop', col: 4 } }));
    expect(exited.terminated).toBe(true);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('拒绝非法电脑落子，超时后可用新的请求重试', async () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'placeDisc', row: 0, col: 0 } }));
    expect(screen.getByRole('alert')).toHaveTextContent('未能落下');
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: '重试这步' }));
    await act(async () => { await Promise.resolve(); });
    expect(FakeWorker.instances).toHaveLength(2);
    act(() => vi.advanceTimersByTime(7_001));
    expect(screen.getByRole('alert')).toHaveTextContent('等得太久');
    expect(FakeWorker.instances[1]!.terminated).toBe(true);
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试这步' }));
    await act(async () => { await Promise.resolve(); });
    expect(FakeWorker.instances).toHaveLength(3);
    act(() => FakeWorker.instances[2]!.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
  });

  it('黑白棋电脑先手使用合法落子，玩家随后可落子且练习不需服务端', async () => {
    render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: '电脑先手' }));
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'placeDisc', row: 2, col: 3 } }));
    expect(screen.getByText('轮到你')).toBeInTheDocument();
    expect(screen.getByText('电脑先手 · 轻松')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell', { name: /可落子/ }).length).toBeGreaterThan(0);
  });

  it('Worker 启动失败不会一直显示思考，用户能重试同一局', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('unavailable'); } });
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: '电脑先手' }));
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法启动');
    expect(screen.getByText('电脑这步遇到问题')).toBeInTheDocument();
    vi.stubGlobal('Worker', FakeWorker);
    fireEvent.click(screen.getByRole('button', { name: '重试这步' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'drop', col: 3 } }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
  });

  it('正常动效结束前保留玩家落子，减少动态效果时立即应手', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(349));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
  });
});
