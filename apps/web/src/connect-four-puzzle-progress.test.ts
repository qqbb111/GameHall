import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyConnectFourAction } from '@gamehall/game-core';
import { connectFourPuzzles, puzzleSolutions, replayConnectFourPuzzle, choosePuzzleReply, immediatePuzzleWins } from './connect-four-puzzles';
import { decodePuzzleAttempt, freshPuzzleAttempt, markPuzzleCompleted, PUZZLE_ATTEMPT_KEY, PUZZLE_COMPLETION_PREFIX, puzzleAttemptBoard, readPuzzleAttempt, readPuzzleCompletions, savePuzzleAttempt } from './connect-four-puzzle-progress';

describe('independent four-in-a-row puzzle progress', () => {
  afterEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

  it('restores the exact two-step board by replaying the selected puzzle and both real moves', () => {
    const puzzle = connectFourPuzzles.find((entry) => entry.kind === 'win-in-two')!;
    const start = replayConnectFourPuzzle(puzzle);
    const firstColumn = puzzleSolutions(puzzle, start)[0]!;
    const first = applyConnectFourAction(start, 0, { type: 'drop', col: firstColumn });
    if (!first.ok) throw Error('first');
    const reply = choosePuzzleReply(first.state);
    const attempt = { ...freshPuzzleAttempt(puzzle.id), moves: [firstColumn, reply.col], hintUsed: true, hintShown: true };
    expect(savePuzzleAttempt(attempt)).toBe(true);
    const loaded = readPuzzleAttempt();
    expect(loaded).toEqual({ attempt, warning: null });
    expect(puzzleAttemptBoard(loaded.attempt)).toEqual(reply.state);
    const winningColumn = immediatePuzzleWins(reply.state, 0)[0]!;
    const completed = { ...attempt, moves: [...attempt.moves, winningColumn], completed: true, hintShown: false };
    expect(decodePuzzleAttempt(JSON.stringify(completed)).completed).toBe(true);
    expect(puzzleAttemptBoard(completed).result).toMatchObject({ type: 'win', winner: 0 });
  });

  it('rejects invented boards, wrong replies, premature completion and unrelated or oversized records', () => {
    const puzzle = connectFourPuzzles.find((entry) => entry.kind === 'win-in-two')!;
    const firstColumn = puzzleSolutions(puzzle)[0]!;
    const first = applyConnectFourAction(replayConnectFourPuzzle(puzzle), 0, { type: 'drop', col: firstColumn });
    if (!first.ok) throw Error('first');
    const reply = choosePuzzleReply(first.state);
    const valid = { ...freshPuzzleAttempt(puzzle.id), moves: [firstColumn, reply.col] };
    expect(() => decodePuzzleAttempt(JSON.stringify({ ...valid, board: Array(42).fill(0) }))).toThrow();
    expect(() => decodePuzzleAttempt(JSON.stringify({ ...valid, moves: [firstColumn, (reply.col + 1) % 7] }))).toThrow();
    expect(() => decodePuzzleAttempt(JSON.stringify({ ...valid, completed: true }))).toThrow();
    expect(() => decodePuzzleAttempt(JSON.stringify({ ...valid, hintShown: true }))).toThrow();
    expect(() => decodePuzzleAttempt(JSON.stringify({ ...valid, id: 'twenty-four' }))).toThrow();
    expect(() => decodePuzzleAttempt('x'.repeat(513))).toThrow();
    window.sessionStorage.setItem(PUZZLE_ATTEMPT_KEY, JSON.stringify({ ...valid, moves: [6, 6, 6] }));
    const recovered = readPuzzleAttempt();
    expect(recovered.attempt).toEqual(freshPuzzleAttempt());
    expect(recovered.warning).toContain('无法读取');
  });

  it('keeps each solved marker monotonic across tabs and never replaces other practice keys', () => {
    const oldPractice = 'gamehall:solo:connect-four:v1';
    window.localStorage.setItem(oldPractice, 'older practice');
    expect(markPuzzleCompleted('bridge', 'reference')).toBe(true);
    expect(markPuzzleCompleted('tower', 'independent')).toBe(true);
    expect(readPuzzleCompletions().completions).toMatchObject({ bridge: 'reference', tower: 'independent' });
    expect(markPuzzleCompleted('bridge', 'independent')).toBe(true);
    expect(markPuzzleCompleted('bridge', 'reference')).toBe(true);
    expect(readPuzzleCompletions().completions.bridge).toBe('independent');
    expect(window.localStorage.getItem(oldPractice)).toBe('older practice');
    expect(window.localStorage.getItem(`${PUZZLE_COMPLETION_PREFIX}bridge:independent`)).toBe('1');
    expect(window.localStorage.getItem(`${PUZZLE_COMPLETION_PREFIX}tower:independent`)).toBe('1');
  });

  it('surfaces unavailable storage without preventing an in-memory attempt', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked'); });
    expect(savePuzzleAttempt(freshPuzzleAttempt())).toBe(false);
    expect(markPuzzleCompleted('bridge', 'independent')).toBe(false);
  });
});
