/** Local, single-player Sokoban rules. This module is not a multiplayer GameId. */

export type SokobanDirection = 'U' | 'R' | 'D' | 'L';
export type SokobanState = { player: number; boxes: number[]; steps: number; pushes: number };
export type SokobanLevel = {
  id: string;
  title: string;
  description: string;
  rows: readonly string[];
  width: number;
  height: number;
  walls: ReadonlySet<number>;
  goals: ReadonlySet<number>;
  initial: SokobanState;
};
export type SokobanMoveResult = { ok: true; state: SokobanState; pushed: boolean }
  | { ok: false; reason: 'INVALID_DIRECTION' | 'BLOCKED' | 'FINISHED' };

export const MAX_SOKOBAN_HISTORY = 2000;

export function parseSokobanLevel(id: string, title: string, description: string, rows: readonly string[]): SokobanLevel {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  if (!id || !title || height < 4 || height > 12 || width < 5 || width > 14 || rows.some((row) => row.length !== width)) {
    throw new Error('invalid sokoban dimensions');
  }
  const walls = new Set<number>();
  const goals = new Set<number>();
  const boxes: number[] = [];
  let player: number | null = null;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = rows[row]![col]!;
      const index = row * width + col;
      if (!'# .$@*+'.includes(cell)) throw new Error('invalid sokoban tile');
      if ((row === 0 || row === height - 1 || col === 0 || col === width - 1) && cell !== '#') throw new Error('unclosed sokoban boundary');
      if (cell === '#') walls.add(index);
      if (cell === '.' || cell === '*' || cell === '+') goals.add(index);
      if (cell === '$' || cell === '*') boxes.push(index);
      if (cell === '@' || cell === '+') {
        if (player !== null) throw new Error('multiple sokoban players');
        player = index;
      }
    }
  }
  if (player === null || boxes.length < 1 || boxes.length > 3 || boxes.length !== goals.size) {
    throw new Error('invalid sokoban players, boxes or goals');
  }
  return { id, title, description, rows, width, height, walls, goals,
    initial: { player, boxes: boxes.sort((a, b) => a - b), steps: 0, pushes: 0 } };
}

export function isSokobanSolved(level: SokobanLevel, state: SokobanState): boolean {
  return state.boxes.length === level.goals.size && state.boxes.every((box) => level.goals.has(box));
}

function neighbor(level: SokobanLevel, index: number, direction: SokobanDirection): number | null {
  const col = index % level.width;
  const row = Math.floor(index / level.width);
  const nextCol = col + (direction === 'R' ? 1 : direction === 'L' ? -1 : 0);
  const nextRow = row + (direction === 'D' ? 1 : direction === 'U' ? -1 : 0);
  return nextCol < 0 || nextCol >= level.width || nextRow < 0 || nextRow >= level.height
    ? null : nextRow * level.width + nextCol;
}

export function moveSokoban(level: SokobanLevel, state: SokobanState, direction: SokobanDirection): SokobanMoveResult {
  if (direction !== 'U' && direction !== 'R' && direction !== 'D' && direction !== 'L') return { ok: false, reason: 'INVALID_DIRECTION' };
  if (isSokobanSolved(level, state)) return { ok: false, reason: 'FINISHED' };
  const next = neighbor(level, state.player, direction);
  if (next === null || level.walls.has(next)) return { ok: false, reason: 'BLOCKED' };
  if (!state.boxes.includes(next)) return { ok: true, state: { ...state, player: next, steps: state.steps + 1 }, pushed: false };
  const beyond = neighbor(level, next, direction);
  if (beyond === null || level.walls.has(beyond) || state.boxes.includes(beyond)) return { ok: false, reason: 'BLOCKED' };
  const boxes = state.boxes.map((box) => box === next ? beyond : box).sort((a, b) => a - b);
  return { ok: true, state: { player: next, boxes, steps: state.steps + 1, pushes: state.pushes + 1 }, pushed: true };
}

/** Rejects blocked, post-win and oversized histories before using them as saved progress. */
export function replaySokobanHistory(level: SokobanLevel, history: unknown): SokobanState {
  if (typeof history !== 'string' || history.length > MAX_SOKOBAN_HISTORY) throw new Error('invalid sokoban history');
  let state = level.initial;
  for (const char of history) {
    const result = moveSokoban(level, state, char as SokobanDirection);
    if (!result.ok) throw new Error(`invalid sokoban move: ${result.reason}`);
    state = result.state;
  }
  return state;
}

/** A box against two perpendicular walls, away from a goal, cannot be recovered. */
export function hasSokobanCornerTrap(level: SokobanLevel, state: SokobanState): boolean {
  return state.boxes.some((box) => {
    if (level.goals.has(box)) return false;
    const wall = (direction: SokobanDirection) => {
      const next = neighbor(level, box, direction);
      return next === null || level.walls.has(next);
    };
    return (wall('U') || wall('D')) && (wall('L') || wall('R'));
  });
}

const definitions = [
  { id: 'first-push', title: '推到终点', description: '先认清方向：站到箱后，把它推到发光的目标。', rows: ['#######', '#     #', '# @$ .#', '#     #', '#######'] },
  { id: 'around-wall', title: '绕到背后', description: '目标在墙边。先横推，再绕到箱子上方。', rows: ['########', '#      #', '# @ $  #', '#   #. #', '#      #', '########'] },
  { id: 'turning-point', title: '转身入位', description: '先让箱子离开墙角，再从下方转向目标。', rows: ['#########', '#  #    #', '#  #.   #', '# @$    #', '#       #', '#########'] },
  { id: 'two-lanes', title: '双线归位', description: '两只箱子隔墙相望，分别找准推送路线。', rows: ['#########', '# .   . #', '#       #', '# $ # $ #', '#   @   #', '#       #', '#########'] },
  { id: 'side-route', title: '墙边换位', description: '绕过两侧障碍，别把箱子堵在墙角。', rows: ['##########', '# .   .  #', '#  #  #  #', '# $  @ $ #', '#        #', '##########'] },
  { id: 'open-passage', title: '留出通路', description: '两只箱子要先后穿过中央空地。', rows: ['#########', '#   .   #', '#  ##   #', '# @ $ $ #', '#   .   #', '#       #', '#########'] },
  { id: 'split-corridor', title: '三箱分流', description: '中间隔墙让路线分开，先为第三只箱子腾位置。', rows: ['###########', '# .  #  . #', '#    #    #', '# $     $ #', '#    @    #', '#  . $    #', '#         #', '###########'] },
  { id: 'three-in-line', title: '排成一列', description: '三只箱子在同一排，留意推箱顺序与站位。', rows: ['##########', '#  . . . #', '#        #', '#  $$$   #', '#   @    #', '#        #', '##########'] },
  { id: 'narrow-turns', title: '窄道转向', description: '转弯前先把通道让出来，再处理剩下的箱子。', rows: ['##########', '# .  . . #', '#        #', '# $ $ $  #', '#   #    #', '# @      #', '##########'] },
  { id: 'last-loop', title: '最后一圈', description: '三只箱子分布在墙的两侧，按顺序绕行归位。', rows: ['###########', '#  .   .  #', '#         #', '#  ## ##  #', '# $  $  $ #', '#    @  . #', '#         #', '###########'] },
] as const;

export const sokobanLevels: readonly SokobanLevel[] = definitions.map(({ id, title, description, rows }) => parseSokobanLevel(id, title, description, rows));
