const roomCodeCharacters = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(roomCodeCharacters, '').slice(0, 6);
}

export function parseRoomCodeInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const containsRoomQuery = /(?:[?&]|^)room=/i.test(trimmed);
  const looksLikeUrl = /^https?:\/\//i.test(trimmed);
  if (containsRoomQuery || looksLikeUrl) {
    const roomMatch = trimmed.match(/(?:[?&]|^)room=([^&#\s)\]]+)/i);
    if (roomMatch) {
      try {
        return normalizeRoomCode(decodeURIComponent(roomMatch[1] ?? ''));
      } catch {
        return '';
      }
    }

    try {
      const url = new URL(trimmed, 'http://gamehall.local');
      const code = url.searchParams.get('room');
      return code === null ? '' : normalizeRoomCode(code);
    } catch {
      return '';
    }
  }

  return normalizeRoomCode(trimmed);
}

export function removeRoomQueryFromAddress(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('room')) return;
  url.searchParams.delete('room');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
