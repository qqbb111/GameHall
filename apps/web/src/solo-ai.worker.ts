/// <reference lib="webworker" />
import { connectFourDefinition, reversiDefinition } from '@gamehall/game-core';
import { chooseSoloMove, recommendSoloHint, type SoloAction, type SoloDifficulty, type SoloGameId, type SoloHint } from './solo-ai';

export type SoloWorkerRequest = { requestId: number; purpose: 'move' | 'hint'; gameId: SoloGameId; difficulty: SoloDifficulty; stateJson: string };
export type SoloWorkerResponse = { requestId: number; action?: SoloAction; hint?: SoloHint; error?: string };

self.onmessage = (event: MessageEvent<SoloWorkerRequest>) => {
  const { requestId, purpose, gameId, difficulty, stateJson } = event.data;
  try {
    if (difficulty !== 'easy' && difficulty !== 'thoughtful') throw new Error('invalid difficulty');
    const state = gameId === 'connect-four' ? connectFourDefinition.deserialize(stateJson)
      : gameId === 'reversi' ? reversiDefinition.deserialize(stateJson) : null;
    if (!state || state.phase !== 'playing') throw new Error('invalid game state');
    if (purpose !== 'move' && purpose !== 'hint') throw new Error('invalid purpose');
    if (purpose === 'hint' && state.turn !== 0) throw new Error('invalid hint turn');
    if (purpose === 'move' && state.turn !== 1) throw new Error('invalid move turn');
    const response: SoloWorkerResponse = purpose === 'hint'
      ? { requestId, hint: recommendSoloHint(state) }
      : { requestId, action: chooseSoloMove(state, difficulty) };
    self.postMessage(response);
  } catch {
    const response: SoloWorkerResponse = { requestId, error: '电脑暂时无法完成这步，请重试' };
    self.postMessage(response);
  }
};
