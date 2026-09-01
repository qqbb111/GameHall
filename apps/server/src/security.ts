import { createHash, randomBytes } from 'node:crypto';

const bidiAndControl = /[\p{Cc}\p{Cf}]/u;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function normalizeNickname(input: string): { display: string; key: string } | null {
  const display = input.normalize('NFC').trim().replace(/\s+/gu, ' ');
  // U+200D is the visible emoji grapheme joiner (for example 👨‍👩‍👧‍👦).
  // Other format/control characters remain forbidden to prevent invisible or
  // bidirectional nickname spoofing.
  const safetyText = display.replaceAll('\u200D', '');
  if (!safetyText || bidiAndControl.test(safetyText)) return null;
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
  const count = [...segmenter.segment(display)].length;
  if (count < 1 || count > 16) return null;
  return { display, key: display.normalize('NFKC').toLocaleLowerCase('zh-CN') };
}

export function normalizeRoomMessage(input: string): string | null {
  const display = input.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const safetyText = display.replaceAll('\u200D', '');
  if (!safetyText || bidiAndControl.test(safetyText)) return null;
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
  const count = [...segmenter.segment(display)].length;
  return count >= 1 && count <= 100 ? display : null;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export class SlidingWindowLimiter {
  private readonly attempts = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs: number, nowMs = Date.now()): boolean {
    const cutoff = nowMs - windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= limit) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.attempts.set(key, recent);
    return true;
  }

  sweep(nowMs = Date.now()): void {
    // The longest configured bucket is the hourly session-creation limit.
    const cutoff = nowMs - 60 * 60_000;
    for (const [key, timestamps] of this.attempts) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length === 0) this.attempts.delete(key);
      else this.attempts.set(key, recent);
    }
  }
}
