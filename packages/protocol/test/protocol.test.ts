import { describe, expect, it } from 'vitest';
import { createRoomSchema, gameActionSchema } from '../src';

describe('shared realtime protocol', () => {
  it('允许复杂可见字素通过传输层并交给服务端做字素校验', () => {
    expect(createRoomSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000001',
      nickname: '👨‍👩‍👧‍👦棋手',
      gameId: 'gomoku',
    }).success).toBe(true);
  });

  it('游戏动作只接受有界的浅层联合类型', () => {
    const base = {
      actionId: '00000000-0000-4000-8000-000000000002',
      roomId: '00000000-0000-4000-8000-000000000003',
      expectedVersion: 1,
    };
    expect(gameActionSchema.safeParse({ ...base, action: { type: 'place', row: 7, col: 7 } }).success).toBe(true);
    expect(gameActionSchema.safeParse({ ...base, action: { type: 'submit', expression: '1'.repeat(129) } }).success).toBe(false);
    expect(gameActionSchema.safeParse({ ...base, action: { type: 'place', row: 7, col: 7, nested: [[[[]]]] } }).success).toBe(false);
  });
});
