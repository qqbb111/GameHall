import { isExactObject, ruleError, type ApplyResult, type GameDefinition } from './types';

export type PokerSeat = 0 | 1 | 2 | 3;
export type PokerSuit = 'S' | 'H' | 'D' | 'C';
export type PokerCard = { id: number; suit: PokerSuit; rank: number };
export type PokerPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'finished';
export type PokerActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn';

export type TexasHoldemAction =
  | { type: 'fold' | 'check' | 'call' | 'allIn' | 'resign' }
  | { type: 'bet' | 'raise'; amount: number };

export type PokerPlayer = {
  seat: PokerSeat;
  stack: number;
  holeCards: [PokerCard, PokerCard];
  folded: boolean;
  allIn: boolean;
  totalCommitted: number;
  streetCommitted: number;
  actedThisRound: boolean;
};

export type PokerPot = { amount: number; eligibleSeats: PokerSeat[] };
export type PokerPotResult = PokerPot & { winners: PokerSeat[] };
export type PokerPayout = { seat: PokerSeat; amount: number };
export type PokerHandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';
export type PokerHandValue = { category: PokerHandCategory; tiebreakers: number[]; label: string };

export type TexasHoldemResult =
  | { type: 'completed'; reason: 'showdown' | 'fold'; winners: PokerSeat[]; payouts: PokerPayout[]; pots: PokerPotResult[]; hands: Array<{ seat: PokerSeat; value: PokerHandValue }> }
  | { type: 'aborted'; reason: 'disconnect' | 'leave' | 'restart_timeout' };

export type TexasHoldemState = {
  kind: 'texas-holdem';
  phase: PokerPhase;
  playerCount: number;
  players: PokerPlayer[];
  deck: PokerCard[];
  communityCards: PokerCard[];
  dealerSeat: PokerSeat;
  smallBlindSeat: PokerSeat;
  bigBlindSeat: PokerSeat;
  turn: PokerSeat | null;
  currentBet: number;
  minRaise: number;
  pot: number;
  result: TexasHoldemResult | null;
};

export type TexasHoldemPlayerView = Omit<PokerPlayer, 'holeCards'> & {
  holeCards: PokerCard[] | null;
  holeCardCount: number;
  availableActions: PokerActionType[];
  toCall: number;
  minimumWager: number | null;
  maximumWager: number | null;
};

export type TexasHoldemView = Omit<TexasHoldemState, 'deck' | 'players'> & {
  mySeat: PokerSeat;
  players: TexasHoldemPlayerView[];
};

export type TexasHoldemInitialOptions = {
  seats: PokerSeat[];
  dealerSeat?: PokerSeat;
  rng?: () => number;
};

export const TEXAS_HOLDEM_STARTING_STACK = 1_000;
export const TEXAS_HOLDEM_SMALL_BLIND = 10;
export const TEXAS_HOLDEM_BIG_BLIND = 20;

const suits: PokerSuit[] = ['S', 'H', 'D', 'C'];
const categories: Record<PokerHandCategory, string> = {
  'high-card': '高牌',
  pair: '一对',
  'two-pair': '两对',
  'three-of-a-kind': '三条',
  straight: '顺子',
  flush: '同花',
  'full-house': '葫芦',
  'four-of-a-kind': '四条',
  'straight-flush': '同花顺',
};

function nextSeat(players: readonly PokerPlayer[], seat: PokerSeat): PokerSeat {
  const index = players.findIndex((player) => player.seat === seat);
  if (index < 0) throw new Error('seat is not in poker table');
  return players[(index + 1) % players.length]!.seat;
}

function clockwiseSeats(state: TexasHoldemState): PokerSeat[] {
  const ordered: PokerSeat[] = [];
  let current = state.dealerSeat;
  for (let index = 0; index < state.players.length; index += 1) {
    ordered.push(current);
    current = nextSeat(state.players, current);
  }
  return ordered;
}

function activePlayers(state: TexasHoldemState): PokerPlayer[] {
  return state.players.filter((player) => !player.folded && !player.allIn);
}

