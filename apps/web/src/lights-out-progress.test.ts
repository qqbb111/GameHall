import { afterEach, describe, expect, it, vi } from 'vitest';
import { lightsOutLevels, solveLightsOut } from '@gamehall/game-core';
import { betterLightsOutHistory, LIGHTS_OUT_ATTEMPT_KEY, lightsOutBestKey, mergeLightsOutBests, readLightsOutAttempt, readLightsOutBests, readLightsOutHomeAttempt, readLightsOutHomeCompletedCount, writeLightsOutAttempt, writeLightsOutBests } from './lights-out-progress';

const first = lightsOutLevels[0]!;
const win = solveLightsOut(first, first.initial)!;
const equal = [...win].reverse();
const worse = [0, 0, ...win];
const saved = (history: number[]) => JSON.stringify({ version: 1, levelId: first.id, history });

describe('连灯解谜独立进度存储', () => {
  afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); window.localStorage.clear(); });

  it('尝试只存本标签的已知关卡与可重放有界点击，坏记录不冒充可续进度', () => {
    expect(readLightsOutHomeAttempt()).toEqual({ kind: 'fresh' });
    window.sessionStorage.setItem('gamehall:sokoban:attempt:v1', 'untouched');
    expect(writeLightsOutAttempt({ levelId: first.id, history: [win[0]!] })).toBeNull();
    expect(readLightsOutAttempt().attempt.history).toEqual([win[0]!]);
    expect(readLightsOutHomeAttempt()).toEqual({ kind: 'saved', levelNumber: 1, moves: 1, solved: false });
    expect(window.sessionStorage.getItem('gamehall:sokoban:attempt:v1')).toBe('untouched');
    for (const raw of [saved([-1]), saved([9]), saved([0.5]), saved([...win, 0]), saved(Array(257).fill(0)),
      JSON.stringify({ version: 1, levelId: 'unknown', history: win }), '{bad']) {
      window.sessionStorage.setItem(LIGHTS_OUT_ATTEMPT_KEY, raw);
      expect(readLightsOutAttempt().warning).toBeTruthy();
      expect(readLightsOutHomeAttempt()).toEqual({ kind: 'unavailable' });
    }
  });

  it('最佳成绩只能来自完整合法通关轨迹，不采信零步或虚假键', () => {
    const winKey = lightsOutBestKey(first, win);
    window.localStorage.setItem(winKey, saved([]));
    expect(readLightsOutBests().bests).toEqual({});
    expect(readLightsOutBests().warning).toBeTruthy();
    expect(readLightsOutHomeCompletedCount()).toBe(0);
    expect(writeLightsOutBests({ [first.id]: worse }).bests[first.id]).toEqual(worse);
    expect(writeLightsOutBests({ [first.id]: win }).bests[first.id]).toEqual(win);
    expect(writeLightsOutBests({ [first.id]: worse }).bests[first.id]).toEqual(win);
    expect(readLightsOutHomeCompletedCount()).toBe(1);
    expect(window.localStorage.getItem(lightsOutBestKey(first, worse))).toBeNull();
    expect(mergeLightsOutBests({ [first.id]: [], fake: win }, { [first.id]: win })).toEqual({ [first.id]: win });
  });

  it('交错标签的不同分数与同分路径按独立键、固定次序收敛且无重复写入', () => {
    expect(equal).not.toEqual(win);
    expect(betterLightsOutHistory(win, equal)).toEqual(betterLightsOutHistory(equal, win));
    expect(mergeLightsOutBests({ [first.id]: win }, { [first.id]: equal }))
      .toEqual(mergeLightsOutBests({ [first.id]: equal }, { [first.id]: win }));
    const betterKey = lightsOutBestKey(first, win);
    const worseKey = lightsOutBestKey(first, worse);
    const actualSet = Storage.prototype.setItem;
    let interleaved = false;
    const hook = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === worseKey && !interleaved) {
        interleaved = true;
        actualSet.call(this, betterKey, saved(win));
      }
      actualSet.call(this, key, value);
    });
    expect(writeLightsOutBests({ [first.id]: worse }).bests[first.id]).toEqual(win);
    hook.mockRestore();
    expect(interleaved).toBe(true);
    expect(window.localStorage.getItem(worseKey)).toBeNull();
    const canonical = betterLightsOutHistory(win, equal);
    expect(writeLightsOutBests({ [first.id]: equal }).bests[first.id]).toEqual(canonical);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    for (let turn = 0; turn < 4; turn++) {
      expect(writeLightsOutBests({ [first.id]: win }).bests[first.id]).toEqual(canonical);
      expect(writeLightsOutBests({ [first.id]: equal }).bests[first.id]).toEqual(canonical);
    }
    expect(writes).not.toHaveBeenCalled();
  });

  it('存储读写失败保留内存成果，恢复后可重试且不动其它游戏', () => {
    window.localStorage.setItem('gamehall:sokoban:best:v1:first-push:2-2', 'untouched');
    const blockWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(writeLightsOutAttempt({ levelId: first.id, history: [win[0]!] })).toMatch(/无法保存/);
    const failed = writeLightsOutBests({ [first.id]: win });
    expect(failed.warning).toMatch(/无法保存/);
    expect(failed.bests[first.id]).toEqual(win);
    blockWrite.mockRestore();
    const blockRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readLightsOutHomeAttempt()).toEqual({ kind: 'unavailable' });
    const unreadable = writeLightsOutBests(failed.bests);
    expect(unreadable.readable).toBe(false);
    expect(unreadable.warning).toMatch(/无法读取/);
    expect(unreadable.bests[first.id]).toEqual(win);
    expect(readLightsOutHomeCompletedCount()).toBeNull();
    blockRead.mockRestore();
    expect(writeLightsOutBests(unreadable.bests).warning).toBeNull();
    expect(readLightsOutBests().bests[first.id]).toEqual(win);
    expect(window.localStorage.getItem('gamehall:sokoban:best:v1:first-push:2-2')).toBe('untouched');
  });

  it('并发更优候选在第二次读取时出现，旧候选清理失败仍返回刚验证过的更优成果', () => {
    const longKey = lightsOutBestKey(first, worse);
    const shortKey = lightsOutBestKey(first, win);
    window.localStorage.setItem(longKey, saved(worse));
    const actualGet = Storage.prototype.getItem;
    const actualSet = Storage.prototype.setItem;
    let inserted = false;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      const value = actualGet.call(this, key);
      if (key === longKey && !inserted) {
        inserted = true;
        actualSet.call(this, shortKey, saved(win));
      }
      return value;
    });
    const actualRemove = Storage.prototype.removeItem;
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key === longKey) throw new Error('cleanup blocked');
      actualRemove.call(this, key);
    });
    const result = writeLightsOutBests({ [first.id]: worse });
    expect(inserted).toBe(true);
    expect(remove).toHaveBeenCalledWith(longKey);
    expect(result.bests[first.id]).toEqual(win);
    expect(result.readable).toBe(true);
    expect(result.warning).toMatch(/无法清理/);
    expect(window.localStorage.getItem(shortKey)).toBe(saved(win));
  });
});
