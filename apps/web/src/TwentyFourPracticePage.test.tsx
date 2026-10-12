import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { TwentyFourPracticePage } from './TwentyFourPracticePage';
import { fixturePack } from './twenty-four-fixture';
import { readTwentyFourSnapshot, writeTwentyFourDraft, writeTwentyFourProgress } from './twenty-four-store';
import * as store from './twenty-four-store';
import { captureStorageTimers, holdFirstWriteCompletion } from './idb-late-ack.test-helper';
import { newTwentyFourProgress } from './twenty-four-practice';

const pack = fixturePack();
class PackWorkerMock {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  postMessage({ requestId }: { requestId: number }) { queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: { requestId, pack } } as MessageEvent); }); }
  terminate() { this.terminated = true; }
}
beforeEach(() => { vi.stubGlobal('Worker', PackWorkerMock); window.sessionStorage.clear(); });
afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function start(mode: 'practice' | 'challenge' = 'practice') {
  render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
  await screen.findByRole('button', { name: '开始练习' });
  if (mode === 'challenge') fireEvent.click(screen.getByLabelText('60 秒挑战'));
  fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
  await screen.findByLabelText('24 点单人题面');
}

describe('24 点单人流程', () => {
  it('错答即时说明且保留草稿；提示后正确计参考，答案揭晓后由玩家手动进入下一题', async () => {
    await start();
    const input = screen.getByLabelText('输入算式');
    fireEvent.change(input, { target: { value: '1+1+1+1' } });
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/必须恰好使用题面上的四张牌各一次|结果不是 24/);
    expect(input).toHaveValue('1+1+1+1');
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    expect(screen.getByText('一种可行解法的步骤')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: pack[0]!.solution } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('参考解出')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一题' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一题' }));
    expect(screen.getByText('第 2 / 10 题')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看完整答案' }));
    expect(screen.getByText('已查看答案')).toBeInTheDocument();
    expect(screen.getByText('独立解出 0')).toBeInTheDocument();
  });
  it('十题逐题揭晓后结算，可再生成一组', async () => {
    await start();
    for (let index = 0; index < 10; index++) {
      await waitFor(() => expect(screen.getByRole('button', { name: '查看完整答案' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: '查看完整答案' }));
      fireEvent.click(await screen.findByRole('button', { name: index === 9 ? '查看本组结果' : '下一题' }));
    }
    expect(screen.getByText('10 题完成')).toBeInTheDocument();
    expect(screen.getByText(/查看答案 10 题/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再来一组' }));
    await screen.findByText('第 1 / 10 题');
  });
  it('暂停与隐藏停止挑战计时，恢复后按单调时钟到期并禁用提交', async () => {
    await start('challenge');
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(document.visibilityState).toBe('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByText('已暂停，点击继续后作答')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交答案' })).toBeDisabled();
    visible.mockReturnValue('visible');
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    now.mockReturnValue(61_001);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '提示一步' })); });
    expect(screen.getByText('时间到，本组结束')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交答案' })).not.toBeInTheDocument();
  });
  it('两个只读恢复页中关闭已暂停的一个，不改共享 token，也不挡另一页继续', async () => {
    const initial = newTwentyFourProgress('challenge', pack);
    const saved = await writeTwentyFourProgress({ ...initial, remainingMs: 16_500 }, null, () => true);
    if (saved.kind !== 'saved') throw new Error('seed failed');
    const write = vi.spyOn(store, 'writeTwentyFourProgress');
    const first = render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    const second = render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await waitFor(() => expect(within(second.container).getByText('已暂停，点击继续后作答')).toBeInTheDocument());
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pagehide'));
    first.unmount();
    expect(write).not.toHaveBeenCalled();
    expect(store.readTwentyFourDraft()).toBeNull();
    expect((await readTwentyFourSnapshot()).token).toBe(saved.token);
    visible.mockReturnValue('visible');
    fireEvent.focus(window);
    expect(within(second.container).getByRole('button', { name: '继续' })).toBeEnabled();
    expect(within(second.container).queryByText('另一窗口的 24 点进度已改变')).not.toBeInTheDocument();
  });
  it('未开始和已结算页面隐藏、离开、卸载不生成新存档', async () => {
    const write = vi.spyOn(store, 'writeTwentyFourProgress');
    const empty = render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await within(empty.container).findByRole('button', { name: '开始练习' });
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pagehide'));
    empty.unmount();
    expect(write).not.toHaveBeenCalled();
    expect(store.readTwentyFourDraft()).toBeNull();
    visible.mockReturnValue('visible');
    const initial = newTwentyFourProgress('practice', pack);
    const done = { ...initial, answers: pack.map((hand) => ({ kind: 'independent' as const, expression: hand.solution, hints: 0 })),
      index: 10, phase: 'finished' as const, finishReason: 'complete' as const };
    const saved = await writeTwentyFourProgress(done, null, () => true);
    if (saved.kind !== 'saved') throw new Error('seed failed');
    write.mockClear();
    const finished = render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await within(finished.container).findByText('10 题完成');
    visible.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pagehide'));
    finished.unmount();
    expect(write).not.toHaveBeenCalled();
    expect(store.readTwentyFourDraft()).toBeNull();
    expect((await readTwentyFourSnapshot()).token).toBe(saved.token);
  });
  it('运行中的挑战隐藏时只做一次准确 checkpoint，随后的 pagehide 不重写终局', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    await start('challenge');
    await waitFor(async () => expect((await readTwentyFourSnapshot()).kind).toBe('valid'));
    fireEvent.change(screen.getByLabelText('输入算式'), { target: { value: '8+' } });
    clock = 12_000;
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(async () => {
      const latest = await readTwentyFourSnapshot();
      expect(latest.kind === 'valid' && latest.progress.remainingMs).toBe(48_000);
      expect(latest.kind === 'valid' && latest.progress.draft).toBe('8+');
    });
    const saved = await readTwentyFourSnapshot();
    fireEvent(window, new Event('pagehide'));
    expect((await readTwentyFourSnapshot()).token).toBe(saved.token);
    visible.mockReturnValue('visible');
  });
  it('挑战在隐藏瞬间到期只写一次终局，pagehide 与卸载不再续写', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const view = render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: '开始练习' });
    fireEvent.click(screen.getByLabelText('60 秒挑战'));
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    await screen.findByLabelText('24 点单人题面');
    await waitFor(async () => expect((await readTwentyFourSnapshot()).kind).toBe('valid'));
    clock = 61_000;
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText('时间到，本组结束');
    await waitFor(async () => {
      const current = await readTwentyFourSnapshot();
      expect(current.kind === 'valid' && current.progress.phase).toBe('finished');
    });
    const terminal = await readTwentyFourSnapshot();
    expect(terminal.kind === 'valid' && terminal.progress.phase).toBe('finished');
    fireEvent(window, new Event('pagehide'));
    view.unmount();
    expect((await readTwentyFourSnapshot()).token).toBe(terminal.token);
    expect(store.readTwentyFourDraft()).toBeNull();
    visible.mockReturnValue('visible');
  });
  it('有草稿重开需确认；Esc 与背景取消，继续原题', async () => {
    await start();
    fireEvent.change(screen.getByLabelText('输入算式'), { target: { value: '8+' } });
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('输入算式')).toHaveValue('8+');
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    fireEvent.mouseDown(screen.getByRole('alertdialog').parentElement!);
    fireEvent.click(screen.getByRole('alertdialog').parentElement!);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
  it('刷新恢复完整题组与草稿，挑战默认暂停', async () => {
    const first = render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByRole('button', { name: '开始练习' });
    fireEvent.click(screen.getByLabelText('60 秒挑战'));
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    await screen.findByLabelText('24 点单人题面');
    fireEvent.change(screen.getByLabelText('输入算式'), { target: { value: '8+' } });
    first.unmount();
    render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('已暂停，点击继续后作答')).toBeInTheDocument());
    expect(screen.getByLabelText('输入算式')).toHaveValue('8+');
    expect(screen.getByRole('button', { name: '提交答案' })).toBeDisabled();
  });
  it('另一窗口写入后暂停当前题组，玩家明确选择共享进度', async () => {
    await start();
    await waitFor(async () => expect((await readTwentyFourSnapshot()).kind).toBe('valid'));
    const prior = await readTwentyFourSnapshot();
    if (prior.kind !== 'valid') throw new Error('missing saved progress');
    const elsewhere = { ...prior.progress, draft: '8+' };
    expect((await writeTwentyFourProgress(elsewhere, prior.token, () => true)).kind).toBe('saved');
    fireEvent(window, new Event('focus'));
    await screen.findByText('另一窗口的 24 点进度已改变');
    expect(screen.getByRole('button', { name: '提交答案' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '接着共享进度' }));
    await waitFor(() => expect(screen.getByLabelText('输入算式')).toHaveValue('8+'));
    expect(screen.getByText('已暂停，点击继续后作答')).toBeInTheDocument();
  });
  it('同内容草稿即使带旧 token 也使用共享最新 token，继续编辑正常保存', async () => {
    const same = newTwentyFourProgress('practice', pack);
    const first = await writeTwentyFourProgress(same, null, () => true);
    if (first.kind !== 'saved') throw new Error('first save failed');
    const latest = await writeTwentyFourProgress(same, first.token, () => true);
    if (latest.kind !== 'saved') throw new Error('second save failed');
    writeTwentyFourDraft({ progress: same, baseToken: first.token });
    render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('已暂停，点击继续后作答');
    expect(screen.queryByText('另一窗口的 24 点进度已改变')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.change(screen.getByLabelText('输入算式'), { target: { value: '1+' } });
    await waitFor(async () => {
      const saved = await readTwentyFourSnapshot();
      expect(saved.kind === 'valid' && saved.progress.draft).toBe('1+');
    });
    expect(screen.queryByText('另一窗口的 24 点进度已改变')).not.toBeInTheDocument();
  });
  it('StrictMode effect 重放后仍可连续保存两次草稿', async () => {
    const initial = newTwentyFourProgress('practice', pack);
    const saved = await writeTwentyFourProgress(initial, null, () => true);
    expect(saved.kind).toBe('saved');
    render(<StrictMode><TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} /></StrictMode>);
    await screen.findByText('已暂停，点击继续后作答');
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    const input = screen.getByLabelText('输入算式');
    for (const draft of ['1+', '1+2']) {
      fireEvent.change(input, { target: { value: draft } });
      await waitFor(async () => {
        const latest = await readTwentyFourSnapshot();
        expect(latest.kind === 'valid' && latest.progress.draft).toBe(draft);
      });
    }
    expect(screen.queryByText('另一窗口的 24 点进度已改变')).not.toBeInTheDocument();
  });
  it('丢失写入回执且暂时读不到共享库时保留 pending 草稿，之后认出本页 UUID 并继续 CAS', async () => {
    const initial = newTwentyFourProgress('practice', pack);
    const base = await writeTwentyFourProgress(initial, null, () => true);
    if (base.kind !== 'saved') throw new Error('seed failed');
    render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('已暂停，点击继续后作答');
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await screen.findByText('进度已保存');
    const own = 'idb:11111111-1111-4111-8111-111111111111';
    const next = 'idb:22222222-2222-4222-8222-222222222222';
    const write = vi.spyOn(store, 'writeTwentyFourProgress')
      .mockImplementationOnce(async (_progress, _expected, _current, onAttempt) => { onAttempt?.(own); return { kind: 'uncertain', token: own }; })
      .mockResolvedValueOnce({ kind: 'saved', token: next });
    const read = vi.spyOn(store, 'readTwentyFourSnapshot')
      .mockResolvedValueOnce({ kind: 'unavailable', token: null })
      .mockResolvedValueOnce({ kind: 'valid', progress: initial, token: own });
    const input = screen.getByLabelText('输入算式');
    fireEvent.change(input, { target: { value: '1+' } });
    await waitFor(() => expect(store.readTwentyFourDraft()?.pendingToken).toBe(own));
    fireEvent.change(input, { target: { value: '1+2' } });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.readTwentyFourDraft()?.progress.draft).toBe('1+2');
    fireEvent.change(input, { target: { value: '1+2+' } });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1]?.[1]).toBe(own);
    expect(screen.queryByText('另一窗口的 24 点进度已改变')).not.toBeInTheDocument();
  });
  it('刷新后 pending 草稿遇到本页 UUID 可继续；遇到外窗 UUID 仍提示冲突', async () => {
    const initial = newTwentyFourProgress('practice', pack);
    const own = 'idb:33333333-3333-4333-8333-333333333333';
    const foreign = 'idb:44444444-4444-4444-8444-444444444444';
    writeTwentyFourDraft({ progress: { ...initial, draft: '8+' }, baseToken: null, pendingToken: own });
    const read = vi.spyOn(store, 'readTwentyFourSnapshot').mockResolvedValueOnce({ kind: 'valid', progress: initial, token: own });
    const first = render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('已暂停，点击继续后作答');
    expect(store.readTwentyFourDraft()).toMatchObject({ baseToken: own, progress: { draft: '8+' } });
    expect(screen.queryByText('另一窗口的 24 点进度已改变')).not.toBeInTheDocument();
    first.unmount();
    writeTwentyFourDraft({ progress: { ...initial, draft: '8+' }, baseToken: null, pendingToken: own });
    read.mockResolvedValueOnce({ kind: 'valid', progress: initial, token: foreign });
    render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('另一窗口的 24 点进度已改变');
    expect(store.readTwentyFourDraft()?.pendingToken).toBe(own);
    expect(screen.getByRole('button', { name: '继续' })).toBeDisabled();
  });
  it('写入已提交但 ACK 尚未返回时卸载，刷新仍凭写前记录的 UUID 恢复而不自冲突', async () => {
    const initial = newTwentyFourProgress('practice', pack);
    const base = await writeTwentyFourProgress(initial, null, () => true);
    if (base.kind !== 'saved') throw new Error('seed failed');
    const first = render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('已暂停，点击继续后作答');
    const held = holdFirstWriteCompletion();
    const timers = captureStorageTimers();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.change(screen.getByLabelText('输入算式'), { target: { value: '8+' } });
    await vi.waitFor(() => expect(held()).toBe(true));
    let committed = await readTwentyFourSnapshot();
    await vi.waitFor(async () => { committed = await readTwentyFourSnapshot(); expect(committed.token).not.toBe(base.token); });
    expect(store.readTwentyFourDraft()?.pendingToken).toBe(committed.token);
    first.unmount();
    render(<TwentyFourPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    await screen.findByText('已暂停，点击继续后作答');
    expect(screen.getByLabelText('输入算式')).toHaveValue('8+');
    expect(screen.queryByText('另一窗口的 24 点进度已改变')).not.toBeInTheDocument();
    timers[1]!();
  });
});
