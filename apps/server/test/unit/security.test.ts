import { describe, expect, it } from 'vitest';
import { normalizeNickname, requestHash, SlidingWindowLimiter } from '../../src/security';

describe('guest security helpers', () => {
  it('按可见字素限制昵称并拒绝控制字符', () => {
    expect(normalizeNickname('  木纹   棋手  ')).toEqual({ display: '木纹 棋手', key: '木纹 棋手' });
    expect(normalizeNickname('😀'.repeat(16))?.display).toBe('😀'.repeat(16));
    expect(normalizeNickname('👨‍👩‍👧‍👦'.repeat(16))?.display).toBe('👨‍👩‍👧‍👦'.repeat(16));
    expect(normalizeNickname('😀'.repeat(17))).toBeNull();
    expect(normalizeNickname('坏\u0000名字')).toBeNull();
  });

  it('稳定哈希不受对象键顺序影响', () => {
    expect(requestHash({ b: 2, a: [1, 3] })).toBe(requestHash({ a: [1, 3], b: 2 }));
  });

  it('滑动窗口在限额后拒绝并在窗口外恢复', () => {
    const limiter = new SlidingWindowLimiter();
    expect(limiter.allow('session', 2, 1000, 100)).toBe(true);
    expect(limiter.allow('session', 2, 1000, 200)).toBe(true);
    expect(limiter.allow('session', 2, 1000, 300)).toBe(false);
    expect(limiter.allow('session', 2, 1000, 1_201)).toBe(true);
  });

  it('清理任务不会提前清空一小时限流桶', () => {
    const limiter = new SlidingWindowLimiter();
    expect(limiter.allow('hourly', 1, 60 * 60_000, 1)).toBe(true);
    limiter.sweep(11 * 60_000);
    expect(limiter.allow('hourly', 1, 60 * 60_000, 11 * 60_000)).toBe(false);
  });
});
