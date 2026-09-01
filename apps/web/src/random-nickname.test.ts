import { describe, expect, it } from 'vitest';
import { generateRandomNickname } from './random-nickname';

describe('generateRandomNickname', () => {
  it('使用可注入随机数生成稳定的雅致昵称', () => {
    expect(generateRandomNickname('', () => 0)).toBe('竹影棋客');
    expect(generateRandomNickname('', () => 0.999999)).toBe('清风慢手');
  });

  it('不会连续返回当前昵称', () => {
    expect(generateRandomNickname('竹影棋客', () => 0)).toBe('竹影闲家');
  });

  it('无效随机值会安全回退', () => {
    expect(generateRandomNickname('', () => Number.NaN)).toBe('竹影棋客');
  });
});
