const NICKNAME_STORAGE_KEY = 'gamehall:nickname:v1';

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
