import { isExactObject, otherPlayer, ruleError, type ApplyResult, type GameDefinition, type GameResult, type Player } from './types';

export const REVERSI_SIZE = 8;
type Cell = Player | null;
export type ReversiState = {
  kind: 'reversi'; phase: 'playing' | 'finished'; board: Cell[];
  blackPlayer: Player; turn: Player; moveCount: number;
  lastMove: { row: number; col: number; player: Player } | null;
  lastFlipped: Array<{ row: number; col: number }>;
  lastPass: Player | null;
  counts: [number, number]; result: GameResult | null;
};
export type ReversiAction = { type: 'placeDisc'; row: number; col: number } | { type: 'resign' };
const directions = [-1, 0, 1].flatMap((dr) => [-1, 0, 1].filter((dc) => dr !== 0 || dc !== 0).map((dc) => [dr, dc] as const));
function inside(row: number, col: number): boolean { return row >= 0 && row < 8 && col >= 0 && col < 8; }
function at(row: number, col: number): number { return row * 8 + col; }

export function createReversiState(blackPlayer: Player): ReversiState {
  const board = Array<Cell>(64).fill(null);
  board[at(3, 3)] = otherPlayer(blackPlayer); board[at(4, 4)] = otherPlayer(blackPlayer);
  board[at(3, 4)] = blackPlayer; board[at(4, 3)] = blackPlayer;
  return { kind: 'reversi', phase: 'playing', board, blackPlayer, turn: blackPlayer, moveCount: 0,
    lastMove: null, lastFlipped: [], lastPass: null, counts: [2, 2], result: null };
}

export function reversiFlips(board: Cell[], player: Player, row: number, col: number): Array<{ row: number; col: number }> {
  if (!Number.isInteger(row) || !Number.isInteger(col) || !inside(row, col) || board[at(row, col)] !== null) return [];
  const flipped: Array<{ row: number; col: number }> = [];
  for (const [dr, dc] of directions) {
    const line: Array<{ row: number; col: number }> = [];
    let r = row + dr, c = col + dc;
    while (inside(r, c) && board[at(r, c)] === otherPlayer(player)) {
      line.push({ row: r, col: c }); r += dr; c += dc;
    }
    if (line.length > 0 && inside(r, c) && board[at(r, c)] === player) flipped.push(...line);
  }
  return flipped;
}

export function legalReversiMoves(board: Cell[], player: Player): Array<{ row: number; col: number }> {
  const moves: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    if (reversiFlips(board, player, row, col).length > 0) moves.push({ row, col });
  }
  return moves;
}

export function applyReversiAction(state: ReversiState, actor: Player, action: ReversiAction): ApplyResult<ReversiState> {
  if (state.phase !== 'playing') return ruleError('GAME_FINISHED', '本局已经结束');
  if (action.type === 'resign') return { ok: true, state: { ...state, phase: 'finished', result: { type: 'win', winner: otherPlayer(actor), reason: 'resign' } } };
  if (actor !== state.turn) return ruleError('NOT_YOUR_TURN', '还没轮到你落子');
  if (!Number.isInteger(action.row) || !Number.isInteger(action.col) || !inside(action.row, action.col)) return ruleError('OUT_OF_BOUNDS', '落子位置超出棋盘');
  if (state.board[at(action.row, action.col)] !== null) return ruleError('OCCUPIED', '这里已经有棋子');
  const flips = reversiFlips(state.board, actor, action.row, action.col);
  if (flips.length === 0) return ruleError('NO_CAPTURE', '这一步无法夹住对方棋子');
  const board = [...state.board]; board[at(action.row, action.col)] = actor;
  for (const cell of flips) board[at(cell.row, cell.col)] = actor;
  const counts: [number, number] = [0, 0];
  for (const cell of board) if (cell !== null) counts[cell]++;
  const opponent = otherPlayer(actor);
  const opponentMoves = legalReversiMoves(board, opponent);
  const ownMoves = opponentMoves.length ? [] : legalReversiMoves(board, actor);
  const finished = counts[0] + counts[1] === 64 || (opponentMoves.length === 0 && ownMoves.length === 0);
  const winner: Player | null = counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1;
  return { ok: true, state: { ...state, board, counts, moveCount: state.moveCount + 1,
    lastMove: { row: action.row, col: action.col, player: actor }, lastFlipped: flips,
    lastPass: !finished && opponentMoves.length === 0 ? opponent : null,
    turn: !finished && opponentMoves.length > 0 ? opponent : actor,
    phase: finished ? 'finished' : 'playing',
    result: finished ? winner === null ? { type: 'draw' } : { type: 'win', winner, reason: 'score' } : null,
  } };
}

function decode(serialized: string): ReversiState {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object') throw new Error('invalid reversi state');
  const state = value as ReversiState;
  if (state.kind !== 'reversi' || !['playing', 'finished'].includes(state.phase) || !Array.isArray(state.board) || state.board.length !== 64
      || !state.board.every((cell) => cell === null || cell === 0 || cell === 1) || ![0, 1].includes(state.blackPlayer) || ![0, 1].includes(state.turn)
      || !Number.isInteger(state.moveCount) || state.moveCount < 0 || state.moveCount > 60
      || !Array.isArray(state.counts) || state.counts.length !== 2 || state.counts.some((count) => !Number.isInteger(count) || count < 0)
      || state.counts[0] !== state.board.filter((cell) => cell === 0).length || state.counts[1] !== state.board.filter((cell) => cell === 1).length
      || !Array.isArray(state.lastFlipped) || !state.lastFlipped.every((cell) => cell && Number.isInteger(cell.row) && Number.isInteger(cell.col) && inside(cell.row, cell.col))
      || (state.lastMove !== null && (!state.lastMove || !Number.isInteger(state.lastMove.row) || !Number.isInteger(state.lastMove.col) || !inside(state.lastMove.row, state.lastMove.col)))
      || ![0, 1, null].includes(state.lastPass) || (state.phase === 'playing') !== (state.result === null)) throw new Error('invalid reversi state');
  return state;
}

export const reversiDefinition: GameDefinition<ReversiState, ReversiAction, ReversiState, Player> = {
  id: 'reversi', stateSchemaVersion: 1, initialize: createReversiState,
  validateAction: (input) => {
    if (isExactObject(input, ['type']) && input.type === 'resign') return { ok: true, action: { type: 'resign' } };
    if (isExactObject(input, ['type', 'row', 'col']) && input.type === 'placeDisc' && Number.isInteger(input.row) && Number.isInteger(input.col))
      return { ok: true, action: { type: 'placeDisc', row: input.row as number, col: input.col as number } };
    return { ok: false, message: '黑白棋操作格式不合法' };
  },
  advance: applyReversiAction, viewFor: (state) => state, result: (state) => state.result,
  serialize: JSON.stringify, deserialize: decode,
};
