import { isExactObject, otherPlayer, ruleError, type ApplyResult, type GameDefinition, type GameResult, type Player } from './types';

export type Suit = 'S' | 'H' | 'D' | 'C';
export type PlayingCard = { id: number; suit: Suit; rank: number };
export type FourCards = [PlayingCard, PlayingCard, PlayingCard, PlayingCard];

type Rational = { numerator: bigint; denominator: bigint };

export type ExpressionValidation =
  | { ok: true; normalized: string }
  | { ok: false; code: string; message: string };

export type TwentyFourState = {
  kind: 'twenty-four';
  phase: 'answering' | 'revealing' | 'finished';
  round: number;
  cards: FourCards;
  canonicalSolution: string;
  scores: [number, number];
  deadlineAtMs: number;
  cooldownUntilMs: [number, number];
  roundOutcome: null | { type: 'correct' | 'timeout'; winner: Player | null; expression?: string };
  winner: Player | null;
  finishReason: null | 'score' | 'resign' | 'disconnect' | 'leave' | 'restart_timeout';
};

export type TwentyFourAction =
  | { type: 'submit'; expression: string }
  | { type: 'resign' };

export type TwentyFourView = Omit<TwentyFourState, 'canonicalSolution'> & { solution: string | null; serverNowMs: number };
export type TwentyFourInitialOptions = {
  cards: FourCards;
  canonicalSolution: string;
  nowMs: number;
  scores?: [number, number];
  round?: number;
};

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = abs(left);
  let b = abs(right);
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error('DIVISION_BY_ZERO');
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator / divisor) * sign, denominator: abs(denominator / divisor) };
}

function add(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}
function subtract(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
}
function multiply(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}
function divide(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.denominator, a.denominator * b.numerator);
}

class ExpressionParser {
  private index = 0;
  private depth = 0;
  readonly numbers: number[] = [];

  constructor(private readonly input: string) {}

  parse(): Rational {
    const value = this.parseAdditive();
    this.skipWhitespace();
    if (this.index !== this.input.length) throw new Error('UNEXPECTED_TOKEN');
    return value;
  }

  private parseAdditive(): Rational {
    let value = this.parseMultiplicative();
    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.index];
      if (operator !== '+' && operator !== '-') return value;
      this.index += 1;
      const right = this.parseMultiplicative();
      value = operator === '+' ? add(value, right) : subtract(value, right);
    }
  }

  private parseMultiplicative(): Rational {
    let value = this.parsePrimary();
    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.index];
      if (operator !== '*' && operator !== '/' && operator !== '×' && operator !== '÷') return value;
      this.index += 1;
      const right = this.parsePrimary();
      try {
        value = operator === '*' || operator === '×' ? multiply(value, right) : divide(value, right);
      } catch {
        throw new Error('DIVISION_BY_ZERO');
      }
    }
  }

  private parsePrimary(): Rational {
    this.skipWhitespace();
    if (this.input[this.index] === '(') {
      this.depth += 1;
      if (this.depth > 16) throw new Error('TOO_DEEP');
      this.index += 1;
      const value = this.parseAdditive();
      this.skipWhitespace();
      if (this.input[this.index] !== ')') throw new Error('MISMATCHED_PARENTHESES');
      this.index += 1;
      this.depth -= 1;
      return value;
    }
    const start = this.index;
    while (this.index < this.input.length && /[0-9]/.test(this.input[this.index]!)) this.index += 1;
    if (start === this.index) throw new Error('NUMBER_EXPECTED');
    const numberText = this.input.slice(start, this.index);
    const value = Number(numberText);
    if (!Number.isInteger(value) || value < 1 || value > 13) throw new Error('CARD_VALUE_INVALID');
    this.numbers.push(value);
    return rational(BigInt(value));
  }

  private skipWhitespace(): void {
    while (this.index < this.input.length && /\s/.test(this.input[this.index]!)) this.index += 1;
  }
}

function sameMultiset(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.every((value, index) => value === b[index]);
}

