import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAVORITES_STORAGE_KEY, NICKNAME_STORAGE_KEY, readFavoriteGames, readRememberedNickname, rememberFavoriteGames, rememberNickname } from './client-preferences';

describe('nickname preferences', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('保存并读取昵称', () => {
    rememberNickname('落子无悔');
    expect(window.localStorage.getItem(NICKNAME_STORAGE_KEY)).toBe('落子无悔');
    expect(readRememberedNickname()).toBe('落子无悔');
  });

  it('浏览器拒绝存储时静默降级', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked'); });
    expect(readRememberedNickname()).toBe('');
    expect(() => rememberNickname('棋手')).not.toThrow();
    expect(readFavoriteGames()).toEqual([]);
    expect(() => rememberFavoriteGames(['gomoku'])).not.toThrow();
  });

  it('收藏只读取数组并在损坏数据时安全降级', () => {
    rememberFavoriteGames(['gomoku', 'reversi']);
    expect(readFavoriteGames()).toEqual(['gomoku', 'reversi']);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, '{bad');
    expect(readFavoriteGames()).toEqual([]);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, '{"id":"gomoku"}');
    expect(readFavoriteGames()).toEqual([]);
  });
});
