import { describe, expect, it } from 'vitest';
import { applyGomokuAction, createGomokuState, GOMOKU_SIZE, type GomokuState } from '../src';

function play(state: GomokuState, player: 0 | 1, row: number, col: number): GomokuState {
  const result = applyGomokuAction(state, player, { type: 'place', row, col });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.state;
}

const lineCases: Array<Array<[number, number]>> = [
  [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]],
  [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]],
  [[3, 3], [4, 4], [5, 5], [6, 6], [7, 7]],
  [[3, 11], [4, 10], [5, 9], [6, 8], [7, 7]],
];

describe('gomoku', () => {
  it('starts with the chosen black player', () => {
    const state = createGomokuState(1);
    expect(state.turn).toBe(1);
    expect(state.board).toHaveLength(225);
    expect(state.board.every((cell) => cell === null)).toBe(true);
  });

  it.each(lineCases.map((moves) => [moves] as const))('detects all line directions', (moves) => {
    let state = createGomokuState(0);
    for (let index = 0; index < moves.length; index += 1) {
      const [row, col] = moves[index]!;
      state = play(state, 0, row!, col!);
      if (index < moves.length - 1) state = play(state, 1, index, 14);
    }
    expect(state.result).toMatchObject({ type: 'win', winner: 0 });
    expect(state.winningLine.length).toBeGreaterThanOrEqual(5);
  });

  it('accepts an overline as a win', () => {
    const state = createGomokuState(0);
    state.board.splice(0, 6, 0, 0, null, 0, 0, 0);
    state.moveCount = 5;
    const result = applyGomokuAction(state, 0, { type: 'place', row: 0, col: 2 });
    expect(result.ok && result.state.result).toMatchObject({ type: 'win', winner: 0 });
  });

  it('rejects wrong turns, occupied cells and invalid coordinates without mutation', () => {
    const state = createGomokuState(0);
    expect(applyGomokuAction(state, 1, { type: 'place', row: 0, col: 0 })).toMatchObject({ ok: false });
    expect(applyGomokuAction(state, 0, { type: 'place', row: -1, col: 0 })).toMatchObject({ ok: false });
    const after = play(state, 0, 0, 0);
    expect(applyGomokuAction(after, 1, { type: 'place', row: 0, col: 0 })).toMatchObject({ ok: false });
    expect(state.board.every((cell) => cell === null)).toBe(true);
  });

  it('reports a draw when the final legal move creates no line', () => {
    const state = createGomokuState(0);
    for (let row = 0; row < GOMOKU_SIZE; row += 1) {
      for (let col = 0; col < GOMOKU_SIZE; col += 1) {
        const index = row * GOMOKU_SIZE + col;
        state.board[index] = ((row + Math.floor(col / 2)) % 2) as 0 | 1;
      }
    }
    state.board[224] = null;
    state.turn = ((14 + Math.floor(14 / 2)) % 2) as 0 | 1;
    state.moveCount = 224;
    const result = applyGomokuAction(state, state.turn, { type: 'place', row: 14, col: 14 });
    expect(result.ok && result.state.result).toEqual({ type: 'draw' });
  });
});
