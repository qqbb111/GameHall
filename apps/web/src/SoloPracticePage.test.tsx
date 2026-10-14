import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoloWorkerRequest, SoloWorkerResponse } from './solo-ai.worker';
import { applyConnectFourAction, applyGomokuAction, applyReversiAction, createConnectFourState, createDotsAndBoxesState, createGomokuState, createReversiState, legalReversiMoves, type ConnectFourState, type DotsAndBoxesState, type ReversiState } from '@gamehall/game-core';
import { dotsAfter, type DotsEdge } from './dots-solo';
import { readSoloDraft, saveSoloProgress, soloProgressKey, writeSoloDraft, type SoloProgress, type SoloSnapshot } from './solo-progress';
import { readSharedSoloSnapshot, writeSharedSoloProgress } from './solo-shared-store';
import * as sharedStore from './solo-shared-store';
import { SoloPracticePage } from './SoloPracticePage';
import { captureStorageTimers, holdFirstWriteCompletion } from './idb-late-ack.test-helper';

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

async function start(gameId: 'connect-four' | 'reversi' | 'dots-and-boxes' | 'gomoku' = 'connect-four', onExit = vi.fn()) {
  const view = render(<SoloPracticePage gameId={gameId} recoveredRoom={false} onExit={onExit} />);
  fireEvent.click(await screen.findByRole('button', { name: '开始练习' }));
  return { ...view, onExit };
}

function reversiProgress(moveCount: number, difficulty: 'easy' | 'thoughtful' = 'easy'): SoloProgress {
  let state = createReversiState(0);
  for (let index = 0; index < moveCount; index++) {
    const move = legalReversiMoves(state.board, state.turn)[0];
    if (!move) throw new Error('bad reversi fixture');
    const result = applyReversiAction(state, state.turn, { type: 'placeDisc', ...move });
    if (!result.ok) throw new Error('bad reversi fixture');
    state = result.state;
  }
  return { gameId: 'reversi', state, history: [], difficulty, starter: 'human' };
}

async function shared(gameId: 'connect-four' | 'reversi' | 'dots-and-boxes' | 'gomoku') { return (await readSharedSoloSnapshot(gameId)).read; }

function dotsProgress(firstPlayer: 0 | 1, edges: DotsEdge[]): SoloProgress {
  let state = createDotsAndBoxesState(firstPlayer);
  const history: DotsAndBoxesState[] = [];
  for (const edge of edges) {
    if (state.turn === 0) history.push(state);
    state = dotsAfter(state, edge);
  }
  return { gameId: 'dots-and-boxes', state, trace: edges, history, difficulty: 'easy', starter: firstPlayer === 0 ? 'human' : 'computer' };
}

function conflictPractice(gameId: 'connect-four' | 'gomoku', count: number): SoloProgress {
  if (gameId === 'connect-four') {
    let state = createConnectFourState(0);
    for (const col of [2, 3, 2, 3, 4, 4].slice(0, count)) {
      const result = applyConnectFourAction(state, state.turn, { type: 'drop', col });
      if (!result.ok) throw new Error('bad four fixture');
      state = result.state;
    }
    return { gameId, state, history: [], difficulty: 'easy', starter: 'human' };
  }
  let state = createGomokuState(0);
  const history: SoloProgress['history'] = [];
  const gomokuMoves = [{ row: 7, col: 7 }, { row: 7, col: 8 }, { row: 8, col: 7 }, { row: 8, col: 8 }, { row: 6, col: 7 }, { row: 6, col: 8 }].slice(0, count);
  for (const move of gomokuMoves) {
    if (state.turn === 0) history.push(state);
    const result = applyGomokuAction(state, state.turn, { type: 'place', ...move });
    if (!result.ok) throw new Error('bad gomoku fixture');
    state = result.state;
  }
  return { gameId, state, history, gomokuMoves, difficulty: 'easy', starter: 'human' };
}

async function saveShared(progress: SoloProgress) {
  const before = await readSharedSoloSnapshot(progress.gameId);
  const result = await writeSharedSoloProgress(progress, before.token);
  expect(result.kind).toBe('saved');
  fireEvent.focus(window);
}

