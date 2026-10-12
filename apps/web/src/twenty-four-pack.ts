import type { Hand } from './twenty-four-practice';
import type { PackWorkerResponse } from './twenty-four-pack.worker';

export class PackGenerator {
  private generation = 0;
  private worker: Worker | null = null;
  private rejectPending: ((error: Error) => void) | null = null;
  cancel() { this.generation++; this.rejectPending?.(new Error('已取消生成')); this.rejectPending = null; this.worker?.terminate(); this.worker = null; }
  async generate(): Promise<Hand[]> {
    this.cancel();
    const generation = this.generation;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (generation !== this.generation) throw new Error('已取消生成');
      try {
        const pack = await new Promise<Hand[]>((resolve, reject) => {
          let settled = false;
          let worker: Worker;
          try { worker = new Worker(new URL('./twenty-four-pack.worker.ts', import.meta.url), { type: 'module' }); }
          catch { reject(new Error('无法启动题目生成器')); return; }
          this.worker = worker;
          const finish = (result: Hand[] | Error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            worker.terminate();
            if (this.worker === worker) this.worker = null;
            if (this.rejectPending) this.rejectPending = null;
            if (result instanceof Error) reject(result); else resolve(result);
          };
          const timer = window.setTimeout(() => finish(new Error('题组生成超时')), 8_000);
          this.rejectPending = (error) => finish(error);
          worker.onerror = () => finish(new Error('题组生成器出错'));
          worker.onmessage = (event: MessageEvent<PackWorkerResponse>) => {
            if (event.data.requestId !== generation) return;
            if (event.data.pack) finish(event.data.pack);
            else finish(new Error(event.data.error ?? '题组生成失败'));
          };
          try { worker.postMessage({ requestId: generation }); }
          catch { finish(new Error('题目生成器无法接收请求')); }
        });
        if (generation !== this.generation) throw new Error('已取消生成');
        return pack;
      } catch (error) {
        if (generation !== this.generation || attempt === 1) throw error;
      }
    }
    throw new Error('题组生成失败');
  }
}
