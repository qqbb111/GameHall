import { MAX_SOKOBAN_HISTORY, moveSokoban, type SokobanDirection, type SokobanLevel } from '@gamehall/game-core';

export type SokobanVisualBox = { id: number; cell: number };
export type SokobanVisuals = { player: number; boxes: readonly SokobanVisualBox[] };

/** Replays valid moves while retaining each box's identity from its initial cell. */
export function traceSokobanVisuals(level: SokobanLevel, history: string): SokobanVisuals {
  if (history.length > MAX_SOKOBAN_HISTORY) throw new Error('oversized sokoban visual history');
  let state = level.initial;
  const boxes = state.boxes.map((cell, id) => ({ id, cell }));
  for (const direction of history as Iterable<SokobanDirection>) {
    const result = moveSokoban(level, state, direction);
    if (!result.ok) throw new Error('invalid sokoban visual history');
    if (result.pushed) {
      const box = boxes.find((piece) => piece.cell === result.state.player);
      if (!box) throw new Error('missing pushed sokoban box');
      const distance = direction === 'U' ? -level.width : direction === 'D' ? level.width : direction === 'L' ? -1 : 1;
      box.cell += distance;
    }
    state = result.state;
  }
  if (boxes.some(({ cell }) => !state.boxes.includes(cell))) throw new Error('sokoban visual state diverged');
  return { player: state.player, boxes };
}

export function oppositeSokobanDirection(direction: SokobanDirection): SokobanDirection {
  return direction === 'U' ? 'D' : direction === 'D' ? 'U' : direction === 'L' ? 'R' : 'L';
}
