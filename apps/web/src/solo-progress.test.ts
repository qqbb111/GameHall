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

  it('浏览器存储访问和写入抛错时只报告不可用，不影响纯棋局', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readSoloProgress('connect-four')).toEqual({ kind: 'unavailable' });
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(saveSoloProgress(fourProgress())).toBe(false);
    expect(fourProgress().state.moveCount).toBe(2);
  });
});
