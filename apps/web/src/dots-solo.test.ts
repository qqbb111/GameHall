import { describe, expect, it } from 'vitest';
import { createDotsAndBoxesState, type DotsAndBoxesState } from '@gamehall/game-core';
import { chooseDotsMove, dotsAfter, dotsHint, DOTS_SEARCH_LIMIT, openDotsEdges, type DotsEdge } from './dots-solo';

function closeToEnd(except: DotsEdge[]): DotsAndBoxesState {
  let state = createDotsAndBoxesState(1);
  const all = openDotsEdges(state);
  for (const edge of all) {
    if (except.some((candidate) => JSON.stringify(candidate) === JSON.stringify(edge))) continue;
    state = dotsAfter(state, edge);
  }
  return state;
}

describe('dots computer and hint', () => {
  it('every playing position returns a legal edge within the node budget', () => {
    let state = createDotsAndBoxesState(1);
    while (state.phase === 'playing') {
      for (const difficulty of ['easy', 'thoughtful'] as const) {
        const stats = { nodes: 0 };
        const edge = chooseDotsMove(state, difficulty, stats);
        expect(openDotsEdges(state)).toContainEqual(edge);
        expect(stats.nodes).toBeLessThanOrEqual(DOTS_SEARCH_LIMIT[difficulty]);
      }
      state = dotsAfter(state, openDotsEdges(state)[0]!);
    }
    expect(state.edgeCount).toBe(24);
    expect(state.scores[0] + state.scores[1]).toBe(9);
  });

  it('takes an immediate double box and continues the same player turn', () => {
    const shared: DotsEdge = { type: 'drawEdge', orientation: 'V', row: 1, col: 1 };
    const far: DotsEdge = { type: 'drawEdge', orientation: 'H', row: 0, col: 0 };
    const state = closeToEnd([shared, far]);
    // The shared edge closes both adjacent boxes, whereas the far edge closes one.
    const before = state.scores[state.turn];
    for (const difficulty of ['easy', 'thoughtful'] as const) {
      const chosen = chooseDotsMove(state, difficulty);
      expect(chosen).toEqual(shared);
      const next = dotsAfter(state, chosen);
      expect(next.scores[state.turn] - before).toBe(2);
      expect(next.turn).toBe(state.turn);
      expect(next.phase).toBe('playing');
      expect(openDotsEdges(next)).toEqual([far]);
    }
  });

  it('hint names actual score and extra turn, and terminal capture says the game ends', () => {
    const shared: DotsEdge = { type: 'drawEdge', orientation: 'V', row: 1, col: 1 };
    const far: DotsEdge = { type: 'drawEdge', orientation: 'H', row: 0, col: 0 };
    const state = closeToEnd([shared, far]);
    const human = { ...state, turn: 0 as const };
    const hint = dotsHint(human);
    expect(openDotsEdges(human)).toContainEqual(hint.action);
    const after = dotsAfter(human, hint.action);
    expect(hint.reason).toContain(`${after.scores[0] - human.scores[0]} 分`);
    expect(hint.reason).toContain('继续画边');
    const terminal = { ...after, turn: 0 as const };
    expect(dotsHint(terminal).reason).toContain('结束本局');
  });
});
