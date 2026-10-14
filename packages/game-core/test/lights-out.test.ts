import { describe, expect, it } from 'vitest';
import { clickLightsOut, lightsOutLevels, lightsOutNeighborMask, parseLightsOutLevel, replayLightsOutHistory, solveLightsOut } from '../src/lights-out';

/** Independent row-chasing oracle: choose first-row clicks, then each next row is forced. */
function minimumByRowChasing(size: 3 | 4 | 5, state: number): number | null {
  const rowMask = (1 << size) - 1;
  const lit = Array.from({ length: size }, (_, row) => state >>> (row * size) & rowMask);
  let best = Infinity;
  for (let first = 0; first <= rowMask; first++) {
    const clicks = [first];
    for (let row = 1; row < size; row++) {
      const previous = clicks[row - 1]!;
      clicks.push(lit[row - 1]! ^ (clicks[row - 2] ?? 0) ^ previous
        ^ ((previous << 1) & rowMask) ^ (previous >>> 1));
    }
    const last = clicks[size - 1]!;
    const bottom = lit[size - 1]! ^ clicks[size - 2]! ^ last ^ ((last << 1) & rowMask) ^ (last >>> 1);
    if (bottom !== 0) continue;
    const moves = clicks.reduce((total, bits) => total + bits.toString(2).replaceAll('0', '').length, 0);
    best = Math.min(best, moves);
  }
  return Number.isFinite(best) ? best : null;
}

describe('local Lights Out', () => {
  it('toggles exactly the existing orthogonal neighbors, without edge wrap; two clicks cancel', () => {
    const level = lightsOutLevels[0]!;
    expect(lightsOutNeighborMask(3, 0)).toBe((1 << 0) | (1 << 1) | (1 << 3));
    expect(lightsOutNeighborMask(3, 2)).toBe((1 << 2) | (1 << 1) | (1 << 5));
    expect(lightsOutNeighborMask(3, 4)).toBe((1 << 4) | (1 << 1) | (1 << 3) | (1 << 5) | (1 << 7));
    expect(clickLightsOut(level, clickLightsOut(level, level.initial, 0), 0)).toBe(level.initial);
    expect(() => clickLightsOut(level, level.initial, -1)).toThrow();
    expect(() => clickLightsOut(level, level.initial, 9)).toThrow();
    expect(() => clickLightsOut(level, -1, 0)).toThrow();
  });

  it('ships 12 nonempty, stable, progressively larger boards with exact independently checked minimum solutions', () => {
    const expected = [2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 10, 11];
    expect(lightsOutLevels).toHaveLength(12);
    expect(new Set(lightsOutLevels.map((level) => level.id)).size).toBe(12);
    for (const [index, level] of lightsOutLevels.entries()) {
      expect(level.size).toBe(index < 3 ? 3 : index < 7 ? 4 : 5);
      expect(level.initial).not.toBe(0);
      const solution = solveLightsOut(level, level.initial);
      expect(solution).not.toBeNull();
      expect(solution).toHaveLength(expected[index]!);
      expect(minimumByRowChasing(level.size, level.initial)).toBe(expected[index]!);
      expect(replayLightsOutHistory(level, solution)).toBe(0);
      expect(solveLightsOut(level, 0)).toEqual([]);
    }
  });

  it('rejects invalid levels and histories, including clicks after a win', () => {
    expect(() => parseLightsOutLevel('bad', ['000', '000', '000'])).toThrow();
    expect(() => parseLightsOutLevel('bad', ['100', '10x', '000'])).toThrow();
    const level = lightsOutLevels[0]!;
    for (const history of [null, '1', [-1], [9], [0.5], Array(257).fill(0)]) {
      expect(() => replayLightsOutHistory(level, history)).toThrow();
    }
    expect(() => replayLightsOutHistory(level, [...solveLightsOut(level, level.initial)!, 0])).toThrow();
  });

  it('solves arbitrary reachable states and distinguishes unreachable boards', () => {
    const level = lightsOutLevels[11]!;
    const state = clickLightsOut(level, clickLightsOut(level, level.initial, 3), 17);
    const solution = solveLightsOut(level, state);
    expect(solution).not.toBeNull();
    expect(solution!.reduce((board, index) => clickLightsOut(level, board, index), state)).toBe(0);
    const unreachable = Array.from({ length: 1 << 10 }, (_, state) => state)
      .find((candidate) => minimumByRowChasing(level.size, candidate) === null);
    expect(unreachable).toBeDefined();
    expect(solveLightsOut(level, unreachable!)).toBeNull();
    const impossibleFourByFour = parseLightsOutLevel('single-corner', ['1000', '0000', '0000', '0000']);
    expect(minimumByRowChasing(4, impossibleFourByFour.initial)).toBeNull();
    expect(solveLightsOut(impossibleFourByFour, impossibleFourByFour.initial)).toBeNull();
    expect(() => solveLightsOut(level, 1 << 25)).toThrow();
  });
});