export function validateTwentyFourExpression(expression: string, ranks: readonly number[]): ExpressionValidation {
  if (expression.length === 0) return { ok: false, code: 'EMPTY_EXPRESSION', message: '请输入算式' };
  if (expression.length > 128) return { ok: false, code: 'EXPRESSION_TOO_LONG', message: '算式过长' };
  try {
    const parser = new ExpressionParser(expression);
    const value = parser.parse();
    if (!sameMultiset(parser.numbers, [...ranks])) {
      return { ok: false, code: 'CARDS_MISMATCH', message: '必须恰好使用题面上的四张牌各一次' };
    }
    if (value.numerator !== 24n * value.denominator) {
      return { ok: false, code: 'NOT_TWENTY_FOUR', message: '这个算式的结果不是 24' };
    }
    return { ok: true, normalized: expression.replaceAll('×', '*').replaceAll('÷', '/') };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_EXPRESSION';
    const messages: Record<string, string> = {
      DIVISION_BY_ZERO: '不能除以零',
      TOO_DEEP: '括号嵌套过深',
      MISMATCHED_PARENTHESES: '括号不匹配',
      CARD_VALUE_INVALID: '牌面数字必须在 1 到 13 之间',
    };
    return { ok: false, code, message: messages[code] ?? '算式格式不合法' };
  }
}

type SolverItem = { value: Rational; expression: string };

function rationalKey(value: Rational): string {
  return `${value.numerator}/${value.denominator}`;
}

function solveItems(items: SolverItem[], visited: Set<string>): string | null {
  if (items.length === 1) {
    const only = items[0]!;
    return only.value.numerator === 24n * only.value.denominator ? only.expression : null;
  }
  const stateKey = items.map((item) => rationalKey(item.value)).sort().join('|');
  if (visited.has(stateKey)) return null;
  visited.add(stateKey);

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i]!;
      const right = items[j]!;
      const rest = items.filter((_, index) => index !== i && index !== j);
      const candidates: SolverItem[] = [
        { value: add(left.value, right.value), expression: `(${left.expression}+${right.expression})` },
        { value: multiply(left.value, right.value), expression: `(${left.expression}*${right.expression})` },
        { value: subtract(left.value, right.value), expression: `(${left.expression}-${right.expression})` },
        { value: subtract(right.value, left.value), expression: `(${right.expression}-${left.expression})` },
      ];
      if (right.value.numerator !== 0n) candidates.push({ value: divide(left.value, right.value), expression: `(${left.expression}/${right.expression})` });
      if (left.value.numerator !== 0n) candidates.push({ value: divide(right.value, left.value), expression: `(${right.expression}/${left.expression})` });
      const candidateKeys = new Set<string>();
      for (const candidate of candidates) {
        const key = rationalKey(candidate.value);
        if (candidateKeys.has(key)) continue;
        candidateKeys.add(key);
        const solution = solveItems([...rest, candidate], visited);
        if (solution) return solution;
      }
    }
  }
  return null;
}

export function solveTwentyFour(ranks: readonly number[]): string | null {
  if (ranks.length !== 4 || ranks.some((rank) => !Number.isInteger(rank) || rank < 1 || rank > 13)) return null;
  return solveItems(ranks.map((rank) => ({ value: rational(BigInt(rank)), expression: String(rank) })), new Set());
}

const suits: Suit[] = ['S', 'H', 'D', 'C'];

export function cardFromId(id: number): PlayingCard {
  if (!Number.isInteger(id) || id < 0 || id >= 52) throw new Error('invalid card id');
  return { id, suit: suits[Math.floor(id / 13)]!, rank: (id % 13) + 1 };
}

export function drawSolvableCards(random: () => number, excludedHands: ReadonlySet<string> = new Set()): { cards: FourCards; solution: string } {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const deck = Array.from({ length: 52 }, (_, id) => id);
    for (let index = deck.length - 1; index > 0; index -= 1) {
      const swapWith = Math.floor(random() * (index + 1));
      [deck[index], deck[swapWith]] = [deck[swapWith]!, deck[index]!];
    }
    const cards = deck.slice(0, 4).map(cardFromId) as FourCards;
    const handKey = cards.map((card) => card.rank).sort((a, b) => a - b).join('-');
    if (excludedHands.has(handKey)) continue;
    const solution = solveTwentyFour(cards.map((card) => card.rank));
    if (solution) return { cards, solution };
  }
  throw new Error('failed to draw a solvable 24-point hand');
}

export function createTwentyFourState(cards: FourCards, canonicalSolution: string, nowMs: number, scores: [number, number] = [0, 0], round = 1): TwentyFourState {
  return {
    kind: 'twenty-four',
    phase: 'answering',
    round,
    cards,
    canonicalSolution,
    scores: [...scores],
    deadlineAtMs: nowMs + 30_000,
    cooldownUntilMs: [0, 0],
    roundOutcome: null,
    winner: null,
    finishReason: null,
  };
}

