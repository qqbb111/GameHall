import {
  applyConnectFourAction, applyReversiAction, applyGomokuAction, legalReversiMoves, otherPlayer, reversiFlips, GOMOKU_SIZE,
  type ConnectFourAction, type ConnectFourState, type DotsAndBoxesAction, type DotsAndBoxesState, type GomokuAction, type GomokuState, type Player, type ReversiAction, type ReversiState,
} from '@gamehall/game-core';
import { chooseDotsMove, dotsHint } from './dots-solo';

export type SoloDifficulty = 'easy' | 'thoughtful';
export type SoloGameId = 'connect-four' | 'reversi' | 'dots-and-boxes' | 'gomoku';
export type SoloState = ConnectFourState | ReversiState | DotsAndBoxesState | GomokuState;
export type SoloAction = ConnectFourAction | ReversiAction | DotsAndBoxesAction | GomokuAction;
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

function gomokuCandidates(state: GomokuState): Array<{ row: number; col: number }> {
  if (state.moveCount === 0) return [{ row: 7, col: 7 }];
  const moves: Array<{ row: number; col: number; distance: number }> = [];
  for (let row = 0; row < GOMOKU_SIZE; row++) for (let col = 0; col < GOMOKU_SIZE; col++) {
    if (state.board[row * GOMOKU_SIZE + col] !== null) continue;
    let nearby = false;
    for (let dr = -2; dr <= 2 && !nearby; dr++) for (let dc = -2; dc <= 2; dc++) {
      const r = row + dr, c = col + dc;
      if (r >= 0 && r < GOMOKU_SIZE && c >= 0 && c < GOMOKU_SIZE && state.board[r * GOMOKU_SIZE + c] !== null) nearby = true;
    }
    if (nearby) moves.push({ row, col, distance: Math.abs(row - 7) + Math.abs(col - 7) });
  }
  return moves.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
}

function gomokuAfter(state: GomokuState, actor: Player, row: number, col: number): GomokuState {
  const result = applyGomokuAction({ ...state, turn: actor }, actor, { type: 'place', row, col });
  if (!result.ok) throw new Error('invalid gomoku move');
  return result.state;
}

function gomokuPotential(state: GomokuState, actor: Player, row: number, col: number): number {
  let score = 0;
  for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let count = 1, open = 0;
    for (const sign of [-1, 1]) {
      let r = row + dr! * sign, c = col + dc! * sign;
      while (r >= 0 && r < 15 && c >= 0 && c < 15 && state.board[r * 15 + c] === actor) {
        count++; r += dr! * sign; c += dc! * sign;
      }
      if (r >= 0 && r < 15 && c >= 0 && c < 15 && state.board[r * 15 + c] === null) open++;
    }
    score += count >= 5 ? 100_000 : count === 4 ? (open === 2 ? 8_000 : 1_500)
      : count === 3 ? (open === 2 ? 500 : 90) : count === 2 ? (open === 2 ? 28 : 7) : 0;
  }
  return score;
}

export function chooseGomokuMove(state: GomokuState, difficulty: SoloDifficulty): GomokuAction {
  if (state.phase !== 'playing') throw new Error('finished gomoku game');
  const moves = gomokuCandidates(state);
  if (!moves.length) throw new Error('no gomoku moves');
  const actor = state.turn, rival = otherPlayer(actor);
  for (const move of moves) if (gomokuAfter(state, actor, move.row, move.col).result?.type === 'win') return { type: 'place', row: move.row, col: move.col };
  for (const move of moves) if (gomokuAfter(state, rival, move.row, move.col).result?.type === 'win') return { type: 'place', row: move.row, col: move.col };
  let selected = moves[0]!, best = -Infinity;
  // Fixed candidate and reply limits keep the worker responsive even late in a long game.
  for (const move of moves.slice(0, difficulty === 'easy' ? 32 : 64)) {
    const next = gomokuAfter(state, actor, move.row, move.col);
    let value = gomokuPotential(next, actor, move.row, move.col) + gomokuPotential(next, rival, move.row, move.col) * .65;
    if (difficulty === 'thoughtful') {
      const reply = gomokuCandidates(next).slice(0, 40);
      let worst = 0;
      for (const candidate of reply) {
        const after = gomokuAfter(next, rival, candidate.row, candidate.col);
        worst = Math.max(worst, after.result?.type === 'win' ? 100_000 : gomokuPotential(after, rival, candidate.row, candidate.col));
      }
      value -= worst * .8;
    }
    if (value > best) { best = value; selected = move; }
  }
  return { type: 'place', row: selected.row, col: selected.col };
}

export function chooseSoloMove(state: SoloState, difficulty: SoloDifficulty): SoloAction {
  return state.kind === 'connect-four' ? chooseConnectFourMove(state, difficulty)
    : state.kind === 'reversi' ? chooseReversiMove(state, difficulty)
      : state.kind === 'gomoku' ? chooseGomokuMove(state, difficulty) : chooseDotsMove(state, difficulty);
}

export function recommendSoloHint(state: SoloState): SoloHint {
  if (state.phase !== 'playing' || state.turn !== 0) throw new Error('hint requires a human turn');
  if (state.kind === 'dots-and-boxes') return dotsHint(state);
  if (state.kind === 'gomoku') {
    const action = chooseGomokuMove(state, 'thoughtful');
    if (action.type !== 'place') throw new Error('invalid gomoku hint');
    if (gomokuAfter(state, 0, action.row, action.col).result?.type === 'win') return { action, reason: '这步可以立即连成五子。' };
    if (gomokuAfter(state, 1, action.row, action.col).result?.type === 'win') return { action, reason: '这步能挡住电脑下一手的五连。' };
    return { action, reason: '这里兼顾连线和阻挡；你仍可自由落子。' };
  }
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
