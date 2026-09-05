import { isExactObject, ruleError, type ApplyResult, type GameDefinition } from './types';

export const SPLENDOR_RULES_SOURCE = 'https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf';
export const SPLENDOR_CARD_DATA_SOURCES = [
  'https://raw.githubusercontent.com/kyle-ip/splendor/main/src/data/card-pool.json',
  'https://github.com/anicolao/splendor/blob/main/data/verified_card_properties.csv',
  // Cross-check for all ten nobles. The JSON above incorrectly lists green/black
  // instead of red/black for one 4+4 noble; the corrected requirements are below.
  'https://github.com/roeey777/Splendor-AI/blob/master/src/splendor/splendor/splendor_utils.py',
] as const;

export const gemColors = ['white', 'blue', 'green', 'red', 'black'] as const;
export const tokenColors = [...gemColors, 'gold'] as const;
export type GemColor = (typeof gemColors)[number];
export type TokenColor = (typeof tokenColors)[number];
export type SplendorSeat = 0 | 1 | 2 | 3;
export type SplendorTier = 1 | 2 | 3;
export type GemCounts = Record<GemColor, number>;
export type TokenCounts = Record<TokenColor, number>;

export type SplendorCard = { id: string; tier: SplendorTier; bonus: GemColor; points: number; cost: GemCounts };
export type SplendorNoble = { id: string; points: 3; requirement: GemCounts };
export type SplendorPlayer = {
  seat: SplendorSeat;
  tokens: TokenCounts;
  bonuses: GemCounts;
  purchased: SplendorCard[];
  reserved: SplendorCard[];
  nobles: SplendorNoble[];
  score: number;
};
export type SplendorStanding = { seat: SplendorSeat; score: number; purchasedCards: number };
export type SplendorResult =
  | { type: 'completed'; winners: SplendorSeat[]; standings: SplendorStanding[] }
  | { type: 'aborted'; reason: 'resign' | 'disconnect' | 'leave' | 'restart_timeout' | 'stalemate'; standings: SplendorStanding[] };
export type SplendorPhase = 'action' | 'return-tokens' | 'choose-noble' | 'finished';
export type SplendorState = {
  kind: 'splendor';
  phase: SplendorPhase;
  playerCount: 2 | 3 | 4;
  players: SplendorPlayer[];
  supply: TokenCounts;
  decks: Record<SplendorTier, SplendorCard[]>;
  market: Record<SplendorTier, SplendorCard[]>;
  nobles: SplendorNoble[];
  turn: SplendorSeat;
  startingPlayer: SplendorSeat;
  finalRound: boolean;
  passedInRow: number;
  result: SplendorResult | null;
};
export type SplendorPlayerView = Omit<SplendorPlayer, 'reserved'> & { reservedCount: number; reserved?: SplendorCard[] };
export type SplendorView = Omit<SplendorState, 'decks' | 'players'> & {
  deckCounts: Record<SplendorTier, number>;
  players: SplendorPlayerView[];
};
export type SplendorCardSource =
  | { kind: 'market'; tier: SplendorTier; cardId: string }
  | { kind: 'deck'; tier: SplendorTier }
  | { kind: 'reserved'; cardId: string };
export type SplendorAction =
  | { type: 'takeTokens'; colors: GemColor[] }
  | { type: 'reserve'; source: SplendorCardSource }
  | { type: 'purchase'; source: SplendorCardSource; payment: TokenCounts }
  | { type: 'returnTokens'; tokens: TokenCounts }
  | { type: 'chooseNoble'; nobleId: string }
  | { type: 'pass' }
  | { type: 'resign' };
export type SplendorInitialOptions = { playerCount: 2 | 3 | 4; seats?: SplendorSeat[]; rng?: () => number; startingPlayer?: SplendorSeat };

