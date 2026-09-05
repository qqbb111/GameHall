import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SPLENDOR_CARDS, SPLENDOR_NOBLES, applySplendorAction, canAffordSplendorCard, createSplendorState, gemColors, legalSplendorPayment, splendorDefinition, tokenColors, validateSplendorAction, type SplendorAction, type SplendorState, type TokenCounts } from '../src';

const zero = (): TokenCounts => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });
function step(state: SplendorState, action: SplendorAction): SplendorState {
  const before = JSON.stringify(state);
  const result = applySplendorAction(state, state.turn, action);
  expect(JSON.stringify(state)).toBe(before);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.state;
}
function setup() { return createSplendorState({ playerCount: 2, startingPlayer: 0, rng: () => 0.3 }); }

describe('Splendor base set and rules', () => {
  it('逐张锁定两个独立数据源核对后的 90 张发展卡，以及修正过的完整贵族表', () => {
    const canonical = SPLENDOR_CARDS.map((card) => `${card.tier}|${card.bonus}|${card.points}|${gemColors.map((color) => card.cost[color]).join(',')}`).sort().join('\n');
    expect(createHash('sha256').update(canonical).digest('hex')).toBe('417d650b072d783121cbb910ac3aa5bbce0f533fffb05a34c3645ed68d5c6401');
    expect(new Set(SPLENDOR_CARDS.map((card) => card.id)).size).toBe(90);
    expect([1, 2, 3].map((tier) => SPLENDOR_CARDS.filter((card) => card.tier === tier).length)).toEqual([40, 30, 20]);
    expect(SPLENDOR_NOBLES.map((noble) => gemColors.map((color) => noble.requirement[color]).join(',')).sort()).toEqual([
      '0,0,4,4,0', '4,4,0,0,0', '4,0,0,0,4', '0,4,4,0,0', '0,0,0,4,4',
      '3,0,0,3,3', '0,3,3,3,0', '3,3,3,0,0', '3,3,0,0,3', '0,0,3,3,3',
    ].sort());
    expect(SPLENDOR_NOBLES.every((noble) => noble.points === 3)).toBe(true);
  });

  it.each([2, 3, 4] as const)('%i 人供给、市场、贵族及洗牌设置', (playerCount) => {
    const state = createSplendorState({ playerCount, rng: () => 0 });
    expect(state.players).toHaveLength(playerCount);
    expect(gemColors.map((color) => state.supply[color])).toEqual(Array(5).fill(playerCount === 2 ? 4 : playerCount === 3 ? 5 : 7));
    expect(state.supply.gold).toBe(5);
    expect(state.nobles).toHaveLength(playerCount + 1);
    expect(Object.values(state.market).map((market) => market.length)).toEqual([4, 4, 4]);
    expect(state.decks).not.toEqual(createSplendorState({ playerCount, rng: () => 0.9 }).decks);
    expect(state.startingPlayer).toBe(0);
  });

  it('拿取数量、同色四枚门槛、回合和浅层严格参数校验', () => {
    const state = setup();
    expect(applySplendorAction(state, 1, { type: 'pass' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(applySplendorAction(state, 0, { type: 'pass' }).ok).toBe(false);
    for (const colors of [[], ['white'], ['white', 'blue'], ['white', 'white', 'blue']] as const) expect(applySplendorAction(state, 0, { type: 'takeTokens', colors: [...colors] }).ok).toBe(false);
    const taken = step(state, { type: 'takeTokens', colors: ['white', 'white'] });
    expect(taken.players[0]!.tokens.white).toBe(2);
    expect(applySplendorAction(taken, 1, { type: 'takeTokens', colors: ['white', 'white'] }).ok).toBe(false);
    state.supply = { ...zero(), white: 1, blue: 1, gold: 5 };
    expect(step(state, { type: 'takeTokens', colors: ['white'] }).players[0]!.tokens.white).toBe(1);
    expect(step(state, { type: 'takeTokens', colors: ['white', 'blue'] }).players[0]!.tokens.white).toBe(1);
    for (const action of [{ type: 'pass', injected: true }, { type: 'takeTokens', colors: ['gold'] }, { type: 'returnTokens', tokens: { ...zero(), gold: -1 } }, { type: 'reserve', source: { kind: 'deck', tier: 4 } }]) expect(validateSplendorAction(action).ok).toBe(false);
  });

  it('购买允许黄金主动替代，拒绝不足、过付、错色；永久折扣与补牌正确', () => {
    const state = setup();
    const card = SPLENDOR_CARDS.find((item) => item.id === 'L1-01')!;
    state.market[1]![0] = card;
    state.players[0]!.tokens = { ...zero(), red: 2, black: 1, gold: 3 };
    expect(legalSplendorPayment(state.players[0]!, card, { ...zero(), gold: 3 })).toBe(true);
    for (const payment of [{ ...zero(), gold: 2 }, { ...zero(), red: 2, black: 1, gold: 1 }, { ...zero(), blue: 3 }]) expect(legalSplendorPayment(state.players[0]!, card, payment)).toBe(false);
    const next = step(state, { type: 'purchase', source: { kind: 'market', tier: 1, cardId: card.id }, payment: { ...zero(), gold: 3 } });
    expect(next.players[0]!.tokens).toEqual({ ...zero(), red: 2, black: 1 });
    expect(next.players[0]!.bonuses.white).toBe(1);
    expect(next.market[1]).toHaveLength(4);
    expect(next.decks[1]).toHaveLength(state.decks[1].length - 1);
  });

  it('明牌和盲抽保留、上限、空牌堆以及终局快照隐私', () => {
    let state = setup();
    const hiddenId = state.decks[3].at(-1)!.id;
    state = step(state, { type: 'reserve', source: { kind: 'deck', tier: 3 } });
    const viewer = splendorDefinition.viewFor(state, 1, 0);
    expect(viewer).not.toHaveProperty('decks');
    expect(viewer.players[0]).not.toHaveProperty('reserved');
    expect(viewer.players[0]!.reservedCount).toBe(1);
    expect(JSON.stringify(viewer)).not.toContain(hiddenId);
    expect(splendorDefinition.viewFor(state, 0, 0).players[0]!.reserved?.[0]!.id).toBe(hiddenId);
    state.turn = 0;
    for (let index = 0; index < 2; index++) { state = step(state, { type: 'reserve', source: { kind: 'market', tier: 1, cardId: state.market[1][0]!.id } }); state.turn = 0; }
    expect(applySplendorAction(state, 0, { type: 'reserve', source: { kind: 'deck', tier: 2 } }).ok).toBe(false);
    const finished = step(state, { type: 'resign' });
    expect(splendorDefinition.viewFor(finished, 1, 0).players[0]).not.toHaveProperty('reserved');
    expect(finished.result).toMatchObject({ type: 'aborted', reason: 'resign' });
    const empty = setup(); empty.decks[1] = [];
    expect(applySplendorAction(empty, 0, { type: 'reserve', source: { kind: 'deck', tier: 1 } }).ok).toBe(false);
    expect(step(empty, { type: 'reserve', source: { kind: 'market', tier: 1, cardId: empty.market[1][0]!.id } }).market[1]).toHaveLength(3);
    empty.supply.gold = 0;
    expect(step(empty, { type: 'reserve', source: { kind: 'deck', tier: 2 } }).players[0]!.tokens.gold).toBe(0);
  });

  it('超额归还、贵族多选中间阶段可持久化，全部必选完成才换人', () => {
    let state = setup();
    state.players[0]!.tokens = { white: 2, blue: 2, green: 2, red: 2, black: 2, gold: 0 };
    state.players[0]!.bonuses = { white: 4, blue: 4, green: 4, red: 4, black: 4 };
    state = step(state, { type: 'reserve', source: { kind: 'deck', tier: 3 } });
    expect(state.phase).toBe('return-tokens'); expect(state.turn).toBe(0);
    expect(applySplendorAction(state, 0, { type: 'takeTokens', colors: ['red', 'blue', 'green'] }).ok).toBe(false);
    expect(applySplendorAction(state, 0, { type: 'returnTokens', tokens: zero() }).ok).toBe(false);
    state = step(splendorDefinition.deserialize(splendorDefinition.serialize(state)), { type: 'returnTokens', tokens: { ...zero(), gold: 1 } });
    expect(state.phase).toBe('choose-noble'); expect(state.turn).toBe(0);
    expect(applySplendorAction(state, 0, { type: 'chooseNoble', nobleId: 'missing' }).ok).toBe(false);
    state = step(splendorDefinition.deserialize(splendorDefinition.serialize(state)), { type: 'chooseNoble', nobleId: state.nobles[1]!.id });
    expect(state.players[0]!.nobles).toHaveLength(1); expect(state.players[0]!.score).toBe(3); expect(state.turn).toBe(1);
    state.turn = 0; state.nobles = [state.nobles[0]!];
    state = step(state, { type: 'takeTokens', colors: ['red', 'blue', 'green'] });
    state = step(state, { type: 'returnTokens', tokens: { ...zero(), red: 3 } });
    expect(state.players[0]!.nobles).toHaveLength(2); expect(state.turn).toBe(1);
  });

  it('十五分完成以随机首家为界的当前轮，依分数和较少卡数裁决或共享胜利', () => {
    let state = createSplendorState({ playerCount: 3, seats: [0, 2, 3], startingPlayer: 2 });
    state.players.forEach((player) => { player.score = 15; });
    state = step(state, { type: 'takeTokens', colors: ['white', 'blue', 'green'] });
    expect(state.finalRound).toBe(true); expect(state.turn).toBe(3); expect(state.result).toBeNull();
    state = step(state, { type: 'takeTokens', colors: ['red', 'blue', 'black'] });
    expect(state.turn).toBe(0);
    const tied = step(state, { type: 'takeTokens', colors: ['white', 'green', 'black'] });
    expect(tied.result).toMatchObject({ type: 'completed', winners: [0, 2, 3] });
    state.players[0]!.purchased = [SPLENDOR_CARDS[0]!];
    expect(step(state, { type: 'takeTokens', colors: ['white', 'green', 'black'] }).result).toMatchObject({ winners: [2, 3] });
    state.players[0]!.score = 16;
    expect(step(state, { type: 'takeTokens', colors: ['white', 'green', 'black'] }).result).toMatchObject({ winners: [0] });
  });

  it('所有玩家均无合法行动时中止，不生成赢家', () => {
    let state = setup(); state.supply = zero(); state.market = { 1: [], 2: [], 3: [] }; state.decks = { 1: [], 2: [], 3: [] };
    state = step(state, { type: 'pass' }); expect(state.result).toBeNull();
    expect(step(state, { type: 'pass' }).result).toMatchObject({ type: 'aborted', reason: 'stalemate' });
  });

  it.each([2, 3, 4] as const)('%i 人完整模拟对局逐步检查宝石和 90 张卡守恒', (playerCount) => {
    let seed = playerCount;
    let state = createSplendorState({ playerCount, rng: () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; } });
    const initialSupply = { ...state.supply };
    for (let turn = 0; turn < 600 && !state.result; turn++) {
      const me = state.players.find((player) => player.seat === state.turn)!;
      let action: SplendorAction;
      if (state.phase === 'return-tokens') {
        let excess = tokenColors.reduce((sum, color) => sum + me.tokens[color], 0) - 10;
        const returned = zero();
        for (const color of tokenColors) { returned[color] = Math.min(excess, me.tokens[color]); excess -= returned[color]; }
        action = { type: 'returnTokens', tokens: returned };
      } else if (state.phase === 'choose-noble') action = { type: 'chooseNoble', nobleId: state.nobles.find((noble) => gemColors.every((color) => me.bonuses[color] >= noble.requirement[color]))!.id };
      else {
        const card = [...me.reserved, ...Object.values(state.market).flat()].filter((item) => canAffordSplendorCard(me, item)).sort((a, b) => b.points - a.points)[0];
        if (card) {
          const payment = zero();
          for (const color of gemColors) { const cost = Math.max(0, card.cost[color] - me.bonuses[color]); payment[color] = Math.min(cost, me.tokens[color]); payment.gold += cost - payment[color]; }
          action = { type: 'purchase', source: me.reserved.includes(card) ? { kind: 'reserved', cardId: card.id } : { kind: 'market', tier: card.tier, cardId: card.id }, payment };
        } else {
          const colors = gemColors.filter((color) => state.supply[color] > 0).sort((a, b) => me.tokens[a] - me.tokens[b]).slice(0, 3);
          action = colors.length ? { type: 'takeTokens', colors } : { type: 'pass' };
        }
      }
      state = step(state, action);
      for (const color of tokenColors) expect(state.supply[color] + state.players.reduce((sum, player) => sum + player.tokens[color], 0)).toBe(initialSupply[color]);
      const allCards = [...Object.values(state.decks).flat(), ...Object.values(state.market).flat(), ...state.players.flatMap((player) => [...player.purchased, ...player.reserved])];
      expect(allCards).toHaveLength(90); expect(new Set(allCards.map((card) => card.id)).size).toBe(90);
      for (const player of state.players) { expect(player.score).toBe(player.purchased.reduce((sum, card) => sum + card.points, 0) + player.nobles.length * 3); for (const color of gemColors) expect(player.bonuses[color]).toBe(player.purchased.filter((card) => card.bonus === color).length); }
    }
    expect(state.result?.type).toBe('completed');
  });
});
