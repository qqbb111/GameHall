import { describe, expect, it } from 'vitest';
import { applyQuoridorAction, canPlaceQuoridorWall, createQuoridorState, legalQuoridorMoves, type QuoridorState } from '../src';

function coords(state: QuoridorState, player: 0 | 1): string[] {
  return legalQuoridorMoves(state, player).map((coord) => `${coord.row},${coord.col}`).sort();
}

describe('quoridor', () => {
  it('creates the standard board and wall supply', () => {
    const state = createQuoridorState(0);
    expect(state.pawns).toEqual([{ row: 8, col: 4 }, { row: 0, col: 4 }]);
    expect(state.goalRows).toEqual([0, 8]);
    expect(state.wallsRemaining).toEqual([10, 10]);
    expect(coords(state, 0)).toEqual(['7,4', '8,3', '8,5']);
  });

  it('supports straight jumps and only exposes diagonal jumps when blocked behind', () => {
    const state = createQuoridorState(0);
    state.pawns = [{ row: 4, col: 4 }, { row: 3, col: 4 }];
    state.turn = 0;
    expect(coords(state, 0)).toContain('2,4');
    expect(coords(state, 0)).not.toContain('3,3');
    state.walls.push({ row: 2, col: 4, orientation: 'H' });
    expect(coords(state, 0)).toEqual(expect.arrayContaining(['3,3', '3,5']));
    expect(coords(state, 0)).not.toContain('2,4');
    state.walls.push({ row: 2, col: 3, orientation: 'V' });
    expect(coords(state, 0)).not.toContain('3,3');
    expect(coords(state, 0)).toContain('3,5');
  });

  it('allows diagonal jumps at the board edge', () => {
    const state = createQuoridorState(0);
    state.pawns = [{ row: 1, col: 4 }, { row: 0, col: 4 }];
    expect(coords(state, 0)).toEqual(expect.arrayContaining(['0,3', '0,5']));
  });

  it('rejects overlapping and crossing walls but permits end-to-end walls', () => {
    const state = createQuoridorState(0);
    state.walls.push({ row: 3, col: 2, orientation: 'H' });
    expect(canPlaceQuoridorWall(state, { row: 3, col: 3, orientation: 'H' })).toMatchObject({ ok: false, code: 'WALL_CONFLICT' });
    expect(canPlaceQuoridorWall(state, { row: 3, col: 2, orientation: 'V' })).toMatchObject({ ok: false, code: 'WALL_CONFLICT' });
    expect(canPlaceQuoridorWall(state, { row: 3, col: 4, orientation: 'H' })).toEqual({ ok: true });
  });

  it('rejects a wall that removes the final path', () => {
    const state = createQuoridorState(0);
    state.pawns[0] = { row: 3, col: 3 };
    state.walls = [
      { row: 2, col: 3, orientation: 'H' },
      { row: 4, col: 3, orientation: 'H' },
      { row: 3, col: 2, orientation: 'V' },
    ];
    expect(canPlaceQuoridorWall(state, { row: 3, col: 4, orientation: 'V' })).toMatchObject({ ok: false, code: 'PATH_BLOCKED' });
  });

  it('moves, places walls and detects the goal', () => {
    let state = createQuoridorState(0);
    const wall = applyQuoridorAction(state, 0, { type: 'placeWall', row: 4, col: 4, orientation: 'H' });
    expect(wall.ok).toBe(true);
    if (!wall.ok) return;
    state = wall.state;
    expect(state.wallsRemaining[0]).toBe(9);
    state.turn = 0;
    state.pawns[0] = { row: 1, col: 0 };
    const win = applyQuoridorAction(state, 0, { type: 'move', row: 0, col: 0 });
    expect(win.ok && win.state.result).toMatchObject({ type: 'win', winner: 0 });
  });
});
