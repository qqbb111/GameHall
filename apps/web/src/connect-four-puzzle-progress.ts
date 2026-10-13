import { applyConnectFourAction, type ConnectFourState } from '@gamehall/game-core';
import { choosePuzzleReply, connectFourPuzzles, immediatePuzzleWins, puzzleSolutions, replayConnectFourPuzzle, type ConnectFourPuzzle } from './connect-four-puzzles';

export const PUZZLE_ATTEMPT_KEY = 'gamehall:connect-four-puzzles:attempt:v1';
export const PUZZLE_COMPLETION_PREFIX = 'gamehall:connect-four-puzzles:solved:v1:';
export type PuzzleCompletion = 'independent' | 'reference';
export type PuzzleAttempt = { version: 1; id: string; moves: number[]; hintUsed: boolean; hintShown: boolean; completed: boolean };

export function mergePuzzleCompletions(...sources: ReadonlyArray<Record<string, PuzzleCompletion>>): Record<string, PuzzleCompletion> {
  const merged: Record<string, PuzzleCompletion> = {};
  for (const source of sources) {
    for (const [id, status] of Object.entries(source)) {
      if (status === 'independent' || merged[id] === undefined) merged[id] = status;
    }
  }
  return merged;
}

export function freshPuzzleAttempt(id = connectFourPuzzles[0]!.id): PuzzleAttempt {
  return { version: 1, id, moves: [], hintUsed: false, hintShown: false, completed: false };
}

export function puzzleAttemptBoard(attempt: PuzzleAttempt): ConnectFourState {
  const puzzle = connectFourPuzzles.find((entry) => entry.id === attempt.id);
  if (!puzzle) throw new Error('unknown puzzle');
  let state = replayConnectFourPuzzle(puzzle);
  if (attempt.moves.length === 0) return state;
  const firstColumn = attempt.moves[0]!;
  if (!puzzleSolutions(puzzle, state).includes(firstColumn)) throw new Error('invalid first move');
  const first = applyConnectFourAction(state, 0, { type: 'drop', col: firstColumn });
  if (!first.ok) throw new Error('invalid first move');
  state = first.state;
  if (puzzle.kind !== 'win-in-two') {
    if (attempt.moves.length !== 1 || !attempt.completed) throw new Error('invalid completed puzzle');
    return state;
  }
  if (attempt.moves.length < 2 || state.phase !== 'playing') throw new Error('invalid two-step puzzle');
  const reply = choosePuzzleReply(state);
  if (attempt.moves[1] !== reply.col) throw new Error('invalid opponent reply');
  state = reply.state;
  if (attempt.moves.length === 2 && !attempt.completed) return state;
  if (attempt.moves.length !== 3 || !attempt.completed || !immediatePuzzleWins(state, 0).includes(attempt.moves[2]!)) throw new Error('invalid finish');
  const finish = applyConnectFourAction(state, 0, { type: 'drop', col: attempt.moves[2]! });
  if (!finish.ok || finish.state.result?.type !== 'win' || finish.state.result.winner !== 0) throw new Error('invalid finish');
  return finish.state;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function decodePuzzleAttempt(raw: string): PuzzleAttempt {
  if (raw.length > 512) throw new Error('puzzle record too large');
  const value: unknown = JSON.parse(raw);
  if (!isExactRecord(value, ['version', 'id', 'moves', 'hintUsed', 'hintShown', 'completed'])
    || value.version !== 1 || typeof value.id !== 'string' || !connectFourPuzzles.some((puzzle) => puzzle.id === value.id)
    || !Array.isArray(value.moves) || value.moves.length > 3 || !value.moves.every((col) => Number.isInteger(col) && col >= 0 && col < 7)
    || typeof value.hintUsed !== 'boolean' || typeof value.hintShown !== 'boolean' || typeof value.completed !== 'boolean'
    || (value.hintShown && (!value.hintUsed || value.completed)) || (value.moves.length === 0 && value.completed)) throw new Error('invalid puzzle record');
  const attempt = value as PuzzleAttempt;
  puzzleAttemptBoard(attempt);
  return attempt;
}

export function readPuzzleAttempt(): { attempt: PuzzleAttempt; warning: string | null } {
  try {
    const raw = window.sessionStorage.getItem(PUZZLE_ATTEMPT_KEY);
    return raw === null ? { attempt: freshPuzzleAttempt(), warning: null } : { attempt: decodePuzzleAttempt(raw), warning: null };
  } catch {
    return { attempt: freshPuzzleAttempt(), warning: '本标签的残局记录无法读取，已从第一关重新开始。' };
  }
}

export function savePuzzleAttempt(attempt: PuzzleAttempt): boolean {
  try {
    window.sessionStorage.setItem(PUZZLE_ATTEMPT_KEY, JSON.stringify(attempt));
    return true;
  } catch { return false; }
}

function completionKey(puzzle: ConnectFourPuzzle, status: PuzzleCompletion): string {
  return `${PUZZLE_COMPLETION_PREFIX}${puzzle.id}:${status}`;
}

export function readPuzzleCompletions(): { completions: Record<string, PuzzleCompletion>; warning: string | null } {
  const completions: Record<string, PuzzleCompletion> = {};
  try {
    let invalid = false;
    for (const puzzle of connectFourPuzzles) {
      const independent = window.localStorage.getItem(completionKey(puzzle, 'independent'));
      const reference = window.localStorage.getItem(completionKey(puzzle, 'reference'));
      if (independent !== null && independent !== '1' || reference !== null && reference !== '1') invalid = true;
      if (independent === '1') completions[puzzle.id] = 'independent';
      else if (reference === '1') completions[puzzle.id] = 'reference';
    }
    return { completions, warning: invalid ? '部分完成记录损坏，已忽略；可以重新完成对应关卡。' : null };
  } catch { return { completions, warning: '浏览器暂不能读取通关记录；本页仍可继续闯关。' }; }
}

export function markPuzzleCompleted(id: string, status: PuzzleCompletion): boolean {
  const puzzle = connectFourPuzzles.find((entry) => entry.id === id);
  if (!puzzle) return false;
  try {
    // Completion markers are additive. Separate keys make other tabs' finished puzzles
    // and independent solutions impossible to overwrite with an older summary.
    window.localStorage.setItem(completionKey(puzzle, status), '1');
    return true;
  } catch { return false; }
}
