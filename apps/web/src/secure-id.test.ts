import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoomSchema, gameActionSchema } from '@gamehall/protocol';
import { secureUuid } from './secure-id';

describe('secure UUID on plain HTTP origins', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses getRandomValues to produce protocol-valid v4 command and action IDs', () => {
    let next = 0;
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => {
      bytes.forEach((_, index) => { bytes[index] = (next + index) & 0xff; });
      next++;
      return bytes;
    } });
    const commandId = secureUuid();
    const actionId = secureUuid();
    expect(commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(commandId).not.toBe(actionId);
    expect(createRoomSchema.safeParse({ commandId, nickname: '棋手', gameId: 'connect-four' }).success).toBe(true);
    expect(gameActionSchema.safeParse({ actionId, roomId: '123e4567-e89b-42d3-a456-426614174000', expectedVersion: 1, action: { type: 'drop', col: 0 } }).success).toBe(true);
  });

  it('fails closed when no secure random source exists', () => {
    vi.stubGlobal('crypto', {});
    expect(() => secureUuid()).toThrow(/安全操作编号/);
  });
});
