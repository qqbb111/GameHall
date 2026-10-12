import { isExactObject, otherPlayer, ruleError, type ApplyResult, type GameDefinition, type GameResult, type Player } from './types';

export const CONNECT_FOUR_ROWS = 6;
export const CONNECT_FOUR_COLS = 7;
type Cell = Player | null;
export type ConnectFourState = {
  kind: 'connect-four';
  phase: 'playing' | 'finished';
  board: Cell[];
  firstPlayer: Player;
  turn: Player;
  moveCount: number;
  lastMove: { row: number; col: number; player: Player } | null;
  winningLine: Array<{ row: number; col: number }>;
  result: GameResult | null;
};
export type ConnectFourAction = { type: 'drop'; col: number } | { type: 'resign' };

export function createConnectFourState(firstPlayer: Player): ConnectFourState {
  return { kind: 'connect-four', phase: 'playing', board: Array<Cell>(42).fill(null), firstPlayer, turn: firstPlayer, moveCount: 0, lastMove: null, winningLine: [], result: null };
}

function at(row: number, col: number): number { return row * CONNECT_FOUR_COLS + col; }
function inside(row: number, col: number): boolean { return row >= 0 && row < CONNECT_FOUR_ROWS && col >= 0 && col < CONNECT_FOUR_COLS; }
function line(board: Cell[], row: number, col: number, player: Player): Array<{ row: number; col: number }> {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const cells = [{ row, col }];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (inside(r, c) && board[at(r, c)] === player) {
        cells.push({ row: r, col: c }); r += dr * sign; c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return [];
}

export function applyConnectFourAction(state: ConnectFourState, actor: Player, action: ConnectFourAction): ApplyResult<ConnectFourState> {
  if (state.phase !== 'playing') return ruleError('GAME_FINISHED', '本局已经结束');
  if (action.type === 'resign') return { ok: true, state: { ...state, phase: 'finished', result: { type: 'win', winner: otherPlayer(actor), reason: 'resign' } } };
  if (actor !== state.turn) return ruleError('NOT_YOUR_TURN', '还没轮到你落子');
  if (!Number.isInteger(action.col) || action.col < 0 || action.col >= CONNECT_FOUR_COLS) return ruleError('OUT_OF_BOUNDS', '列号超出棋盘');
  let row = CONNECT_FOUR_ROWS - 1;
  while (row >= 0 && state.board[at(row, action.col)] !== null) row--;
  if (row < 0) return ruleError('COLUMN_FULL', '这一列已经放满');
  const board = [...state.board]; board[at(row, action.col)] = actor;
  const moveCount = state.moveCount + 1;
  const winningLine = line(board, row, action.col, actor);
  return { ok: true, state: { ...state, board, moveCount, lastMove: { row, col: action.col, player: actor }, winningLine,
    turn: winningLine.length || moveCount === 42 ? actor : otherPlayer(actor),
    phase: winningLine.length || moveCount === 42 ? 'finished' : 'playing',
    result: winningLine.length ? { type: 'win', winner: actor, reason: 'line' } : moveCount === 42 ? { type: 'draw' } : null,
  } };
}

function decode(serialized: string): ConnectFourState {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object') throw new Error('invalid connect-four state');
  const state = value as ConnectFourState;
  if (state.kind !== 'connect-four' || !Array.isArray(state.board) || state.board.length !== 42 || !state.board.every((cell) => cell === null || cell === 0 || cell === 1)
      || ![0, 1].includes(state.firstPlayer) || ![0, 1].includes(state.turn) || !Number.isInteger(state.moveCount) || state.moveCount < 0 || state.moveCount > 42
      || state.board.filter((cell) => cell !== null).length !== state.moveCount || !['playing', 'finished'].includes(state.phase)
      || (state.phase === 'playing') !== (state.result === null)) throw new Error('invalid connect-four state');
  if (state.moveCount > 0 && state.lastMove === null) throw new Error('invalid connect-four last move');
  if (state.lastMove !== null && (!state.lastMove || !Number.isInteger(state.lastMove.row) || !Number.isInteger(state.lastMove.col)
      || !inside(state.lastMove.row, state.lastMove.col) || ![0, 1].includes(state.lastMove.player)
      || state.board[at(state.lastMove.row, state.lastMove.col)] !== state.lastMove.player)) throw new Error('invalid connect-four last move');
  if (!Array.isArray(state.winningLine) || !state.winningLine.every((cell) => cell && Number.isInteger(cell.row) && Number.isInteger(cell.col) && inside(cell.row, cell.col))) throw new Error('invalid connect-four winning line');
  if (state.result !== null && (state.result.type === 'win' ? ![0, 1].includes(state.result.winner) : state.result.type !== 'draw')) throw new Error('invalid connect-four result');
  if (state.phase === 'playing' && (state.turn !== (state.moveCount % 2 === 0 ? state.firstPlayer : otherPlayer(state.firstPlayer))
      || state.winningLine.length > 0)) throw new Error('invalid connect-four turn');
  const winner = state.result?.type === 'win' && state.result.reason === 'line' ? state.result.winner : null;
  if (winner !== null && (state.winningLine.length < 4 || state.winningLine.some((cell) => state.board[at(cell.row, cell.col)] !== winner))) throw new Error('invalid connect-four winner');
  for (let col = 0; col < 7; col++) {
    let gap = false;
    for (let row = 5; row >= 0; row--) {
      if (state.board[at(row, col)] === null) gap = true;
      else if (gap) throw new Error('invalid connect-four gravity');
    }
  }
  return state;
}

export const connectFourDefinition: GameDefinition<ConnectFourState, ConnectFourAction, ConnectFourState, Player> = {
  id: 'connect-four', stateSchemaVersion: 1, initialize: createConnectFourState,
  validateAction: (input) => {
    if (isExactObject(input, ['type']) && input.type === 'resign') return { ok: true, action: { type: 'resign' } };
    if (isExactObject(input, ['type', 'col']) && input.type === 'drop' && Number.isInteger(input.col)) return { ok: true, action: { type: 'drop', col: input.col as number } };
    return { ok: false, message: '四子连线操作格式不合法' };
  },
  advance: applyConnectFourAction, viewFor: (state) => state, result: (state) => state.result,
  serialize: JSON.stringify, deserialize: decode,
};
