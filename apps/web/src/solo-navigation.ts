import type { SoloGameId } from './solo-ai';
export type PracticeGameId = SoloGameId | 'twenty-four';

const practiceEntryKey = '__gamehallPracticeEntryV1';

export function practiceFromSearch(search: string): PracticeGameId | null {
  const value = new URLSearchParams(search).get('practice');
  return value === 'connect-four' || value === 'reversi' || value === 'dots-and-boxes' || value === 'twenty-four' ? value : null;
}

function addressWithPractice(gameId: PracticeGameId | null): string {
  const url = new URL(window.location.href);
  if (gameId) url.searchParams.set('practice', gameId);
  else url.searchParams.delete('practice');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function pushPracticeAddress(gameId: PracticeGameId): void {
  const prior = window.history.state as unknown;
  const state = prior !== null && typeof prior === 'object' && !Array.isArray(prior)
    ? { ...prior, [practiceEntryKey]: { gameId } }
    : { [practiceEntryKey]: { gameId }, previousState: prior };
  window.history.pushState(state, '', addressWithPractice(gameId));
}

export function leavePracticeAddress(): 'back' | 'replace' {
  const current = practiceFromSearch(window.location.search);
  const state: unknown = window.history.state;
  const marker = state && typeof state === 'object' ? (state as Record<string, unknown>)[practiceEntryKey] : null;
  if (marker && typeof marker === 'object' && (marker as { gameId?: unknown }).gameId === current && current !== null && window.history.length > 1) {
    window.history.back();
    return 'back';
  }
  window.history.replaceState(window.history.state, '', addressWithPractice(null));
  return 'replace';
}
