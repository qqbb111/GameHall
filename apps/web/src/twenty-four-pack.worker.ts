import { drawSolvableCards } from '@gamehall/game-core';
import type { Hand } from './twenty-four-practice';

export type PackWorkerRequest = { requestId: number };
export type PackWorkerResponse = { requestId: number; pack?: Hand[]; error?: string };

self.onmessage = (event: MessageEvent<PackWorkerRequest>) => {
  const { requestId } = event.data;
  try {
    const excluded = new Set<string>();
    const random = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x1_0000_0000;
    const pack = Array.from({ length: 10 }, () => {
      const hand = drawSolvableCards(random, excluded);
      excluded.add(hand.cards.map((card) => card.rank).sort((a, b) => a - b).join('-'));
      return hand;
    });
    self.postMessage({ requestId, pack } satisfies PackWorkerResponse);
  } catch {
    self.postMessage({ requestId, error: '题组生成失败，请重试' } satisfies PackWorkerResponse);
  }
};
