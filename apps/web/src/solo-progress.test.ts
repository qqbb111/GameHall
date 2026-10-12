import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyConnectFourAction, applyReversiAction, createConnectFourState, createReversiState } from '@gamehall/game-core';
import { decodeSoloProgress, encodeSoloProgress, readSoloProgress, saveSoloProgress, SOLO_HISTORY_MAX, SOLO_PROGRESS_MAX_BYTES, soloProgressKey, type SoloProgress } from './solo-progress';

function fourProgress(): SoloProgress {
  const before = createConnectFourState(0);
  const human = applyConnectFourAction(before, 0, { type: 'drop', col: 3 });
  if (!human.ok) throw new Error('bad fixture');
  const computer = applyConnectFourAction(human.state, 1, { type: 'drop', col: 2 });
  if (!computer.ok) throw new Error('bad fixture');
  return { gameId: 'connect-four', state: computer.state, history: [before], difficulty: 'thoughtful', starter: 'human' };
}

function reversiProgress(): SoloProgress {
  const before = createReversiState(0);
  const human = applyReversiAction(before, 0, { type: 'placeDisc', row: 2, col: 3 });
  if (!human.ok) throw new Error('bad fixture');
  return { gameId: 'reversi', state: human.state, history: [before], difficulty: 'easy', starter: 'human' };
}

describe('local solo progress', () => {
  afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it('两款棋独立 roundtrip，悔棋前状态与电脑回合原样恢复', () => {
    const four = fourProgress(), reversi = reversiProgress();
    expect(saveSoloProgress(four)).toBe(true);
    expect(saveSoloProgress(reversi)).toBe(true);
    expect(readSoloProgress('connect-four')).toEqual({ kind: 'valid', progress: four });
    expect(readSoloProgress('reversi')).toEqual({ kind: 'valid', progress: reversi });
    expect(four.history[0]?.moveCount).toBe(0);
    expect(reversi.state.turn).toBe(1);
    expect(soloProgressKey('connect-four')).not.toBe(soloProgressKey('reversi'));
  });

  it('已结束棋局也能恢复为可查看棋盘', () => {
    const first = createConnectFourState(0);
    let state = first;
    for (const col of [0, 6, 1, 6, 2, 5, 3]) {
      const result = applyConnectFourAction(state, state.turn, { type: 'drop', col });
      if (!result.ok) throw new Error('bad fixture');
      state = result.state;
    }
    expect(state.phase).toBe('finished');
    const progress: SoloProgress = { gameId: 'connect-four', state, history: [], difficulty: 'easy', starter: 'human' };
    expect(decodeSoloProgress('connect-four', encodeSoloProgress(progress))).toEqual(progress);
  });

  it('未知版本、错游戏、错先手、损坏核心状态、乱序/过长历史和超大记录安全拒绝', () => {
    const base = JSON.parse(encodeSoloProgress(fourProgress())) as Record<string, unknown>;
    const invalid = [
      { ...base, version: 2 },
      { ...base, gameId: 'reversi' },
      { ...base, starter: 'computer' },
      { ...base, state: JSON.stringify({ kind: 'connect-four', board: [] }) },
      { ...base, history: [base.state, base.state] },
      { ...base, history: Array(SOLO_HISTORY_MAX + 1).fill(base.history) },
    ];
    for (const value of invalid) expect(() => decodeSoloProgress('connect-four', JSON.stringify(value))).toThrow();
    expect(() => decodeSoloProgress('connect-four', 'x'.repeat(SOLO_PROGRESS_MAX_BYTES + 1))).toThrow();
    window.localStorage.setItem(soloProgressKey('connect-four'), JSON.stringify({ ...base, version: 2 }));
    expect(readSoloProgress('connect-four')).toEqual({ kind: 'invalid' });
    window.localStorage.removeItem(soloProgressKey('connect-four'));
    expect(readSoloProgress('connect-four')).toEqual({ kind: 'empty' });
  });

  it('拒绝联机核心可解码但单人不可达的四连棋盘或错误棋色数量', () => {
    const first = createConnectFourState(0);
    let state = first;
    for (const col of [0, 6, 1, 6, 2, 5, 3]) {
      const result = applyConnectFourAction(state, state.turn, { type: 'drop', col });
      if (!result.ok) throw new Error('bad fixture');
      state = result.state;
    }
    const won = JSON.parse(encodeSoloProgress({ gameId: 'connect-four', state, history: [], difficulty: 'easy', starter: 'human' })) as Record<string, unknown>;
    const falsePlaying = { ...state, phase: 'playing', result: null, turn: 1, winningLine: [] };
    expect(() => decodeSoloProgress('connect-four', JSON.stringify({ ...won, state: JSON.stringify(falsePlaying) }))).toThrow();
    const wrongColors = fourProgress();
    if (wrongColors.state.kind !== 'connect-four') throw new Error('bad fixture');
    const board = [...wrongColors.state.board]; board[37] = 0;
    expect(() => decodeSoloProgress('connect-four', JSON.stringify({ ...won, state: JSON.stringify({ ...wrongColors.state, board }) }))).toThrow();
  });

  it('黑白棋自动跳过与自然终局可恢复；无合法步、计数不符和错误比分拒绝', () => {
    const board = Array<0 | 1 | null>(64).fill(0);
    board[0] = null; board[1] = 1; board[63] = null; board[62] = 1;
    const near = { ...createReversiState(0), board, counts: [60, 2] as [number, number], moveCount: 58 };
    const first = applyReversiAction(near, 0, { type: 'placeDisc', row: 0, col: 0 });
    if (!first.ok) throw new Error('bad fixture');
    const progress: SoloProgress = { gameId: 'reversi', state: first.state, history: [], difficulty: 'easy', starter: 'human' };
    expect(decodeSoloProgress('reversi', encodeSoloProgress(progress)).state).toEqual(first.state);
    const final = applyReversiAction(first.state, 0, { type: 'placeDisc', row: 7, col: 7 });
    if (!final.ok) throw new Error('bad fixture');
    expect(decodeSoloProgress('reversi', encodeSoloProgress({ ...progress, state: final.state })).state).toEqual(final.state);
    const raw = JSON.parse(encodeSoloProgress(progress)) as Record<string, unknown>;
    for (const bad of [
      { ...first.state, moveCount: 58 },
      { ...first.state, turn: 1, lastPass: null },
      { ...final.state, result: { type: 'win', winner: 1, reason: 'score' } },
    ]) expect(() => decodeSoloProgress('reversi', JSON.stringify({ ...raw, state: JSON.stringify(bad) }))).toThrow();
  });

  it('浏览器存储访问和写入抛错时只报告不可用，不影响纯棋局', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readSoloProgress('connect-four')).toEqual({ kind: 'unavailable' });
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(saveSoloProgress(fourProgress())).toBe(false);
    expect(fourProgress().state.moveCount).toBe(2);
  });
});
