import { isExactObject, otherPlayer, ruleError, type ApplyResult, type GameDefinition, type GameResult, type Player } from './types';

export const GOMOKU_SIZE = 15;

export type GomokuCell = Player | null;

export type GomokuState = {
  kind: 'gomoku';
  phase: 'playing' | 'finished';
  board: GomokuCell[];
  blackPlayer: Player;
  turn: Player;
  moveCount: number;
  lastMove: { row: number; col: number; player: Player } | null;
  winningLine: Array<{ row: number; col: number }>;
  result: GameResult | null;
};

export type GomokuAction =
  | { type: 'place'; row: number; col: number }
  | { type: 'resign' };

export function createGomokuState(blackPlayer: Player): GomokuState {
  return {
    kind: 'gomoku',
    phase: 'playing',
    board: Array<GomokuCell>(GOMOKU_SIZE * GOMOKU_SIZE).fill(null),
    blackPlayer,
    turn: blackPlayer,
    moveCount: 0,
    lastMove: null,
    winningLine: [],
    result: null,
  };
}

function indexOf(row: number, col: number): number {
  return row * GOMOKU_SIZE + col;
}

function inBounds(row: number, col: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < GOMOKU_SIZE && col >= 0 && col < GOMOKU_SIZE;
}

function collectDirection(
  board: GomokuCell[],
  row: number,
  col: number,
  rowStep: number,
  colStep: number,
  player: Player,
): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  let currentRow = row + rowStep;
  let currentCol = col + colStep;
  while (inBounds(currentRow, currentCol) && board[indexOf(currentRow, currentCol)] === player) {
    cells.push({ row: currentRow, col: currentCol });
    currentRow += rowStep;
    currentCol += colStep;
  }
  return cells;
}

function findWinningLine(board: GomokuCell[], row: number, col: number, player: Player): Array<{ row: number; col: number }> {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
  for (const [rowStep, colStep] of directions) {
    const before = collectDirection(board, row, col, -rowStep, -colStep, player).reverse();
    const after = collectDirection(board, row, col, rowStep, colStep, player);
    const line = [...before, { row, col }, ...after];
    if (line.length >= 5) return line;
  }
  return [];
}

export function applyGomokuAction(state: GomokuState, actor: Player, action: GomokuAction): ApplyResult<GomokuState> {
  if (state.phase !== 'playing') return ruleError('GAME_FINISHED', '本局已经结束');
  if (action.type === 'resign') {
    const winner = otherPlayer(actor);
    return {
      ok: true,
      state: { ...state, phase: 'finished', result: { type: 'win', winner, reason: 'resign' } },
    };
  }
  if (actor !== state.turn) return ruleError('NOT_YOUR_TURN', '还没轮到你落子');
  if (!inBounds(action.row, action.col)) return ruleError('OUT_OF_BOUNDS', '落子位置超出棋盘');
  const targetIndex = indexOf(action.row, action.col);
  if (state.board[targetIndex] !== null) return ruleError('OCCUPIED', '这里已经有棋子');

  const board = [...state.board];
  board[targetIndex] = actor;
  const moveCount = state.moveCount + 1;
  const winningLine = findWinningLine(board, action.row, action.col, actor);
  if (winningLine.length >= 5) {
    return {
      ok: true,
      state: {
        ...state,
        board,
        moveCount,
        lastMove: { row: action.row, col: action.col, player: actor },
        winningLine,
        phase: 'finished',
        result: { type: 'win', winner: actor, reason: 'line' },
      },
    };
  }
  if (moveCount === GOMOKU_SIZE * GOMOKU_SIZE) {
    return {
      ok: true,
      state: {
        ...state,
        board,
        moveCount,
        lastMove: { row: action.row, col: action.col, player: actor },
        phase: 'finished',
        result: { type: 'draw' },
      },
    };
  }
  return {
    ok: true,
    state: {
      ...state,
      board,
      moveCount,
      lastMove: { row: action.row, col: action.col, player: actor },
      turn: otherPlayer(actor),
    },
  };
}

export const gomokuDefinition: GameDefinition<GomokuState, GomokuAction, GomokuState, Player> = {
  id: 'gomoku',
  stateSchemaVersion: 1,
  initialize: (blackPlayer) => createGomokuState(blackPlayer),
  validateAction: (input) => {
    if (isExactObject(input, ['type']) && input.type === 'resign') return { ok: true, action: { type: 'resign' } };
    if (isExactObject(input, ['type', 'row', 'col']) && input.type === 'place' && Number.isInteger(input.row) && Number.isInteger(input.col)) {
      return { ok: true, action: { type: 'place', row: input.row as number, col: input.col as number } };
    }
    return { ok: false, message: '五子棋操作格式不合法' };
  },
  advance: (state, actor, action) => applyGomokuAction(state, actor, action),
  viewFor: (state) => state,
  result: (state) => state.result,
  serialize: (state) => JSON.stringify(state),
  deserialize: (serialized) => JSON.parse(serialized) as GomokuState,
};
