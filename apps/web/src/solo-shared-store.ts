import type { SoloGameId } from './solo-ai';
import { secureUuid } from './secure-id';
import { decodeSoloProgress, encodeSoloProgress, readSoloSnapshot, type SoloProgress, type SoloSnapshot, type SoloWriteResult } from './solo-progress';

const DATABASE = 'gamehall-solo-progress';
const STORE = 'games';
const CHANNEL = 'gamehall:solo-progress';
const STORAGE_TIMEOUT_MS = 4_000;

type StoredGame = { gameId: SoloGameId; token: string; serialized: string };

function available(): boolean { return typeof indexedDB !== 'undefined'; }

function openDatabase(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    const finish = (database: IDBDatabase | null) => {
      if (settled) { database?.close(); return; }
      settled = true;
      window.clearTimeout(timer);
      resolve(database);
    };
    const timer = window.setTimeout(() => finish(null), STORAGE_TIMEOUT_MS);
    try { request = indexedDB.open(DATABASE, 1); }
    catch { finish(null); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'gameId' });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      finish(database);
    };
    request.onerror = () => finish(null);
    request.onblocked = () => { /* The timeout keeps an older tab from blocking practice indefinitely. */ };
  });
}

function snapshotFromRecord(gameId: SoloGameId, value: unknown): SoloSnapshot {
  if (value === undefined) {
    const legacy = readSoloSnapshot(gameId);
    return legacy.read.kind === 'unavailable' ? { read: { kind: 'empty' }, token: null } : legacy;
  }
  if (!value || typeof value !== 'object') return { read: { kind: 'unavailable' }, token: null };
  const record = value as Partial<StoredGame>;
  if (record.gameId !== gameId || typeof record.token !== 'string' || !/^idb:[0-9a-f-]{36}$/.test(record.token)
      || typeof record.serialized !== 'string') return { read: { kind: 'unavailable' }, token: null };
  try { return { read: { kind: 'valid', progress: decodeSoloProgress(gameId, record.serialized) }, token: record.token }; }
  catch { return { read: { kind: 'invalid' }, token: record.token }; }
}

function announceSave(gameId: SoloGameId): void {
  window.dispatchEvent(new CustomEvent('gamehall:solo-progress', { detail: gameId }));
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(gameId);
    channel.close();
  } catch { /* focus/visibility still refresh another tab */ }
}

export function subscribeSharedSoloProgress(listener: (gameId: SoloGameId) => void): () => void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'connect-four' || event.data === 'reversi') listener(event.data);
    };
    return () => channel.close();
  } catch { return () => undefined; }
}

export async function readSharedSoloSnapshot(gameId: SoloGameId): Promise<SoloSnapshot> {
  const database = await openDatabase();
  if (!database) return { read: { kind: 'unavailable' }, token: null };
  return new Promise((resolve) => {
    let settled = false;
    let snapshot: SoloSnapshot = { read: { kind: 'unavailable' }, token: null };
    const finish = (value: SoloSnapshot) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      database.close();
      resolve(value);
    };
    let transaction: IDBTransaction;
    const timer = window.setTimeout(() => { try { transaction?.abort(); } catch { /* already settled */ } finish({ read: { kind: 'unavailable' }, token: null }); }, STORAGE_TIMEOUT_MS);
    try {
      transaction = database.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(gameId);
      request.onsuccess = () => { snapshot = snapshotFromRecord(gameId, request.result); };
      transaction.oncomplete = () => finish(snapshot);
      transaction.onabort = transaction.onerror = () => finish({ read: { kind: 'unavailable' }, token: null });
    } catch { finish({ read: { kind: 'unavailable' }, token: null }); }
  });
}

export async function writeSharedSoloProgress(progress: SoloProgress, expectedToken: string | null,
  isCurrent: () => boolean = () => true): Promise<SoloWriteResult> {
  let serialized: string, token: string;
  try { serialized = encodeSoloProgress(progress); token = `idb:${secureUuid()}`; }
  catch { return { kind: 'unavailable' }; }
  const database = await openDatabase();
  if (!database) return { kind: 'unavailable' };
  const result = await new Promise<SoloWriteResult>((resolve) => {
    let settled = false;
    let outcome: SoloWriteResult = { kind: 'unavailable' };
    const finish = (value: SoloWriteResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      database.close();
      resolve(value);
    };
    let transaction: IDBTransaction;
    const timer = window.setTimeout(() => { try { transaction?.abort(); } catch { /* already settled */ } finish({ kind: 'unavailable' }); }, STORAGE_TIMEOUT_MS);
    try {
      transaction = database.transaction(STORE, 'readwrite');
      const request = transaction.objectStore(STORE).get(progress.gameId);
      request.onsuccess = () => {
        const snapshot = snapshotFromRecord(progress.gameId, request.result);
        if (snapshot.read.kind === 'unavailable') { outcome = { kind: 'unavailable' }; return; }
        if (snapshot.token !== expectedToken) { outcome = { kind: 'conflict', snapshot }; return; }
        if (!isCurrent()) { outcome = { kind: 'superseded' }; return; }
        transaction.objectStore(STORE).put({ gameId: progress.gameId, token, serialized } satisfies StoredGame);
        outcome = { kind: 'saved', token };
      };
      transaction.oncomplete = () => finish(outcome);
      transaction.onabort = transaction.onerror = () => finish({ kind: 'unavailable' });
    } catch { finish({ kind: 'unavailable' }); }
  });
  if (result.kind === 'saved') announceSave(progress.gameId);
  return result;
}
