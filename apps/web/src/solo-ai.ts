import {
  applyConnectFourAction, applyReversiAction, legalReversiMoves, otherPlayer, reversiFlips,
  type ConnectFourAction, type ConnectFourState, type DotsAndBoxesAction, type DotsAndBoxesState, type Player, type ReversiAction, type ReversiState,
} from '@gamehall/game-core';
import { chooseDotsMove, dotsHint } from './dots-solo';

export type SoloDifficulty = 'easy' | 'thoughtful';
export type SoloGameId = 'connect-four' | 'reversi' | 'dots-and-boxes';
export type SoloState = ConnectFourState | ReversiState | DotsAndBoxesState;
export type SoloAction = ConnectFourAction | ReversiAction | DotsAndBoxesAction;
export type SoloHint = { action: SoloAction; reason: string };

const FOUR_WINDOWS: number[][] = [];
for (let row = 0; row < 6; row++) for (let col = 0; col < 7; col++) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    if (row + dr * 3 < 6 && col + dc * 3 >= 0 && col + dc * 3 < 7) {
      FOUR_WINDOWS.push(Array.from({ length: 4 }, (_, step) => (row + dr * step) * 7 + col + dc * step));
    }
  }
}

function fourMoves(state: ConnectFourState): number[] {
  return [3, 2, 4, 1, 5, 0, 6].filter((col) => state.board[col] === null);
}

function fourAfter(state: ConnectFourState, col: number): ConnectFourState {
  const result = applyConnectFourAction(state, state.turn, { type: 'drop', col });
  if (!result.ok) throw new Error('invalid AI four move');
  return result.state;
}

function fourScore(state: ConnectFourState, computer: Player): number {
  if (state.result?.type === 'win') return state.result.winner === computer ? 100_000 : -100_000;
  if (state.result?.type === 'draw') return 0;
  let score = 0;
  for (let row = 0; row < 6; row++) {
    const cell = state.board[row * 7 + 3];
    if (cell !== null) score += cell === computer ? 3 : -3;
  }
  for (const window of FOUR_WINDOWS) {
    let own = 0, rival = 0;
    for (const index of window) {
      if (state.board[index] === computer) own++;
      else if (state.board[index] === otherPlayer(computer)) rival++;
    }
    if (own && rival) continue;
    if (own) score += [0, 1, 8, 55, 1_000][own]!;
    if (rival) score -= [0, 1, 8, 70, 1_000][rival]!;
  }
  return score;
}

function fourSearch(state: ConnectFourState, computer: Player, depth: number, alpha: number, beta: number, budget: { nodes: number; limit: number }): number {
  budget.nodes++;
  if (depth === 0 || state.phase === 'finished' || budget.nodes >= budget.limit) return fourScore(state, computer);
  const maximize = state.turn === computer;
  let best = maximize ? -Infinity : Infinity;
  for (const col of fourMoves(state)) {
    const value = fourSearch(fourAfter(state, col), computer, depth - 1, alpha, beta, budget);
    best = maximize ? Math.max(best, value) : Math.min(best, value);
    if (maximize) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (beta <= alpha || budget.nodes >= budget.limit) break;
  }
  return Number.isFinite(best) ? best : fourScore(state, computer);
}

export function chooseConnectFourMove(state: ConnectFourState, difficulty: SoloDifficulty): ConnectFourAction {
  if (state.phase !== 'playing') throw new Error('finished four game');
  const computer = state.turn;
  const moves = fourMoves(state);
  if (!moves.length) throw new Error('no four moves');
  for (const col of moves) {
    const next = fourAfter(state, col);
    if (next.result?.type === 'win' && next.result.winner === computer) return { type: 'drop', col };
  }
  // A single immediate threat must be blocked before looking ahead.
  const rival = otherPlayer(computer);
  const threats = moves.filter((col) => {
    const hypothetical = fourAfter({ ...state, turn: rival }, col);
    return hypothetical.result?.type === 'win' && hypothetical.result.winner === rival;
  });
  if (threats.length === 1) return { type: 'drop', col: threats[0]! };
  const depth = difficulty === 'easy' ? 3 : 5;
  const budget = { nodes: 0, limit: difficulty === 'easy' ? 900 : 6_000 };
  let best = -Infinity, selected = moves[0]!;
  for (const col of moves) {
    const value = fourSearch(fourAfter(state, col), computer, depth - 1, -Infinity, Infinity, budget);
    if (value > best) { best = value; selected = col; }
    if (budget.nodes >= budget.limit) break;
  }
  return { type: 'drop', col: selected };
}