type CardTuple = readonly [GemColor, number, number, number, number, number, number];
const LEVEL_1: readonly CardTuple[] = [
  ['white',0,0,0,0,2,1],['white',0,0,2,2,0,1],['white',1,0,0,4,0,0],['white',0,0,2,0,0,2],['white',0,0,1,2,1,1],['white',0,3,1,0,0,1],['white',0,0,1,1,1,1],['white',0,0,3,0,0,0],
  ['blue',0,0,0,0,0,3],['blue',0,1,0,1,1,1],['blue',0,1,0,1,2,1],['blue',0,0,0,2,0,2],['blue',0,1,0,0,0,2],['blue',0,0,1,3,1,0],['blue',1,0,0,0,4,0],['blue',0,1,0,2,2,0],
  ['green',0,2,1,0,0,0],['green',0,0,0,0,3,0],['green',0,1,1,0,1,1],['green',0,1,3,1,0,0],['green',0,0,2,0,2,0],['green',0,1,1,0,1,2],['green',1,0,0,0,0,4],['green',0,0,1,0,2,2],
  ['red',0,0,2,1,0,0],['red',0,2,1,1,0,1],['red',0,2,0,1,0,2],['red',1,4,0,0,0,0],['red',0,1,1,1,0,1],['red',0,1,0,0,1,3],['red',0,2,0,0,2,0],['red',0,3,0,0,0,0],
  ['black',0,1,1,1,1,0],['black',0,0,0,3,0,0],['black',0,0,0,1,3,1],['black',0,2,0,2,0,0],['black',0,2,2,0,1,0],['black',0,1,2,1,1,0],['black',0,0,0,2,1,0],['black',1,0,4,0,0,0],
];
const LEVEL_2: readonly CardTuple[] = [
  ['white',1,0,0,3,2,2],['white',1,2,3,0,3,0],['white',2,0,0,1,4,2],['white',2,0,0,0,5,3],['white',2,0,0,0,5,0],['white',3,6,0,0,0,0],
  ['blue',1,0,2,2,3,0],['blue',1,0,2,3,0,3],['blue',2,5,3,0,0,0],['blue',2,2,0,0,1,4],['blue',2,0,5,0,0,0],['blue',3,0,6,0,0,0],
  ['green',1,3,0,2,3,0],['green',1,2,3,0,0,2],['green',2,4,2,0,0,1],['green',2,0,5,3,0,0],['green',2,0,0,5,0,0],['green',3,0,0,6,0,0],
  ['red',1,2,0,0,2,3],['red',1,0,3,0,2,3],['red',2,1,4,2,0,0],['red',2,3,0,0,0,5],['red',2,0,0,0,0,5],['red',3,0,0,0,6,0],
  ['black',1,3,2,2,0,0],['black',1,3,0,3,0,2],['black',2,0,1,4,2,0],['black',2,0,0,5,3,0],['black',2,5,0,0,0,0],['black',3,0,0,0,0,6],
];
const LEVEL_3: readonly CardTuple[] = [
  ['white',3,0,3,3,5,3],['white',4,0,0,0,0,7],['white',4,3,0,0,3,6],['white',5,3,0,0,0,7],
  ['blue',3,3,0,3,3,5],['blue',4,7,0,0,0,0],['blue',4,6,3,0,0,3],['blue',5,7,3,0,0,0],
  ['green',3,5,3,0,3,3],['green',4,0,7,0,0,0],['green',4,3,6,3,0,0],['green',5,0,7,3,0,0],
  ['red',3,3,5,3,0,3],['red',4,0,0,7,0,0],['red',4,0,3,6,3,0],['red',5,0,0,7,3,0],
  ['black',3,3,3,5,3,0],['black',4,0,0,0,7,0],['black',4,0,0,3,6,3],['black',5,0,0,0,7,3],
];
const NOBLE_REQUIREMENTS: readonly (readonly [number, number, number, number, number])[] = [
  [0,0,4,4,0],[4,4,0,0,0],[4,0,0,0,4],[0,4,4,0,0],[0,0,0,4,4],
  [3,0,0,3,3],[0,3,3,3,0],[3,3,3,0,0],[3,3,0,0,3],[0,0,3,3,3],
];

const gems = (white = 0, blue = 0, green = 0, red = 0, black = 0): GemCounts => ({ white, blue, green, red, black });
const tokens = (white = 0, blue = 0, green = 0, red = 0, black = 0, gold = 0): TokenCounts => ({ white, blue, green, red, black, gold });
function makeCards(tier: SplendorTier, rows: readonly CardTuple[]): SplendorCard[] {
  return rows.map(([bonus, points, white, blue, green, red, black], index) => ({ id: `L${tier}-${String(index + 1).padStart(2, '0')}`, tier, bonus, points, cost: gems(white, blue, green, red, black) }));
}
export const SPLENDOR_CARDS: readonly SplendorCard[] = [...makeCards(1, LEVEL_1), ...makeCards(2, LEVEL_2), ...makeCards(3, LEVEL_3)];
export const SPLENDOR_NOBLES: readonly SplendorNoble[] = NOBLE_REQUIREMENTS.map(([white, blue, green, red, black], index) => ({ id: `N-${index + 1}`, points: 3, requirement: gems(white, blue, green, red, black) }));

