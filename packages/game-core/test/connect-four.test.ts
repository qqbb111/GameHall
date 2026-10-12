import { describe, expect, it } from 'vitest';
import { applyConnectFourAction, connectFourDefinition, createConnectFourState, type ConnectFourState } from '../src';

function drop(state: ConnectFourState, col: number) {
  const result = applyConnectFourAction(state, state.turn, { type: 'drop', col });
  if (!result.ok) throw new Error(result.error.code);
  return result.state;
}

describe('四子连线', () => {
  it('按重力下落、交替落子，拒绝满列与越界', () => {
    let state = createConnectFourState(1);
    state = drop(state, 2);
    expect(state.lastMove).toEqual({ row: 5, col: 2, player: 1 });
    state = drop(state, 2);
    expect(state.lastMove).toEqual({ row: 4, col: 2, player: 0 });
    expect(applyConnectFourAction(state, 0, { type: 'drop', col: 2 })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(applyConnectFourAction(state, 1, { type: 'drop', col: 7 })).toMatchObject({ ok: false, error: { code: 'OUT_OF_BOUNDS' } });
    for (let index = 0; index < 4; index++) state = drop(state, 2);
    expect(applyConnectFourAction(state, state.turn, { type: 'drop', col: 2 })).toMatchObject({ ok: false, error: { code: 'COLUMN_FULL' } });
  });

  it.each([
    [0, 6, 1, 6, 2, 6, 3],
    [0, 1, 0, 1, 0, 1, 0],
  ])('横向或纵向四连终局', (...moves) => {
    let state = createConnectFourState(0);
    for (const col of moves) state = drop(state, col);
    expect(state.result).toEqual({ type: 'win', winner: 0, reason: 'line' });
    expect(state.winningLine).toHaveLength(4);
    expect(applyConnectFourAction(state, 1, { type: 'drop', col: 5 })).toMatchObject({ ok: false, error: { code: 'GAME_FINISHED' } });
  });

  it('识别斜向四连，并保证反序列化拒绝悬空棋子', () => {
    let state = createConnectFourState(0);
    for (const col of [0,1,1,2,4,2,2,3,4,3,5,3,3]) state = drop(state, col);
    expect(state.result).toEqual({ type: 'win', winner: 0, reason: 'line' });
    expect(connectFourDefinition.deserialize(connectFourDefinition.serialize(state))).toEqual(state);
    const invalid = { ...state, board: [...state.board] };
    invalid.board[35] = null;
    expect(() => connectFourDefinition.deserialize(JSON.stringify(invalid))).toThrow();
    expect(() => connectFourDefinition.deserialize(JSON.stringify({ ...state, winningLine: null }))).toThrow();
    expect(() => connectFourDefinition.deserialize(JSON.stringify({ ...state, lastMove: { row: 99, col: 0, player: 0 } }))).toThrow();
    expect(() => connectFourDefinition.deserialize(JSON.stringify({ ...state, result: { type: 'win', winner: 1, reason: 'line' } }))).toThrow();
    expect(() => connectFourDefinition.deserialize(JSON.stringify({ ...createConnectFourState(0), turn: 1 }))).toThrow();
  });

  it('满盘无连线时判和', () => {
    const state = createConnectFourState(0);
    const board = [
      '0011001', '1100110', '0011001', '1100110', '0011001', '1100110',
    ].join('').split('').map((cell) => Number(cell) as 0 | 1);
    const near = { ...state, board: board.map((cell, index) => index === 0 ? null : cell), moveCount: 41, turn: 0 as const };
    const outcome = applyConnectFourAction(near, 0, { type: 'drop', col: 0 });
    expect(outcome).toMatchObject({ ok: true, state: { result: { type: 'draw' } } });
  });
});
