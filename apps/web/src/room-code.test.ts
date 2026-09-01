import { afterEach, describe, expect, it } from 'vitest';
import { normalizeRoomCode, parseRoomCodeInput, removeRoomQueryFromAddress } from './room-code';

describe('room code input', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('保留普通输入的过滤和大写规则', () => {
    expect(normalizeRoomCode('ab201-z9')).toBe('AB2Z9');
    expect(parseRoomCodeInput('35c3ty')).toBe('35C3TY');
  });

  it('从本地、临时隧道和查询串中提取邀请码', () => {
    expect(parseRoomCodeInput('http://127.0.0.1:5173/?room=35C3TY')).toBe('35C3TY');
    expect(parseRoomCodeInput('https://posting-son.trycloudflare.com/play?from=chat&room=35c3ty')).toBe('35C3TY');
    expect(parseRoomCodeInput('?room=35C3TY&source=copy')).toBe('35C3TY');
  });

  it('URL 不含 room 参数时不会从 HTTP 域名生成伪邀请码', () => {
    expect(parseRoomCodeInput('https://example.com/welcome')).toBe('');
    expect(parseRoomCodeInput('https://example.com/?room=%E0%A4%A')).toBe('');
  });

  it('只移除地址栏中的 room 参数', () => {
    window.history.replaceState(null, '', '/?room=35C3TY&source=copy#join');
    removeRoomQueryFromAddress();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/?source=copy#join');
  });
});
