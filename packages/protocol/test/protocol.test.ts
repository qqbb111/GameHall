import { describe, expect, it } from 'vitest';
import { createRoomSchema, gameActionSchema, roomMessageSchema, startRoomSchema, reopenRoomSchema } from '../src';

describe('shared realtime protocol', () => {
  it('璀璨宝石命令必须有版本与 UUID，支付和牌来源严格有界', () => {
    const base = { commandId: '00000000-0000-4000-8000-000000000001', roomId: '00000000-0000-4000-8000-000000000002', expectedVersion: 8 };
    for (const schema of [startRoomSchema, reopenRoomSchema]) {
      expect(schema.safeParse(base).success).toBe(true);
      expect(schema.safeParse({ ...base, expectedVersion: -1 }).success).toBe(false);
      expect(schema.safeParse({ ...base, unexpected: true }).success).toBe(false);
    }
    const payment = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 2 };
    const command = { actionId: base.commandId, roomId: base.roomId, expectedVersion: 8 };
    expect(gameActionSchema.safeParse({ ...command, action: { type: 'purchase', source: { kind: 'reserved', cardId: 'L1-01' }, payment } }).success).toBe(true);
    for (const action of [
      { type: 'purchase', source: { kind: 'deck', tier: 1 }, payment },
      { type: 'reserve', source: { kind: 'reserved', cardId: 'L1-01' } },
      { type: 'takeTokens', colors: [] }, { type: 'takeTokens', colors: ['gold'] },
      { type: 'returnTokens', tokens: { ...payment, gold: 1.5 } },
      { type: 'returnTokens', tokens: { ...payment, gold: 11 } },
    ]) expect(gameActionSchema.safeParse({ ...command, action }).success).toBe(false);
  });
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
    expect(gameActionSchema.safeParse({ ...base, action: { type: 'raise', amount: 40 } }).success).toBe(true);
    expect(gameActionSchema.safeParse({ ...base, action: { type: 'raise', amount: 4_000 } }).success).toBe(true);
    expect(gameActionSchema.safeParse({ ...base, action: { type: 'raise', amount: 4_001 } }).success).toBe(false);
    expect(gameActionSchema.safeParse({ ...base, action: { type: 'allIn' } }).success).toBe(true);
    expect(gameActionSchema.safeParse({ ...base, action: { type: 'readyNextHand' } }).success).toBe(true);
  });

  it('房间消息传输必须携带 UUID 且保持有界', () => {
    const base = {
      messageId: '00000000-0000-4000-8000-000000000004',
      roomId: '00000000-0000-4000-8000-000000000003',
    };
    expect(roomMessageSchema.safeParse({ ...base, content: '今晚再来一局' }).success).toBe(true);
    expect(roomMessageSchema.safeParse({ ...base, content: '' }).success).toBe(false);
    expect(roomMessageSchema.safeParse({ ...base, content: '棋'.repeat(2001) }).success).toBe(false);
  });
});
