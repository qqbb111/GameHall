import { describe, expect, it } from 'vitest';
import { applyDotsAndBoxesAction, createDotsAndBoxesState, dotsAndBoxesDefinition, type DotsAndBoxesState, type EdgeOrientation } from '../src';

function draw(state: DotsAndBoxesState, orientation: EdgeOrientation, row: number, col: number) {
  const result = applyDotsAndBoxesAction(state, state.turn, { type: 'drawEdge', orientation, row, col });
  if (!result.ok) throw new Error(result.error.code);
  return result.state;
}

describe('点格棋', () => {
  it('占边轮换、重复与越界被拒绝', () => {
    let state = createDotsAndBoxesState(1);
    state = draw(state, 'H', 0, 0);
    expect(state.turn).toBe(0);
    expect(applyDotsAndBoxesAction(state, 0, { type: 'drawEdge', orientation: 'H', row: 0, col: 0 })).toMatchObject({ ok: false, error: { code: 'EDGE_TAKEN' } });
    expect(applyDotsAndBoxesAction(state, 0, { type: 'drawEdge', orientation: 'V', row: 3, col: 0 })).toMatchObject({ ok: false, error: { code: 'OUT_OF_BOUNDS' } });
    expect(applyDotsAndBoxesAction(state, 1, { type: 'drawEdge', orientation: 'H', row: 0, col: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
  });

  it('一条边同时封两个格得两分并保持回合', () => {
    const state = createDotsAndBoxesState(0);
    const horizontal = [...state.horizontal], vertical = [...state.vertical];
    for (const [row, col] of [[1,0],[2,0],[1,1],[2,1]] as const) horizontal[row * 3 + col] = 1;
    vertical[1 * 4 + 0] = 1; vertical[1 * 4 + 2] = 1;
    const near = { ...state, horizontal, vertical, edgeCount: 6 };
    const result = applyDotsAndBoxesAction(near, 0, { type: 'drawEdge', orientation: 'V', row: 1, col: 1 });
    expect(result).toMatchObject({ ok: true, state: { scores: [2, 0], turn: 0, lastBoxes: [3, 4], edgeCount: 7 } });
    if (result.ok) expect(dotsAndBoxesDefinition.deserialize(dotsAndBoxesDefinition.serialize(result.state))).toEqual(result.state);
  });

  it('24 条边画满，九格全部归属后按得分结算', () => {
    let state = createDotsAndBoxesState(0);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) state = draw(state, 'H', row, col);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) state = draw(state, 'V', row, col);
    expect(state.edgeCount).toBe(24);
    expect(state.phase).toBe('finished');
    expect(state.scores[0] + state.scores[1]).toBe(9);
    expect(state.result).toMatchObject({ type: 'win', reason: 'score' });
    expect(applyDotsAndBoxesAction(state, 0, { type: 'drawEdge', orientation: 'H', row: 0, col: 0 })).toMatchObject({ ok: false, error: { code: 'GAME_FINISHED' } });
  });

  it('严格动作格式和损坏状态保护', () => {
    const state = createDotsAndBoxesState(0);
    expect(dotsAndBoxesDefinition.validateAction({ type: 'drawEdge', orientation: 'H', row: 0, col: 0, extra: [] }).ok).toBe(false);
    expect(() => dotsAndBoxesDefinition.deserialize(JSON.stringify({ ...state, scores: [9, 0] }))).toThrow();
  });
});