function shuffle<T>(values: readonly T[], rng: () => number): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  }
  return copy;
}
function cloneCounts<T extends GemCounts | TokenCounts>(value: T): T { return { ...value }; }
function totalTokens(value: TokenCounts): number { return tokenColors.reduce((sum, color) => sum + value[color], 0); }
function standings(state: SplendorState): SplendorStanding[] { return state.players.map((player) => ({ seat: player.seat, score: player.score, purchasedCards: player.purchased.length })); }
function eligibleNobles(state: SplendorState, seat: SplendorSeat): SplendorNoble[] {
  const player = playerFor(state, seat)!;
  return state.nobles.filter((noble) => gemColors.every((color) => player.bonuses[color] >= noble.requirement[color]));
}
function drawIntoMarket(decks: Record<SplendorTier, SplendorCard[]>, market: Record<SplendorTier, SplendorCard[]>, tier: SplendorTier): void {
  while (market[tier].length < 4 && decks[tier].length > 0) market[tier].push(decks[tier].pop()!);
}

export function createSplendorState(options: SplendorInitialOptions): SplendorState {
  const rng = options.rng ?? Math.random;
  if (![2, 3, 4].includes(options.playerCount)) throw new Error('Splendor playerCount must be 2, 3, or 4');
  const perGem = options.playerCount === 2 ? 4 : options.playerCount === 3 ? 5 : 7;
  const decks = { 1: shuffle(SPLENDOR_CARDS.filter((card) => card.tier === 1), rng), 2: shuffle(SPLENDOR_CARDS.filter((card) => card.tier === 2), rng), 3: shuffle(SPLENDOR_CARDS.filter((card) => card.tier === 3), rng) };
  const market: Record<SplendorTier, SplendorCard[]> = { 1: [], 2: [], 3: [] };
  ([1, 2, 3] as const).forEach((tier) => drawIntoMarket(decks, market, tier));
  const nobles = shuffle(SPLENDOR_NOBLES, rng).slice(0, options.playerCount + 1);
  const seats = options.seats ?? Array.from({ length: options.playerCount }, (_, seat) => seat as SplendorSeat);
  if (seats.length !== options.playerCount || new Set(seats).size !== seats.length || seats.some((seat) => seat < 0 || seat > 3)) throw new Error('Splendor seats must be unique seats 0-3');
  const startingPlayer = options.startingPlayer !== undefined && seats.includes(options.startingPlayer)
    ? options.startingPlayer
    : seats[Math.floor(rng() * seats.length)]!;
  const players = seats.map((seat) => ({ seat, tokens: tokens(), bonuses: gems(), purchased: [], reserved: [], nobles: [], score: 0 }));
  return { kind: 'splendor', phase: 'action', playerCount: options.playerCount, players, supply: tokens(perGem, perGem, perGem, perGem, perGem, 5), decks, market, nobles, turn: startingPlayer, startingPlayer, finalRound: false, passedInRow: 0, result: null };
}