describe('local computer practice', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: () => unknown) => callback() } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('五子棋提示只标落点；采用、电脑应手、悔棋、迟到回包和刷新恢复共享进度', async () => {
    const view = await start('gomoku');
    expect(screen.getByRole('grid', { name: '15乘15五子棋棋盘' }).querySelectorAll('[role="gridcell"]')).toHaveLength(225);
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    act(() => FakeWorker.instances[0]!.reply({ hint: { action: { type: 'place', row: 7, col: 7 }, reason: '占据中心。' } }));
    expect(screen.getByRole('gridcell', { name: /第 8 行第 8 列.*建议落点/ })).toHaveClass('is-hint');
    await waitFor(async () => expect(await shared('gomoku')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 }, gomokuMoves: [] } }));
    fireEvent.click(screen.getByRole('button', { name: '采用这步' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const pending = FakeWorker.instances[1]!;
    expect(pending.request).toMatchObject({ gameId: 'gomoku', purpose: 'move' });
    act(() => pending.reply({ action: { type: 'place', row: 7, col: 8 } }));
    await waitFor(async () => expect(await shared('gomoku')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 2 }, gomokuMoves: [{ row: 7, col: 7 }, { row: 7, col: 8 }] } }));
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    await waitFor(async () => expect(await shared('gomoku')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 }, gomokuMoves: [] } }));
    act(() => pending.reply({ action: { type: 'place', row: 7, col: 9 } }));
    expect(screen.getByRole('gridcell', { name: /第 8 行第 8 列，空位/ })).toBeInTheDocument();
    view.unmount();
    render(<SoloPracticePage gameId="gomoku" recoveredRoom={false} onExit={vi.fn()} />);
    expect(await screen.findByText('已恢复上次练习')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '悔棋' })).toBeDisabled();
  });

  it('五子棋电脑先手执黑，旧回包在重新开始后不能改写新棋局', async () => {
    render(<SoloPracticePage gameId="gomoku" recoveredRoom={false} onExit={vi.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: '电脑先手' }));
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    expect(screen.getByText('你 · 白色')).toBeInTheDocument();
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const old = FakeWorker.instances[0]!;
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    act(() => old.reply({ action: { type: 'place', row: 7, col: 7 } }));
    expect(screen.getByRole('gridcell', { name: /第 8 行第 8 列，空位/ })).toBeInTheDocument();
    act(() => FakeWorker.instances[1]!.reply({ action: { type: 'place', row: 7, col: 7 } }));
    expect(screen.getByRole('gridcell', { name: /第 8 行第 8 列，黑子/ })).toBeInTheDocument();
  });

  it('五子棋方向键落子后电脑应手时接续合法空位，移开焦点后不抢回棋盘', async () => {
    await start('gomoku');
    const center = screen.getByRole('gridcell', { name: /第 8 行第 8 列，空位/ });
    center.focus();
    fireEvent.keyDown(center, { key: 'Enter' });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'place', row: 7, col: 8 } }));
    const next = screen.getByRole('gridcell', { name: /第 8 行第 10 列，空位/ });
    expect(next).toHaveFocus();
    fireEvent.keyDown(next, { key: 'Enter' });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const undoButton = screen.getByRole('button', { name: '悔棋' });
    undoButton.focus();
    act(() => FakeWorker.instances[1]!.reply({ action: { type: 'place', row: 6, col: 8 } }));
    expect(undoButton).toHaveFocus();
  });

  it('四子连线的人机两步可悔棋，重开只按明确设置生效', async () => {
    await start();
    expect(screen.getByText('轮到你')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
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
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(2));
    expect(FakeWorker.instances[1]!.request?.difficulty).toBe('easy');
  });

  it('点格棋提示仅预览合法边，取消与另画边清除，后台错误可重试', async () => {
    await start('dots-and-boxes');
    expect(screen.getByText('电脑 · 珊瑚色')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    const bad = FakeWorker.instances[0]!;
    act(() => bad.reply({ hint: { action: { type: 'drawEdge', orientation: 'H', row: 9, col: 0 }, reason: '错边' } }));
    expect(screen.getByRole('button', { name: '重试提示' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试提示' }));
    act(() => FakeWorker.instances[1]!.reply({ hint: { action: { type: 'drawEdge', orientation: 'H', row: 0, col: 0 }, reason: '这条边安全' } }));
    expect(screen.getByRole('button', { name: '横边，第 1 行第 1 列，可画' })).toHaveClass('is-hint');
    await waitFor(async () => expect(await shared('dots-and-boxes')).toMatchObject({ kind: 'valid', progress: { state: { edgeCount: 0 }, trace: [] } }));
    fireEvent.click(screen.getByRole('button', { name: '取消提示' }));
    expect(screen.getByRole('button', { name: '横边，第 1 行第 1 列，可画' })).not.toHaveClass('is-hint');
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    act(() => FakeWorker.instances[2]!.reply({ hint: { action: { type: 'drawEdge', orientation: 'H', row: 0, col: 0 }, reason: '建议' } }));
    fireEvent.click(screen.getByRole('button', { name: '竖边，第 1 行第 1 列，可画' }));
    expect(screen.queryByText(/建议：横边/)).not.toBeInTheDocument();
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(4));
    expect((FakeWorker.instances[3]!.request?.gameId)).toBe('dots-and-boxes');
  });

  it('点格棋人类封格后仍能画边；悔棋按每次决定回退并截断轨迹', async () => {
    const edges: DotsEdge[] = [
      { type: 'drawEdge', orientation: 'H', row: 0, col: 0 },
      { type: 'drawEdge', orientation: 'H', row: 1, col: 0 },
      { type: 'drawEdge', orientation: 'V', row: 0, col: 0 },
    ];
    await saveShared(dotsProgress(1, edges));
    render(<SoloPracticePage gameId="dots-and-boxes" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: '竖边，第 1 行第 2 列，可画' });
    fireEvent.click(screen.getByRole('button', { name: '竖边，第 1 行第 2 列，可画' }));
    expect(screen.getByText('你获得 1 分，还能继续画边')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '横边，第 1 行第 2 列，可画' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '横边，第 1 行第 2 列，可画' }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    expect(screen.getByRole('button', { name: '横边，第 1 行第 2 列，可画' })).toBeEnabled();
    await waitFor(async () => expect(await shared('dots-and-boxes')).toMatchObject({ kind: 'valid', progress: { state: { edgeCount: 4 }, trace: [...edges, { type: 'drawEdge', orientation: 'V', row: 0, col: 1 }] } }));
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    await waitFor(async () => expect(await shared('dots-and-boxes')).toMatchObject({ kind: 'valid', progress: { state: { edgeCount: 3 }, trace: edges } }));
  });

  it('点格棋电脑封格后继续请求，重开时旧回包不能进入新轨迹', async () => {
    const edges: DotsEdge[] = [
      { type: 'drawEdge', orientation: 'H', row: 0, col: 0 },
      { type: 'drawEdge', orientation: 'H', row: 1, col: 0 },
      { type: 'drawEdge', orientation: 'V', row: 0, col: 0 },
    ];
    await saveShared(dotsProgress(0, edges));
    render(<SoloPracticePage gameId="dots-and-boxes" recoveredRoom={false} onExit={vi.fn()} />);
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'drawEdge', orientation: 'V', row: 0, col: 1 } }));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    expect(screen.getByText('电脑获得 1 分，正在继续画边…')).toBeInTheDocument();
    const old = FakeWorker.instances[1]!;
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    fireEvent.click(screen.getByRole('button', { name: '清空并重新开始' }));
    expect(old.terminated).toBe(true);
    act(() => old.reply({ action: { type: 'drawEdge', orientation: 'H', row: 0, col: 1 } }));
    await waitFor(async () => expect(await shared('dots-and-boxes')).toMatchObject({ kind: 'valid', progress: { state: { edgeCount: 0 }, trace: [] } }));
  });

  it('点格棋跨标签差异预览标出边归属，显式保存当前分叉仍保留轨迹', async () => {
    const horizontal: DotsEdge = { type: 'drawEdge', orientation: 'H', row: 0, col: 0 };
    const vertical: DotsEdge = { type: 'drawEdge', orientation: 'V', row: 0, col: 0 };
    const current = dotsProgress(0, [horizontal]);
    const saved = dotsProgress(0, [vertical]);
    expect(writeSoloDraft({ progress: current, baseToken: null })).toBe(true);
    await saveShared(saved);
    const { container } = render(<SoloPracticePage gameId="dots-and-boxes" recoveredRoom={false} onExit={vi.fn()} />);
    expect(await screen.findByText('另一窗口更新了这款练习')).toBeInTheDocument();
    expect(screen.getByText(/两盘有 2 条边或方格归属不同/)).toBeInTheDocument();
    expect(screen.getByText(/差异位置：横边第 1 行第 1 列、竖边第 1 行第 1 列/)).toBeInTheDocument();
    expect(container.querySelectorAll('.solo-dots-preview')).toHaveLength(2);
    expect(container.querySelectorAll('.solo-dots-preview .is-different')).toHaveLength(4);
    expect(container.querySelector('.solo-dots-preview button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存当前棋局' }));
    await waitFor(async () => expect(await shared('dots-and-boxes')).toEqual({ kind: 'valid', progress: current }));
  });

  it('进行中重开先确认；Esc 与背景关闭保留棋盘、存档及电脑应手，并恢复按钮焦点', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0]!;
    const saved = (await readSharedSoloSnapshot('connect-four')).token;
    const restart = screen.getByRole('button', { name: '重新开始' });
    restart.focus();
    fireEvent.click(restart);
    const dialog = screen.getByRole('alertdialog', { name: '重新开始这局？' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.querySelector('.solo-shell')).toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: '继续这盘' })).toHaveFocus();
    expect(worker.terminated).toBe(false);
    expect((await readSharedSoloSnapshot('connect-four')).token).toBe(saved);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '清空并重新开始' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '继续这盘' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(document.querySelector('.solo-shell')).not.toHaveAttribute('inert');
    expect(restart).toHaveFocus();
    expect(worker.terminated).toBe(false);
    act(() => worker.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    const hintWorker = FakeWorker.instances[1]!;
    restart.focus();
    fireEvent.click(restart);
    act(() => hintWorker.reply({ hint: { action: { type: 'drop', col: 3 }, reason: '当前建议' } }));
    expect(screen.getByRole('button', { name: '继续这盘' })).toHaveFocus();
    expect(screen.getByText(/当前建议/)).toBeInTheDocument();
    const backdrop = screen.getByRole('alertdialog').parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.mouseUp(backdrop);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(backdrop);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(restart).toHaveFocus();
    expect(screen.getByText(/当前建议/)).toBeInTheDocument();
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 2 } } }));
  });

  it('确认重开才清除进行中棋盘与旧请求，并按待生效设置保存新局；空局与终局直接重开', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    const old = FakeWorker.instances[0]!;
    fireEvent.click(screen.getByText('新一局设置'));
    fireEvent.click(screen.getByRole('radio', { name: '电脑先手' }));
    fireEvent.click(screen.getByRole('radio', { name: '认真' }));
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    expect(screen.getByText(/这盘练习会清空，新一局会用“电脑先手 · 认真”设置/)).toBeInTheDocument();
    expect(old.terminated).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '清空并重新开始' }));
    expect(old.terminated).toBe(true);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();
    expect(screen.getByText('电脑先手 · 认真')).toBeInTheDocument();
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 }, starter: 'computer', difficulty: 'thoughtful' } }));
  });

  it('确认框期间电脑可完成应手，取消后仍保留；已结束棋局直接开新局', async () => {
    const first = await start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续这盘' }));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 2 } } }));
    first.unmount();

    let finished = createConnectFourState(0);
    for (const col of [0, 0, 1, 1, 2, 2, 3]) {
      const moved = applyConnectFourAction(finished, finished.turn, { type: 'drop', col });
      if (!moved.ok) throw new Error('bad finished fixture');
      finished = moved.state;
    }
    expect(finished.phase).toBe('finished');
    await saveShared({ gameId: 'connect-four', state: finished, history: [], difficulty: 'easy', starter: 'human' });
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: /已投放 7 枚棋子/ });
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();
  });

  it('四子提示只预览合法列，取消不落子；采用后按玩家落子并恢复焦点', async () => {
    await start();
    const originalSave = window.localStorage.getItem(soloProgressKey('connect-four'));
    screen.getByRole('button', { name: '提示一步' }).focus();
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    const worker = FakeWorker.instances[0]!;
    expect(worker.request).toMatchObject({ purpose: 'hint', difficulty: 'thoughtful', gameId: 'connect-four' });
    expect(screen.getByRole('button', { name: '正在寻找落点…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    expect(worker.terminated).toBe(true);
    act(() => worker.reply({ hint: { action: { type: 'drop', col: 3 }, reason: '旧建议' } }));
    expect(screen.queryByText(/旧建议/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();

    screen.getByRole('button', { name: '提示一步' }).focus();
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    act(() => FakeWorker.instances[2]!.reply({ hint: { action: { type: 'drop', col: 3 }, reason: '建议这一列。' } }));
    expect(screen.getByRole('button', { name: '采用这步' })).toHaveFocus();
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();
    expect(window.localStorage.getItem(soloProgressKey('connect-four'))).toBe(originalSave);
    expect(screen.getByRole('button', { name: '投放第 4 列，建议落点' })).toHaveClass('is-hint');
    expect(screen.getByRole('gridcell', { name: /第 6 行第 4 列，空位，建议落点/ })).toHaveClass('is-hint');
    fireEvent.click(screen.getByRole('button', { name: '取消提示' }));
    expect(screen.getByRole('button', { name: '提示一步' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '投放第 4 列' })).not.toHaveClass('is-hint');

    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    act(() => FakeWorker.instances[3]!.reply({ hint: { action: { type: 'drop', col: 3 }, reason: '建议这一列。' } }));
    fireEvent.click(screen.getByRole('button', { name: '采用这步' }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    await waitFor(async () => expect(screen.getByText('电脑正在思考…')).toHaveFocus());
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1 } } }));
  });

  it('黑白棋提示标出合法格，不能自动落子；手动改落点会清提示', async () => {
    await start('reversi');
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    const hint = { action: { type: 'placeDisc', row: 2, col: 3 } as const, reason: '这步可以翻转 1 枚棋子。' };
    act(() => FakeWorker.instances[0]!.reply({ hint }));
    expect(screen.getByRole('gridcell', { name: /第 3 行第 4 列.*建议落点/ })).toHaveClass('is-hint');
    await waitFor(async () => expect(await shared('reversi')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 } } }));
    fireEvent.click(screen.getByRole('gridcell', { name: '第 4 行第 3 列，空位，可落子' }));
    expect(screen.queryByText(/这步可以翻转/)).not.toBeInTheDocument();
    await waitFor(async () => expect(await shared('reversi')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1 } } }));
  });

  it('黑白棋可采用建议，异步建议不会抢走用户移到棋盘的焦点', async () => {
    await start('reversi');
    screen.getByRole('button', { name: '提示一步' }).focus();
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    const cell = screen.getByRole('gridcell', { name: '第 3 行第 4 列，空位，可落子' });
    cell.focus();
    act(() => FakeWorker.instances[0]!.reply({ hint: { action: { type: 'placeDisc', row: 2, col: 3 }, reason: '这步可以翻转 1 枚棋子。' } }));
    expect(cell).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '采用这步' }));
    await waitFor(async () => expect(await shared('reversi')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1, turn: 1 } } }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(2));
    expect(FakeWorker.instances[1]!.request?.purpose).toBe('move');
  });

  it('提示拒绝错请求、认输与非法位置；超时可重试且棋盘始终可正常落子', async () => {
    await start();
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 } } }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    const first = FakeWorker.instances[0]!;
    act(() => first.onmessage?.({ data: { requestId: first.request!.requestId + 1, hint: { action: { type: 'drop', col: 2 }, reason: '错请求' } } } as MessageEvent<SoloWorkerResponse>));
    expect(screen.queryByText(/错请求/)).not.toBeInTheDocument();
    act(() => first.reply({ hint: { action: { type: 'resign' }, reason: '不可采用' } }));
    expect(screen.getByRole('button', { name: '重试提示' })).toBeInTheDocument();
    expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 } } });
    fireEvent.click(screen.getByRole('button', { name: '重试提示' }));
    act(() => FakeWorker.instances[1]!.reply({ hint: { action: { type: 'drop', col: 7 }, reason: '越界' } }));
    expect(screen.getByRole('button', { name: '重试提示' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试提示' }));
    act(() => vi.advanceTimersByTime(7_001));
    expect(FakeWorker.instances[2]!.terminated).toBe(true);
    expect(screen.getByRole('button', { name: '重试提示' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '投放第 2 列' }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
  });

  it.each(['undo', 'restart', 'exit'] as const)('提示计算中 %s 取消旧响应', async (cancel) => {
    const { unmount, onExit } = await start();
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    const old = FakeWorker.instances[0]!;
    if (cancel === 'undo') {
      fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
      fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    } else if (cancel === 'restart') fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    else { fireEvent.click(screen.getAllByRole('button', { name: '返回大厅' })[0]!); unmount(); expect(onExit).toHaveBeenCalledOnce(); }
    expect(old.terminated).toBe(true);
    act(() => old.reply({ hint: { action: { type: 'drop', col: 3 }, reason: '过期' } }));
    expect(screen.queryByText(/过期/)).not.toBeInTheDocument();
    if (cancel !== 'exit') expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();
  });

  it('有结果的提示在重开后立即消失，新局不沿用旧建议', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    act(() => FakeWorker.instances[0]!.reply({ hint: { action: { type: 'drop', col: 3 }, reason: '仅适用于旧局' } }));
    expect(screen.getByText(/仅适用于旧局/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    expect(screen.queryByText(/仅适用于旧局/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提示一步' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '投放第 4 列' })).not.toHaveClass('is-hint');
  });

  it('计算中悔棋、重开与离开会取消旧请求，迟到回包不能改新局', async () => {
    const { onExit, unmount } = await start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    const old = FakeWorker.instances[0]!;
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(old.terminated).toBe(true);
    act(() => old.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '投放第 2 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(2));
    const restarted = FakeWorker.instances[1]!;
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    fireEvent.click(screen.getByRole('button', { name: '清空并重新开始' }));
    act(() => restarted.reply({ action: { type: 'drop', col: 3 } }));
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '投放第 3 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(3));
    const exited = FakeWorker.instances[2]!;
    fireEvent.click(screen.getAllByRole('button', { name: '返回大厅' })[0]!);
    unmount();
    act(() => exited.reply({ action: { type: 'drop', col: 4 } }));
    expect(exited.terminated).toBe(true);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('拒绝非法电脑落子，超时后可用新的请求重试', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
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

  it('电脑回传认输动作也不会结束本地练习', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'resign' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('未能落下');
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    expect(screen.queryByText('你赢了！')).not.toBeInTheDocument();
  });

  it('黑白棋电脑先手使用合法落子，玩家随后可落子且练习不需服务端', async () => {
    render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: '开始练习' });
    fireEvent.click(screen.getByRole('radio', { name: '电脑先手' }));
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'placeDisc', row: 2, col: 3 } }));
    expect(screen.getByText('轮到你')).toBeInTheDocument();
    expect(screen.getByText('电脑先手 · 轻松')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell', { name: /可落子/ }).length).toBeGreaterThan(0);
  });

  it('Worker 启动失败不会一直显示思考，用户能重试同一局', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('unavailable'); } });
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: '开始练习' });
    fireEvent.click(screen.getByRole('radio', { name: '电脑先手' }));
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法启动');
    expect(screen.getByText('电脑这步遇到问题')).toBeInTheDocument();
    vi.stubGlobal('Worker', FakeWorker);
    const retry = screen.getByRole('button', { name: '重试这步' });
    retry.focus();
    fireEvent.click(retry);
    expect(screen.queryByText('电脑这步遇到问题')).not.toBeInTheDocument();
    expect(screen.getByText('电脑正在思考…')).toHaveFocus();
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'drop', col: 3 } }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
  });

  it('正常动效结束前保留玩家落子，减少动态效果时立即应手', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    await start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(349));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
  });

  it.each(['undo', 'restart', 'exit'] as const)('电脑回包已进入动画等待时 %s 会清除待落子的旧计时器', async (cancel) => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const { onExit, unmount } = await start();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await act(async () => { await Promise.resolve(); });
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0]!;
    act(() => worker.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();

    if (cancel === 'undo') fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    else if (cancel === 'restart') {
      fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
      fireEvent.click(screen.getByRole('button', { name: '清空并重新开始' }));
    }
    else {
      fireEvent.click(screen.getAllByRole('button', { name: '返回大厅' })[0]!);
      unmount();
      expect(onExit).toHaveBeenCalledOnce();
    }
    expect(worker.terminated).toBe(true);
    if (cancel === 'exit') {
      act(() => vi.advanceTimersByTime(1_000));
      vi.useRealTimers();
      render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
      expect(await screen.findByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    } else act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('grid', { name: cancel === 'exit' ? /已投放 1 枚棋子/ : /已投放 0 枚棋子/ })).toBeInTheDocument();
  });

  it('四子连线刷新后继续电脑回合，旧实例迟到应手不污染新局，悔棋历史仍可用', async () => {
    const first = await start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1, turn: 1 }, history: [{ moveCount: 0 }] } }));
    const old = FakeWorker.instances[0]!;
    first.unmount();
    expect(old.terminated).toBe(true);
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: /已投放 1 枚棋子/ });
    expect(screen.getByText('已恢复上次练习')).toBeInTheDocument();
    expect(await screen.findByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(2));
    act(() => old.reply({ action: { type: 'drop', col: 2 } }));
    expect(await screen.findByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    act(() => FakeWorker.instances[1]!.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(screen.getByRole('grid', { name: /已投放 0 枚棋子/ })).toBeInTheDocument();
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 }, history: [] } }));
  });

  it('黑白棋刷新后合法应手和悔棋继续可用，不重新显示设置页', async () => {
    const first = await start('reversi');
    fireEvent.click(screen.getByRole('gridcell', { name: '第 3 行第 4 列，空位，可落子' }));
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(1));
    first.unmount();
    render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: '8乘8黑白棋棋盘' });
    expect(screen.queryByRole('button', { name: '开始练习' })).not.toBeInTheDocument();
    await waitFor(async () => expect(FakeWorker.instances).toHaveLength(2));
    const request = FakeWorker.instances[1]!.request!;
    const board = JSON.parse(request.stateJson).board as Array<0 | 1 | null>;
    const move = legalReversiMoves(board, 1)[0]!;
    act(() => FakeWorker.instances[1]!.reply({ action: { type: 'placeDisc', ...move } }));
    expect(screen.getByText('轮到你')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    await waitFor(async () => expect(await shared('reversi')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 }, history: [] } }));
  });

  it('pagehide 不重写共享存档，本标签草稿保留实际先手/难度；坏记录退回设置', async () => {
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: '开始练习' });
    fireEvent.click(screen.getByRole('radio', { name: '电脑先手' }));
    fireEvent.click(screen.getByRole('radio', { name: '认真' }));
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    expect(readSoloDraft('connect-four')).toMatchObject({ progress: { starter: 'computer', difficulty: 'thoughtful', state: { turn: 1 } } });
    window.localStorage.removeItem(soloProgressKey('connect-four'));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(await shared('connect-four')).toEqual({ kind: 'empty' });
    window.localStorage.setItem(soloProgressKey('reversi'), '{broken');
    render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: '开始练习' });
    expect(screen.getByText('上次练习没能恢复，可以开始新一局。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始练习' })).toBeInTheDocument();
  });

  it('存储不可写只显示非阻断提示，仍可继续落子', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await start();
    expect(screen.getByText('当前浏览器无法保存，刷新后会重新开始。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    expect(screen.getByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
  });

  it('有效结束棋局直接显示棋盘，且不得无意覆盖旧局', async () => {
    let state = createConnectFourState(0);
    for (const col of [0, 6, 1, 6, 2, 5, 3]) {
      const result = applyConnectFourAction(state, state.turn, { type: 'drop', col });
      if (!result.ok) throw new Error('bad fixture');
      state = result.state;
    }
    expect(saveSoloProgress({ gameId: 'connect-four', state, history: [], starter: 'human', difficulty: 'easy' })).toBe(true);
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: /已投放 7 枚棋子/ });
    expect(screen.getByRole('grid', { name: /已投放 7 枚棋子/ })).toBeInTheDocument();
    expect(screen.getByText('你赢了！')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始练习' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('新一局设置'));
    fireEvent.click(screen.getByRole('radio', { name: '电脑先手' }));
    expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { starter: 'human' } });
  });

  it('同游戏另一窗口保存后，旧棋盘与自动应手可继续，但离开和pagehide不覆盖新存档；刷新保留分叉选择', async () => {
    const old = reversiProgress(7);
    const newer = reversiProgress(9, 'thoughtful');
    expect(saveSoloProgress(old)).toBe(true);
    const first = render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: '8乘8黑白棋棋盘' });
    expect(screen.getByRole('grid', { name: '8乘8黑白棋棋盘' })).toBeInTheDocument();
    expect(screen.getByText('你先手 · 轻松')).toBeInTheDocument();
    await saveShared(newer);
    expect(await screen.findByText('另一窗口更新了这款练习')).toBeInTheDocument();
    expect(screen.getByText(/当前棋盘：7 步/)).toBeInTheDocument();
    expect(screen.getByText(/已保存：9 步/)).toBeInTheDocument();
    expect(screen.getByText(/当前棋盘：7 步.*黑 \d+：白 \d+/)).toBeInTheDocument();
    expect(screen.getByText(/已保存：9 步.*黑 \d+：白 \d+/)).toBeInTheDocument();

    if (old.state.turn === 1) {
      const worker = FakeWorker.instances.find((item) => !item.terminated)!;
      const move = legalReversiMoves((old.state as ReversiState).board, 1)[0]!;
      act(() => worker.reply({ action: { type: 'placeDisc', ...move } }));
    } else {
      const move = legalReversiMoves((old.state as ReversiState).board, 0)[0]!;
      fireEvent.click(screen.getByRole('gridcell', { name: new RegExp(`第 ${move.row + 1} 行第 ${move.col + 1} 列，空位，可落子`) }));
    }
    expect((readSoloDraft('reversi')?.progress.state as ReversiState | undefined)?.moveCount).toBe(8);
    expect(await shared('reversi')).toEqual({ kind: 'valid', progress: newer });
    act(() => window.dispatchEvent(new Event('pagehide')));
    fireEvent.click(screen.getAllByRole('button', { name: '返回大厅' })[0]!);
    first.unmount();
    expect(await shared('reversi')).toEqual({ kind: 'valid', progress: newer });

    render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText(/当前棋盘：8 步/);
    expect(screen.getByText(/当前棋盘：8 步/)).toBeInTheDocument();
    expect(screen.getByText(/已保存：9 步/)).toBeInTheDocument();
    const staleWorker = FakeWorker.instances.findLast((item) => !item.terminated);
    fireEvent.click(screen.getByRole('button', { name: '接着已保存的练习' }));
    await waitFor(async () => expect(screen.queryByText('另一窗口更新了这款练习')).not.toBeInTheDocument());
    expect(screen.getByText('你先手 · 认真')).toBeInTheDocument();
    expect(screen.getByText('已接着另一窗口保存的练习')).toBeInTheDocument();
    if (staleWorker) {
      expect(staleWorker.terminated).toBe(true);
      act(() => staleWorker.reply({ action: { type: 'placeDisc', row: 0, col: 0 } }));
    }
    expect(await shared('reversi')).toEqual({ kind: 'valid', progress: newer });
    expect(readSoloDraft('reversi')).toBeNull();
  });

  it.each(['connect-four', 'gomoku'] as const)('%s 接着共享棋局前再次核对：未展示的新版本先更新预览，第二次选择才采用', async (gameId) => {
    const local = conflictPractice(gameId, 4);
    const shown = conflictPractice(gameId, 5);
    const latest = conflictPractice(gameId, 6);
    expect(writeSoloDraft({ progress: local, baseToken: null })).toBe(true);
    await saveShared(shown);
    render(<SoloPracticePage gameId={gameId} recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText(/已保存：5 步/);
    await saveShared(latest);
    expect(screen.getByText(/已保存：5 步/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '接着已保存的练习' }));
    expect(await screen.findByText('另一窗口又更新了，请按新预览选择。')).toBeInTheDocument();
    expect(screen.getByText(/已保存：6 步/)).toBeInTheDocument();
    expect(screen.getByText(/当前棋盘：4 步/)).toBeInTheDocument();
    expect(readSoloDraft(gameId)?.progress).toEqual(local);
    const adoptLatest = screen.getByRole('button', { name: '接着已保存的练习' });
    adoptLatest.focus();
    fireEvent.click(adoptLatest);
    await waitFor(() => expect(screen.queryByText('另一窗口更新了这款练习')).not.toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('.solo-toolbar strong')).toHaveFocus());
    if (gameId === 'connect-four') expect(screen.getByRole('grid', { name: /已投放 6 枚棋子/ })).toBeInTheDocument();
    else expect(screen.getByRole('gridcell', { name: /第 7 行第 9 列，白子，最近一步/ })).toBeInTheDocument();
    expect(readSoloDraft(gameId)).toBeNull();
    expect(await shared(gameId)).toEqual({ kind: 'valid', progress: latest });
  });

  it.each(['connect-four', 'gomoku'] as const)('%s 接着共享棋局的读取期间，本地再落子后迟到回包不能覆盖分支', async (gameId) => {
    const local = conflictPractice(gameId, 4);
    const shown = conflictPractice(gameId, 5);
    expect(writeSoloDraft({ progress: local, baseToken: null })).toBe(true);
    await saveShared(shown);
    render(<SoloPracticePage gameId={gameId} recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText(/已保存：5 步/);
    const snapshot = await readSharedSoloSnapshot(gameId);
    let release!: (value: SoloSnapshot) => void;
    const delayed = new Promise<SoloSnapshot>((resolve) => { release = resolve; });
    vi.spyOn(sharedStore, 'readSharedSoloSnapshot').mockImplementationOnce(() => delayed);
    fireEvent.click(screen.getByRole('button', { name: '接着已保存的练习' }));
    if (gameId === 'connect-four') fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    else fireEvent.click(screen.getByRole('gridcell', { name: /第 10 行第 9 列，空位/ }));
    expect(readSoloDraft(gameId)?.progress.state).toMatchObject({ moveCount: 5 });
    await act(async () => { release(snapshot); await delayed; });
    expect(screen.getByText(/当前棋盘：5 步/)).toBeInTheDocument();
    expect(screen.getByText(/已保存：5 步/)).toBeInTheDocument();
    expect(readSoloDraft(gameId)?.progress.state).toMatchObject({ moveCount: 5 });
    expect(await shared(gameId)).toEqual({ kind: 'valid', progress: shown });
  });

  it('接着共享棋局的异步核对期间移焦后不由 round 效果抢回', async () => {
    const local = conflictPractice('connect-four', 4);
    const shown = conflictPractice('connect-four', 5);
    expect(writeSoloDraft({ progress: local, baseToken: null })).toBe(true);
    await saveShared(shown);
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText(/已保存：5 步/);
    const latest = await readSharedSoloSnapshot('connect-four');
    let release!: (value: SoloSnapshot) => void;
    const delayed = new Promise<SoloSnapshot>((resolve) => { release = resolve; });
    vi.spyOn(sharedStore, 'readSharedSoloSnapshot').mockImplementationOnce(() => delayed);
    const adopt = screen.getByRole('button', { name: '接着已保存的练习' });
    adopt.focus();
    fireEvent.click(adopt);
    const headerExit = document.querySelector<HTMLButtonElement>('.solo-header .solo-back')!;
    headerExit.focus();
    await act(async () => { release(latest); await delayed; });
    await waitFor(() => expect(screen.queryByText('另一窗口更新了这款练习')).not.toBeInTheDocument());
    expect(headerExit).toHaveFocus();
    expect(screen.getByRole('grid', { name: /已投放 5 枚棋子/ })).toBeInTheDocument();
  });

  it('四子连线相同四步和最近列仍显示两盘真实差异，预览不可操作', async () => {
    const play = (columns: number[]): SoloProgress => {
      let state = createConnectFourState(0);
      for (const col of columns) {
        const result = applyConnectFourAction(state, state.turn, { type: 'drop', col });
        if (!result.ok) throw new Error('bad fixture');
        state = result.state;
      }
      return { gameId: 'connect-four', state, history: [], difficulty: 'easy', starter: 'human' };
    };
    const current = play([2, 3, 2, 3]);
    const saved = play([6, 3, 6, 3]);
    expect(writeSoloDraft({ progress: current, baseToken: null })).toBe(true);
    await saveShared(saved);
    const { container } = render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('另一窗口更新了这款练习');
    expect(screen.getByText(/当前棋盘：4 步.*最近第 4 列/)).toBeInTheDocument();
    expect(screen.getByText(/已保存：4 步.*最近第 4 列/)).toBeInTheDocument();
    expect(screen.getByText(/两盘有 4 格棋子归属或颜色不同/)).toBeInTheDocument();
    const previews = container.querySelectorAll('.solo-conflict-preview');
    expect(previews).toHaveLength(2);
    expect(previews[0]!.querySelectorAll('.solo-preview-board > span')).toHaveLength(42);
    expect(previews[1]!.querySelectorAll('.solo-preview-board > span')).toHaveLength(42);
    expect(previews[0]!.querySelector('[data-cell="5-3"]')).toHaveAttribute('data-owner', 'human');
    expect(previews[1]!.querySelector('[data-cell="5-7"]')).toHaveAttribute('data-owner', 'human');
    expect(previews[0]!.querySelectorAll('.is-different')).toHaveLength(4);
    expect(previews[0]!.querySelector('button')).toBeNull();
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '接着已保存的练习' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存当前棋局' })).toBeInTheDocument();
    expect(await shared('connect-four')).toEqual({ kind: 'valid', progress: saved });
  });

  it('同一玩家棋子在两盘颜色不同也标差异', async () => {
    const play = (starter: 'human' | 'computer', columns: number[]): SoloProgress => {
      let state = createConnectFourState(starter === 'human' ? 0 : 1);
      for (const col of columns) {
        const result = applyConnectFourAction(state, state.turn, { type: 'drop', col });
        if (!result.ok) throw new Error('bad fixture');
        state = result.state;
      }
      return { gameId: 'connect-four', state, history: [], difficulty: 'easy', starter };
    };
    const current = play('human', [2, 3]);
    const saved = play('computer', [3, 2]);
    expect((current.state as ConnectFourState).board[5 * 7 + 2]).toBe(0);
    expect((saved.state as ConnectFourState).board[5 * 7 + 2]).toBe(0);
    expect(writeSoloDraft({ progress: current, baseToken: null })).toBe(true);
    await saveShared(saved);
    const { container } = render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('另一窗口更新了这款练习');
    expect(screen.getByText(/两盘有 2 格棋子归属或颜色不同/)).toBeInTheDocument();
    const previews = container.querySelectorAll('.solo-conflict-preview');
    expect(previews[0]!.querySelector('[data-cell="6-3"]')).toHaveClass('is-gold', 'is-different');
    expect(previews[1]!.querySelector('[data-cell="6-3"]')).toHaveClass('is-coral', 'is-different');
    expect(screen.getByText(/差异位置：第 6 行第 3 列/)).toBeInTheDocument();
  });

  it('黑白棋预览标出颜色翻转，且损坏记录不伪造棋盘', async () => {
    const current: SoloProgress = { gameId: 'reversi', state: createReversiState(0), history: [], difficulty: 'easy', starter: 'human' };
    const saved: SoloProgress = { gameId: 'reversi', state: createReversiState(1), history: [], difficulty: 'thoughtful', starter: 'computer' };
    expect(writeSoloDraft({ progress: current, baseToken: null })).toBe(true);
    await saveShared(saved);
    const { container, unmount } = render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('另一窗口更新了这款练习');
    const colorChanged = (current.state as ReversiState).board.findIndex((cell, index) => cell !== null && (saved.state as ReversiState).board[index] !== null && cell !== (saved.state as ReversiState).board[index]);
    expect(colorChanged).toBeGreaterThanOrEqual(0);
    const marked = container.querySelectorAll('.solo-conflict-preview')[0]!.querySelectorAll('.solo-preview-board > span')[colorChanged]!;
    expect(marked).toHaveClass('is-different');
    expect(container.querySelectorAll('.solo-preview-board.reversi > span')).toHaveLength(128);
    unmount();

    vi.spyOn(sharedStore, 'readSharedSoloSnapshot').mockResolvedValue({ read: { kind: 'invalid' }, token: 'idb:00000000-0000-0000-0000-000000000000' });
    const second = render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('另一窗口更新了这款练习');
    expect(screen.getByText('共享记录损坏，不能显示棋盘；请确认当前局面后再保存。')).toBeInTheDocument();
    expect(second.container.querySelector('.solo-conflict-preview')).toBeNull();
    expect(screen.queryByRole('button', { name: '接着已保存的练习' })).not.toBeInTheDocument();
  });

  it('显式保存当前棋局前重读修订；看到的共享局已再次变化时先更新摘要，第二次点击才覆盖', async () => {
    const initial = createConnectFourState(0);
    const first = applyConnectFourAction(initial, 0, { type: 'drop', col: 0 });
    if (!first.ok) throw new Error('bad fixture');
    const second = applyConnectFourAction(first.state, 1, { type: 'drop', col: 1 });
    if (!second.ok) throw new Error('bad fixture');
    const wrap = (state: typeof initial): SoloProgress => ({ gameId: 'connect-four', state, history: [], difficulty: 'easy', starter: 'human' });
    expect(saveSoloProgress(wrap(initial))).toBe(true);
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: /已投放 0 枚棋子/ });
    await saveShared(wrap(first.state));
    await screen.findByText(/已保存：1 步/);
    await saveShared(wrap(second.state));
    fireEvent.click(screen.getByRole('button', { name: '保存当前棋局' }));
    await screen.findByText(/已保存：2 步/);
    expect(await shared('connect-four')).toEqual({ kind: 'valid', progress: wrap(second.state) });
    const saveCurrent = screen.getByRole('button', { name: '保存当前棋局' });
    saveCurrent.focus();
    fireEvent.click(saveCurrent);
    await waitFor(async () => expect(await shared('connect-four')).toEqual({ kind: 'valid', progress: wrap(initial) }));
    expect(screen.queryByText('另一窗口更新了这款练习')).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.solo-toolbar strong')).toHaveFocus());
  });

  it('显式覆盖写入已发生但锁结果迟到时，新的本地落子草稿仍保留并继续保存', async () => {
    const initial = createConnectFourState(0);
    const newer = applyConnectFourAction(initial, 0, { type: 'drop', col: 3 });
    if (!newer.ok) throw new Error('bad fixture');
    expect(saveSoloProgress({ gameId: 'connect-four', state: initial, history: [], difficulty: 'easy', starter: 'human' })).toBe(true);
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: /已投放 0 枚棋子/ });
    await saveShared({ gameId: 'connect-four', state: newer.state, history: [initial], difficulty: 'easy', starter: 'human' });
    await screen.findByText(/已保存：1 步/);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let holdFirst = true;
    const actualWrite = sharedStore.writeSharedSoloProgress;
    vi.spyOn(sharedStore, 'writeSharedSoloProgress').mockImplementation(async (...args) => {
      const result = await actualWrite(...args);
      if (holdFirst) { holdFirst = false; await held; }
      return result;
    });
    fireEvent.click(screen.getByRole('button', { name: '保存当前棋局' }));
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 } } }));
    fireEvent.click(screen.getByRole('button', { name: '投放第 2 列' }));
    expect((readSoloDraft('connect-four')?.progress.state as ConnectFourState | undefined)?.moveCount).toBe(1);
    await act(async () => release());
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1 } } }));
    expect(screen.queryByText('另一窗口更新了这款练习')).not.toBeInTheDocument();
  });

  it('显式覆盖迟到后若新一步草稿写失败，不谎称当前棋局已保存', async () => {
    const initial = createConnectFourState(0);
    const newer = applyConnectFourAction(initial, 0, { type: 'drop', col: 3 });
    if (!newer.ok) throw new Error('bad fixture');
    expect(saveSoloProgress({ gameId: 'connect-four', state: initial, history: [], difficulty: 'easy', starter: 'human' })).toBe(true);
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: /已投放 0 枚棋子/ });
    await saveShared({ gameId: 'connect-four', state: newer.state, history: [initial], difficulty: 'easy', starter: 'human' });
    await screen.findByText(/已保存：1 步/);
    let releaseFirst!: () => void, releaseSecond!: () => void;
    const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondHold = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let requests = 0;
    const actualWrite = sharedStore.writeSharedSoloProgress;
    vi.spyOn(sharedStore, 'writeSharedSoloProgress').mockImplementation(async (...args) => {
      requests++;
      if (requests === 1) { const result = await actualWrite(...args); await firstHold; return result; }
      await secondHold;
      return actualWrite(...args);
    });
    fireEvent.click(screen.getByRole('button', { name: '保存当前棋局' }));
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 } } }));
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === window.sessionStorage) throw new Error('session blocked');
      return setItem.call(this, key, value);
    });
    fireEvent.click(screen.getByRole('button', { name: '投放第 2 列' }));
    expect(screen.getByText('当前浏览器无法保存，刷新后会重新开始。')).toBeInTheDocument();
    await act(async () => releaseFirst());
    await waitFor(async () => expect(requests).toBe(2));
    expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 } } });
    expect(screen.queryByText('当前棋局已保存')).not.toBeInTheDocument();
    expect(screen.getByText('当前浏览器无法保存，刷新后会重新开始。')).toBeInTheDocument();
    await act(async () => releaseSecond());
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1 } } }));
  });

  it('普通排队保存的旧确认不能掩盖更新一步的草稿失败', async () => {
    const initial = createConnectFourState(0);
    await saveShared({ gameId: 'connect-four', state: initial, history: [], difficulty: 'easy', starter: 'human' });
    let releaseFirst!: () => void, releaseSecond!: () => void;
    const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondHold = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let requests = 0;
    const actualWrite = sharedStore.writeSharedSoloProgress;
    vi.spyOn(sharedStore, 'writeSharedSoloProgress').mockImplementation(async (...args) => {
      requests++;
      if (requests === 1) { const result = await actualWrite(...args); await firstHold; return result; }
      await secondHold;
      return actualWrite(...args);
    });
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: /已投放 0 枚棋子/ });
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1 } } }));
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === window.sessionStorage) throw new Error('session blocked');
      return setItem.call(this, key, value);
    });
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByText('当前浏览器无法保存，刷新后会重新开始。')).toBeInTheDocument();
    await act(async () => releaseFirst());
    await waitFor(async () => expect(requests).toBe(2));
    expect(screen.getByText('当前浏览器无法保存，刷新后会重新开始。')).toBeInTheDocument();
    expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1 } } });
    await act(async () => releaseSecond());
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 2 } } }));
  });

  it('首笔共享写入迟到失败时，残留的旧草稿不能被误认成当前棋盘已保存', async () => {
    await saveShared({ gameId: 'connect-four', state: createConnectFourState(0), history: [], difficulty: 'easy', starter: 'human' });
    let releaseFirst!: () => void, releaseSecond!: () => void;
    const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondHold = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let requests = 0;
    vi.spyOn(sharedStore, 'writeSharedSoloProgress').mockImplementation(async () => {
      requests++;
      if (requests === 1) await firstHold;
      else await secondHold;
      return { kind: 'unavailable' };
    });
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: /已投放 0 枚棋子/ });
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await waitFor(() => expect(requests).toBe(1));
    expect((readSoloDraft('connect-four')?.progress.state as ConnectFourState | undefined)?.moveCount).toBe(1);
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === window.sessionStorage) throw new Error('session blocked');
      return setItem.call(this, key, value);
    });
    act(() => FakeWorker.instances[0]!.reply({ action: { type: 'drop', col: 1 } }));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
    expect((readSoloDraft('connect-four')?.progress.state as ConnectFourState | undefined)?.moveCount).toBe(1);
    expect(screen.getByText('当前浏览器无法保存，刷新后会重新开始。')).toBeInTheDocument();
    await act(async () => releaseFirst());
    await waitFor(() => expect(requests).toBe(2));
    expect(screen.getByText('当前浏览器无法保存，刷新后会重新开始。')).toBeInTheDocument();
    expect(screen.queryByText(/这盘仍保存在当前标签/)).not.toBeInTheDocument();
    await act(async () => releaseSecond());
    expect(screen.getByText('当前浏览器无法保存，刷新后会重新开始。')).toBeInTheDocument();
    expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 0 } } });
  });

  it('无Web Locks时事务持久保存可跨标签读取，刷新继续', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const first = await start();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    expect((readSoloDraft('connect-four')?.progress.state as ConnectFourState | undefined)?.moveCount).toBe(1);
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1 } } }));
    first.unmount();
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    expect(await screen.findByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    expect(screen.queryByText(/只保存在当前标签/)).not.toBeInTheDocument();
  });

  it('共享存储暂不可读时保留有旧修订的本标签草稿，不伪报另一窗口冲突', async () => {
    const initial = createConnectFourState(0);
    await saveShared({ gameId: 'connect-four', state: initial, history: [], difficulty: 'easy', starter: 'human' });
    const baseToken = (await readSharedSoloSnapshot('connect-four')).token;
    const human = applyConnectFourAction(initial, 0, { type: 'drop', col: 1 });
    if (!human.ok) throw new Error('bad fixture');
    expect(writeSoloDraft({ progress: { gameId: 'connect-four', state: human.state, history: [initial], difficulty: 'easy', starter: 'human' }, baseToken })).toBe(true);
    const workingIndexedDB = indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    expect(await screen.findByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    expect(screen.queryByText('另一窗口更新了这款练习')).not.toBeInTheDocument();
    expect(screen.getByText(/只保存在当前标签/)).toBeInTheDocument();
    expect((readSoloDraft('connect-four')?.progress.state as ConnectFourState | undefined)?.moveCount).toBe(1);
    vi.stubGlobal('indexedDB', workingIndexedDB);
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(async () => expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: { moveCount: 1 } } }));
    expect(screen.queryByText(/只保存在当前标签/)).not.toBeInTheDocument();
  });

  it.each(['connect-four', 'reversi', 'gomoku', 'dots-and-boxes'] as const)('%s 保存重试成功回到回合状态，失败仍在按钮且不多落子', async (gameId) => {
    const workingIndexedDB = indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    await start(gameId);
    const before = readSoloDraft(gameId)?.progress.state;
    expect(before).toBeDefined();
    const retry = screen.getByRole('button', { name: '重试保存' });
    retry.focus();
    fireEvent.click(retry);
    expect(retry).toHaveFocus();
    vi.stubGlobal('indexedDB', workingIndexedDB);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试保存' })).not.toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('.solo-toolbar strong')).toHaveFocus());
    expect(await shared(gameId)).toMatchObject({ kind: 'valid', progress: { state: before } });
  });

  it.each(['other-focus', 'blank-pointer'] as const)('共享保存仍在等待时 %s 不夺回用户焦点', async (choice) => {
    const workingIndexedDB = indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    await start();
    const before = readSoloDraft('connect-four')!.progress.state;
    vi.stubGlobal('indexedDB', workingIndexedDB);
    const realWrite = sharedStore.writeSharedSoloProgress;
    let release!: () => void;
    const write = vi.spyOn(sharedStore, 'writeSharedSoloProgress').mockImplementationOnce((...args) => new Promise((resolve) => {
      release = () => { void realWrite(...args).then(resolve); };
    }));
    const retry = screen.getByRole('button', { name: '重试保存' });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    const headerExit = document.querySelector<HTMLButtonElement>('.solo-header .solo-back')!;
    if (choice === 'other-focus') headerExit.focus();
    else fireEvent.pointerDown(document.body);
    await act(async () => { release(); });
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试保存' })).not.toBeInTheDocument());
    if (choice === 'other-focus') expect(headerExit).toHaveFocus();
    else expect(document.querySelector('.solo-toolbar strong')).not.toHaveFocus();
    expect(await shared('connect-four')).toMatchObject({ kind: 'valid', progress: { state: before } });
  });

  it('共享存储不可读时仍可读取旧版浏览器记录，并提示本标签保存范围', async () => {
    const progress: SoloProgress = { gameId: 'reversi', state: createReversiState(0), history: [], difficulty: 'easy', starter: 'human' };
    expect(saveSoloProgress(progress)).toBe(true);
    vi.stubGlobal('indexedDB', undefined);
    render(<SoloPracticePage gameId="reversi" recoveredRoom={false} onExit={vi.fn()} />);
    expect(await screen.findByRole('grid', { name: '8乘8黑白棋棋盘' })).toBeInTheDocument();
    expect(screen.getByText('已恢复上次练习')).toBeInTheDocument();
    expect(screen.getByText(/只保存在当前标签/)).toBeInTheDocument();
  });

  it('StrictMode重放挂载时草稿仍恢复且只有当前Worker能应手', async () => {
    const initial = createConnectFourState(0);
    const human = applyConnectFourAction(initial, 0, { type: 'drop', col: 1 });
    if (!human.ok) throw new Error('bad fixture');
    expect(saveSoloProgress({ gameId: 'connect-four', state: initial, history: [], difficulty: 'easy', starter: 'human' })).toBe(true);
    const baseToken = (await readSharedSoloSnapshot('connect-four')).token;
    expect(writeSoloDraft({ progress: { gameId: 'connect-four', state: human.state, history: [initial], difficulty: 'easy', starter: 'human' }, baseToken })).toBe(true);
    render(<StrictMode><SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} /></StrictMode>);
    expect(await screen.findByRole('grid', { name: /已投放 1 枚棋子/ })).toBeInTheDocument();
    await waitFor(async () => expect(FakeWorker.instances.filter((item) => !item.terminated)).toHaveLength(1));
    expect(FakeWorker.instances).toHaveLength(1);
    const current = FakeWorker.instances.find((item) => !item.terminated)!;
    act(() => current.reply({ action: { type: 'drop', col: 2 } }));
    expect(screen.getByRole('grid', { name: /已投放 2 枚棋子/ })).toBeInTheDocument();
  });

  it('落子已提交但 ACK 尚未返回就刷新，凭写前 UUID 接续而不把自己当另一窗口', async () => {
    const first = await start();
    await waitFor(async () => expect((await readSharedSoloSnapshot('connect-four')).read.kind).toBe('valid'));
    const base = await readSharedSoloSnapshot('connect-four');
    const actualWrite = sharedStore.writeSharedSoloProgress;
    const writes: Array<ReturnType<typeof writeSharedSoloProgress>> = [];
    vi.spyOn(sharedStore, 'writeSharedSoloProgress').mockImplementation((...args) => {
      const write = actualWrite(...args);
      writes.push(write);
      return write;
    });
    const held = holdFirstWriteCompletion();
    const timers = captureStorageTimers();
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    await vi.waitFor(() => expect(held()).toBe(true));
    let committed = await readSharedSoloSnapshot('connect-four');
    await vi.waitFor(async () => { committed = await readSharedSoloSnapshot('connect-four'); expect(committed.token).not.toBe(base.token); });
    expect(readSoloDraft('connect-four')?.pendingToken).toBe(committed.token);
    first.unmount();
    render(<SoloPracticePage gameId="connect-four" recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('grid', { name: /已投放 1 枚棋子/ });
    expect(screen.queryByText('另一窗口更新了这款练习')).not.toBeInTheDocument();
    expect(writes).toHaveLength(1);
    await act(async () => { timers[1]!(); expect(await writes[0]).toMatchObject({ kind: 'saved', token: committed.token }); });
    expect(readSoloDraft('connect-four')).toBeNull();
  });
});
