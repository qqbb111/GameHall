import { connectFourDefinition, reversiDefinition, type ConnectFourState, type ReversiState } from '@gamehall/game-core';
import type { SoloDifficulty, SoloGameId, SoloState } from './solo-ai';

export type SoloStarter = 'human' | 'computer';
export type SoloProgress = {
  gameId: SoloGameId;
  state: SoloState;
  history: SoloState[];
  difficulty: SoloDifficulty;
  starter: SoloStarter;
};
export type SoloProgressRead =
  | { kind: 'valid'; progress: SoloProgress }
  | { kind: 'empty' | 'invalid' | 'unavailable' };

const VERSION = 1;
export const SOLO_PROGRESS_MAX_BYTES = 65_536;
export const SOLO_HISTORY_MAX = 64;
export function soloProgressKey(gameId: SoloGameId): string { return `gamehall:solo:${gameId}:v1`; }

function decodeState(gameId: SoloGameId, serialized: string): SoloState {
  return gameId === 'connect-four' ? connectFourDefinition.deserialize(serialized) : reversiDefinition.deserialize(serialized);
}

function serializeState(state: SoloState): string {
  return state.kind === 'connect-four' ? connectFourDefinition.serialize(state as ConnectFourState)
    : reversiDefinition.serialize(state as ReversiState);
}

function expectedFirst(starter: SoloStarter): 0 | 1 { return starter === 'human' ? 0 : 1; }

function validState(state: SoloState, gameId: SoloGameId, starter: SoloStarter): boolean {
  if (state.kind !== gameId || (state.kind === 'connect-four' ? state.firstPlayer : state.blackPlayer) !== expectedFirst(starter)) return false;
  if (state.phase === 'finished') {
    if (state.result?.type !== 'draw' && state.result?.type !== 'win') return false;
    if (state.result.type === 'win' && ![0, 1].includes(state.result.winner)) return false;
    if (state.result.type === 'win' && !['line', 'score'].includes(state.result.reason)) return false;
  }
  return true;
}

function validHistory(progress: SoloProgress): boolean {
  if (progress.history.length > SOLO_HISTORY_MAX) return false;
  let lastMoveCount = -1;
  for (const snapshot of progress.history) {
    if (!validState(snapshot, progress.gameId, progress.starter) || snapshot.phase !== 'playing' || snapshot.turn !== 0
        || snapshot.moveCount <= lastMoveCount || snapshot.moveCount >= progress.state.moveCount) return false;
    lastMoveCount = snapshot.moveCount;
  }
  return true;
}

export function encodeSoloProgress(progress: SoloProgress): string {
  if (!validState(progress.state, progress.gameId, progress.starter) || !validHistory(progress)
      || !['easy', 'thoughtful'].includes(progress.difficulty)) throw new Error('invalid solo progress');
  const serialized = JSON.stringify({ version: VERSION, gameId: progress.gameId, difficulty: progress.difficulty,
    starter: progress.starter, state: serializeState(progress.state), history: progress.history.map(serializeState) });
  if (serialized.length > SOLO_PROGRESS_MAX_BYTES) throw new Error('solo progress too large');
  return serialized;
}

export function decodeSoloProgress(gameId: SoloGameId, serialized: string): SoloProgress {
  if (serialized.length > SOLO_PROGRESS_MAX_BYTES) throw new Error('solo progress too large');
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid solo progress');
  const record = value as Record<string, unknown>;
  if (record.version !== VERSION || record.gameId !== gameId || !['easy', 'thoughtful'].includes(record.difficulty as string)
      || !['human', 'computer'].includes(record.starter as string) || typeof record.state !== 'string'
      || !Array.isArray(record.history) || record.history.length > SOLO_HISTORY_MAX
      || !record.history.every((state) => typeof state === 'string')) throw new Error('invalid solo progress');
  const progress: SoloProgress = { gameId, difficulty: record.difficulty as SoloDifficulty, starter: record.starter as SoloStarter,
    state: decodeState(gameId, record.state), history: record.history.map((state) => decodeState(gameId, state as string)) };
  if (!validState(progress.state, gameId, progress.starter) || !validHistory(progress)) throw new Error('invalid solo progress');
  return progress;
}

export function readSoloProgress(gameId: SoloGameId): SoloProgressRead {
  let stored: string | null;
  try { stored = window.localStorage.getItem(soloProgressKey(gameId)); }
  catch { return { kind: 'unavailable' }; }
  if (stored === null) return { kind: 'empty' };
  try { return { kind: 'valid', progress: decodeSoloProgress(gameId, stored) }; }
  catch { return { kind: 'invalid' }; }
}

export function saveSoloProgress(progress: SoloProgress): boolean {
  try { window.localStorage.setItem(soloProgressKey(progress.gameId), encodeSoloProgress(progress)); return true; }
  catch { return false; }
}
