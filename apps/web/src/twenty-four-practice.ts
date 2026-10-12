import { cardFromId, validateTwentyFourExpression, type FourCards } from '@gamehall/game-core';
import { solutionSteps } from './twenty-four-hints';

export type TwentyFourMode = 'practice' | 'challenge';
export type Hand = { cards: FourCards; solution: string };
export type Answer = { kind: 'independent' | 'assisted' | 'revealed'; expression: string | null; hints: number };
export type TwentyFourProgress = {
  mode: TwentyFourMode; pack: Hand[]; index: number; phase: 'playing' | 'answered' | 'finished';
  finishReason: null | 'complete' | 'time'; answers: Answer[]; draft: string; hints: number; remainingMs: number;
};
export const TWENTY_FOUR_MAX_BYTES = 16_384;

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(',') === keys.sort().join(',');
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validHand(value: unknown): value is Hand {
  if (!object(value) || !exactKeys(value, ['cards', 'solution']) || !Array.isArray(value.cards) || value.cards.length !== 4
      || typeof value.solution !== 'string' || value.solution.length > 128) return false;
  const ids = new Set<number>();
  for (const card of value.cards) {
    if (!object(card) || !exactKeys(card, ['id', 'suit', 'rank']) || !Number.isInteger(card.id)) return false;
    let actual;
    try { actual = cardFromId(card.id as number); } catch { return false; }
    if (ids.has(actual.id) || card.suit !== actual.suit || card.rank !== actual.rank) return false;
    ids.add(actual.id);
  }
  const ranks = (value.cards as FourCards).map((card) => card.rank);
  if (!validateTwentyFourExpression(value.solution, ranks).ok) return false;
  try { return solutionSteps(value.solution).length === 3; } catch { return false; }
}
export function validTwentyFourProgress(value: unknown): value is TwentyFourProgress {
  if (!object(value) || !exactKeys(value, ['mode', 'pack', 'index', 'phase', 'finishReason', 'answers', 'draft', 'hints', 'remainingMs'])
      || !['practice', 'challenge'].includes(value.mode as string) || !Array.isArray(value.pack) || value.pack.length !== 10
      || !Array.isArray(value.answers) || value.answers.length > 10 || !Number.isInteger(value.index) || (value.index as number) < 0 || (value.index as number) > 10
      || !['playing', 'answered', 'finished'].includes(value.phase as string)
      || typeof value.draft !== 'string' || value.draft.length > 128 || !Number.isInteger(value.hints) || (value.hints as number) < 0 || (value.hints as number) > 3
      || !Number.isInteger(value.remainingMs) || (value.remainingMs as number) < 0 || (value.remainingMs as number) > 60_000) return false;
  const hands = new Set<string>();
  for (const hand of value.pack) {
    if (!validHand(hand)) return false;
    const key = hand.cards.map((card) => card.rank).sort((a, b) => a - b).join('-');
    if (hands.has(key)) return false;
    hands.add(key);
  }
  for (let i = 0; i < value.answers.length; i++) {
    const answer = value.answers[i];
    if (!object(answer) || !exactKeys(answer, ['kind', 'expression', 'hints']) || !['independent', 'assisted', 'revealed'].includes(answer.kind as string)
        || !Number.isInteger(answer.hints) || (answer.hints as number) < 0 || (answer.hints as number) > 3) return false;
    if (answer.kind === 'revealed') { if (answer.expression !== null) return false; }
    else if (typeof answer.expression !== 'string' || !validateTwentyFourExpression(answer.expression, (value.pack[i] as Hand).cards.map((card) => card.rank)).ok) return false;
    if (answer.kind === 'independent' && answer.hints !== 0 || answer.kind === 'assisted' && answer.hints === 0) return false;
  }
  const index = value.index as number;
  const phase = value.phase;
  if (value.mode === 'practice' && value.remainingMs !== 60_000) return false;
  if (phase === 'playing' && (index >= 10 || value.answers.length !== index || value.finishReason !== null)) return false;
  if (phase === 'answered' && (index >= 10 || value.answers.length !== index + 1 || value.finishReason !== null)) return false;
  if (phase === 'answered' && (value.answers[index] as Answer).kind !== 'revealed' && value.draft !== (value.answers[index] as Answer).expression) return false;
  if (phase === 'finished') {
    if (index !== value.answers.length || value.draft !== '' || value.hints !== 0) return false;
    if (value.finishReason === 'complete' && (index !== 10 || value.mode === 'challenge' && value.remainingMs === 0)) return false;
    if (value.finishReason === 'time' && (value.mode !== 'challenge' || value.remainingMs !== 0)) return false;
    if (value.finishReason !== 'complete' && value.finishReason !== 'time') return false;
  } else if (value.mode === 'challenge' && value.remainingMs === 0) return false;
  if (phase === 'playing' && (value.hints as number) > 0 && value.draft.length > 128) return false;
  if (phase !== 'playing' && value.hints !== 0) return false;
  return true;
}
export function encodeTwentyFourProgress(progress: TwentyFourProgress): string {
  if (!validTwentyFourProgress(progress)) throw new Error('invalid 24-point progress');
  const serialized = JSON.stringify({ version: 1, ...progress });
  if (new TextEncoder().encode(serialized).byteLength > TWENTY_FOUR_MAX_BYTES) throw new Error('24-point progress too large');
  return serialized;
}
export function decodeTwentyFourProgress(serialized: string): TwentyFourProgress {
  if (new TextEncoder().encode(serialized).byteLength > TWENTY_FOUR_MAX_BYTES) throw new Error('24-point progress too large');
  const value: unknown = JSON.parse(serialized);
  if (!object(value) || value.version !== 1) throw new Error('invalid 24-point progress');
  const { version: _version, ...progress } = value;
  void _version;
  if (!validTwentyFourProgress(progress)) throw new Error('invalid 24-point progress');
  return progress;
}
export function newTwentyFourProgress(mode: TwentyFourMode, pack: Hand[]): TwentyFourProgress {
  const progress: TwentyFourProgress = { mode, pack, index: 0, phase: 'playing', finishReason: null,
    answers: [], draft: '', hints: 0, remainingMs: 60_000 };
  if (!validTwentyFourProgress(progress)) throw new Error('invalid generated 24-point pack');
  return progress;
}
export function answerSummary(progress: TwentyFourProgress) {
  return { solved: progress.answers.filter((answer) => answer.kind !== 'revealed').length,
    independent: progress.answers.filter((answer) => answer.kind === 'independent').length,
    assisted: progress.answers.filter((answer) => answer.kind === 'assisted').length,
    revealed: progress.answers.filter((answer) => answer.kind === 'revealed').length };
}
export function tickChallenge(progress: TwentyFourProgress, elapsedMs: number): TwentyFourProgress {
  if (progress.mode !== 'challenge' || progress.phase === 'finished') return progress;
  const remainingMs = Math.max(0, Math.ceil(progress.remainingMs - Math.max(0, elapsedMs)));
  if (remainingMs > 0) return { ...progress, remainingMs };
  return { ...progress, remainingMs: 0, index: progress.answers.length, phase: 'finished', finishReason: 'time', draft: '', hints: 0 };
}
