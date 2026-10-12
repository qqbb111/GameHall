import { describe, expect, it } from 'vitest';
import { applyReversiAction, createReversiState, legalReversiMoves, reversiDefinition } from '../src';

describe('黑白棋', () => {
  it('初始黑方四个合法步，落子翻转并轮换', () => {
    const state = createReversiState(1);
    expect(legalReversiMoves(state.board, 1)).toEqual([{ row: 2, col: 3 }, { row: 3, col: 2 }, { row: 4, col: 5 }, { row: 5, col: 4 }]);
    expect(applyReversiAction(state, 0, { type: 'placeDisc', row: 2, col: 3 })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(applyReversiAction(state, 1, { type: 'placeDisc', row: 0, col: 0 })).toMatchObject({ ok: false, error: { code: 'NO_CAPTURE' } });
    const result = applyReversiAction(state, 1, { type: 'placeDisc', row: 2, col: 3 });
    expect(result).toMatchObject({ ok: true, state: { board: expect.any(Array), counts: [1, 4], turn: 0, lastFlipped: [{ row: 3, col: 3 }] } });
    if (result.ok) expect(reversiDefinition.deserialize(reversiDefinition.serialize(result.state))).toEqual(result.state);
  });

  it('八个方向同时夹住时全部翻转', () => {
    const state = createReversiState(0);
    const board = Array<0 | 1 | null>(64).fill(null);
    for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1]) {
      if (!dr && !dc) continue;
      board[(3 + dr) * 8 + 3 + dc] = 1;
      board[(3 + dr * 2) * 8 + 3 + dc * 2] = 0;
    }
    const outcome = applyReversiAction({ ...state, board, counts: [8, 8] }, 0, { type: 'placeDisc', row: 3, col: 3 });
    expect(outcome).toMatchObject({ ok: true, state: { counts: [17, 0], lastFlipped: expect.arrayContaining([{ row: 2, col: 3 }, { row: 4, col: 4 }]) } });
  });

  it('对手无步时自动跳过，随后满盘按数量结算', () => {
    const state = createReversiState(0);
    const board = Array<0 | 1 | null>(64).fill(0);
    board[0] = null; board[1] = 1; board[63] = null; board[62] = 1;
    const near = { ...state, board, counts: [60, 2] as [number, number], moveCount: 58 };
    const first = applyReversiAction(near, 0, { type: 'placeDisc', row: 0, col: 0 });
    expect(first).toMatchObject({ ok: true, state: { phase: 'playing', turn: 0, lastPass: 1, counts: [62, 1] } });
    if (!first.ok) return;
    const final = applyReversiAction(first.state, 0, { type: 'placeDisc', row: 7, col: 7 });
    expect(final).toMatchObject({ ok: true, state: { phase: 'finished', counts: [64, 0], result: { type: 'win', winner: 0, reason: 'score' } } });
  });

  it('双方都无步时提前结束；格式和状态反序列化拒绝异常值', () => {
    const state = createReversiState(0);
    const board = Array<0 | 1 | null>(64).fill(0); board[0] = null; board[1] = 1; board[63] = null;
    const outcome = applyReversiAction({ ...state, board, counts: [61, 1], moveCount: 58 }, 0, { type: 'placeDisc', row: 0, col: 0 });
    expect(outcome).toMatchObject({ ok: true, state: { phase: 'finished', counts: [63, 0], result: { type: 'win', winner: 0, reason: 'score' } } });
    expect(reversiDefinition.validateAction({ type: 'placeDisc', row: 2, col: 3, extra: 1 }).ok).toBe(false);
    expect(() => reversiDefinition.deserialize(JSON.stringify({ ...state, board: [] }))).toThrow();
  });
});
