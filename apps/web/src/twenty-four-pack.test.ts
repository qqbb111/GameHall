import { afterEach, describe, expect, it, vi } from 'vitest';
import { PackGenerator } from './twenty-four-pack';
import { fixturePack } from './twenty-four-fixture';

class DeferredWorker {
  static instances: DeferredWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  requestId = -1;
  terminated = false;
  constructor() { DeferredWorker.instances.push(this); }
  postMessage(request: { requestId: number }) { this.requestId = request.requestId; }
  terminate() { this.terminated = true; }
  answer(requestId = this.requestId) { this.onmessage?.({ data: { requestId, pack: fixturePack() } } as MessageEvent); }
}
afterEach(() => { DeferredWorker.instances = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('24 点题组 Worker 边界', () => {
  it('错误后限次重试；迟到或不匹配的回包不能覆盖换组结果', async () => {
    vi.stubGlobal('Worker', DeferredWorker);
    const generator = new PackGenerator();
    const first = generator.generate();
    const stale = DeferredWorker.instances[0]!;
    stale.onerror?.();
    await vi.waitFor(() => expect(DeferredWorker.instances).toHaveLength(2));
    DeferredWorker.instances[1]!.answer(999);
    expect(DeferredWorker.instances[1]!.terminated).toBe(false);
    DeferredWorker.instances[1]!.answer();
    expect(await first).toHaveLength(10);
    const second = generator.generate();
    const latest = DeferredWorker.instances[2]!;
    stale.answer();
    expect(latest.terminated).toBe(false);
    latest.answer();
    expect(await second).toHaveLength(10);
  });
  it('取消挂起请求并终止 Worker；超时只重试一次', async () => {
    vi.stubGlobal('Worker', DeferredWorker);
    vi.useFakeTimers();
    const generator = new PackGenerator();
    const pending = generator.generate();
    generator.cancel();
    await expect(pending).rejects.toThrow('已取消生成');
    expect(DeferredWorker.instances[0]!.terminated).toBe(true);
    const retry = generator.generate();
    const failure = expect(retry).rejects.toThrow('题组生成超时');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(DeferredWorker.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(8_000);
    await failure;
    expect(DeferredWorker.instances[2]!.terminated).toBe(true);
  });
});