function playerFor(state: SplendorState, seat: SplendorSeat): SplendorPlayer | undefined { return state.players.find((player) => player.seat === seat); }
function locateCard(state: SplendorState, seat: SplendorSeat, source: SplendorCardSource): { card: SplendorCard; remove: () => void; refill?: () => void } | null {
  if (source.kind === 'reserved') {
    const player = playerFor(state, seat);
    const index = player?.reserved.findIndex((card) => card.id === source.cardId) ?? -1;
    return player && index >= 0 ? { card: player.reserved[index]!, remove: () => { player.reserved.splice(index, 1); } } : null;
  }
  if (source.kind === 'deck') {
    const card = state.decks[source.tier].at(-1);
    return card ? { card, remove: () => { state.decks[source.tier].pop(); } } : null;
  }
  const index = state.market[source.tier].findIndex((card) => card.id === source.cardId);
  if (index < 0) return null;
  return { card: state.market[source.tier][index]!, remove: () => { state.market[source.tier].splice(index, 1); }, refill: () => drawIntoMarket(state.decks, state.market, source.tier) };
}
export function canAffordSplendorCard(player: Pick<SplendorPlayer, 'tokens' | 'bonuses'>, card: SplendorCard): boolean {
  const missing = gemColors.reduce((sum, color) => sum + Math.max(0, card.cost[color] - player.bonuses[color] - player.tokens[color]), 0);
  return missing <= player.tokens.gold;
}
export function legalSplendorPayment(player: Pick<SplendorPlayer, 'tokens' | 'bonuses'>, card: SplendorCard, payment: TokenCounts): boolean {
  if (tokenColors.some((color) => !Number.isInteger(payment[color]) || payment[color] < 0 || payment[color] > player.tokens[color])) return false;
  let requiredTotal = 0;
  let coloredTotal = 0;
  for (const color of gemColors) {
    const required = Math.max(0, card.cost[color] - player.bonuses[color]);
    if (payment[color] > required) return false;
    requiredTotal += required;
    coloredTotal += payment[color];
  }
  return coloredTotal + payment.gold === requiredTotal;
}
export function hasLegalSplendorAction(state: SplendorState, seat: SplendorSeat): boolean {
  const available = gemColors.filter((color) => state.supply[color] > 0);
  if (available.length > 0 || gemColors.some((color) => state.supply[color] >= 4)) return true;
  const player = playerFor(state, seat)!;
  if (player.reserved.some((card) => canAffordSplendorCard(player, card))) return true;
  if (([1, 2, 3] as const).some((tier) => state.market[tier].some((card) => canAffordSplendorCard(player, card)))) return true;
  return player.reserved.length < 3 && ([1, 2, 3] as const).some((tier) => state.market[tier].length > 0 || state.decks[tier].length > 0);
}
function finishCompleted(state: SplendorState): SplendorState {
  const ordered = standings(state).sort((a, b) => b.score - a.score || a.purchasedCards - b.purchasedCards);
  const best = ordered[0]!;
  const winners = ordered.filter((item) => item.score === best.score && item.purchasedCards === best.purchasedCards).map((item) => item.seat);
  return { ...state, phase: 'finished', result: { type: 'completed', winners, standings: standings(state) } };
}
export function abortSplendorState(state: SplendorState, reason: Extract<SplendorResult, { type: 'aborted' }>['reason']): SplendorState {
  return { ...state, phase: 'finished', result: { type: 'aborted', reason, standings: standings(state) } };
}
function completeTurn(state: SplendorState): SplendorState {
  const player = playerFor(state, state.turn)!;
  const finalRound = state.finalRound || player.score >= 15;
  const turnIndex = state.players.findIndex((item) => item.seat === state.turn);
  const next = state.players[(turnIndex + 1) % state.players.length]!.seat;
  if (finalRound && next === state.startingPlayer) return finishCompleted({ ...state, finalRound });
  return { ...state, phase: 'action', finalRound, turn: next };
}
function afterMainAction(state: SplendorState): SplendorState {
  if (totalTokens(playerFor(state, state.turn)!.tokens) > 10) return { ...state, phase: 'return-tokens' };
  const eligible = eligibleNobles(state, state.turn);
  if (eligible.length > 1) return { ...state, phase: 'choose-noble' };
  if (eligible.length === 1) {
    const noble = eligible[0]!;
    const player = playerFor(state, state.turn)!;
    player.nobles.push(noble);
    player.score += noble.points;
    state.nobles = state.nobles.filter((item) => item.id !== noble.id);
  }
  return completeTurn(state);
}
function cloneState(state: SplendorState): SplendorState {
  return { ...state, supply: cloneCounts(state.supply), decks: { 1: [...state.decks[1]], 2: [...state.decks[2]], 3: [...state.decks[3]] }, market: { 1: [...state.market[1]], 2: [...state.market[2]], 3: [...state.market[3]] }, nobles: [...state.nobles], players: state.players.map((player) => ({ ...player, tokens: cloneCounts(player.tokens), bonuses: cloneCounts(player.bonuses), purchased: [...player.purchased], reserved: [...player.reserved], nobles: [...player.nobles] })) };
}