const CORNERS = new Set([0, 7, 56, 63]);
function reversiMoves(state: ReversiState): Array<{ row: number; col: number }> {
  return legalReversiMoves(state.board, state.turn).sort((a, b) => {
    const aIndex = a.row * 8 + a.col, bIndex = b.row * 8 + b.col;
    return Number(CORNERS.has(bIndex)) - Number(CORNERS.has(aIndex)) || aIndex - bIndex;
  });
}

function reversiAfter(state: ReversiState, row: number, col: number): ReversiState {
  const result = applyReversiAction(state, state.turn, { type: 'placeDisc', row, col });
  if (!result.ok) throw new Error('invalid AI reversi move');
  return result.state;
}

function reversiScore(state: ReversiState, computer: Player): number {
  if (state.result?.type === 'win') return state.result.winner === computer ? 100_000 : -100_000;
  if (state.result?.type === 'draw') return 0;
  const rival = otherPlayer(computer);
  let score = (state.counts[computer] - state.counts[rival]) * (state.moveCount > 45 ? 3 : 1);
  for (const corner of CORNERS) {
    const cell = state.board[corner];
    if (cell !== null) score += cell === computer ? 75 : -75;
  }
  score += (legalReversiMoves(state.board, computer).length - legalReversiMoves(state.board, rival).length) * 5;
  return score;
}

function reversiSearch(state: ReversiState, computer: Player, depth: number, alpha: number, beta: number, budget: { nodes: number; limit: number }): number {
  budget.nodes++;
  if (depth === 0 || state.phase === 'finished' || budget.nodes >= budget.limit) return reversiScore(state, computer);
  const maximize = state.turn === computer;
  let best = maximize ? -Infinity : Infinity;
  for (const { row, col } of reversiMoves(state)) {
    const value = reversiSearch(reversiAfter(state, row, col), computer, depth - 1, alpha, beta, budget);
    best = maximize ? Math.max(best, value) : Math.min(best, value);
    if (maximize) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (beta <= alpha || budget.nodes >= budget.limit) break;
  }
  return Number.isFinite(best) ? best : reversiScore(state, computer);
}

export function chooseReversiMove(state: ReversiState, difficulty: SoloDifficulty): ReversiAction {
  if (state.phase !== 'playing') throw new Error('finished reversi game');
  const moves = reversiMoves(state);
  if (!moves.length) throw new Error('no reversi moves');
  const corner = moves.find(({ row, col }) => CORNERS.has(row * 8 + col));
  if (corner) return { type: 'placeDisc', ...corner };
  const computer = state.turn;
  const depth = difficulty === 'easy' ? 2 : 4;
  const budget = { nodes: 0, limit: difficulty === 'easy' ? 600 : 4_000 };
  let best = -Infinity, selected = moves[0]!;
  for (const move of moves) {
    const next = reversiAfter(state, move.row, move.col);
    const immediateFlips = reversiFlips(state.board, computer, move.row, move.col).length;
    const value = reversiSearch(next, computer, depth - 1, -Infinity, Infinity, budget) + immediateFlips * 0.1;
    if (value > best) { best = value; selected = move; }
    if (budget.nodes >= budget.limit) break;
  }
  return { type: 'placeDisc', ...selected };
}

export function chooseSoloMove(state: SoloState, difficulty: SoloDifficulty): SoloAction {
  return state.kind === 'connect-four' ? chooseConnectFourMove(state, difficulty)
    : state.kind === 'reversi' ? chooseReversiMove(state, difficulty) : chooseDotsMove(state, difficulty);
}

export function recommendSoloHint(state: SoloState): SoloHint {
  if (state.phase !== 'playing' || state.turn !== 0) throw new Error('hint requires a human turn');
  if (state.kind === 'dots-and-boxes') return dotsHint(state);
  const action = chooseSoloMove(state, 'thoughtful');
  if (state.kind === 'connect-four') {
    if (action.type !== 'drop') throw new Error('invalid four hint');
    const next = applyConnectFourAction(state, 0, action);
    if (!next.ok) throw new Error('invalid four hint');
    if (next.state.result?.type === 'win') return { action, reason: '这步可以立即连成四子。' };
    const rival = applyConnectFourAction({ ...state, turn: 1 }, 1, action);
    if (rival.ok && rival.state.result?.type === 'win') return { action, reason: '这步能挡住电脑下一手的四连。' };
    return { action, reason: '综合当前局面，建议考虑这一列；你仍可自由落子。' };
  }
  if (action.type !== 'placeDisc') throw new Error('invalid reversi hint');
  const flips = reversiFlips(state.board, 0, action.row, action.col).length;
  if (!flips) throw new Error('invalid reversi hint');
  const corner = (action.row === 0 || action.row === 7) && (action.col === 0 || action.col === 7);
  return { action, reason: corner ? `角位落子可翻转 ${flips} 枚棋子，角位落子后不会再被翻走。` : `这步可以翻转 ${flips} 枚棋子；还可考虑其他合法落点。` };
}
