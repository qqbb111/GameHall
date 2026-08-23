import { describe, expect, it } from 'vitest';
import {
  gomokuDefinition,
  quoridorDefinition,
  twentyFourDefinition,
  type FourCards,
} from '../src';

const cards: FourCards = [
  { id: 0, suit: 'S', rank: 1 },
  { id: 14, suit: 'H', rank: 2 },
  { id: 28, suit: 'D', rank: 3 },
  { id: 42, suit: 'C', rank: 4 },
];

describe('统一 GameDefinition 合约', () => {
  it('三款游戏都可初始化、严格校验动作并无损序列化', () => {
    const gomoku = gomokuDefinition.initialize(0);
    expect(gomokuDefinition.deserialize(gomokuDefinition.serialize(gomoku))).toEqual(gomoku);
    expect(gomokuDefinition.validateAction({ type: 'place', row: 1, col: 2 })).toMatchObject({ ok: true });
    expect(gomokuDefinition.validateAction({ type: 'place', row: 1, col: 2, injected: true })).toEqual({ ok: false, message: '五子棋操作格式不合法' });

    const quoridor = quoridorDefinition.initialize(1);
    expect(quoridorDefinition.deserialize(quoridorDefinition.serialize(quoridor))).toEqual(quoridor);
    expect(quoridorDefinition.validateAction({ type: 'placeWall', row: 0, col: 0, orientation: 'H' })).toMatchObject({ ok: true });
    expect(quoridorDefinition.validateAction({ type: 'move', row: 8, col: 4, extra: 1 })).toEqual({ ok: false, message: '路墙棋操作格式不合法' });

    const twentyFour = twentyFourDefinition.initialize({ cards, canonicalSolution: '1*2*3*4', nowMs: 1_000 });
    expect(twentyFourDefinition.stateSchemaVersion).toBe(2);
    expect(twentyFourDefinition.deserialize(twentyFourDefinition.serialize(twentyFour))).toEqual(twentyFour);
    const legacyTwentyFour = JSON.parse(JSON.stringify(twentyFour)) as Record<string, unknown>;
    delete legacyTwentyFour.finishReason;
    expect(twentyFourDefinition.deserialize(JSON.stringify(legacyTwentyFour)).finishReason).toBeNull();
    expect(twentyFourDefinition.validateAction({ type: 'submit', expression: '1*2*3*4' })).toMatchObject({ ok: true });
    expect(twentyFourDefinition.validateAction({ type: 'submit', expression: '1*2*3*4', answer: 24 })).toEqual({ ok: false, message: '24 点操作格式不合法' });
  });

  it('统一推进与结果接口由具体规则引擎负责', () => {
    const state = gomokuDefinition.initialize(0);
    const validation = gomokuDefinition.validateAction({ type: 'place', row: 7, col: 7 });
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const advanced = gomokuDefinition.advance(state, 0, validation.action, 1_000);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.state.board[7 * 15 + 7]).toBe(0);
    expect(gomokuDefinition.result(advanced.state)).toBeNull();
    expect(gomokuDefinition.viewFor(advanced.state, 1, 1_000)).toEqual(advanced.state);
  });
});
