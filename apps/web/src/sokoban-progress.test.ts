import { afterEach, describe, expect, it, vi } from 'vitest';
import { sokobanLevels } from '@gamehall/game-core';
import { betterSokobanHistory, mergeSokobanBests, readSokobanAttempt, readSokobanBests, SOKOBAN_ATTEMPT_KEY, sokobanBestKey, writeSokobanAttempt, writeSokobanBests } from './sokoban-progress';

const first = sokobanLevels[0]!;
const bestKey = sokobanBestKey(first, 'RR');
const saved = (history: string) => JSON.stringify({ version: 1, levelId: first.id, history });

describe('推箱子独立进度存储', () => {
  afterEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

  it('当前尝试只从本标签读写已知关卡和可重放移动，损坏轨迹不进入游戏', () => {
    window.sessionStorage.setItem('gamehall:solo:connect-four:v1', 'untouched');
    expect(writeSokobanAttempt({ levelId: first.id, history: 'R' })).toBeNull();
    expect(readSokobanAttempt().attempt).toEqual({ levelId: first.id, history: 'R' });
    expect(window.sessionStorage.getItem('gamehall:solo:connect-four:v1')).toBe('untouched');
    for (const raw of [saved('X'), saved('RRR'), JSON.stringify({ version: 1, levelId: 'unknown', history: 'R' }), saved('R'.repeat(2001)), '{bad']) {
      window.sessionStorage.setItem(SOKOBAN_ATTEMPT_KEY, raw);
      const result = readSokobanAttempt();
      expect(result.attempt).toEqual({ levelId: first.id, history: '' });
      expect(result.warning).toBeTruthy();
    }
  });

  it('最佳成绩必须有完整合法通关历史；旧标签、虚假零步、未知关卡不能覆盖', () => {
    window.localStorage.setItem(bestKey, saved(''));
    expect(readSokobanBests().bests).toEqual({});
    expect(readSokobanBests().warning).toBeTruthy();
    expect(writeSokobanBests({ [first.id]: 'UDRR' }).bests[first.id]).toBe('UDRR');
    expect(readSokobanBests().bests[first.id]).toBe('UDRR');
    expect(writeSokobanBests({ [first.id]: 'RR' }).bests[first.id]).toBe('RR');
    expect(writeSokobanBests({ [first.id]: 'UDRR' }).bests[first.id]).toBe('RR');
    expect(readSokobanBests().bests[first.id]).toBe('RR');
    expect(window.localStorage.getItem(sokobanBestKey(first, 'UDRR'))).toBeNull();
    expect(mergeSokobanBests({ [first.id]: '', fake: 'RR' }, { [first.id]: 'RR' })).toEqual({ [first.id]: 'RR' });
    expect(betterSokobanHistory(first, 'UDRR', 'RR')).toBe('RR');
  });

  it('两个标签交错保存不同成绩时使用不同候选键，较差的后写也不能覆盖更好成绩', () => {
    const betterKey = sokobanBestKey(first, 'RR');
    const worseKey = sokobanBestKey(first, 'UDRR');
    const actualSet = Storage.prototype.setItem;
    let interleaved = false;
    const hook = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === worseKey && !interleaved) {
        interleaved = true;
        actualSet.call(this, betterKey, saved('RR'));
      }
      actualSet.call(this, key, value);
    });
    const merged = writeSokobanBests({ [first.id]: 'UDRR' });
    hook.mockRestore();
    expect(interleaved).toBe(true);
    expect(merged.bests[first.id]).toBe('RR');
    expect(window.localStorage.getItem(betterKey)).toBe(saved('RR'));
    expect(window.localStorage.getItem(worseKey)).toBeNull();
    window.localStorage.setItem(worseKey, saved('UDRR'));
    expect(readSokobanBests().bests[first.id]).toBe('RR');
  });

  it('两个合法同分路径以固定顺序交换、重复合并，storage 同步后不再写入', () => {
    const upper = 'UDRR';
    const lower = 'DURR';
    expect(sokobanBestKey(first, upper)).toBe(sokobanBestKey(first, lower));
    expect(betterSokobanHistory(first, upper, lower)).toBe(lower);
    expect(betterSokobanHistory(first, lower, upper)).toBe(lower);
    expect(mergeSokobanBests({ [first.id]: upper }, { [first.id]: lower })).toEqual({ [first.id]: lower });
    expect(mergeSokobanBests({ [first.id]: lower }, { [first.id]: upper })).toEqual({ [first.id]: lower });
    expect(mergeSokobanBests({ [first.id]: lower }, { [first.id]: lower })).toEqual({ [first.id]: lower });

    const writes = vi.spyOn(Storage.prototype, 'setItem');
    expect(writeSokobanBests({ [first.id]: upper }).bests[first.id]).toBe(upper);
    expect(writeSokobanBests({ [first.id]: lower }).bests[first.id]).toBe(lower);
    expect(window.localStorage.getItem(sokobanBestKey(first, lower))).toBe(saved(lower));
    writes.mockClear();
    for (let turn = 0; turn < 4; turn++) {
      expect(writeSokobanBests({ [first.id]: upper }).bests[first.id]).toBe(lower);
      expect(writeSokobanBests({ [first.id]: lower }).bests[first.id]).toBe(lower);
    }
    expect(writes).not.toHaveBeenCalled();
  });

  it('存储写入或读取失败时保留已知通关轨迹，恢复后可重试保存且不降级', () => {
    const blockWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(writeSokobanAttempt({ levelId: first.id, history: 'R' })).toMatch(/无法保存/);
    const unavailable = writeSokobanBests({ [first.id]: 'RR' });
    expect(unavailable.bests[first.id]).toBe('RR');
    expect(unavailable.warning).toMatch(/无法保存/);
    blockWrite.mockRestore();
    const blockRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const unreadable = writeSokobanBests(unavailable.bests);
    expect(unreadable.bests[first.id]).toBe('RR');
    expect(unreadable.warning).toMatch(/无法读取/);
    blockRead.mockRestore();
    expect(writeSokobanBests(unreadable.bests).warning).toBeNull();
    expect(readSokobanBests().bests[first.id]).toBe('RR');
  });
});
