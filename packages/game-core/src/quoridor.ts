import { isExactObject, otherPlayer, ruleError, type ApplyResult, type GameDefinition, type GameResult, type Player } from './types';

export const QUORIDOR_SIZE = 9;

export type Coord = { row: number; col: number };
export type WallOrientation = 'H' | 'V';
export type QuoridorWall = { row: number; col: number; orientation: WallOrientation };

export type QuoridorState = {
  kind: 'quoridor';
  phase: 'playing' | 'finished';
  pawns: [Coord, Coord];
  goalRows: [number, number];
  turn: Player;
  wallsRemaining: [number, number];
  walls: QuoridorWall[];
  lastAction: QuoridorAction | null;
  result: GameResult | null;
};

export type QuoridorAction =
  | { type: 'move'; row: number; col: number }
  | { type: 'placeWall'; row: number; col: number; orientation: WallOrientation }
  | { type: 'resign' };

export function createQuoridorState(southPlayer: Player): QuoridorState {
  const northPlayer = otherPlayer(southPlayer);
  const pawns: [Coord, Coord] = [{ row: 0, col: 4 }, { row: 0, col: 4 }];
  pawns[southPlayer] = { row: 8, col: 4 };
  pawns[northPlayer] = { row: 0, col: 4 };
  const goalRows: [number, number] = [0, 0];
  goalRows[southPlayer] = 0;
  goalRows[northPlayer] = 8;
  return {
    kind: 'quoridor',
    phase: 'playing',
    pawns,
    goalRows,
    turn: southPlayer,
    wallsRemaining: [10, 10],
    walls: [],
    lastAction: null,
    result: null,
  };
}

function isCoord(value: Coord): boolean {
  return Number.isInteger(value.row) && Number.isInteger(value.col) && value.row >= 0 && value.row < 9 && value.col >= 0 && value.col < 9;
}

function sameCoord(left: Coord, right: Coord): boolean {
  return left.row === right.row && left.col === right.col;
}

export function isBlocked(state: Pick<QuoridorState, 'walls'>, from: Coord, to: Coord): boolean {
  const rowDelta = to.row - from.row;
  const colDelta = to.col - from.col;
  if (Math.abs(rowDelta) + Math.abs(colDelta) !== 1) return true;
  if (rowDelta !== 0) {
    const boundaryRow = Math.min(from.row, to.row);
    return state.walls.some((wall) =>
      wall.orientation === 'H' && wall.row === boundaryRow && (wall.col === from.col || wall.col + 1 === from.col),
    );
  }
  const boundaryCol = Math.min(from.col, to.col);
  return state.walls.some((wall) =>
    wall.orientation === 'V' && wall.col === boundaryCol && (wall.row === from.row || wall.row + 1 === from.row),
  );
}

export function legalQuoridorMoves(state: QuoridorState, actor: Player): Coord[] {
  const own = state.pawns[actor];
  const opponent = state.pawns[otherPlayer(actor)];
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  const result: Coord[] = [];

  for (const [rowStep, colStep] of directions) {
    const adjacent = { row: own.row + rowStep, col: own.col + colStep };
    if (!isCoord(adjacent) || isBlocked(state, own, adjacent)) continue;
    if (!sameCoord(adjacent, opponent)) {
      result.push(adjacent);
      continue;
    }
    const behind = { row: opponent.row + rowStep, col: opponent.col + colStep };
    if (isCoord(behind) && !isBlocked(state, opponent, behind)) {
      result.push(behind);
      continue;
    }
    const sideDirections = rowStep === 0 ? [[-1, 0], [1, 0]] as const : [[0, -1], [0, 1]] as const;
    for (const [sideRow, sideCol] of sideDirections) {
      const diagonal = { row: opponent.row + sideRow, col: opponent.col + sideCol };
      if (isCoord(diagonal) && !isBlocked(state, opponent, diagonal)) result.push(diagonal);
    }
  }

  return result;
}

function wallConflict(existing: QuoridorWall, candidate: QuoridorWall): boolean {
  if (existing.orientation !== candidate.orientation) {
    return existing.row === candidate.row && existing.col === candidate.col;
  }
  if (candidate.orientation === 'H') {
    return existing.row === candidate.row && Math.abs(existing.col - candidate.col) <= 1;
  }
  return existing.col === candidate.col && Math.abs(existing.row - candidate.row) <= 1;
}

