import { drawSolvableCards } from '@gamehall/game-core';
import type { Hand } from './twenty-four-practice';

export function fixturePack(): Hand[] {
  let seed = 17;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  const excluded = new Set<string>();
  return Array.from({ length: 10 }, () => {
    const hand = drawSolvableCards(random, excluded);
    excluded.add(hand.cards.map((card) => card.rank).sort((a, b) => a - b).join('-'));
    return hand;
  });
}
