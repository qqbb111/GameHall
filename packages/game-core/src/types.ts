export type Player = 0 | 1;

export function requireBinaryPlayer(seat: number): Player {
  if (seat === 0 || seat === 1) return seat;
  throw new Error('binary game contains invalid seat');
}

export type GameResult =
  | { type: 'win'; winner: Player; reason: 'line' | 'goal' | 'score' | 'resign' | 'disconnect' | 'leave' }
  | { type: 'draw' };

export type RuleError = {
  code: string;
  message: string;
};

export type ApplyResult<State> =
  | { ok: true; state: State }
  | { ok: false; error: RuleError; state?: State };

export type ActionValidation<Action> =
  | { ok: true; action: Action }
  | { ok: false; message: string };

export interface GameDefinition<State, Action, View, InitialOptions, Actor = Player, Result = GameResult> {
  readonly id: string;
  readonly stateSchemaVersion: number;
  initialize(options: InitialOptions): State;
  validateAction(input: unknown): ActionValidation<Action>;
  advance(state: State, actor: Actor, action: Action, nowMs: number): ApplyResult<State>;
  viewFor(state: State, viewer: Actor, nowMs: number): View;
  result(state: State): Result | null;
  serialize(state: State): string;
  deserialize(serialized: string): State;
}

export function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function otherPlayer(player: Player): Player {
  return player === 0 ? 1 : 0;
}

export function ruleError<State>(code: string, message: string): ApplyResult<State> {
  return { ok: false, error: { code, message } };
}
