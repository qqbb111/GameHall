import { describe, expect, it } from 'vitest';
import { applyConnectFourAction, createConnectFourState } from '@gamehall/game-core';
import { choosePuzzleReply, connectFourPuzzles, immediatePuzzleWins, openPuzzleColumns, puzzleLineDirection, puzzleSolutions, replayConnectFourPuzzle } from './connect-four-puzzles';

describe('four-in-a-row tactical puzzle catalog', () => {
  it('has three distinct, reachable boards for each objective and never continues past a win', () => {
    expect(connectFourPuzzles.map((puzzle) => puzzle.kind)).toEqual([
      'win-now', 'win-now', 'win-now', 'defend', 'defend', 'defend', 'win-in-two', 'win-in-two', 'win-in-two',
    ]);
    expect(new Set(connectFourPuzzles.map((puzzle) => puzzle.id)).size).toBe(connectFourPuzzles.length);
    const positions = new Set<string>();
    for (const puzzle of connectFourPuzzles) {
      let state = createConnectFourState(puzzle.firstPlayer);
      for (const col of puzzle.history) {
        expect(state.phase).toBe('playing');
        const step = applyConnectFourAction(state, state.turn, { type: 'drop', col });
        expect(step.ok).toBe(true);
        if (!step.ok) throw Error(puzzle.id);
        expect(step.state.phase).toBe('playing');
        expect(step.state.moveCount).toBe(state.moveCount + 1);
        state = step.state;
      }
      expect(state.turn).toBe(0);
      expect(replayConnectFourPuzzle(puzzle)).toEqual(state);
      positions.add(state.board.join(','));
    }
    expect(positions.size).toBe(connectFourPuzzles.length);
  });

  it.each(connectFourPuzzles)('$id accepts precisely the rule-proven first columns', (puzzle) => {
    const start = replayConnectFourPuzzle(puzzle);
    const solutions = puzzleSolutions(puzzle, start);
    expect(solutions.length).toBeGreaterThan(0);
    if (puzzle.kind === 'win-now') {
      expect(solutions).toEqual(immediatePuzzleWins(start, 0));
      for (const col of openPuzzleColumns(start)) {
        const step = applyConnectFourAction(start, 0, { type: 'drop', col });
        expect(step.ok).toBe(true);
        if (step.ok) expect(solutions.includes(col)).toBe(step.state.result?.type === 'win' && step.state.result.winner === 0);
      }
    } else if (puzzle.kind === 'defend') {
      expect(immediatePuzzleWins(start, 0)).toEqual([]);
      expect(immediatePuzzleWins(start, 1).length).toBeGreaterThan(0);
      for (const col of openPuzzleColumns(start)) {
        const step = applyConnectFourAction(start, 0, { type: 'drop', col });
        expect(step.ok).toBe(true);
        if (step.ok) expect(solutions.includes(col)).toBe(step.state.phase === 'playing' && immediatePuzzleWins(step.state, 1).length === 0);
      }
    } else {
      expect(immediatePuzzleWins(start, 0)).toEqual([]);
      expect(immediatePuzzleWins(start, 1)).toEqual([]);
      for (const col of openPuzzleColumns(start)) {
        const first = applyConnectFourAction(start, 0, { type: 'drop', col });
        expect(first.ok).toBe(true);
        if (!first.ok) continue;
        const allRepliesLeaveAWin = first.state.phase === 'playing' && openPuzzleColumns(first.state).every((reply) => {
          const answered = applyConnectFourAction(first.state, 1, { type: 'drop', col: reply });
          return answered.ok && answered.state.phase === 'playing' && immediatePuzzleWins(answered.state, 0).length > 0;
        });
        expect(solutions.includes(col)).toBe(allRepliesLeaveAWin);
      }
    }
  });

  it('every accepted two-step line has a real opponent reply and a playable finishing move', () => {
    for (const puzzle of connectFourPuzzles.filter((entry) => entry.kind === 'win-in-two')) {
      const start = replayConnectFourPuzzle(puzzle);
      for (const col of puzzleSolutions(puzzle, start)) {
        const first = applyConnectFourAction(start, 0, { type: 'drop', col });
        if (!first.ok) throw Error(puzzle.id);
        const reply = choosePuzzleReply(first.state);
        expect(openPuzzleColumns(first.state)).toContain(reply.col);
        const replayed = applyConnectFourAction(first.state, 1, { type: 'drop', col: reply.col });
        expect(replayed.ok && replayed.state).toEqual(reply.state);
        for (const finishing of immediatePuzzleWins(reply.state, 0)) {
          const end = applyConnectFourAction(reply.state, 0, { type: 'drop', col: finishing });
          expect(end.ok && end.state.result).toMatchObject({ type: 'win', winner: 0, reason: 'line' });
        }
      }
    }
  });

  it('labels horizontal, vertical and diagonal finishes from the actual winning line', () => {
    const expected = ['横向', '竖向', '斜向'];
    connectFourPuzzles.slice(0, 3).forEach((puzzle, index) => {
      const start = replayConnectFourPuzzle(puzzle);
      const finish = applyConnectFourAction(start, 0, { type: 'drop', col: puzzleSolutions(puzzle, start)[0]! });
      if (!finish.ok) throw Error(puzzle.id);
      expect(puzzleLineDirection(finish.state)).toBe(expected[index]);
    });
  });

  it('rejects histories that try to play after a finished board', () => {
    const first = connectFourPuzzles[0]!;
    const win = puzzleSolutions(first)[0]!;
    expect(() => replayConnectFourPuzzle({ ...first, history: [...first.history, win, 0] })).toThrow('invalid puzzle history');
  });
});
