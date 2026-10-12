/// <reference lib="webworker" />
import { connectFourDefinition, reversiDefinition } from '@gamehall/game-core';
import { chooseSoloMove, type SoloAction, type SoloDifficulty, type SoloGameId } from './solo-ai';

export type SoloWorkerRequest = { requestId: number; gameId: SoloGameId; difficulty: SoloDifficulty; stateJson: string };
export type SoloWorkerResponse = { requestId: number; action?: SoloAction; error?: string };

self.onmessage = (event: MessageEvent<SoloWorkerRequest>) => {
  const { requestId, gameId, difficulty, stateJson } = event.data;
  try {
    if (difficulty !== 'easy' && difficulty !== 'thoughtful') throw new Error('invalid difficulty');
    const state = gameId === 'connect-four' ? connectFourDefinition.deserialize(stateJson)
      : gameId === 'reversi' ? reversiDefinition.deserialize(stateJson) : null;
    if (!state || state.phase !== 'playing') throw new Error('invalid game state');
    const response: SoloWorkerResponse = { requestId, action: chooseSoloMove(state, difficulty) };
    self.postMessage(response);
  } catch {
    const response: SoloWorkerResponse = { requestId, error: '电脑暂时无法完成这步，请重试' };
    self.postMessage(response);
  }
};