function remainingPlayers(state: TexasHoldemState): PokerPlayer[] {
  return state.players.filter((player) => !player.folded);
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.max(0, Math.min(0.999999999, rng())) * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function createDeck(): PokerCard[] {
  return suits.flatMap((suit, suitIndex) => Array.from({ length: 13 }, (_, index) => ({
    id: suitIndex * 13 + index,
    suit,
    rank: index + 2,
  })));
}

function draw(deck: PokerCard[]): PokerCard {
  const card = deck.pop();
  if (!card) throw new Error('poker deck exhausted');
  return card;
}

function dealBoardCard(deck: PokerCard[], communityCards: PokerCard[]): void {
  draw(deck);
  communityCards.push(draw(deck));
}

function dealFlop(deck: PokerCard[], communityCards: PokerCard[]): void {
  draw(deck);
  communityCards.push(draw(deck), draw(deck), draw(deck));
}

function cloneState(state: TexasHoldemState): TexasHoldemState {
  return {
    ...state,
    deck: [...state.deck],
    communityCards: [...state.communityCards],
    players: state.players.map((player) => ({ ...player, holeCards: [...player.holeCards] as [PokerCard, PokerCard] })),
    result: state.result ? JSON.parse(JSON.stringify(state.result)) as TexasHoldemResult : null,
  };
}

function playerFor(state: TexasHoldemState, seat: PokerSeat): PokerPlayer | undefined {
  return state.players.find((player) => player.seat === seat);
}

function updatePot(state: TexasHoldemState): void {
  state.pot = state.players.reduce((sum, player) => sum + player.totalCommitted, 0);
}

export function buildTexasHoldemPots(players: readonly PokerPlayer[]): PokerPot[] {
  const levels = [...new Set(players.map((player) => player.totalCommitted).filter((value) => value > 0))].sort((a, b) => a - b);
  const pots: PokerPot[] = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = players.filter((player) => player.totalCommitted >= level).length;
    const amount = (level - previous) * contributors;
    const eligibleSeats = players.filter((player) => !player.folded && player.totalCommitted >= level).map((player) => player.seat);
    if (amount > 0 && eligibleSeats.length > 0) pots.push({ amount, eligibleSeats });
    previous = level;
  }
  return pots;
}

function compareValues(left: PokerHandValue, right: PokerHandValue): number {
  const categoryOrder: PokerHandCategory[] = ['high-card', 'pair', 'two-pair', 'three-of-a-kind', 'straight', 'flush', 'full-house', 'four-of-a-kind', 'straight-flush'];
  const categoryDifference = categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category);
  if (categoryDifference !== 0) return categoryDifference;
  for (let index = 0; index < Math.max(left.tiebreakers.length, right.tiebreakers.length); index += 1) {
    const difference = (left.tiebreakers[index] ?? 0) - (right.tiebreakers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function evaluateFive(cards: readonly PokerCard[]): PokerHandValue {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0]);
  const flush = cards.every((card) => card.suit === cards[0]!.suit);
  const uniqueRanks = [...new Set(ranks)];
  const straightHigh = uniqueRanks.length === 5
    ? uniqueRanks[0] === 14 && uniqueRanks[1] === 5 && uniqueRanks[2] === 4 && uniqueRanks[3] === 3 && uniqueRanks[4] === 2
      ? 5
      : uniqueRanks.every((rank, index) => index === 0 || uniqueRanks[index - 1]! - rank === 1) ? uniqueRanks[0]! : 0
    : 0;
  if (flush && straightHigh) return { category: 'straight-flush', tiebreakers: [straightHigh], label: categories['straight-flush'] };
  if (groups[0]![1] === 4) return { category: 'four-of-a-kind', tiebreakers: [groups[0]![0], groups[1]![0]], label: categories['four-of-a-kind'] };
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return { category: 'full-house', tiebreakers: [groups[0]![0], groups[1]![0]], label: categories['full-house'] };
  if (flush) return { category: 'flush', tiebreakers: ranks, label: categories.flush };
  if (straightHigh) return { category: 'straight', tiebreakers: [straightHigh], label: categories.straight };
  if (groups[0]![1] === 3) return { category: 'three-of-a-kind', tiebreakers: [groups[0]![0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)], label: categories['three-of-a-kind'] };
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return { category: 'two-pair', tiebreakers: [Math.max(groups[0]![0], groups[1]![0]), Math.min(groups[0]![0], groups[1]![0]), groups[2]![0]], label: categories['two-pair'] };
  if (groups[0]![1] === 2) return { category: 'pair', tiebreakers: [groups[0]![0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)], label: categories.pair };
  return { category: 'high-card', tiebreakers: ranks, label: categories['high-card'] };
}

