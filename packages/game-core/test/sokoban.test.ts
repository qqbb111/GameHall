import { describe, expect, it } from 'vitest';
import { hasSokobanCornerTrap, isSokobanSolved, moveSokoban, parseSokobanLevel, replaySokobanHistory, sokobanLevels, MAX_SOKOBAN_HISTORY, type SokobanLevel } from '../src';

// Test-only, independent breadth-first search over the ASCII boards. It does
// not use the production move function, so a rule bug cannot prove itself.
function solveRawBoard(level: SokobanLevel, maxStates = 300_000): { path: string; pushes: number; visited: number } {
  const width = level.rows[0]!.length;
  const walls = new Set<number>();
  const goals = new Set<number>();
  const boxes: number[] = [];
  let player = -1;
  level.rows.forEach((row, y) => [...row].forEach((tile, x) => {
    const cell = y * width + x;
    if (tile === '#') walls.add(cell);
    if (tile === '.' || tile === '*' || tile === '+') goals.add(cell);
    if (tile === '$' || tile === '*') boxes.push(cell);
    if (tile === '@' || tile === '+') player = cell;
  }));
  type Node = { player: number; boxes: number[]; path: string; pushes: number };
  const queue: Node[] = [{ player, boxes: boxes.sort((a, b) => a - b), path: '', pushes: 0 }];
  const seen = new Set([`${player}:${boxes.join(',')}`]);
  const moves = [['U', 0, -1], ['R', 1, 0], ['D', 0, 1], ['L', -1, 0]] as const;
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!;
    if (node.boxes.every((box) => goals.has(box))) return { path: node.path, pushes: node.pushes, visited: seen.size };
    for (const [direction, dx, dy] of moves) {
      const x = node.player % width + dx;
      const y = Math.floor(node.player / width) + dy;
      if (x < 0 || x >= width || y < 0 || y >= level.rows.length) continue;
      const next = y * width + x;
      if (walls.has(next)) continue;
      let nextBoxes = node.boxes;
      let pushed = false;
      if (node.boxes.includes(next)) {
        const boxX = x + dx;
        const boxY = y + dy;
        if (boxX < 0 || boxX >= width || boxY < 0 || boxY >= level.rows.length) continue;
        const destination = boxY * width + boxX;
        if (walls.has(destination) || node.boxes.includes(destination)) continue;
        nextBoxes = node.boxes.map((box) => box === next ? destination : box).sort((a, b) => a - b);
        pushed = true;
      }
      const key = `${next}:${nextBoxes.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > maxStates) throw new Error(`${level.id} exceeded ${maxStates} search states`);
      queue.push({ player: next, boxes: nextBoxes, path: node.path + direction, pushes: node.pushes + Number(pushed) });
    }
  }
  throw new Error(`${level.id} has no solution`);
}

describe('single-player Sokoban rules', () => {
  it('rejects illegal tiles, open boundaries and mismatched pieces', () => {
    const base = ['#####', '#@$.#', '#   #', '#####'];
    expect(parseSokobanLevel('valid', 'Valid', '', base).initial.boxes).toHaveLength(1);
    expect(() => parseSokobanLevel('bad', 'Bad', '', ['#####', '#@$. ', '#   #', '#####'])).toThrow('boundary');
    expect(() => parseSokobanLevel('bad', 'Bad', '', ['#####', '#@X.#', '# $ #', '#####'])).toThrow('tile');
    expect(() => parseSokobanLevel('bad', 'Bad', '', ['#####', '#@$.#', '# $ #', '#####'])).toThrow('boxes or goals');
    expect(() => parseSokobanLevel('bad', 'Bad', '', ['#####', '#@@.#', '# $ #', '#####'])).toThrow('players');
  });

  it('moves and pushes exactly one box; walls, bounds and a second box do not consume steps', () => {
    const level = sokobanLevels[0]!;
    const start = level.initial;
    expect(moveSokoban(level, start, 'X' as 'U')).toEqual({ ok: false, reason: 'INVALID_DIRECTION' });
    const up = moveSokoban(level, start, 'U');
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(moveSokoban(level, up.state, 'U')).toEqual({ ok: false, reason: 'BLOCKED' });
    const first = moveSokoban(level, start, 'R');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state).toMatchObject({ steps: 1, pushes: 1 });
    expect(start).toMatchObject({ steps: 0, pushes: 0 });
    const back = moveSokoban(level, first.state, 'L');
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state).toMatchObject({ boxes: first.state.boxes, steps: 2, pushes: 1 });
    const second = moveSokoban(level, first.state, 'R');
    expect(second.ok && isSokobanSolved(level, second.state)).toBe(true);
    if (second.ok) expect(moveSokoban(level, second.state, 'R')).toEqual({ ok: false, reason: 'FINISHED' });

    const chain = parseSokobanLevel('chain', 'Chain', '', ['########', '#@$$.. #', '#      #', '########']);
    expect(moveSokoban(chain, chain.initial, 'R')).toEqual({ ok: false, reason: 'BLOCKED' });
  });

  it('replays only bounded, legal histories and detects guaranteed non-goal corners', () => {
    const level = sokobanLevels[0]!;
    expect(replaySokobanHistory(level, 'RR')).toMatchObject({ steps: 2, pushes: 2 });
    expect(() => replaySokobanHistory(level, 'RRR')).toThrow('FINISHED');
    expect(() => replaySokobanHistory(level, 'UU')).toThrow('BLOCKED');
    expect(() => replaySokobanHistory(level, 'X')).toThrow('INVALID_DIRECTION');
    expect(() => replaySokobanHistory(level, 'L'.repeat(MAX_SOKOBAN_HISTORY + 1))).toThrow('history');
    expect(hasSokobanCornerTrap(level, { ...level.initial, boxes: [level.width + 1] })).toBe(true);
    expect(hasSokobanCornerTrap(level, replaySokobanHistory(level, 'RR'))).toBe(false);
  });
});

describe('ten authored Sokoban levels', () => {
  const solutions = [
    [2, 2], [5, 2], [4, 2], [12, 4], [18, 5],
    [16, 7], [17, 6], [15, 9], [20, 8], [25, 10],
  ] as const;

  it('has unique, compact, progressively larger layouts', () => {
    expect(sokobanLevels).toHaveLength(10);
    expect(new Set(sokobanLevels.map((level) => level.id)).size).toBe(10);
    expect(sokobanLevels.map((level) => level.initial.boxes.length)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 3]);
    for (const level of sokobanLevels) {
      expect(level.width).toBeLessThanOrEqual(11);
      expect(level.height).toBeLessThanOrEqual(8);
      expect(isSokobanSolved(level, level.initial)).toBe(false);
    }
  });

  it.each(sokobanLevels.map((level, index) => [level, solutions[index]!] as const))(
    '%s has a nontrivial independently found solution that production rules replay',
    (level, [steps, pushes]) => {
      const result = solveRawBoard(level);
      expect(result.path.length).toBe(steps);
      expect(result.pushes).toBe(pushes);
      expect(result.pushes).toBeGreaterThanOrEqual(2);
      expect(result.visited).toBeLessThanOrEqual(300_000);
      const replayed = replaySokobanHistory(level, result.path);
      expect(replayed).toMatchObject({ steps, pushes });
      expect(isSokobanSolved(level, replayed)).toBe(true);
    },
    20_000,
  );
});
