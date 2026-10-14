import { lightsOutLevels, replayLightsOutHistory, type LightsOutLevel } from '@gamehall/game-core';

export type LightsOutAttempt = { levelId: string; history: number[] };
export type LightsOutBests = Record<string, number[]>;
export const LIGHTS_OUT_ATTEMPT_KEY = 'gamehall:lights-out:attempt:v1';
export const LIGHTS_OUT_BEST_PREFIX = 'gamehall:lights-out:best:v1:';
const freshAttempt = (): LightsOutAttempt => ({ levelId: lightsOutLevels[0]!.id, history: [] });

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsedAttempt(value: unknown): LightsOutAttempt | null {
  if (!record(value) || value.version !== 1 || typeof value.levelId !== 'string' || !Array.isArray(value.history)
    || Object.keys(value).sort().join(',') !== 'history,levelId,version') return null;
  const level = lightsOutLevels.find((item) => item.id === value.levelId);
  if (!level) return null;
  try { replayLightsOutHistory(level, value.history); } catch { return null; }
  return { levelId: level.id, history: [...value.history] as number[] };
}

function parsedBest(value: unknown, level: LightsOutLevel): number[] | null {
  const attempt = parsedAttempt(value);
  if (!attempt || attempt.levelId !== level.id) return null;
  return replayLightsOutHistory(level, attempt.history) === 0 ? attempt.history : null;
}

function encoded(attempt: LightsOutAttempt): string {
  return JSON.stringify({ version: 1, levelId: attempt.levelId, history: attempt.history });
}

/** Each distinct winning route has its own key, so racing tabs never overwrite one another. */
export function lightsOutBestKey(level: LightsOutLevel, history: number[]): string {
  if (replayLightsOutHistory(level, history) !== 0) throw new Error('unsolved lights-out best');
  return `${LIGHTS_OUT_BEST_PREFIX}${level.id}:${history.map((index) => index.toString(36).padStart(2, '0')).join('')}`;
}

export function readLightsOutAttempt(): { attempt: LightsOutAttempt; warning: string | null; stored: boolean } {
  try {
    const raw = window.sessionStorage.getItem(LIGHTS_OUT_ATTEMPT_KEY);
    if (raw === null) return { attempt: freshAttempt(), warning: null, stored: false };
    const attempt = parsedAttempt(JSON.parse(raw) as unknown);
    return attempt ? { attempt, warning: null, stored: true }
      : { attempt: freshAttempt(), warning: '本标签的连灯解谜记录无效，已从第一关重新开始。', stored: false };
  } catch {
    return { attempt: freshAttempt(), warning: '本标签的连灯解谜记录无法读取；仍可继续玩，刷新后可能需要重做。', stored: false };
  }
}

export function readLightsOutHomeAttempt(): { kind: 'fresh' | 'unavailable' } | { kind: 'saved'; levelNumber: number; moves: number; solved: boolean } {
  const loaded = readLightsOutAttempt();
  if (!loaded.stored) return { kind: loaded.warning ? 'unavailable' : 'fresh' };
  const levelNumber = lightsOutLevels.findIndex((level) => level.id === loaded.attempt.levelId) + 1;
  const level = lightsOutLevels[levelNumber - 1]!;
  return { kind: 'saved', levelNumber, moves: loaded.attempt.history.length,
    solved: replayLightsOutHistory(level, loaded.attempt.history) === 0 };
}

export function writeLightsOutAttempt(attempt: LightsOutAttempt): string | null {
  if (!parsedAttempt({ version: 1, ...attempt })) throw new Error('invalid lights-out attempt');
  try {
    window.sessionStorage.setItem(LIGHTS_OUT_ATTEMPT_KEY, encoded(attempt));
    return null;
  } catch { return '本标签的连灯解谜进度暂时无法保存；仍可继续玩，刷新后可能需要重做。'; }
}

/** Shorter complete histories win; equal lengths use numeric lexicographic order. */
export function betterLightsOutHistory(left: number[], right: number[]): number[] {
  if (left.length !== right.length) return left.length < right.length ? left : right;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index]! < right[index]! ? left : right;
  }
  return left;
}

export function mergeLightsOutBests(known: LightsOutBests, incoming: LightsOutBests): LightsOutBests {
  const result: LightsOutBests = {};
  for (const level of lightsOutLevels) {
    for (const history of [known[level.id], incoming[level.id]]) {
      if (!history || parsedBest({ version: 1, levelId: level.id, history }, level) === null) continue;
      const previous = result[level.id];
      result[level.id] = previous ? betterLightsOutHistory(previous, history) : history;
    }
  }
  return result;
}

export function readLightsOutBests(): { bests: LightsOutBests; warning: string | null; readable: boolean; keys: string[] } {
  const bests: LightsOutBests = {};
  const keys: string[] = [];
  let invalid = false;
  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(LIGHTS_OUT_BEST_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      let value: unknown;
      try { value = JSON.parse(raw) as unknown; } catch { invalid = true; continue; }
      const level = lightsOutLevels.find((item) => key.startsWith(`${LIGHTS_OUT_BEST_PREFIX}${item.id}:`));
      if (!level) { invalid = true; continue; }
      const history = parsedBest(value, level);
      if (!history || lightsOutBestKey(level, history) !== key) { invalid = true; continue; }
      const previous = bests[level.id];
      bests[level.id] = previous ? betterLightsOutHistory(previous, history) : history;
    }
    return { bests, warning: invalid ? '部分连灯解谜成绩无效，已忽略。' : null, readable: true, keys };
  } catch {
    return { bests, warning: '连灯解谜成绩暂时无法读取；本页已知成绩会保留，可稍后重试保存。', readable: false, keys };
  }
}

export function readLightsOutHomeCompletedCount(): number | null {
  const loaded = readLightsOutBests();
  return loaded.readable ? Object.keys(loaded.bests).length : null;
}

/** Read-merge-write, then prune only candidates proven worse after a successful read. */
export function writeLightsOutBests(known: LightsOutBests): { bests: LightsOutBests; warning: string | null } {
  const current = readLightsOutBests();
  const merged = mergeLightsOutBests(known, current.bests);
  if (!current.readable) return { bests: merged, warning: current.warning };
  try {
    for (const level of lightsOutLevels) {
      const history = merged[level.id];
      const existing = current.bests[level.id];
      if (history && (!existing || lightsOutBestKey(level, history) !== lightsOutBestKey(level, existing))) {
        window.localStorage.setItem(lightsOutBestKey(level, history), encoded({ levelId: level.id, history }));
      }
    }
    const after = readLightsOutBests();
    if (!after.readable) return { bests: merged, warning: after.warning };
    for (const key of after.keys) {
      const level = lightsOutLevels.find((item) => key.startsWith(`${LIGHTS_OUT_BEST_PREFIX}${item.id}:`));
      const history = level && after.bests[level.id];
      if (!level || !history || key !== lightsOutBestKey(level, history)) window.localStorage.removeItem(key);
    }
    return { bests: mergeLightsOutBests(merged, after.bests), warning: null };
  } catch {
    return { bests: merged, warning: '连灯解谜成绩暂时无法保存；本页已知成绩会保留，可稍后重试保存。' };
  }
}
