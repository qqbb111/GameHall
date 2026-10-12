import { describe, expect, it } from 'vitest';
import {
  applyConnectFourAction, applyReversiAction, createConnectFourState, createReversiState, legalReversiMoves,
  type ConnectFourState, type Player,
} from '@gamehall/game-core';
import { chooseConnectFourMove, chooseReversiMove, recommendSoloHint } from './solo-ai';

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

  it('黑白棋对方自动无步时，电脑可连续从纯规则选择下一手直至结算', () => {
    const board = Array<Player | null>(64).fill(1);
    board[0] = null; board[1] = 0; board[63] = null; board[62] = 0;
    const state = { ...createReversiState(0), board, turn: 1 as Player, counts: [2, 60] as [number, number], moveCount: 58 };
    const first = applyReversiAction(state, 1, chooseReversiMove(state, 'easy'));
    expect(first).toMatchObject({ ok: true, state: { phase: 'playing', turn: 1, lastPass: 0 } });
    if (!first.ok) return;
    const second = applyReversiAction(first.state, 1, chooseReversiMove(first.state, 'easy'));
    expect(second).toMatchObject({ ok: true, state: { phase: 'finished', counts: [0, 64], result: { type: 'win', winner: 1 } } });
  });

  it('人类四子提示区分立即连四、挡四与一般估计，且只给合法动作', () => {
    expect(recommendSoloHint(fourAfter([0, 6, 1, 6, 2, 5]))).toEqual({ action: { type: 'drop', col: 3 }, reason: '这步可以立即连成四子。' });
    const block = recommendSoloHint(fourAfter([6, 0, 6, 1, 5, 2]));
    expect(block.action).toEqual({ type: 'drop', col: 3 });
    expect(block.reason).toContain('挡住电脑下一手');
    const opening = recommendSoloHint(createConnectFourState(0));
    expect(opening.reason).toContain('建议考虑');
    expect(opening.action.type).toBe('drop');
    expect(() => recommendSoloHint(createConnectFourState(1))).toThrow('human turn');
  });

  it('人类黑白棋提示只给合法位置与实际翻转数量', () => {
    const state = createReversiState(0);
    const hint = recommendSoloHint(state);
    expect(hint.action.type).toBe('placeDisc');
    if (hint.action.type !== 'placeDisc') return;
    expect(legalReversiMoves(state.board, 0)).toContainEqual({ row: hint.action.row, col: hint.action.col });
    expect(hint.reason).toContain('翻转 1 枚棋子');
  });
});
