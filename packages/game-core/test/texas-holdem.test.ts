import { describe, expect, it } from 'vitest';
import {
  applyTexasHoldemAction,
  buildTexasHoldemPots,
  createTexasHoldemState,
  evaluatePokerHand,
  texasHoldemDefinition,
  type PokerCard,
  type PokerPlayer,
  type TexasHoldemState,
} from '../src';

const card = (id: number, suit: PokerCard['suit'], rank: number): PokerCard => ({ id, suit, rank });

function step(state: TexasHoldemState, seat: 0 | 1 | 2 | 3, action: Parameters<typeof applyTexasHoldemAction>[2]): TexasHoldemState {
  const result = applyTexasHoldemAction(state, seat, action);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function checkAroundToShowdown(): TexasHoldemState {
  let state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.1 });
  state = step(state, 0, { type: 'call' });
  state = step(state, 1, { type: 'check' });
  for (let street = 0; street < 3; street += 1) {
    state = step(state, state.turn!, { type: 'check' });
    state = step(state, state.turn!, { type: 'check' });
  }
  return state;
}

describe('Texas Hold’em rules', () => {
  it('creates a unique deck, deals private cards, and sets heads-up blinds/order', () => {
    const state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.25 });
    const ids = [...state.players.flatMap((player) => player.holeCards), ...state.deck].map((item) => item.id);
    expect(new Set(ids).size).toBe(52);
    expect(state.smallBlindSeat).toBe(0);
    expect(state.bigBlindSeat).toBe(1);
    expect(state.turn).toBe(0);
    expect(state.pot).toBe(30);
    expect(state.players.map((player) => player.stack)).toEqual([990, 980]);
  });

  it('advances through all streets and evaluates the showdown', () => {
    const state = checkAroundToShowdown();
    expect(state.phase).toBe('hand-complete');
    expect(state.communityCards).toHaveLength(5);
    expect(state.result).toBeNull();
    expect(state.lastHandResult?.reason).toBe('showdown');
    expect(state.lastHandResult?.hands.every((hand) => hand.value.bestFive.length === 5)).toBe(true);
  });

  it('enforces check/call, minimum raises, and accepts a short all-in', () => {
    let state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.1 });
    expect(applyTexasHoldemAction(state, 0, { type: 'check' })).toMatchObject({ ok: false, error: { code: 'CHECK_NOT_ALLOWED' } });
    expect(applyTexasHoldemAction(state, 0, { type: 'raise', amount: 30 })).toMatchObject({ ok: false, error: { code: 'MIN_RAISE' } });
    state = step(state, 0, { type: 'call' });
    state.players[1]!.stack = 5;
    expect(applyTexasHoldemAction(state, 1, { type: 'raise', amount: 24 })).toMatchObject({ ok: false, error: { code: 'MIN_RAISE' } });
    state = step(state, 1, { type: 'allIn' });
    expect(state.players[1]!.allIn).toBe(true);
  });

  it('fold awards the committed pot without revealing folded hands', () => {
    let state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.1 });
    state = step(state, 0, { type: 'fold' });
    expect(state.phase).toBe('hand-complete');
    expect(state.result).toBeNull();
    expect(state.lastHandResult).toMatchObject({ reason: 'fold', winners: [1] });
    const view = texasHoldemDefinition.viewFor(state, 1, 0);
    expect(view.players.find((player) => player.seat === 0)?.holeCards).toBeNull();
    expect(view.players.find((player) => player.seat === 1)?.holeCards).toHaveLength(2);
  });

  it('ends only the hand when an opponent folds against an all-in', () => {
    let state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.1 });
    state = step(state, 0, { type: 'allIn' });
    state = step(state, 1, { type: 'fold' });
    expect(state.phase).toBe('hand-complete');
    expect(state.result).toBeNull();
    expect(state.lastHandResult).toMatchObject({ reason: 'fold', winners: [0] });
    expect(state.players.map((player) => player.stack)).toEqual([1_020, 980]);
  });

  it('keeps opponents private during play and reveals active hands at showdown', () => {
    const state = checkAroundToShowdown();
    const viewer = texasHoldemDefinition.viewFor(state, 0, 0);
    expect(viewer.players.find((player) => player.seat === 0)?.holeCards).toHaveLength(2);
    expect(viewer.players.find((player) => player.seat === 1)?.holeCards).toHaveLength(2);
    expect('deck' in viewer).toBe(false);
  });

  it('builds main and side pots and splits ties deterministically', () => {
    const player = (seat: 0 | 1 | 2 | 3, totalCommitted: number, folded = false): PokerPlayer => ({
      seat, stack: 0, holeCards: [card(seat * 2, 'S', 2), card(seat * 2 + 1, 'H', 3)], folded, allIn: true, eliminated: false, totalCommitted, streetCommitted: totalCommitted, actedThisRound: true,
    });
    expect(buildTexasHoldemPots([player(0, 100), player(1, 100), player(2, 60), player(3, 100, true)])).toEqual([
      { amount: 240, eligibleSeats: [0, 1, 2] },
      { amount: 120, eligibleSeats: [0, 1] },
    ]);
  });

  it('recognizes ace-low straights and preserves state on serialization', () => {
    const cards = [card(0, 'S', 14), card(1, 'H', 2), card(2, 'D', 3), card(3, 'C', 4), card(4, 'S', 5), card(5, 'H', 9), card(6, 'D', 13)];
    expect(evaluatePokerHand(cards).category).toBe('straight');
    const state = createTexasHoldemState({ seats: [0, 1], rng: () => 0.2 });
    expect(texasHoldemDefinition.deserialize(texasHoldemDefinition.serialize(state))).toEqual(state);
  });

  it('keeps stacks across hands and starts only after every live player confirms', () => {
    let state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.1 });
    state = step(state, 0, { type: 'fold' });
    expect(state.players.map((player) => player.stack)).toEqual([990, 1_010]);
    state = step(state, 0, { type: 'readyNextHand' });
    expect(state.phase).toBe('hand-complete');
    expect(state.nextHandReadySeats).toEqual([0]);
    expect(applyTexasHoldemAction(state, 0, { type: 'readyNextHand' })).toMatchObject({ ok: false, error: { code: 'ALREADY_READY' } });
    const started = applyTexasHoldemAction(state, 1, { type: 'readyNextHand' }, () => 0.3);
    if (!started.ok) throw new Error(started.error.message);
    state = started.state;
    expect(state.phase).toBe('preflop');
    expect(state.handNumber).toBe(2);
    expect(state.dealerSeat).toBe(1);
    expect(state.players.map((player) => player.stack)).toEqual([970, 1_000]);
    expect(state.players.every((player) => player.holeCards.length === 2)).toBe(true);
  });

  it('ends the match only when one player still has chips', () => {
    let state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.1 });
    const loser = state.players[0]!;
    loser.stack = 0;
    loser.streetCommitted = 1_000;
    loser.totalCommitted = 1_000;
    state = step(state, 0, { type: 'fold' });
    expect(state.phase).toBe('finished');
    expect(state.players[0]!.eliminated).toBe(true);
    expect(state.result).toEqual({
      type: 'completed', winner: 1, handsPlayed: 1,
      finalStacks: [{ seat: 0, amount: 0 }, { seat: 1, amount: 1_020 }],
    });
  });

  it('skips eliminated seats when rotating dealer and posting blinds', () => {
    let state = createTexasHoldemState({ seats: [0, 1, 2], dealerSeat: 0, rng: () => 0.1 });
    state.players[1]!.eliminated = true;
    state.players[1]!.stack = 0;
    state.phase = 'hand-complete';
    state.lastHandResult = { handNumber: 1, reason: 'fold', winners: [0], payouts: [], pots: [], hands: [] };
    state = step(state, 0, { type: 'readyNextHand' });
    const started = applyTexasHoldemAction(state, 2, { type: 'readyNextHand' }, () => 0.4);
    if (!started.ok) throw new Error(started.error.message);
    expect(started.state.dealerSeat).toBe(2);
    expect(started.state.smallBlindSeat).toBe(2);
    expect(started.state.bigBlindSeat).toBe(0);
    expect(started.state.players[1]!.holeCards).toEqual([]);
  });

  it('normalizes version-one snapshots without exposing folded cards', () => {
    const current = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.2 });
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    delete legacy.handNumber;
    delete legacy.nextHandReadySeats;
    delete legacy.lastHandResult;
    for (const player of legacy.players as Array<Record<string, unknown>>) delete player.eliminated;
    const restored = texasHoldemDefinition.deserialize(JSON.stringify(legacy));
    expect(restored.handNumber).toBe(1);
    expect(restored.nextHandReadySeats).toEqual([]);
    expect(restored.players.every((player) => !player.eliminated)).toBe(true);
  });
});
