import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyConnectFourAction, createConnectFourState, createDotsAndBoxesState, createReversiState } from '@gamehall/game-core';
import { dotsAfter, type DotsEdge } from './dots-solo';
import { readSharedSoloSnapshot, writeSharedSoloProgress } from './solo-shared-store';
import { readSoloSnapshot, saveSoloProgress, soloProgressKey, type SoloProgress } from './solo-progress';

function progress(col: number | null = null): SoloProgress {
  const initial = createConnectFourState(0);
  if (col === null) return { gameId: 'connect-four', state: initial, history: [], difficulty: 'easy', starter: 'human' };
  const moved = applyConnectFourAction(initial, 0, { type: 'drop', col });
  if (!moved.ok) throw new Error('bad fixture');
  return { gameId: 'connect-four', state: moved.state, history: [initial], difficulty: 'easy', starter: 'human' };
}

async function clearDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('gamehall-solo-progress');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

describe('IndexedDB solo practice authority', () => {
  beforeEach(async () => { await clearDatabase(); window.localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

  it('reads a v1 legacy record and draft checkpoint, then migrates in the first transaction without writing localStorage', async () => {
    const old = progress();
    expect(saveSoloProgress(old)).toBe(true);
    const legacy = readSoloSnapshot('connect-four');
    const first = await readSharedSoloSnapshot('connect-four');
    expect(first).toEqual(legacy);
    const write = await writeSharedSoloProgress(progress(2), legacy.token);
    expect(write.kind).toBe('saved');
    expect((await readSharedSoloSnapshot('connect-four')).read).toEqual({ kind: 'valid', progress: progress(2) });
    expect(window.localStorage.getItem(soloProgressKey('connect-four'))).toBe(legacy.token);
  });

  it('serializes same-game tabs without Web Locks and rejects stale revisions even when moves have equal counts', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const first = await readSharedSoloSnapshot('connect-four');
    const [left, right] = await Promise.all([
      writeSharedSoloProgress(progress(1), first.token),
      writeSharedSoloProgress(progress(4), first.token),
    ]);
    expect([left.kind, right.kind].sort()).toEqual(['conflict', 'saved']);
    const winner = await readSharedSoloSnapshot('connect-four');
    expect(winner.read.kind).toBe('valid');
    const again = await writeSharedSoloProgress(progress(), winner.token);
    expect(again.kind).toBe('saved');
    expect(await writeSharedSoloProgress(progress(2), winner.token)).toMatchObject({ kind: 'conflict' });
  });

  it('keeps dots trace under its own key and CAS revisions without changing existing games', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const fourBefore = await readSharedSoloSnapshot('connect-four');
    const revBefore = await readSharedSoloSnapshot('reversi');
    expect((await writeSharedSoloProgress(progress(), fourBefore.token)).kind).toBe('saved');
    expect((await writeSharedSoloProgress({ gameId: 'reversi', state: createReversiState(0), history: [], difficulty: 'easy', starter: 'human' }, revBefore.token)).kind).toBe('saved');
    const first = createDotsAndBoxesState(0);
    const h: DotsEdge = { type: 'drawEdge', orientation: 'H', row: 0, col: 0 };
    const v: DotsEdge = { type: 'drawEdge', orientation: 'V', row: 0, col: 0 };
    const left: SoloProgress = { gameId: 'dots-and-boxes', state: dotsAfter(first, h), trace: [h], history: [first], difficulty: 'easy', starter: 'human' };
    const right: SoloProgress = { gameId: 'dots-and-boxes', state: dotsAfter(first, v), trace: [v], history: [first], difficulty: 'thoughtful', starter: 'human' };
    const [a, b] = await Promise.all([writeSharedSoloProgress(left, null), writeSharedSoloProgress(right, null)]);
    expect([a.kind, b.kind].sort()).toEqual(['conflict', 'saved']);
    const saved = await readSharedSoloSnapshot('dots-and-boxes');
    expect(saved.read).toEqual({ kind: 'valid', progress: a.kind === 'saved' ? left : right });
    expect((await readSharedSoloSnapshot('connect-four')).read).toEqual({ kind: 'valid', progress: progress() });
    expect((await readSharedSoloSnapshot('reversi')).read).toEqual({ kind: 'valid', progress: { gameId: 'reversi', state: createReversiState(0), history: [], difficulty: 'easy', starter: 'human' } });
    expect(await writeSharedSoloProgress(a.kind === 'saved' ? right : left, null)).toMatchObject({ kind: 'conflict' });
  });

  it('an aborted transaction never becomes a saved record or localStorage mirror', async () => {
    const before = await readSharedSoloSnapshot('connect-four');
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key);
      this.transaction.abort();
      return request;
    });
    expect(await writeSharedSoloProgress(progress(2), before.token)).toEqual({ kind: 'unavailable' });
    expect((await readSharedSoloSnapshot('connect-four')).read).toEqual({ kind: 'empty' });
    expect(window.localStorage.getItem(soloProgressKey('connect-four'))).toBeNull();
  });

  it('fails within a bound when IndexedDB open is blocked', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('indexedDB', { open: () => ({}) });
    const pending = readSharedSoloSnapshot('connect-four');
    await vi.advanceTimersByTimeAsync(4_001);
    expect(await pending).toEqual({ read: { kind: 'unavailable' }, token: null });
  });
});