export function applySplendorAction(state: SplendorState, actor: SplendorSeat, action: SplendorAction): ApplyResult<SplendorState> {
  if (state.phase === 'finished') return ruleError('GAME_FINISHED', '本局已经结束');
  if (!playerFor(state, actor)) return ruleError('INVALID_SEAT', '玩家座位不存在');
  if (action.type === 'resign') return { ok: true, state: abortSplendorState(state, 'resign') };
  if (actor !== state.turn) return ruleError('NOT_YOUR_TURN', '还没轮到你行动');
  const next = cloneState(state);
  const player = playerFor(next, actor)!;
  if (state.phase === 'return-tokens') {
    if (action.type !== 'returnTokens') return ruleError('MUST_RETURN_TOKENS', '请先归还超出上限的宝石');
    if (tokenColors.some((color) => !Number.isInteger(action.tokens[color]) || action.tokens[color] < 0 || action.tokens[color] > player.tokens[color])) return ruleError('INVALID_RETURN', '归还数量不合法');
    if (totalTokens(action.tokens) !== totalTokens(player.tokens) - 10) return ruleError('INVALID_RETURN_TOTAL', '必须把宝石归还到十枚');
    for (const color of tokenColors) { player.tokens[color] -= action.tokens[color]; next.supply[color] += action.tokens[color]; }
    return { ok: true, state: afterMainAction(next) };
  }
  if (state.phase === 'choose-noble') {
    if (action.type !== 'chooseNoble') return ruleError('MUST_CHOOSE_NOBLE', '请先选择一位贵族');
    const noble = eligibleNobles(next, actor).find((item) => item.id === action.nobleId);
    if (!noble) return ruleError('NOBLE_NOT_ELIGIBLE', '不能选择这位贵族');
    player.nobles.push(noble); player.score += noble.points; next.nobles = next.nobles.filter((item) => item.id !== noble.id);
    return { ok: true, state: completeTurn(next) };
  }
  if (action.type === 'returnTokens' || action.type === 'chooseNoble') return ruleError('WRONG_PHASE', '当前不需要完成这项选择');
  if (action.type === 'pass') {
    if (hasLegalSplendorAction(next, actor)) return ruleError('ACTION_AVAILABLE', '仍有合法行动，不能跳过');
    next.passedInRow += 1;
    if (next.passedInRow >= next.playerCount) return { ok: true, state: abortSplendorState(next, 'stalemate') };
    return { ok: true, state: completeTurn(next) };
  }
  next.passedInRow = 0;
  if (action.type === 'takeTokens') {
    if (action.colors.length === 0) return ruleError('INVALID_TOKEN_SELECTION', '至少需要拿取一种宝石');
    if (action.colors.length === 2 && action.colors[0] === action.colors[1]) {
      const color = action.colors[0]!;
      if (next.supply[color] < 4) return ruleError('INSUFFICIENT_SUPPLY', '拿取前该颜色至少需要四枚');
      next.supply[color] -= 2; player.tokens[color] += 2;
    } else {
      const unique = new Set(action.colors);
      const available = gemColors.filter((color) => next.supply[color] > 0);
      const required = Math.min(3, available.length);
      if (unique.size !== action.colors.length || (required === 3 ? action.colors.length !== 3 : action.colors.length > required) || action.colors.some((color) => !gemColors.includes(color) || next.supply[color] <= 0)) return ruleError('INVALID_TOKEN_SELECTION', required === 3 ? '必须拿取三种不同的可用宝石' : `可拿取一至 ${required} 种不同的可用宝石`);
      for (const color of action.colors) { next.supply[color] -= 1; player.tokens[color] += 1; }
    }
    return { ok: true, state: afterMainAction(next) };
  }
  const located = locateCard(next, actor, action.source);
  if (!located) return ruleError('CARD_NOT_FOUND', '这张发展卡已经不在指定位置');
  if (action.type === 'reserve') {
    if (action.source.kind === 'reserved') return ruleError('INVALID_RESERVE_SOURCE', '不能再次保留手中的牌');
    if (player.reserved.length >= 3) return ruleError('RESERVE_LIMIT', '最多保留三张发展卡');
    located.remove(); located.refill?.(); player.reserved.push(located.card);
    if (next.supply.gold > 0) { next.supply.gold -= 1; player.tokens.gold += 1; }
    return { ok: true, state: afterMainAction(next) };
  }
  if (action.source.kind === 'deck') return ruleError('CANNOT_BUY_HIDDEN_CARD', '不能直接购买牌堆顶牌');
  if (!legalSplendorPayment(player, located.card, action.payment)) return ruleError('INVALID_PAYMENT', '支付组合与卡牌费用不匹配');
  located.remove(); located.refill?.();
  for (const color of tokenColors) { player.tokens[color] -= action.payment[color]; next.supply[color] += action.payment[color]; }
  player.purchased.push(located.card); player.bonuses[located.card.bonus] += 1; player.score += located.card.points;
  return { ok: true, state: afterMainAction(next) };
}

