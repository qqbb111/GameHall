import { describe, expect, it } from 'vitest';
import {
  applyTwentyFourAction,
  applyTwentyFourSubmission,
  cardFromId,
  createTwentyFourState,
  drawSolvableCards,
  expireTwentyFourRound,
  solveTwentyFour,
  twentyFourResult,
  validateTwentyFourExpression,
  viewTwentyFourState,
  type FourCards,
} from '../src';

function cards(ranks: [number, number, number, number]): FourCards {
  return ranks.map((rank, index) => ({ id: index * 13 + rank - 1, suit: ['S', 'H', 'D', 'C'][index] as 'S' | 'H' | 'D' | 'C', rank })) as FourCards;
}

describe('24-point parser and solver', () => {
  it.each([
    ['8/(3-8/3)', [8, 3, 8, 3]],
    ['6÷(1-3÷4)', [6, 1, 3, 4]],
    ['(1-3)*(1-13)', [1, 3, 1, 13]],
  ])('accepts exact rational expression %s', (expression, ranks) => {
    expect(validateTwentyFourExpression(expression, ranks)).toMatchObject({ ok: true });
  });

  it.each(['-1+2+3+4', '1.5+2+3+4', '2(3+4)+1', '2**3+4+5', 'Math.abs(1)+2+3+4', '1/(2-2)+3'])('safely rejects %s', (expression) => {
    expect(validateTwentyFourExpression(expression, [1, 2, 3, 4]).ok).toBe(false);
  });

  it('enforces the card multiset', () => {
    expect(validateTwentyFourExpression('12+12', [1, 2, 1, 2])).toMatchObject({ ok: false, code: 'CARDS_MISMATCH' });
  });

  it('finds and revalidates solutions', () => {
    const solution = solveTwentyFour([3, 3, 8, 8]);
    expect(solution).not.toBeNull();
    expect(validateTwentyFourExpression(solution!, [3, 3, 8, 8]).ok).toBe(true);
    expect(solveTwentyFour([1, 1, 1, 1])).toBeNull();
  });

  it('draws unique physical cards and a valid solvable hand', () => {
    let value = 0.12345;
    const drawn = drawSolvableCards(() => {
      value = (value * 7.31 + 0.17) % 1;
      return value;
    });
    expect(new Set(drawn.cards.map((card) => card.id)).size).toBe(4);
    expect(validateTwentyFourExpression(drawn.solution, drawn.cards.map((card) => card.rank)).ok).toBe(true);
    expect(cardFromId(51)).toEqual({ id: 51, suit: 'C', rank: 13 });
  });

  it('applies cooldown, score, timeout and solution hiding', () => {
    let state = createTwentyFourState(cards([3, 3, 8, 8]), '8/(3-8/3)', 1_000);
    const wrong = applyTwentyFourSubmission(state, 0, '3+3+8+8', 2_000);
    expect(wrong.ok).toBe(false);
    if (wrong.ok || !wrong.state) return;
    state = wrong.state;
    expect(state.cooldownUntilMs[0]).toBe(5_000);
    expect(viewTwentyFourState(state, 2_000).solution).toBeNull();
    const correct = applyTwentyFourSubmission(state, 0, '8/(3-8/3)', 5_000);
    expect(correct.ok).toBe(true);
    if (!correct.ok) return;
    expect(correct.state.scores).toEqual([1, 0]);
    expect(viewTwentyFourState(correct.state, 5_000).solution).toBe('8/(3-8/3)');

    const expiring = createTwentyFourState(cards([1, 2, 3, 4]), '1*2*3*4', 0);
    expect(expireTwentyFourRound(expiring, 30_000).roundOutcome).toEqual({ type: 'timeout', winner: null });
  });

  it('先到五分立即结束整场比赛', () => {
    const state = createTwentyFourState(cards([3, 3, 8, 8]), '8/(3-8/3)', 1_000, [4, 2], 7);
    const result = applyTwentyFourSubmission(state, 0, '8/(3-8/3)', 2_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toMatchObject({ phase: 'finished', scores: [5, 2], winner: 0, round: 7 });
    expect(twentyFourResult(result.state)).toEqual({ type: 'win', winner: 0, reason: 'score' });
  });

  it('保留比分胜利、认输、断线与重启超时的不同终局原因', () => {
    const state = createTwentyFourState(cards([1, 2, 3, 4]), '1*2*3*4', 1_000);
    const resigned = applyTwentyFourAction(state, 1, { type: 'resign' }, 2_000);
    expect(resigned.ok).toBe(true);
    if (!resigned.ok) return;
    expect(resigned.state.finishReason).toBe('resign');
    expect(twentyFourResult(resigned.state)).toEqual({ type: 'win', winner: 0, reason: 'resign' });

    expect(twentyFourResult({ ...state, phase: 'finished', winner: 1, finishReason: 'disconnect' }))
      .toEqual({ type: 'win', winner: 1, reason: 'disconnect' });
    expect(twentyFourResult({ ...state, phase: 'finished', winner: null, finishReason: 'restart_timeout' }))
      .toEqual({ type: 'draw' });
  });
});
