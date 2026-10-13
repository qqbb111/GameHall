import { applyConnectFourAction, createConnectFourState, type ConnectFourState, type Player } from '@gamehall/game-core';

export type PuzzleKind = 'win-now' | 'defend' | 'win-in-two';
export type ConnectFourPuzzle = {
  id: string;
  title: string;
  kind: PuzzleKind;
  firstPlayer: Player;
  history: readonly number[];
};

// The board is never stored as a fixture: every column here is replayed through the core rules.
export const connectFourPuzzles: readonly ConnectFourPuzzle[] = [
  { id: 'bridge', title: '补上横线', kind: 'win-now', firstPlayer: 0, history: [3, 6, 6, 0, 4, 5, 1, 6] },
  { id: 'tower', title: '向上连珠', kind: 'win-now', firstPlayer: 0, history: [3, 5, 4, 6, 5, 3, 1, 6, 1, 6, 4, 0, 1, 2] },
  { id: 'diagonal', title: '斜线收官', kind: 'win-now', firstPlayer: 0, history: [2, 3, 3, 1, 0, 5, 1, 2, 2, 2, 1, 6, 3, 1] },
  { id: 'gate', title: '守住缺口', kind: 'defend', firstPlayer: 0, history: [1, 6, 6, 5, 5, 4, 0, 0] },
  { id: 'cross', title: '看清交点', kind: 'defend', firstPlayer: 1, history: [4, 2, 2, 3, 5, 3, 2, 4, 1, 4, 4] },
  { id: 'edge', title: '边线警报', kind: 'defend', firstPlayer: 0, history: [5, 0, 3, 5, 6, 4, 0, 5, 2, 3, 2, 3, 0, 4] },
  { id: 'fork', title: '先造机会', kind: 'win-in-two', firstPlayer: 0, history: [3, 1, 6, 4, 3, 3, 1, 6, 0, 2] },
  { id: 'ladder', title: '下一手的空间', kind: 'win-in-two', firstPlayer: 0, history: [6, 3, 6, 4, 5, 0, 0, 0, 0, 6, 2, 0, 4, 1, 2, 0] },
  { id: 'choice', title: '两路都能赢', kind: 'win-in-two', firstPlayer: 1, history: [6, 0, 0, 4, 5, 2, 6, 6, 0, 0, 2, 1, 4, 4, 3, 5, 0, 5, 0] },
];

export function replayConnectFourPuzzle(puzzle: ConnectFourPuzzle): ConnectFourState {
  let state = createConnectFourState(puzzle.firstPlayer);
  for (const col of puzzle.history) {
    const step = applyConnectFourAction(state, state.turn, { type: 'drop', col });
    if (!step.ok || step.state.phase !== 'playing') throw new Error(`invalid puzzle history: ${puzzle.id}`);
    state = step.state;
  }
  if (state.turn !== 0 || state.moveCount !== puzzle.history.length || state.phase !== 'playing') throw new Error(`invalid puzzle turn: ${puzzle.id}`);
  return state;
}

export function openPuzzleColumns(state: ConnectFourState): number[] {
  return Array.from({ length: 7 }, (_, col) => col).filter((col) => state.board[col] === null);
}

export function immediatePuzzleWins(state: ConnectFourState, player: Player): number[] {
  if (state.phase !== 'playing') return [];
  // A tactical threat asks what this player could do if they moved next; the real board remains untouched.
  const probe = player === state.turn ? state : { ...state, turn: player };
  return openPuzzleColumns(state).filter((col) => {
    const step = applyConnectFourAction(probe, player, { type: 'drop', col });
    return step.ok && step.state.result?.type === 'win' && step.state.result.winner === player;
  });
}

export function puzzleSolutions(puzzle: ConnectFourPuzzle, state = replayConnectFourPuzzle(puzzle)): number[] {
  const ownWins = immediatePuzzleWins(state, 0);
  if (puzzle.kind === 'win-now') return ownWins;
  const enemyWins = immediatePuzzleWins(state, 1);
  if (ownWins.length || (puzzle.kind === 'defend' && !enemyWins.length) || (puzzle.kind === 'win-in-two' && enemyWins.length)) return [];
  return openPuzzleColumns(state).filter((col) => {
    const first = applyConnectFourAction(state, 0, { type: 'drop', col });
    if (!first.ok || first.state.phase !== 'playing') return false;
    if (puzzle.kind === 'defend') return immediatePuzzleWins(first.state, 1).length === 0;
    return openPuzzleColumns(first.state).every((reply) => {
      const answered = applyConnectFourAction(first.state, 1, { type: 'drop', col: reply });
      return answered.ok && answered.state.phase === 'playing' && immediatePuzzleWins(answered.state, 0).length > 0;
    });
  });
}

export function choosePuzzleReply(state: ConnectFourState): { col: number; state: ConnectFourState } {
  if (state.phase !== 'playing' || state.turn !== 1) throw new Error('opponent cannot reply');
  const replies = openPuzzleColumns(state).map((col) => {
    const step = applyConnectFourAction(state, 1, { type: 'drop', col });
    if (!step.ok || step.state.phase !== 'playing') throw new Error('puzzle reply must stay playable');
    return { col, state: step.state, wins: immediatePuzzleWins(step.state, 0).length };
  });
  replies.sort((a, b) => a.wins - b.wins || Math.abs(a.col - 3) - Math.abs(b.col - 3) || a.col - b.col);
  const chosen = replies[0];
  if (!chosen) throw new Error('puzzle has no reply');
  return { col: chosen.col, state: chosen.state };
}

export function puzzleLineDirection(state: ConnectFourState): '横向' | '竖向' | '斜向' {
  const rows = new Set(state.winningLine.map((cell) => cell.row));
  const cols = new Set(state.winningLine.map((cell) => cell.col));
  return rows.size === 1 ? '横向' : cols.size === 1 ? '竖向' : '斜向';
}
