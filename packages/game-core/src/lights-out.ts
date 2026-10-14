/** Local single-player Lights Out rules; this is not a multiplayer GameId. */
export type LightsOutLevel = {
  id: string;
  rows: readonly string[];
  size: 3 | 4 | 5;
  initial: number;
};

export const MAX_LIGHTS_OUT_HISTORY = 256;

export function parseLightsOutLevel(id: string, rows: readonly string[]): LightsOutLevel {
  const size = rows.length;
  if (!id || (size !== 3 && size !== 4 && size !== 5)
    || rows.some((row) => row.length !== size || /[^01]/.test(row))) throw new Error('invalid lights-out level');
  let initial = 0;
  for (let index = 0; index < size * size; index++) {
    if (rows[Math.floor(index / size)]![index % size] === '1') initial |= 1 << index;
  }
  if (initial === 0) throw new Error('lights-out level must start lit');
  return { id, rows, size, initial };
}

export function lightsOutNeighborMask(size: 3 | 4 | 5, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= size * size) throw new Error('invalid lights-out cell');
  const row = Math.floor(index / size);
  const col = index % size;
  let mask = 1 << index;
  if (row > 0) mask |= 1 << (index - size);
  if (row + 1 < size) mask |= 1 << (index + size);
  if (col > 0) mask |= 1 << (index - 1);
  if (col + 1 < size) mask |= 1 << (index + 1);
  return mask;
}

export function clickLightsOut(level: LightsOutLevel, state: number, index: number): number {
  const limit = 1 << (level.size * level.size);
  if (!Number.isInteger(state) || state < 0 || state >= limit) throw new Error('invalid lights-out state');
  return state ^ lightsOutNeighborMask(level.size, index);
}

/** A saved history must be bounded, legal, and stop at the first solution. */
export function replayLightsOutHistory(level: LightsOutLevel, history: unknown): number {
  if (!Array.isArray(history) || history.length > MAX_LIGHTS_OUT_HISTORY) throw new Error('invalid lights-out history');
  let state = level.initial;
  for (const index of history) {
    if (state === 0) throw new Error('lights-out moves after completion');
    state = clickLightsOut(level, state, index as number);
  }
  return state;
}

function bitCount(value: number): number {
  let count = 0;
  while (value) { value &= value - 1; count++; }
  return count;
}

/** Exact minimum-flip solution by GF(2) elimination and enumeration of the null space.
 * Each switch needs at most one click; ties choose the lowest bit mask.
 * Returns [] for all-off and null for an unreachable board. */
export function solveLightsOut(level: LightsOutLevel, state: number): number[] | null {
  const cells = level.size * level.size;
  if (!Number.isInteger(state) || state < 0 || state >= 1 << cells) throw new Error('invalid lights-out state');
  if (state === 0) return [];
  const rows = Array.from({ length: cells }, (_, target) => {
    let equation = (state >>> target & 1) << cells;
    for (let click = 0; click < cells; click++) {
      if (lightsOutNeighborMask(level.size, click) >>> target & 1) equation |= 1 << click;
    }
    return equation;
  });
  const pivots: number[] = [];
  let rank = 0;
  for (let col = 0; col < cells; col++) {
    const candidate = rows.findIndex((row, index) => index >= rank && (row >>> col & 1) === 1);
    if (candidate < 0) continue;
    [rows[rank], rows[candidate]] = [rows[candidate]!, rows[rank]!];
    for (let row = 0; row < cells; row++) {
      if (row !== rank && (rows[row]! >>> col & 1)) rows[row] = rows[row]! ^ rows[rank]!;
    }
    pivots.push(col);
    rank++;
  }
  if (rows.slice(rank).some((row) => row !== 0)) return null;
  const free = Array.from({ length: cells }, (_, index) => index).filter((index) => !pivots.includes(index));
  let bestMask: number | null = null;
  let bestCount = Infinity;
  for (let choice = 0; choice < 1 << free.length; choice++) {
    let mask = 0;
    for (let index = 0; index < free.length; index++) if (choice >>> index & 1) mask |= 1 << free[index]!;
    for (let row = 0; row < rank; row++) {
      const pivot = pivots[row]!;
      const other = rows[row]! & mask;
      const parity = bitCount(other) & 1;
      if (parity !== (rows[row]! >>> cells & 1)) mask |= 1 << pivot;
    }
    const count = bitCount(mask);
    if (count < bestCount || count === bestCount && (bestMask === null || mask < bestMask)) {
      bestMask = mask;
      bestCount = count;
    }
  }
  if (bestMask === null) return null;
  return Array.from({ length: cells }, (_, index) => index).filter((index) => bestMask! >>> index & 1);
}

const definitions = [
  { id: 'first-spark', rows: ['100', '011', '000'] },
  { id: 'diagonal', rows: ['011', '001', '010'] },
  { id: 'crossing', rows: ['001', '010', '101'] },
  { id: 'new-frame', rows: ['0100', '1111', '1110', '1110'] },
  { id: 'two-banks', rows: ['0110', '0100', '0111', '1101'] },
  { id: 'broken-ring', rows: ['1111', '0110', '1001', '1001'] },
  { id: 'four-corners', rows: ['0110', '0111', '1111', '1100'] },
  { id: 'wide-field', rows: ['10110', '00111', '11000', '11111', '00011'] },
  { id: 'night-bridge', rows: ['10110', '10000', '10100', '00010', '10111'] },
  { id: 'scattered-stars', rows: ['10100', '01100', '10100', '10001', '10101'] },
  { id: 'second-wave', rows: ['10101', '00110', '10101', '01001', '11000'] },
  { id: 'last-light', rows: ['11111', '10011', '00101', '10011', '11010'] },
] as const;

export const lightsOutLevels: readonly LightsOutLevel[] = definitions.map(({ id, rows }) => parseLightsOutLevel(id, rows));
