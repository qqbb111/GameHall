import { isSokobanSolved, replaySokobanHistory, sokobanLevels, type SokobanLevel } from '@gamehall/game-core';

export type SokobanAttempt = { levelId: string; history: string };
export type SokobanBests = Record<string, string>;
export const SOKOBAN_ATTEMPT_KEY = 'gamehall:sokoban:attempt:v1';
export const SOKOBAN_BEST_PREFIX = 'gamehall:sokoban:best:v1:';
const freshAttempt: SokobanAttempt = { levelId: sokobanLevels[0]!.id, history: '' };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsedAttempt(value: unknown): SokobanAttempt | null {
  if (!record(value) || value.version !== 1 || typeof value.levelId !== 'string' || typeof value.history !== 'string'
    || Object.keys(value).sort().join(',') !== 'history,levelId,version') return null;
  const level = sokobanLevels.find((entry) => entry.id === value.levelId);
  if (!level) return null;
  try { replaySokobanHistory(level, value.history); } catch { return null; }
  return { levelId: level.id, history: value.history };
}

function parsedBest(value: unknown, level: SokobanLevel): string | null {
  if (!record(value) || value.version !== 1 || value.levelId !== level.id || typeof value.history !== 'string'
    || Object.keys(value).sort().join(',') !== 'history,levelId,version') return null;
  try {
    return isSokobanSolved(level, replaySokobanHistory(level, value.history)) ? value.history : null;
  } catch { return null; }
}

function encoded(levelId: string, history: string): string {
  return JSON.stringify({ version: 1, levelId, history });
}

function score(level: SokobanLevel, history: string): { steps: number; pushes: number } {
  const state = replaySokobanHistory(level, history);
  if (!isSokobanSolved(level, state)) throw new Error('unsolved sokoban best');
  return { steps: state.steps, pushes: state.pushes };
}

/** Each score has its own key; concurrent tabs cannot overwrite a different, better score. */
export function sokobanBestKey(level: SokobanLevel, history: string): string {
  const { steps, pushes } = score(level, history);
  return `${SOKOBAN_BEST_PREFIX}${level.id}:${steps}-${pushes}`;
}

/** Invalid data never enters game state. Browser storage may throw even on read. */
export function readSokobanAttempt(): { attempt: SokobanAttempt; warning: string | null; stored: boolean } {
  try {
    const raw = window.sessionStorage.getItem(SOKOBAN_ATTEMPT_KEY);
    if (raw === null) return { attempt: freshAttempt, warning: null, stored: false };
    const attempt = parsedAttempt(JSON.parse(raw) as unknown);
    return attempt ? { attempt, warning: null, stored: true }
      : { attempt: freshAttempt, warning: '本标签的推箱子尝试记录无效，已从第一关重新开始。', stored: false };
  } catch {
    return { attempt: freshAttempt, warning: '本标签的推箱子尝试记录无法读取；本次仍可继续玩，刷新后可能需要重做。', stored: false };
  }
}

export type SokobanHomeAttempt = { levelNumber: number; steps: number; pushes: number; solved: boolean };

/** Home only reports a validated, stored attempt; the fallback first level is not a resume. */
export function readSokobanHomeAttempt(): SokobanHomeAttempt | null {
  const loaded = readSokobanAttempt();
  if (!loaded.stored) return null;
  const levelNumber = sokobanLevels.findIndex((level) => level.id === loaded.attempt.levelId) + 1;
  const level = sokobanLevels[levelNumber - 1]!;
  const state = replaySokobanHistory(level, loaded.attempt.history);
  return { levelNumber, steps: state.steps, pushes: state.pushes, solved: isSokobanSolved(level, state) };
}

/** Null means localStorage could not be read, not that no levels were completed. */
export function readSokobanHomeCompletedCount(): number | null {
  const loaded = readSokobanBests();
  return loaded.readable ? Object.keys(loaded.bests).length : null;
}

export function writeSokobanAttempt(attempt: SokobanAttempt): string | null {
  if (!parsedAttempt({ version: 1, ...attempt })) throw new Error('invalid sokoban attempt');
  try {
    window.sessionStorage.setItem(SOKOBAN_ATTEMPT_KEY, encoded(attempt.levelId, attempt.history));
    return null;
  } catch { return '本标签的推箱子尝试暂时无法保存；本次可继续玩，刷新后可能需要重做。'; }
}

export function readSokobanBests(): { bests: SokobanBests; warning: string | null; readable: boolean; keys: string[] } {
  const bests: SokobanBests = {};
  const keys: string[] = [];
  let invalid = false;
  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(SOKOBAN_BEST_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      let value: unknown;
      try { value = JSON.parse(raw) as unknown; } catch { invalid = true; continue; }
      const level = sokobanLevels.find((entry) => key.startsWith(`${SOKOBAN_BEST_PREFIX}${entry.id}:`));
      if (!level) { invalid = true; continue; }
      const history = parsedBest(value, level);
      if (history === null || sokobanBestKey(level, history) !== key) { invalid = true; continue; }
      const previous = bests[level.id];
      bests[level.id] = previous ? betterSokobanHistory(level, previous, history) : history;
    }
    return { bests, warning: invalid ? '部分推箱子最佳成绩无效，已忽略；重试保存可清理坏记录。' : null, readable: true, keys };
  } catch {
    return { bests, warning: '推箱子最佳成绩暂时无法读取；已知成绩保留在本页，稍后可重试保存。', readable: false, keys };
  }
}

/** A total order keeps merges independent of tab order, including equal-score routes. */
export function betterSokobanHistory(level: SokobanLevel, left: string, right: string): string {
  const a = score(level, left);
  const b = score(level, right);
  return a.steps < b.steps || a.steps === b.steps && (a.pushes < b.pushes || a.pushes === b.pushes && left <= right)
    ? left : right;
}

export function mergeSokobanBests(known: SokobanBests, incoming: SokobanBests): SokobanBests {
  const result: SokobanBests = {};
  for (const level of sokobanLevels) {
    for (const history of [known[level.id], incoming[level.id]]) {
      if (history === undefined || parsedBest({ version: 1, levelId: level.id, history }, level) === null) continue;
      const previous = result[level.id];
      result[level.id] = previous ? betterSokobanHistory(level, previous, history) : history;
    }
  }
  return result;
}

/** Independent score keys converge under interleaved tabs; prune only strictly worse candidates. */
export function writeSokobanBests(known: SokobanBests): { bests: SokobanBests; warning: string | null } {
  const current = readSokobanBests();
  const merged = mergeSokobanBests(known, current.bests);
  if (!current.readable) return { bests: merged, warning: current.warning };
  try {
    for (const level of sokobanLevels) {
      const history = merged[level.id];
      if (history !== undefined && history !== current.bests[level.id]) {
        window.localStorage.setItem(sokobanBestKey(level, history), encoded(level.id, history));
      }
    }
    const after = readSokobanBests();
    if (!after.readable) return { bests: merged, warning: after.warning };
    for (const key of after.keys) {
      const currentBest = sokobanLevels.find((level) => key.startsWith(`${SOKOBAN_BEST_PREFIX}${level.id}:`));
      const history = currentBest && after.bests[currentBest.id];
      if (!currentBest || !history || key !== sokobanBestKey(currentBest, history)) window.localStorage.removeItem(key);
    }
    return { bests: mergeSokobanBests(merged, after.bests), warning: null };
  } catch {
    return { bests: merged, warning: '推箱子最佳成绩暂时无法保存；已知成绩保留在本页，稍后可重试保存。' };
  }
}