export function applyTwentyFourAction(state: TwentyFourState, actor: Player, action: TwentyFourAction, nowMs: number): ApplyResult<TwentyFourState> {
  if (state.phase === 'finished') return ruleError('GAME_FINISHED', '本场已经结束');
  if (action.type === 'resign') {
    const winner = otherPlayer(actor);
    return { ok: true, state: { ...state, phase: 'finished', winner, finishReason: 'resign' } };
  }
  if (state.phase !== 'answering') return ruleError('ROUND_CLOSED', '本题已经结束');
  if (nowMs >= state.deadlineAtMs) return ruleError('ROUND_EXPIRED', '本题已经超时');
  if (nowMs < state.cooldownUntilMs[actor]) {
    return ruleError('COOLDOWN', `请等待 ${Math.ceil((state.cooldownUntilMs[actor] - nowMs) / 1000)} 秒再提交`);
  }
  const validation = validateTwentyFourExpression(action.expression, state.cards.map((card) => card.rank));
  if (!validation.ok) {
    const cooldownUntilMs: [number, number] = [...state.cooldownUntilMs];
    cooldownUntilMs[actor] = nowMs + 3_000;
    return {
      ok: false,
      error: { code: validation.code, message: validation.message },
      state: { ...state, cooldownUntilMs },
    };
  }
  const scores: [number, number] = [...state.scores];
  scores[actor] += 1;
  const winner = scores[actor] >= 5 ? actor : null;
  return {
    ok: true,
    state: {
      ...state,
      scores,
      winner,
      finishReason: winner === null ? null : 'score',
      phase: winner === null ? 'revealing' : 'finished',
      roundOutcome: { type: 'correct', winner: actor, expression: validation.normalized },
    },
  };
}

export function applyTwentyFourSubmission(state: TwentyFourState, actor: Player, expression: string, nowMs: number): ApplyResult<TwentyFourState> {
  return applyTwentyFourAction(state, actor, { type: 'submit', expression }, nowMs);
}

export function expireTwentyFourRound(state: TwentyFourState, nowMs: number): TwentyFourState {
  if (state.phase !== 'answering' || nowMs < state.deadlineAtMs) return state;
  return { ...state, phase: 'revealing', roundOutcome: { type: 'timeout', winner: null } };
}

export function startNextTwentyFourRound(state: TwentyFourState, cards: FourCards, solution: string, nowMs: number): TwentyFourState {
  if (state.phase !== 'revealing') throw new Error('round is not ready to advance');
  return createTwentyFourState(cards, solution, nowMs, state.scores, state.round + 1);
}

export function viewTwentyFourState(state: TwentyFourState, nowMs: number): TwentyFourView {
  const { canonicalSolution, ...publicState } = state;
  return { ...publicState, solution: state.phase === 'answering' ? null : canonicalSolution, serverNowMs: nowMs };
}

export function twentyFourResult(state: TwentyFourState): GameResult | null {
  if (state.phase !== 'finished') return null;
  if (state.finishReason === 'restart_timeout') return { type: 'draw' };
  if (state.winner === null) return null;
  const reason = state.finishReason === 'resign'
    ? 'resign'
    : state.finishReason === 'disconnect'
      ? 'disconnect'
      : state.finishReason === 'leave'
        ? 'leave'
      : 'score';
  return { type: 'win', winner: state.winner, reason };
}

export const twentyFourDefinition: GameDefinition<TwentyFourState, TwentyFourAction, TwentyFourView, TwentyFourInitialOptions> = {
  id: 'twenty-four',
  stateSchemaVersion: 2,
  initialize: ({ cards, canonicalSolution, nowMs, scores, round }) => createTwentyFourState(cards, canonicalSolution, nowMs, scores, round),
  validateAction: (input) => {
    if (isExactObject(input, ['type']) && input.type === 'resign') return { ok: true, action: { type: 'resign' } };
    if (isExactObject(input, ['type', 'expression']) && input.type === 'submit' && typeof input.expression === 'string' && input.expression.length <= 128) {
      return { ok: true, action: { type: 'submit', expression: input.expression } };
    }
    return { ok: false, message: '24 点操作格式不合法' };
  },
  advance: (state, actor, action, nowMs) => applyTwentyFourAction(state, actor, action, nowMs),
  viewFor: (state, _viewer, nowMs) => viewTwentyFourState(state, nowMs),
  result: (state) => twentyFourResult(state),
  serialize: (state) => JSON.stringify(state),
  deserialize: (serialized) => {
    const parsed = JSON.parse(serialized) as Omit<TwentyFourState, 'finishReason'> & { finishReason?: TwentyFourState['finishReason'] };
    return {
      ...parsed,
      finishReason: parsed.finishReason ?? (parsed.phase === 'finished' && parsed.winner !== null ? 'score' : null),
    };
  },
};