function hasPathToGoal(state: QuoridorState, player: Player): boolean {
  const queue: Coord[] = [state.pawns[player]];
  const visited = new Set<string>([`${state.pawns[player].row},${state.pawns[player].col}`]);
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.row === state.goalRows[player]) return true;
    for (const [rowStep, colStep] of directions) {
      const next = { row: current.row + rowStep, col: current.col + colStep };
      const key = `${next.row},${next.col}`;
      if (!isCoord(next) || visited.has(key) || isBlocked(state, current, next)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return false;
}

export function canPlaceQuoridorWall(state: QuoridorState, wall: QuoridorWall): { ok: true } | { ok: false; code: string; message: string } {
  if (!Number.isInteger(wall.row) || !Number.isInteger(wall.col) || wall.row < 0 || wall.row > 7 || wall.col < 0 || wall.col > 7) {
    return { ok: false, code: 'WALL_OUT_OF_BOUNDS', message: '墙的位置超出棋盘' };
  }
  if (wall.orientation !== 'H' && wall.orientation !== 'V') {
    return { ok: false, code: 'INVALID_ORIENTATION', message: '墙的方向无效' };
  }
  if (state.walls.some((existing) => wallConflict(existing, wall))) {
    return { ok: false, code: 'WALL_CONFLICT', message: '墙不能重叠或交叉' };
  }
  const trial = { ...state, walls: [...state.walls, wall] };
  if (!hasPathToGoal(trial, 0) || !hasPathToGoal(trial, 1)) {
    return { ok: false, code: 'PATH_BLOCKED', message: '必须为双方保留至少一条通路' };
  }
  return { ok: true };
}

function finishAfterPawnMove(
  state: QuoridorState,
  actor: Player,
  pawns: [Coord, Coord],
  lastAction: Extract<QuoridorAction, { type: 'move' }>,
): QuoridorState | null {
  if (pawns[actor].row !== state.goalRows[actor]) return null;
  return {
    ...state,
    pawns,
    lastAction,
    phase: 'finished',
    result: { type: 'win', winner: actor, reason: 'goal' },
  };
}

export function applyQuoridorAction(state: QuoridorState, actor: Player, action: QuoridorAction): ApplyResult<QuoridorState> {
  if (state.phase !== 'playing') return ruleError('GAME_FINISHED', '本局已经结束');
  if (action.type === 'resign') {
    const winner = otherPlayer(actor);
    return { ok: true, state: { ...state, phase: 'finished', result: { type: 'win', winner, reason: 'resign' } } };
  }
  if (actor !== state.turn) return ruleError('NOT_YOUR_TURN', '还没轮到你行动');
  if (action.type === 'move') {
    const target = { row: action.row, col: action.col };
    if (!isCoord(target)) return ruleError('OUT_OF_BOUNDS', '目标位置超出棋盘');
    if (!legalQuoridorMoves(state, actor).some((coord) => sameCoord(coord, target))) {
      return ruleError('ILLEGAL_MOVE', '棋子不能移动到这里');
    }
    const pawns: [Coord, Coord] = [{ ...state.pawns[0] }, { ...state.pawns[1] }];
    pawns[actor] = target;
    const lastAction: Extract<QuoridorAction, { type: 'move' }> = { type: 'move', row: action.row, col: action.col };
    const finishedState = finishAfterPawnMove(state, actor, pawns, lastAction);
    if (finishedState) return { ok: true, state: finishedState };
    return { ok: true, state: { ...state, pawns, lastAction, turn: otherPlayer(actor) } };
  }

  if (state.wallsRemaining[actor] <= 0) return ruleError('NO_WALLS', '你已经没有可用的墙');
  const wall = { row: action.row, col: action.col, orientation: action.orientation };
  const validation = canPlaceQuoridorWall(state, wall);
  if (!validation.ok) return ruleError(validation.code, validation.message);
  const wallsRemaining: [number, number] = [...state.wallsRemaining];
  wallsRemaining[actor] -= 1;
  return {
    ok: true,
    state: {
      ...state,
      walls: [...state.walls, wall],
      wallsRemaining,
      lastAction: action,
      turn: otherPlayer(actor),
    },
  };
}

export type QuoridorView = QuoridorState & { legalMoves: Coord[] };

export const quoridorDefinition: GameDefinition<QuoridorState, QuoridorAction, QuoridorView, Player> = {
  id: 'quoridor',
  stateSchemaVersion: 1,
  initialize: (southPlayer) => createQuoridorState(southPlayer),
  validateAction: (input) => {
    if (isExactObject(input, ['type']) && input.type === 'resign') return { ok: true, action: { type: 'resign' } };
    if (isExactObject(input, ['type', 'row', 'col']) && input.type === 'move' && Number.isInteger(input.row) && Number.isInteger(input.col)) {
      return { ok: true, action: { type: 'move', row: input.row as number, col: input.col as number } };
    }
    if (isExactObject(input, ['type', 'row', 'col', 'orientation']) && input.type === 'placeWall'
      && Number.isInteger(input.row) && Number.isInteger(input.col) && (input.orientation === 'H' || input.orientation === 'V')) {
      return { ok: true, action: { type: 'placeWall', row: input.row as number, col: input.col as number, orientation: input.orientation } };
    }
    return { ok: false, message: '路墙棋操作格式不合法' };
  },
  advance: (state, actor, action) => applyQuoridorAction(state, actor, action),
  viewFor: (state, viewer) => ({ ...state, legalMoves: state.phase === 'playing' ? legalQuoridorMoves(state, viewer) : [] }),
  result: (state) => state.result,
  serialize: (state) => JSON.stringify(state),
  deserialize: (serialized) => JSON.parse(serialized) as QuoridorState,
};
