import { describe, expect, it, vi } from 'vitest';
import { validateTwentyFourExpression } from '@gamehall/game-core';
import { fixturePack } from './twenty-four-fixture';
import { solutionSteps } from './twenty-four-hints';
import { answerSummary, decodeTwentyFourProgress, encodeTwentyFourProgress, newTwentyFourProgress, tickChallenge, type TwentyFourProgress } from './twenty-four-practice';

describe('24 点单人进度', () => {
  it('十道可解题、真实牌 ID 和不同 rank multiset 可往返编解码', () => {
    const progress = newTwentyFourProgress('practice', fixturePack());
    expect(decodeTwentyFourProgress(encodeTwentyFourProgress(progress))).toEqual(progress);
    expect(new Set(progress.pack.map((hand) => hand.cards.map((card) => card.rank).sort((a, b) => a - b).join('-'))).size).toBe(10);
  });
  it('拒绝缺牌、重牌、伪造分数、非法阶段、负时长、错误作答证明及超长草稿', () => {
    const base = newTwentyFourProgress('challenge', fixturePack());
    const invalid = [
      { ...base, score: 10 },
      { ...base, pack: base.pack.slice(0, 9) },
      { ...base, pack: [base.pack[0], base.pack[0], ...base.pack.slice(2)] },
      { ...base, pack: [{ ...base.pack[0], cards: [base.pack[0]!.cards[0], base.pack[0]!.cards[0], ...base.pack[0]!.cards.slice(2)] }, ...base.pack.slice(1)] },
      { ...base, pack: [{ ...base.pack[0], cards: [{ ...base.pack[0]!.cards[0], rank: 99 }, ...base.pack[0]!.cards.slice(1)] }, ...base.pack.slice(1)] },
      { ...base, remainingMs: -1 },
      { ...base, phase: 'answered' },
      { ...base, index: 11 },
      { ...base, draft: 'x'.repeat(129) },
      { ...base, answers: [{ kind: 'independent', expression: '1+1+1+1', hints: 0 }] },
      { ...base, pack: [{ ...base.pack[0], solution: '1+2+3+18' }, ...base.pack.slice(1)] },
    ];
    for (const value of invalid) expect(() => decodeTwentyFourProgress(JSON.stringify({ version: 1, ...value }))).toThrow();
  });
  it('验算分数、重复牌与非法表达式；提示答案必须是真实可验证的运算', () => {
    expect(validateTwentyFourExpression('8/(3-8/3)', [8, 3, 8, 3]).ok).toBe(true);
    expect(validateTwentyFourExpression('8/(3-8/3)', [8, 3, 8, 4]).ok).toBe(false);
    expect(validateTwentyFourExpression('8/(3-3/3)', [8, 3, 8, 3]).ok).toBe(false);
    expect(solutionSteps('(8/(3-(8/3)))')).toEqual(['8 ÷ 3 = 8/3', '3 − (8/3) = 1/3', '8 ÷ (1/3) = 24']);
    expect(() => solutionSteps('8/(3-8/3)')).toThrow();
  });
  it('区分独立、参考解出和查看答案，并在完成或超时时锁定结果', () => {
    const base = newTwentyFourProgress('challenge', fixturePack());
    const expression = base.pack[0]!.solution;
    const answered: TwentyFourProgress = { ...base, phase: 'answered', answers: [{ kind: 'assisted', expression, hints: 1 }], draft: expression };
    expect(decodeTwentyFourProgress(encodeTwentyFourProgress(answered))).toEqual(answered);
    expect(answerSummary(answered)).toEqual({ solved: 1, independent: 0, assisted: 1, revealed: 0 });
    const expired = tickChallenge(answered, 60_000);
    expect(expired).toMatchObject({ phase: 'finished', finishReason: 'time', index: 1, remainingMs: 0 });
    expect(decodeTwentyFourProgress(encodeTwentyFourProgress(expired))).toEqual(expired);
    expect(tickChallenge(expired, 1000)).toEqual(expired);
  });
  it('单调时间扣减不受系统 Date 跳变干扰，暂停由调用方停止 tick', () => {
    const progress = newTwentyFourProgress('challenge', fixturePack());
    const before = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(999999999999);
    expect(tickChallenge(progress, 1250).remainingMs).toBe(58_750);
    expect(progress.remainingMs).toBe(60_000);
    Date.now = before;
    vi.restoreAllMocks();
  });
});
