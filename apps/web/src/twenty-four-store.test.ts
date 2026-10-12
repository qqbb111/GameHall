import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixturePack } from './twenty-four-fixture';
import { newTwentyFourProgress } from './twenty-four-practice';
import { clearTwentyFourDraft, readTwentyFourDraft, readTwentyFourSnapshot, writeTwentyFourDraft, writeTwentyFourProgress } from './twenty-four-store';

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
});