function isTier(value: unknown): value is SplendorTier { return value === 1 || value === 2 || value === 3; }
function isGemColor(value: unknown): value is GemColor { return typeof value === 'string' && gemColors.includes(value as GemColor); }
function parseSource(value: unknown): SplendorCardSource | null {
  if (isExactObject(value, ['kind', 'tier']) && value.kind === 'deck' && isTier(value.tier)) return { kind: 'deck', tier: value.tier };
  if (isExactObject(value, ['kind', 'tier', 'cardId']) && value.kind === 'market' && isTier(value.tier) && typeof value.cardId === 'string' && value.cardId.length <= 16) return { kind: 'market', tier: value.tier, cardId: value.cardId };
  if (isExactObject(value, ['kind', 'cardId']) && value.kind === 'reserved' && typeof value.cardId === 'string' && value.cardId.length <= 16) return { kind: 'reserved', cardId: value.cardId };
  return null;
}
function parseTokenCounts(value: unknown): TokenCounts | null {
  if (!isExactObject(value, tokenColors)) return null;
  if (tokenColors.some((color) => !Number.isInteger(value[color]) || (value[color] as number) < 0 || (value[color] as number) > 10)) return null;
  return value as TokenCounts;
}
export function validateSplendorAction(input: unknown): { ok: true; action: SplendorAction } | { ok: false; message: string } {
  if (isExactObject(input, ['type']) && (input.type === 'pass' || input.type === 'resign')) return { ok: true, action: { type: input.type } };
  if (isExactObject(input, ['type', 'colors']) && input.type === 'takeTokens' && Array.isArray(input.colors) && input.colors.length >= 1 && input.colors.length <= 3 && input.colors.every(isGemColor)) return { ok: true, action: { type: 'takeTokens', colors: input.colors } };
  if (isExactObject(input, ['type', 'source']) && input.type === 'reserve') { const source = parseSource(input.source); if (source) return { ok: true, action: { type: 'reserve', source } }; }
  if (isExactObject(input, ['type', 'source', 'payment']) && input.type === 'purchase') { const source = parseSource(input.source); const payment = parseTokenCounts(input.payment); if (source && payment) return { ok: true, action: { type: 'purchase', source, payment } }; }
  if (isExactObject(input, ['type', 'tokens']) && input.type === 'returnTokens') { const returned = parseTokenCounts(input.tokens); if (returned) return { ok: true, action: { type: 'returnTokens', tokens: returned } }; }
  if (isExactObject(input, ['type', 'nobleId']) && input.type === 'chooseNoble' && typeof input.nobleId === 'string' && input.nobleId.length <= 16) return { ok: true, action: { type: 'chooseNoble', nobleId: input.nobleId } };
  return { ok: false, message: '璀璨宝石操作格式不合法' };
}

export const splendorDefinition: GameDefinition<SplendorState, SplendorAction, SplendorView, SplendorInitialOptions, SplendorSeat, SplendorResult> = {
  id: 'splendor', stateSchemaVersion: 1,
  initialize: createSplendorState,
  validateAction: validateSplendorAction,
  advance: (state, actor, action) => applySplendorAction(state, actor, action),
  viewFor: (state, viewer) => {
    const { decks, players, ...publicState } = state;
    return { ...publicState, players: players.map((player) => ({ seat: player.seat, tokens: player.tokens, bonuses: player.bonuses, purchased: player.purchased, nobles: player.nobles, score: player.score, reservedCount: player.reserved.length, ...(player.seat === viewer ? { reserved: player.reserved } : {}) })), deckCounts: { 1: decks[1].length, 2: decks[2].length, 3: decks[3].length } };
  },
  result: (state) => state.result,
  serialize: JSON.stringify,
  deserialize: (serialized) => JSON.parse(serialized) as SplendorState,
};