export function evaluatePokerHand(cards: readonly PokerCard[]): PokerHandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error('poker hand must contain 5 to 7 cards');
  let best: PokerHandValue | null = null;
  for (let a = 0; a < cards.length - 4; a += 1) for (let b = a + 1; b < cards.length - 3; b += 1) for (let c = b + 1; c < cards.length - 2; c += 1) for (let d = c + 1; d < cards.length - 1; d += 1) for (let e = d + 1; e < cards.length; e += 1) {
    const value = evaluateFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
    if (!best || compareValues(value, best) > 0) best = value;
  }
  return best!;
}

function finishWithWinners(state: TexasHoldemState, winnersByPot: Array<{ pot: PokerPot; winners: PokerSeat[] }>, reason: 'showdown' | 'fold', hands: Array<{ seat: PokerSeat; value: PokerHandValue }>): TexasHoldemState {
  const payouts = new Map<PokerSeat, number>();
  const order = clockwiseSeats(state);
  const potResults: PokerPotResult[] = winnersByPot.map(({ pot, winners }) => {
    const each = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - each * winners.length;
    const orderedWinners = [...order.slice(1), order[0]!].filter((seat) => winners.includes(seat));
    for (const seat of orderedWinners) {
      payouts.set(seat, (payouts.get(seat) ?? 0) + each + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder -= 1;
    }
    return { ...pot, winners };
  });
  const nextPlayers = state.players.map((player) => ({ ...player, stack: player.stack + (payouts.get(player.seat) ?? 0) }));
  const payoutList = [...payouts.entries()].map(([seat, amount]) => ({ seat, amount }));
  return { ...state, players: nextPlayers, phase: 'finished', turn: null, result: { type: 'completed', reason, winners: [...new Set(payoutList.map((item) => item.seat))], payouts: payoutList, pots: potResults, hands } };
}

function finishByFold(state: TexasHoldemState): TexasHoldemState {
  const winner = remainingPlayers(state)[0];
  if (!winner) throw new Error('fold must leave one player');
  const pots = buildTexasHoldemPots(state.players).map((pot) => ({ pot, winners: [winner.seat] }));
  return finishWithWinners(state, pots, 'fold', []);
}

function finishByShowdown(state: TexasHoldemState): TexasHoldemState {
  const remaining = remainingPlayers(state);
  const values = new Map<PokerSeat, PokerHandValue>();
  for (const player of remaining) values.set(player.seat, evaluatePokerHand([...player.holeCards, ...state.communityCards]));
  const pots = buildTexasHoldemPots(state.players).map((pot) => {
    const eligible = pot.eligibleSeats.filter((seat) => values.has(seat));
    const best = eligible.map((seat) => values.get(seat)!).reduce((left, right) => compareValues(left, right) >= 0 ? left : right);
    return { pot, winners: eligible.filter((seat) => compareValues(values.get(seat)!, best) === 0) };
  });
  return finishWithWinners(state, pots, 'showdown', [...values.entries()].map(([seat, value]) => ({ seat, value })));
}

function nextStreet(state: TexasHoldemState): TexasHoldemState {
  const next = cloneState(state);
  if (next.phase === 'preflop') { next.phase = 'flop'; dealFlop(next.deck, next.communityCards); }
  else if (next.phase === 'flop') { next.phase = 'turn'; dealBoardCard(next.deck, next.communityCards); }
  else if (next.phase === 'turn') { next.phase = 'river'; dealBoardCard(next.deck, next.communityCards); }
  else { return finishByShowdown(next); }
  next.currentBet = 0;
  next.minRaise = TEXAS_HOLDEM_BIG_BLIND;
  next.players = next.players.map((player) => ({ ...player, streetCommitted: 0, actedThisRound: false }));
  const first = clockwiseSeats(next).slice(1).find((seat) => {
    const player = playerFor(next, seat);
    return player && !player.folded && !player.allIn;
  });
  next.turn = first ?? null;
  if (activePlayers(next).length === 0) return finishByShowdown(next);
  if (activePlayers(next).length === 1 && remainingPlayers(next).length > 1) return finishByShowdown(next);
  return next;
}

function continueAfterAction(state: TexasHoldemState): TexasHoldemState {
  if (remainingPlayers(state).length === 1) return finishByFold(state);
  const active = activePlayers(state);
  const complete = active.length === 0 || active.every((player) => player.allIn || (player.actedThisRound && player.streetCommitted === state.currentBet));
  if (!complete) return state;
  if (active.length === 0 || active.every((player) => player.allIn)) {
    while (state.communityCards.length < 5 && state.phase !== 'finished') state = nextStreet(state);
    return state.phase === 'finished' ? state : finishByShowdown(state);
  }
  return nextStreet(state);
}

export function createTexasHoldemState(options: TexasHoldemInitialOptions): TexasHoldemState {
  if (options.seats.length < 2 || options.seats.length > 4 || new Set(options.seats).size !== options.seats.length) throw new Error('Texas Holdem requires 2 to 4 unique seats');
  const seats = [...options.seats].sort((a, b) => a - b);
  const rng = options.rng ?? Math.random;
  const dealerSeat = options.dealerSeat ?? seats[Math.floor(Math.max(0, Math.min(0.999999999, rng())) * seats.length)]!;
  if (!seats.includes(dealerSeat)) throw new Error('dealer seat must be seated');
  const shuffled = shuffle(createDeck(), rng);
  const players: PokerPlayer[] = seats.map((seat) => ({ seat, stack: TEXAS_HOLDEM_STARTING_STACK, holeCards: [draw(shuffled), draw(shuffled)], folded: false, allIn: false, totalCommitted: 0, streetCommitted: 0, actedThisRound: false }));
  const initial: TexasHoldemState = { kind: 'texas-holdem', phase: 'preflop', playerCount: seats.length, players, deck: shuffled, communityCards: [], dealerSeat, smallBlindSeat: seats.length === 2 ? dealerSeat : nextSeat(players, dealerSeat), bigBlindSeat: dealerSeat, turn: null, currentBet: TEXAS_HOLDEM_BIG_BLIND, minRaise: TEXAS_HOLDEM_BIG_BLIND, pot: 0, result: null };
  initial.bigBlindSeat = nextSeat(players, initial.smallBlindSeat);
  for (const player of initial.players) {
    const blind = player.seat === initial.smallBlindSeat ? TEXAS_HOLDEM_SMALL_BLIND : player.seat === initial.bigBlindSeat ? TEXAS_HOLDEM_BIG_BLIND : 0;
    player.stack -= blind;
    player.streetCommitted = blind;
    player.totalCommitted = blind;
  }
  updatePot(initial);
  initial.turn = seats.length === 2 ? initial.smallBlindSeat : nextSeat(players, initial.bigBlindSeat);
  return initial;
}

export function applyTexasHoldemAction(state: TexasHoldemState, actor: PokerSeat, action: TexasHoldemAction): ApplyResult<TexasHoldemState> {
  if (state.phase === 'finished') return ruleError('GAME_FINISHED', '本局已经结束');
  const player = playerFor(state, actor);
  if (!player) return ruleError('INVALID_SEAT', '玩家座位不存在');
  if (action.type === 'resign') action = { type: 'fold' };
  if (actor !== state.turn) return ruleError('NOT_YOUR_TURN', '还没轮到你行动');
  if (player.folded || player.allIn) return ruleError('PLAYER_INACTIVE', '你已经不能继续下注');
  const next = cloneState(state);
  const current = playerFor(next, actor)!;
  const toCall = Math.max(0, next.currentBet - current.streetCommitted);
  if (action.type === 'fold') current.folded = true;
  else if (action.type === 'check') {
    if (toCall !== 0) return ruleError('CHECK_NOT_ALLOWED', '当前有需要跟注的金额');
    current.actedThisRound = true;
  } else if (action.type === 'call') {
    if (toCall === 0) return ruleError('CALL_NOT_NEEDED', '当前无需跟注');
    if (current.stack < toCall) return ruleError('INSUFFICIENT_STACK', '筹码不足，请选择 all-in');
    current.stack -= toCall; current.streetCommitted += toCall; current.totalCommitted += toCall; current.actedThisRound = true;
  } else if (action.type === 'allIn' || action.type === 'bet' || action.type === 'raise') {
    const target = action.type === 'allIn' ? current.streetCommitted + current.stack : (action as { type: 'bet' | 'raise'; amount: number }).amount;
    if (!Number.isInteger(target) || target <= current.streetCommitted || target > current.streetCommitted + current.stack) return ruleError('INVALID_WAGER', '下注金额不合法');
    const increase = target - next.currentBet;
    const fullRaise = increase >= next.minRaise;
    if (action.type === 'bet' && next.currentBet !== 0) return ruleError('BET_NOT_ALLOWED', '当前已有下注，请使用加注');
    if (action.type === 'raise' && next.currentBet === 0) return ruleError('RAISE_NOT_ALLOWED', '当前没有下注，请使用 bet');
    if (action.type !== 'allIn' && target <= next.currentBet) return ruleError('WAGER_MUST_RAISE', '加注后金额必须高于当前下注');
    if (!fullRaise && target < current.streetCommitted + current.stack) return ruleError('MIN_RAISE', '加注幅度不足，除非直接 all-in');
    const added = target - current.streetCommitted;
    current.stack -= added;
    current.streetCommitted = target;
    current.totalCommitted += added;
    current.allIn = current.stack === 0;
    current.actedThisRound = true;
    if (target > next.currentBet) {
      const previousBet = next.currentBet;
      next.currentBet = target;
      if (fullRaise) {
        next.minRaise = target - previousBet;
        next.players = next.players.map((item) => item.seat === actor || item.folded || item.allIn ? item : { ...item, actedThisRound: false });
      }
    }
  }
  updatePot(next);
  if (next.phase !== 'finished') {
    let candidateSeat = next.turn ?? actor;
    next.turn = null;
    for (let index = 0; index < next.players.length; index += 1) {
      candidateSeat = nextSeat(next.players, candidateSeat);
      const candidate = playerFor(next, candidateSeat);
      if (candidate && !candidate.folded && !candidate.allIn && (!candidate.actedThisRound || candidate.streetCommitted !== next.currentBet)) {
        next.turn = candidateSeat;
        break;
      }
    }
  }
  const advanced = continueAfterAction(next);
  if (advanced.phase !== 'finished' && advanced.turn === null) return ruleError('TURN_ERROR', '无法找到下一位行动玩家');
  return { ok: true, state: advanced };
}

function visibleActions(state: TexasHoldemState, player: PokerPlayer): { actions: PokerActionType[]; toCall: number; minimumWager: number | null; maximumWager: number | null } {
  if (state.phase === 'finished' || state.turn !== player.seat || player.folded || player.allIn) return { actions: [], toCall: 0, minimumWager: null, maximumWager: null };
  const toCall = Math.max(0, state.currentBet - player.streetCommitted);
  const max = player.streetCommitted + player.stack;
  const actions: PokerActionType[] = ['fold', 'allIn'];
  if (toCall === 0) actions.push('check');
  else if (player.stack >= toCall) actions.push('call');
  const minimum = state.currentBet === 0 ? state.minRaise : state.currentBet + state.minRaise;
  if (max > state.currentBet && max >= minimum) actions.push(state.currentBet === 0 ? 'bet' : 'raise');
  return { actions, toCall, minimumWager: actions.includes('bet') || actions.includes('raise') ? minimum : null, maximumWager: max };
}

export const texasHoldemDefinition: GameDefinition<TexasHoldemState, TexasHoldemAction, TexasHoldemView, TexasHoldemInitialOptions, PokerSeat, TexasHoldemResult> = {
  id: 'texas-holdem',
  stateSchemaVersion: 1,
  initialize: (options) => createTexasHoldemState(options),
  validateAction: (input) => {
    if (isExactObject(input, ['type']) && ['fold', 'check', 'call', 'allIn', 'resign'].includes(String(input.type))) return { ok: true, action: { type: input.type as 'fold' | 'check' | 'call' | 'allIn' | 'resign' } };
    if (isExactObject(input, ['type', 'amount']) && (input.type === 'bet' || input.type === 'raise') && Number.isInteger(input.amount) && (input.amount as number) >= 1) return { ok: true, action: { type: input.type, amount: input.amount as number } };
    return { ok: false, message: '德州扑克操作格式不合法' };
  },
  advance: (state, actor, action) => applyTexasHoldemAction(state, actor, action),
  viewFor: (state, viewer) => {
    const current = playerFor(state, viewer);
    if (!current) throw new Error('viewer is not seated');
    const { deck: _deck, ...visibleState } = state;
    void _deck;
    return {
      ...visibleState,
      mySeat: viewer,
      players: state.players.map((player) => {
        const reveal = player.seat === viewer || (state.phase === 'finished' && state.result?.type === 'completed' && state.result.reason === 'showdown' && !player.folded);
        const actionHints = visibleActions(state, player);
        return { ...player, holeCards: reveal ? [...player.holeCards] : null, holeCardCount: 2, availableActions: actionHints.actions, toCall: actionHints.toCall, minimumWager: actionHints.minimumWager, maximumWager: actionHints.maximumWager };
      }),
    } as TexasHoldemView;
  },
  result: (state) => state.result,
  serialize: (state) => JSON.stringify(state),
  deserialize: (serialized) => JSON.parse(serialized) as TexasHoldemState,
};
