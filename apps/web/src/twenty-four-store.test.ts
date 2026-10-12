import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixturePack } from './twenty-four-fixture';
import { newTwentyFourProgress } from './twenty-four-practice';
import { clearTwentyFourDraft, readTwentyFourDraft, readTwentyFourSnapshot, writeTwentyFourDraft, writeTwentyFourProgress } from './twenty-four-store';
import { captureStorageTimers, holdFirstWriteCompletion } from './idb-late-ack.test-helper';

describe('24 点独立存档', () => {
  afterEach(() => { clearTwentyFourDraft(); vi.restoreAllMocks(); });
  it('在 IDB 事务内做 CAS；无 Web Locks 时另一窗口的旧令牌无法覆盖', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const progress = newTwentyFourProgress('practice', fixturePack());
    const first = await writeTwentyFourProgress(progress, null, () => true);
    expect(first.kind).toBe('saved');
    if (first.kind !== 'saved') return;
    const stale = await writeTwentyFourProgress({ ...progress, draft: '1+2' }, null, () => true);
    expect(stale.kind).toBe('conflict');
    const later = await writeTwentyFourProgress({ ...progress, draft: '1+2' }, first.token, () => true);
    expect(later.kind).toBe('saved');
    expect((await readTwentyFourSnapshot()).kind).toBe('valid');
    const superseded = await writeTwentyFourProgress(progress, later.kind === 'saved' ? later.token : null, () => false);
    expect(superseded).toEqual({ kind: 'superseded' });
  });
  it('session 草稿有长度和格式校验，存储异常时如实失败，旧棋类 key 不被读取', async () => {
    window.localStorage.setItem('gamehall:solo:connect-four:v1', '{}');
    expect((await readTwentyFourSnapshot()).kind).toBe('empty');
    const progress = newTwentyFourProgress('challenge', fixturePack());
    expect(writeTwentyFourDraft({ progress, baseToken: null })).toBe(true);
    expect(readTwentyFourDraft()?.progress).toEqual(progress);
    window.sessionStorage.setItem('gamehall:twenty-four:draft:v1', 'x'.repeat(20_000));
    expect(readTwentyFourDraft()).toBeNull();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage) { if (this === window.sessionStorage) throw new Error('quota'); });
    expect(writeTwentyFourDraft({ progress, baseToken: null })).toBe(false);
    setItem.mockRestore();
  });
  it('事务已提交但完成回调超过时限时，以本次 UUID 读回确认保存', async () => {
    const held = holdFirstWriteCompletion();
    const timers = captureStorageTimers();
    const progress = newTwentyFourProgress('practice', fixturePack());
    const pending = writeTwentyFourProgress(progress, null, () => true);
    await vi.waitFor(() => expect(held()).toBe(true));
    await vi.waitFor(async () => expect((await readTwentyFourSnapshot()).kind).toBe('valid'));
    expect(timers.length).toBeGreaterThanOrEqual(2);
    timers[1]!();
    const result = await pending;
    expect(result.kind).toBe('saved');
    if (result.kind === 'saved') expect((await readTwentyFourSnapshot()).token).toBe(result.token);
  });
  it('未提交就 abort 不得报成功；真正的外窗 UUID 仍是冲突', async () => {
    const progress = newTwentyFourProgress('practice', fixturePack());
    const put = IDBObjectStore.prototype.put;
    const aborting = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key);
      this.transaction.abort();
      return request;
    });
    expect(await writeTwentyFourProgress(progress, null, () => true)).toEqual({ kind: 'unavailable' });
    expect((await readTwentyFourSnapshot()).kind).toBe('empty');
    aborting.mockRestore();
    const foreign = await writeTwentyFourProgress(progress, null, () => true);
    expect(foreign.kind).toBe('saved');
    expect((await writeTwentyFourProgress(progress, null, () => true)).kind).toBe('conflict');
  });
  it('超时读回若已是另一窗口 UUID，应报告真实冲突', async () => {
    const held = holdFirstWriteCompletion();
    const timers = captureStorageTimers();
    const progress = newTwentyFourProgress('practice', fixturePack());
    const pending = writeTwentyFourProgress(progress, null, () => true);
    await vi.waitFor(() => expect(held()).toBe(true));
    let first = await readTwentyFourSnapshot();
    await vi.waitFor(async () => { first = await readTwentyFourSnapshot(); expect(first.kind).toBe('valid'); });
    if (first.kind !== 'valid') throw new Error('first write did not commit');
    const foreign = await writeTwentyFourProgress({ ...progress, draft: '1+' }, first.token, () => true);
    expect(foreign.kind).toBe('saved');
    timers[1]!();
    const result = await pending;
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { token: foreign.kind === 'saved' ? foreign.token : null } });
  });
});
