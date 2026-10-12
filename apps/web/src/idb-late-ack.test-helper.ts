import { vi } from 'vitest';

/** Let a real fake-indexeddb transaction commit while withholding its JS completion callback. */
export function holdFirstWriteCompletion() {
  const transaction = IDBDatabase.prototype.transaction;
  let held = false;
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
    const tx = transaction.apply(this, args);
    if (args[1] === 'readwrite' && !held) {
      held = true;
      Object.defineProperty(tx, 'oncomplete', { configurable: true, get: () => null, set: () => undefined });
    }
    return tx;
  });
  return () => held;
}

export function captureStorageTimers() {
  const callbacks: Array<() => void> = [];
  const native = window.setTimeout.bind(window);
  vi.spyOn(window, 'setTimeout').mockImplementation((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (timeout === 4_000 && typeof handler === 'function') callbacks.push(() => handler(...args));
    return native(handler, timeout, ...args);
  });
  return callbacks;
}
