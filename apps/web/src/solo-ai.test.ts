import { describe, expect, it } from 'vitest';
import {
  applyConnectFourAction, createConnectFourState, createReversiState, legalReversiMoves,
  type ConnectFourState, type Player,
} from '@gamehall/game-core';
import { chooseConnectFourMove, chooseReversiMove } from './solo-ai';

function fourAfter(columns: number[]): ConnectFourState {
  let state = createConnectFourState(0);
  for (const col of columns) {
    const result = applyConnectFourAction(state, state.turn, { type: 'drop', col });
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  return state;
}

describe('solo computer move search', () => {
  it.each(['easy', 'thoughtful'] as const)('四子连线 %s 先拿立即胜利，也能挡住对方下一步四连', (difficulty) => {
    const win = fourAfter([6, 0, 6, 1, 5, 2, 5]);
    expect(win.turn).toBe(1);
    expect(chooseConnectFourMove(win, difficulty)).toEqual({ type: 'drop', col: 3 });
    const block = fourAfter([0, 6, 1, 6, 2]);
    expect(block.turn).toBe(1);
    expect(chooseConnectFourMove(block, difficulty)).toEqual({ type: 'drop', col: 3 });
  });

  it('四子连线不会投放已满列，且轻松与认真均返回合法步', () => {
    const state = fourAfter([0, 0, 0, 0, 0, 0]);
    for (const difficulty of ['easy', 'thoughtful'] as const) {
      const action = chooseConnectFourMove(state, difficulty);
      expect(action.type).toBe('drop');
      if (action.type === 'drop') expect(state.board[action.col]).toBeNull();
    }
  });

  it.each(['easy', 'thoughtful'] as const)('黑白棋 %s 仅选合法翻转，出现角位时优先抢角', (difficulty) => {
    const initial = createReversiState(0);
    const opening = chooseReversiMove(initial, difficulty);
    expect(opening.type).toBe('placeDisc');
    if (opening.type === 'placeDisc') expect(legalReversiMoves(initial.board, initial.turn)).toContainEqual({ row: opening.row, col: opening.col });

    const board = [...initial.board];
    board[1] = 1 as Player;
    board[2] = 0 as Player;
    const cornerState = { ...initial, board, counts: [3, 3] as [number, number] };
    expect(legalReversiMoves(cornerState.board, 0)).toContainEqual({ row: 0, col: 0 });
    expect(chooseReversiMove(cornerState, difficulty)).toEqual({ type: 'placeDisc', row: 0, col: 0 });
  });
});
