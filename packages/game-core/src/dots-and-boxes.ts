import { isExactObject, otherPlayer, ruleError, type ApplyResult, type GameDefinition, type GameResult, type Player } from './types';

export type EdgeOrientation = 'H' | 'V';
export type DotsAndBoxesState = {
  kind: 'dots-and-boxes'; phase: 'playing' | 'finished';
  horizontal: Array<Player | null>; vertical: Array<Player | null>; boxes: Array<Player | null>;
  scores: [number, number]; firstPlayer: Player; turn: Player; edgeCount: number;
  lastEdge: { orientation: EdgeOrientation; row: number; col: number; player: Player } | null;
  lastBoxes: number[]; result: GameResult | null;
};
export type DotsAndBoxesAction = { type: 'drawEdge'; orientation: EdgeOrientation; row: number; col: number } | { type: 'resign' };
const horizontalAt = (row: number, col: number) => row * 3 + col;
const verticalAt = (row: number, col: number) => row * 4 + col;
const boxAt = (row: number, col: number) => row * 3 + col;

export function createDotsAndBoxesState(firstPlayer: Player): DotsAndBoxesState {
  return { kind: 'dots-and-boxes', phase: 'playing', horizontal: Array(12).fill(null), vertical: Array(12).fill(null), boxes: Array(9).fill(null),
    scores: [0, 0], firstPlayer, turn: firstPlayer, edgeCount: 0, lastEdge: null, lastBoxes: [], result: null };
}

function enclosed(state: DotsAndBoxesState, row: number, col: number): boolean {
  return state.horizontal[horizontalAt(row, col)] !== null && state.horizontal[horizontalAt(row + 1, col)] !== null
    && state.vertical[verticalAt(row, col)] !== null && state.vertical[verticalAt(row, col + 1)] !== null;
}

export function applyDotsAndBoxesAction(state: DotsAndBoxesState, actor: Player, action: DotsAndBoxesAction): ApplyResult<DotsAndBoxesState> {
  if (state.phase !== 'playing') return ruleError('GAME_FINISHED', '本局已经结束');
  if (action.type === 'resign') return { ok: true, state: { ...state, phase: 'finished', result: { type: 'win', winner: otherPlayer(actor), reason: 'resign' } } };
  if (actor !== state.turn) return ruleError('NOT_YOUR_TURN', '还没轮到你画边');
  const { orientation, row, col } = action;
  if (!Number.isInteger(row) || !Number.isInteger(col) || (orientation !== 'H' && orientation !== 'V')
      || row < 0 || col < 0 || (orientation === 'H' ? row > 3 || col > 2 : row > 2 || col > 3)) return ruleError('OUT_OF_BOUNDS', '边线位置超出棋盘');
  const horizontal = [...state.horizontal], vertical = [...state.vertical];
  const index = orientation === 'H' ? horizontalAt(row, col) : verticalAt(row, col);
  if ((orientation === 'H' ? horizontal : vertical)[index] !== null) return ruleError('EDGE_TAKEN', '这条边已经被画过');
  if (orientation === 'H') horizontal[index] = actor; else vertical[index] = actor;
  const boxes = [...state.boxes], scores: [number, number] = [...state.scores];
  const next = { ...state, horizontal, vertical, boxes };
  const adjacent = orientation === 'H' ? [[row - 1, col], [row, col]] : [[row, col - 1], [row, col]];
  const lastBoxes: number[] = [];
  for (const [r, c] of adjacent) {
    if (r === undefined || c === undefined || r < 0 || r > 2 || c < 0 || c > 2) continue;
    const boxIndex = boxAt(r, c);
    if (boxes[boxIndex] === null && enclosed(next, r, c)) { boxes[boxIndex] = actor; scores[actor]++; lastBoxes.push(boxIndex); }
  }
  const edgeCount = state.edgeCount + 1;
  const finished = edgeCount === 24;
  const winner: Player | null = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
  return { ok: true, state: { ...next, boxes, scores, edgeCount, lastBoxes,
    lastEdge: { orientation, row, col, player: actor }, turn: lastBoxes.length ? actor : otherPlayer(actor),
    phase: finished ? 'finished' : 'playing',
    result: finished ? winner === null ? { type: 'draw' } : { type: 'win', winner, reason: 'score' } : null,
  } };
}

function decode(serialized: string): DotsAndBoxesState {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object') throw new Error('invalid dots-and-boxes state');
  const state = value as DotsAndBoxesState;
  const validCells = (cells: unknown, count: number) => Array.isArray(cells) && cells.length === count && cells.every((cell) => cell === null || cell === 0 || cell === 1);
  if (state.kind !== 'dots-and-boxes' || !['playing', 'finished'].includes(state.phase)
      || !validCells(state.horizontal, 12) || !validCells(state.vertical, 12) || !validCells(state.boxes, 9)
      || !Array.isArray(state.scores) || state.scores.length !== 2 || state.scores.some((score) => !Number.isInteger(score) || score < 0)
      || state.scores[0] !== state.boxes.filter((cell) => cell === 0).length || state.scores[1] !== state.boxes.filter((cell) => cell === 1).length
      || ![0, 1].includes(state.firstPlayer) || ![0, 1].includes(state.turn) || !Number.isInteger(state.edgeCount) || state.edgeCount < 0 || state.edgeCount > 24
      || state.horizontal.filter((cell) => cell !== null).length + state.vertical.filter((cell) => cell !== null).length !== state.edgeCount
      || !Array.isArray(state.lastBoxes) || !state.lastBoxes.every((index) => Number.isInteger(index) && index >= 0 && index < 9)
      || (state.lastEdge !== null && (!state.lastEdge || !['H', 'V'].includes(state.lastEdge.orientation) || !Number.isInteger(state.lastEdge.row) || !Number.isInteger(state.lastEdge.col)))
      || (state.phase === 'playing') !== (state.result === null)) throw new Error('invalid dots-and-boxes state');
  return state;
}

export const dotsAndBoxesDefinition: GameDefinition<DotsAndBoxesState, DotsAndBoxesAction, DotsAndBoxesState, Player> = {
  id: 'dots-and-boxes', stateSchemaVersion: 1, initialize: createDotsAndBoxesState,
  validateAction: (input) => {
    if (isExactObject(input, ['type']) && input.type === 'resign') return { ok: true, action: { type: 'resign' } };
    if (isExactObject(input, ['type', 'orientation', 'row', 'col']) && input.type === 'drawEdge' && (input.orientation === 'H' || input.orientation === 'V')
        && Number.isInteger(input.row) && Number.isInteger(input.col)) return { ok: true, action: { type: 'drawEdge', orientation: input.orientation, row: input.row as number, col: input.col as number } };
    return { ok: false, message: '点格棋操作格式不合法' };
  },
  advance: applyDotsAndBoxesAction, viewFor: (state) => state, result: (state) => state.result,
  serialize: JSON.stringify, deserialize: decode,
};
