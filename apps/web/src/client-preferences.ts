const NICKNAME_STORAGE_KEY = 'gamehall:nickname:v1';
const FAVORITES_STORAGE_KEY = 'gamehall:favorites:v1';

export function readRememberedNickname(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberNickname(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NICKNAME_STORAGE_KEY, value);
  } catch {
    // Storage can be disabled by privacy settings. Nickname persistence is a
    // convenience only and must never block room creation or reconnection.
  }
}

export { NICKNAME_STORAGE_KEY };

export function readFavoriteGames(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberFavoriteGames(ids: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Favorites remain usable for this visit when storage is unavailable.
  }
}

export { FAVORITES_STORAGE_KEY };
