import { secureUuid } from './secure-id';
import { decodeTwentyFourProgress, encodeTwentyFourProgress, TWENTY_FOUR_MAX_BYTES, type TwentyFourProgress } from './twenty-four-practice';

const DATABASE = 'gamehall-twenty-four-progress';
const STORE = 'progress';
const KEY = 'twenty-four';
const CHANNEL = 'gamehall:twenty-four-progress';
const DRAFT_KEY = 'gamehall:twenty-four:draft:v1';
const TIMEOUT = 4_000;
const tabId = (() => { try { return secureUuid(); } catch { return null; } })();
type RecordValue = { gameId: typeof KEY; token: string; serialized: string };
export type Snapshot = { kind: 'valid'; progress: TwentyFourProgress; token: string } | { kind: 'empty' | 'unavailable'; token: null } | { kind: 'invalid'; token: string };
export type WriteResult = { kind: 'saved'; token: string } | { kind: 'conflict'; snapshot: Snapshot } | { kind: 'unavailable' | 'superseded' };
export type Draft = { progress: TwentyFourProgress; baseToken: string | null };

async function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (db: IDBDatabase | null) => { if (done) { db?.close(); return; } done = true; window.clearTimeout(timer); resolve(db); };
    const timer = window.setTimeout(() => finish(null), TIMEOUT);
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'gameId' }); };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); finish(request.result); };
      request.onerror = () => finish(null);
      request.onblocked = () => undefined;
    } catch { finish(null); }
  });
}
function decodeRecord(value: unknown): Snapshot {
  if (value === undefined) return { kind: 'empty', token: null };
  if (!value || typeof value !== 'object') return { kind: 'invalid', token: 'invalid' };
  const record = value as Partial<RecordValue>;
  if (record.gameId !== KEY || typeof record.token !== 'string' || !/^idb:[0-9a-f-]{36}$/.test(record.token)) return { kind: 'invalid', token: 'invalid' };
  if (typeof record.serialized !== 'string') return { kind: 'invalid', token: record.token };
  try { return { kind: 'valid', progress: decodeTwentyFourProgress(record.serialized), token: record.token }; }
  catch { return { kind: 'invalid', token: record.token }; }
}
function announce() {
  window.dispatchEvent(new Event(CHANNEL));
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage(tabId); channel.close(); } catch { /* focus also checks */ }
}
export function subscribeTwentyFourStore(listener: () => void): () => void {
  try { const channel = new BroadcastChannel(CHANNEL); channel.onmessage = (event) => { if (event.data !== tabId) listener(); }; return () => channel.close(); }
  catch { return () => undefined; }
}
export async function readTwentyFourSnapshot(): Promise<Snapshot> {
  const db = await open();
  if (!db) return { kind: 'unavailable', token: null };
  return new Promise((resolve) => {
    let done = false;
    let value: Snapshot = { kind: 'unavailable', token: null };
    let transaction: IDBTransaction;
    const finish = (result: Snapshot) => { if (done) return; done = true; window.clearTimeout(timer); db.close(); resolve(result); };
    const timer = window.setTimeout(() => { try { transaction?.abort(); } catch { /* settled */ } finish({ kind: 'unavailable', token: null }); }, TIMEOUT);
    try {
      transaction = db.transaction(STORE, 'readonly');
      transaction.objectStore(STORE).get(KEY).onsuccess = (event) => { value = decodeRecord((event.target as IDBRequest).result); };
      transaction.oncomplete = () => finish(value);
      transaction.onerror = transaction.onabort = () => finish({ kind: 'unavailable', token: null });
    } catch { finish({ kind: 'unavailable', token: null }); }
  });
}
export async function writeTwentyFourProgress(progress: TwentyFourProgress, expectedToken: string | null, isCurrent: () => boolean): Promise<WriteResult> {
  let serialized: string, token: string;
  try { serialized = encodeTwentyFourProgress(progress); token = `idb:${secureUuid()}`; } catch { return { kind: 'unavailable' }; }
  const db = await open();
  if (!db) return { kind: 'unavailable' };
  const result = await new Promise<WriteResult>((resolve) => {
    let done = false;
    let outcome: WriteResult = { kind: 'unavailable' };
    let transaction: IDBTransaction;
    const finish = (value: WriteResult) => { if (done) return; done = true; window.clearTimeout(timer); db.close(); resolve(value); };
    const timer = window.setTimeout(() => { try { transaction?.abort(); } catch { /* settled */ } finish({ kind: 'unavailable' }); }, TIMEOUT);
    try {
      transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).get(KEY).onsuccess = (event) => {
        const current = decodeRecord((event.target as IDBRequest).result);
        const currentToken = current.kind === 'valid' || current.kind === 'invalid' ? current.token : null;
        if (currentToken !== expectedToken) { outcome = { kind: 'conflict', snapshot: current }; return; }
        if (!isCurrent()) { outcome = { kind: 'superseded' }; return; }
        transaction.objectStore(STORE).put({ gameId: KEY, token, serialized } satisfies RecordValue);
        outcome = { kind: 'saved', token };
      };
      transaction.oncomplete = () => finish(outcome);
      transaction.onerror = transaction.onabort = () => finish({ kind: 'unavailable' });
    } catch { finish({ kind: 'unavailable' }); }
  });
  if (result.kind === 'saved') announce();
  return result;
}
export function writeTwentyFourDraft(draft: Draft): boolean {
  try {
    const serialized = JSON.stringify({ version: 1, baseToken: draft.baseToken, progress: encodeTwentyFourProgress(draft.progress) });
    if (new TextEncoder().encode(serialized).byteLength > TWENTY_FOUR_MAX_BYTES + 512) return false;
    window.sessionStorage.setItem(DRAFT_KEY, serialized);
    return true;
  } catch { return false; }
}
export function readTwentyFourDraft(): Draft | null {
  try {
    const serialized = window.sessionStorage.getItem(DRAFT_KEY);
    if (!serialized) return null;
    if (new TextEncoder().encode(serialized).byteLength > TWENTY_FOUR_MAX_BYTES + 512) throw new Error('large draft');
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object') throw new Error('invalid draft');
    const draft = value as { version?: unknown; baseToken?: unknown; progress?: unknown };
    if (draft.version !== 1 || draft.baseToken !== null && (typeof draft.baseToken !== 'string' || !/^idb:[0-9a-f-]{36}$/.test(draft.baseToken)) || typeof draft.progress !== 'string') throw new Error('invalid draft');
    return { progress: decodeTwentyFourProgress(draft.progress), baseToken: draft.baseToken as string | null };
  } catch { try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* blocked */ } return null; }
}
export function clearTwentyFourDraft() { try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* blocked */ } }
