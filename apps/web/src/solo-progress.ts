import { applyConnectFourAction, connectFourDefinition, connectFourLine, createConnectFourState, createReversiState, legalReversiMoves,
  otherPlayer, reversiDefinition, type ConnectFourState, type ReversiState } from '@gamehall/game-core';
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

function hasFour(board: ConnectFourState['board']): boolean {
  for (let row = 0; row < 6; row++) for (let col = 0; col < 7; col++) {
    const player = board[row * 7 + col];
    if ((player === 0 || player === 1) && connectFourLine(board, row, col, player).length > 0) return true;
  }
  return false;
}

function validFour(state: ConnectFourState): boolean {
  if (state.moveCount === 0) return JSON.stringify(state) === JSON.stringify(createConnectFourState(state.firstPlayer));
  const actor = state.moveCount % 2 ? state.firstPlayer : otherPlayer(state.firstPlayer);
  if (state.lastMove?.player !== actor || state.board.filter((cell) => cell === state.firstPlayer).length !== Math.ceil(state.moveCount / 2)
      || state.board.filter((cell) => cell === otherPlayer(state.firstPlayer)).length !== Math.floor(state.moveCount / 2)) return false;
  const before = [...state.board];
  before[state.lastMove.row * 7 + state.lastMove.col] = null;
  if (hasFour(before)) return false;
  const prior: ConnectFourState = { ...state, board: before, phase: 'playing', turn: actor, moveCount: state.moveCount - 1,
    lastMove: null, winningLine: [], result: null };
  const replay = applyConnectFourAction(prior, actor, { type: 'drop', col: state.lastMove.col });
  if (!replay.ok) return false;
  return replay.state.board.every((cell, index) => cell === state.board[index]) && replay.state.phase === state.phase
    && replay.state.turn === state.turn && JSON.stringify(replay.state.lastMove) === JSON.stringify(state.lastMove)
    && JSON.stringify(replay.state.winningLine) === JSON.stringify(state.winningLine)
    && JSON.stringify(replay.state.result) === JSON.stringify(state.result);
}

function validReversi(state: ReversiState): boolean {
  const occupied = state.counts[0] + state.counts[1];
  if (occupied !== state.moveCount + 4) return false;
  if (state.moveCount === 0) return JSON.stringify(state) === JSON.stringify(createReversiState(state.blackPlayer));
  if (!state.lastMove || ![0, 1].includes(state.lastMove.player)
      || state.board[state.lastMove.row * 8 + state.lastMove.col] !== state.lastMove.player
      || state.lastFlipped.length === 0 || state.lastFlipped.some((cell) => state.board[cell.row * 8 + cell.col] !== state.lastMove?.player)) return false;
  const actor = state.lastMove.player;
  const currentMoves = legalReversiMoves(state.board, state.turn);
  const opponentMoves = legalReversiMoves(state.board, otherPlayer(state.turn));
  if (state.phase === 'playing') {
    if (currentMoves.length === 0 || (state.lastPass === null ? state.turn !== otherPlayer(actor)
      : state.lastPass !== otherPlayer(actor) || state.turn !== actor || opponentMoves.length !== 0)) return false;
    return true;
  }
  if (state.turn !== actor || state.lastPass !== null || (occupied !== 64 && (currentMoves.length || opponentMoves.length))) return false;
  const winner = state.counts[0] === state.counts[1] ? null : state.counts[0] > state.counts[1] ? 0 : 1;
  return winner === null ? state.result?.type === 'draw'
    : state.result?.type === 'win' && state.result.winner === winner && state.result.reason === 'score';
}

function validState(state: SoloState, gameId: SoloGameId, starter: SoloStarter): boolean {
  if (state.kind !== gameId || (state.kind === 'connect-four' ? state.firstPlayer : state.blackPlayer) !== expectedFirst(starter)) return false;
  return state.kind === 'connect-four' ? validFour(state) : validReversi(state);
}

function validHistory(progress: SoloProgress): boolean {
  if (progress.history.length > SOLO_HISTORY_MAX) return false;
  let lastMoveCount = -1;
  for (const snapshot of progress.history) {
    if (!validState(snapshot, progress.gameId, progress.starter) || snapshot.phase !== 'playing' || snapshot.turn !== 0
        || snapshot.moveCount <= lastMoveCount || snapshot.moveCount >= progress.state.moveCount) return false;
    lastMoveCount = snapshot.moveCount;
  }
  for (const snapshot of progress.history) {
    for (let index = 0; index < snapshot.board.length; index++) {
      if (snapshot.board[index] === null) continue;
      if (progress.state.board[index] === null || progress.gameId === 'connect-four' && snapshot.board[index] !== progress.state.board[index]) return false;
    }
  }
  return true;
}

export function encodeSoloProgress(progress: SoloProgress): string {
  if (!validState(progress.state, progress.gameId, progress.starter) || !validHistory(progress)
      || !['easy', 'thoughtful'].includes(progress.difficulty)) throw new Error('invalid solo progress');
  const serialized = JSON.stringify({ version: VERSION, gameId: progress.gameId, difficulty: progress.difficulty,
    starter: progress.starter, state: serializeState(progress.state), history: progress.history.map(serializeState) });
  if (serialized.length > SOLO_PROGRESS_MAX_BYTES || new TextEncoder().encode(serialized).byteLength > SOLO_PROGRESS_MAX_BYTES) throw new Error('solo progress too large');
  return serialized;
}

export function decodeSoloProgress(gameId: SoloGameId, serialized: string): SoloProgress {
  if (serialized.length > SOLO_PROGRESS_MAX_BYTES || new TextEncoder().encode(serialized).byteLength > SOLO_PROGRESS_MAX_BYTES) throw new Error('solo progress too large');
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
