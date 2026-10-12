import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameHallClient } from './gamehall-client';
import { HomePage } from './HomePage';
import { NICKNAME_STORAGE_KEY } from './client-preferences';
import { applyReversiAction, createConnectFourState, createDotsAndBoxesState, createGomokuState, createReversiState } from '@gamehall/game-core';
import { saveSoloProgress, soloProgressKey } from './solo-progress';
import { leavePracticeAddress } from './solo-navigation';
import { readSharedSoloSnapshot, writeSharedSoloProgress } from './solo-shared-store';
import * as sharedSoloStore from './solo-shared-store';
import type { SoloProgress } from './solo-progress';
import { fixturePack } from './twenty-four-fixture';
import { newTwentyFourProgress } from './twenty-four-practice';
import { readTwentyFourSnapshot, writeTwentyFourDraft, writeTwentyFourProgress } from './twenty-four-store';
import * as twentyFourStore from './twenty-four-store';

async function saveShared(progress: SoloProgress) {
  const before = await readSharedSoloSnapshot(progress.gameId);
  expect((await writeSharedSoloProgress(progress, before.token)).kind).toBe('saved');
}

function clientStub(overrides: Partial<GameHallClient> = {}): GameHallClient {
  return {
    loading: false,
    connection: 'online',
    session: { sessionId: 'session', socketProof: 'A'.repeat(43), reconnectableRoomCode: null },
    room: null,
    game: null,
    error: null,
    messages: [],
    messageToasts: [],
    clearError: vi.fn(),
    reconnect: vi.fn(),
    createRoom: vi.fn().mockResolvedValue({ ok: true }),
    joinRoom: vi.fn().mockResolvedValue({ ok: true }),
    setReady: vi.fn(),
    leaveRoom: vi.fn(),
    submitGameAction: vi.fn(),
    requestRematch: vi.fn(),
    sendMessage: vi.fn(),
    ...overrides,
  } as GameHallClient;
}

describe('HomePage', () => {
  const pendingReads = new Set<Promise<unknown>>();
  const trackRead = <T,>(pending: Promise<T>): Promise<T> => {
    pendingReads.add(pending);
    void pending.then(() => pendingReads.delete(pending), () => pendingReads.delete(pending));
    return pending;
  };

  beforeEach(() => {
    const readSolo = sharedSoloStore.readSharedSoloSnapshot;
    const readTwentyFour = twentyFourStore.readTwentyFourSnapshot;
    vi.spyOn(sharedSoloStore, 'readSharedSoloSnapshot').mockImplementation((gameId) => trackRead(readSolo(gameId)));
    vi.spyOn(twentyFourStore, 'readTwentyFourSnapshot').mockImplementation(() => trackRead(readTwentyFour()));
  });

  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    // Home refreshes all five practice cards. Let transactions started by a
    // mounted page finish before Vitest disposes its JSDOM window.
    while (pendingReads.size) await Promise.all([...pendingReads]);
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('房间关闭后即使连接在线，也显示可关闭的原因', () => {
    const client = clientStub({ error: { event: 'room:closed', commandId: null, code: 'room_closed', message: '房间已经关闭', retryable: false, roomId: 'old' } });
    render(<HomePage client={client} />);
    expect(screen.getByRole('status')).toHaveTextContent('房间已经关闭');
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(client.clearError).toHaveBeenCalledTimes(1);
  });

  it('五款已确认游戏均可进入，开发中卡片不可点击', () => {
    const { container } = render(<HomePage client={clientStub()} />);
    fireEvent.click(screen.getByText('更多玩法正在准备 · 5 款'));
    expect(screen.getByRole('button', { name: '围棋尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '关牌尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '炸金花尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '罗松尚未开放' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '牛牛尚未开放' })).toBeDisabled();
    expect(screen.getAllByText('开发中')).toHaveLength(5);
    expect(container.querySelector('.mini-quoridor')).toBeInTheDocument();
    for (const name of ['璀璨宝石', '五子棋', '路墙棋', '24 点速度对决', '德州扑克']) expect(screen.getByRole('button', { name: `创建${name}房间` })).toBeEnabled();
  });

  it('24 点四张六点牌有完整花色、六个牌面点数和双角标', () => {
    const { container } = render(<HomePage client={clientStub()} />);
    const cards = [...container.querySelectorAll('.calculation-card')];
    expect(cards.map(card => card.getAttribute('data-suit'))).toEqual(['♠', '♥', '♣', '♦']);
    cards.forEach((card, index) => {
      expect(card).toHaveClass(index % 2 ? 'is-red' : 'is-black');
      expect(card.querySelectorAll('.mini-card-pips > span')).toHaveLength(6);
      expect(card.querySelectorAll('.mini-card-corner')).toHaveLength(2);
    });
    expect(container.querySelector('.calculation-result')?.parentElement).toHaveClass('effect-twenty-four');
  });

  it('不再展示首屏冗余装饰和重复的游戏单选', () => {
    const { container } = render(<HomePage client={clientStub()} />);
    expect(screen.queryByText('私人好友房 · 纯娱乐')).not.toBeInTheDocument();
    expect(screen.queryByText('NO. 01')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE GAME SALON · 2026')).not.toBeInTheDocument();
    expect(container.querySelector('.game-marquee')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('新玩法即将入席')).toBeInTheDocument();
    expect(container.querySelector('.editorial-path')).not.toBeInTheDocument();
    expect(container.querySelector('.editorial-numbers')).not.toBeInTheDocument();
    expect(container.querySelector('.editorial-horizon')).not.toBeInTheDocument();
    expect(container.querySelector('.grand-board')).not.toBeInTheDocument();
    expect(container.querySelector('.cinematic-particles')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '开桌流程' })).not.toBeInTheDocument();
  });

  it('电影级标题保持完整可访问名称，视觉字符不会被重复朗读', () => {
    const { container } = render(<HomePage client={clientStub()} />);
    const heading = screen.getByRole('heading', { level: 1, name: '棋逢对手，刚好有空。' });
    expect(heading).toHaveClass('cinematic-title');
    const characters = Array.from(container.querySelectorAll<HTMLElement>('.hero-title-char'));
    expect(characters).toHaveLength(10);
    expect(container.querySelectorAll('.hero-title-line[aria-hidden="true"]')).toHaveLength(2);
    expect(characters[0]?.style.getPropertyValue('--char-delay')).toBe(characters[9]?.style.getPropertyValue('--char-delay'));
    expect(characters[4]?.style.getPropertyValue('--char-delay')).toBe(characters[5]?.style.getPropertyValue('--char-delay'));
    expect(Number.parseFloat(characters[4]?.style.getPropertyValue('--char-delay') ?? '')).toBeLessThan(Number.parseFloat(characters[0]?.style.getPropertyValue('--char-delay') ?? ''));
  });

  it('在线游戏渲染各自的玩法动效结构', () => {
    const { container } = render(<HomePage client={clientStub()} />);
    expect(container.querySelector('.effect-gomoku')).toBeInTheDocument();
    expect(container.querySelectorAll('.effect-gomoku .winning-stone')).toHaveLength(5);
    expect(container.querySelector('.gomoku-grid')).toHaveAttribute('viewBox', '0 0 89 89');
    expect(container.querySelectorAll('.gomoku-grid path')).toHaveLength(5);
    expect(container.querySelector('.splendor-gem-aura')).toBeInTheDocument();
    expect(container.querySelector('.splendor-home-gems')).toHaveAttribute('data-motion', 'hover-replay');
    const gemShimmers = [...container.querySelectorAll('[data-gem-shimmer="clipped"]')];
    expect(gemShimmers).toHaveLength(3);
    expect(gemShimmers.every((shimmer) => shimmer.closest('svg'))).toBe(true);
    expect(container.querySelectorAll('.splendor-gem-dust i')).toHaveLength(6);
    expect(container.querySelector('.effect-gomoku .gomoku-win-guide')).toBeInTheDocument();
    expect(container.querySelector('.effect-quoridor .quoridor-wall')).toBeInTheDocument();
    expect(container.querySelectorAll('.effect-quoridor .quoridor-route')).toHaveLength(3);
    expect(container.querySelector('.effect-twenty-four .calculation-ring')).toBeInTheDocument();
    expect(container.querySelectorAll('.effect-twenty-four .calculation-card')).toHaveLength(4);
    expect(container.querySelector('.effect-twenty-four .calculation-result')).toHaveTextContent('24');
    expect(container.querySelector('.effect-poker .mini-poker-table')).toBeInTheDocument();
    expect(container.querySelector('.effect-poker')).toHaveAttribute('data-motion', 'hover-replay');
    expect(container.querySelector('.effect-poker')).toHaveAttribute('data-community-cards', '5');
    expect(container.querySelector('.effect-poker .mini-poker-table-line')).toBeInTheDocument();
    expect(container.querySelector('.effect-poker .mini-poker-community')).toBeInTheDocument();
    expect(container.querySelectorAll('.effect-poker .mini-poker-hole')).toHaveLength(2);
    expect([...container.querySelectorAll('.effect-poker .mini-poker-board')].map((card) => card.textContent)).toEqual(['4♥', '2♣', 'Q♠', 'J♠', '10♠']);
    expect(container.querySelectorAll('.effect-poker .mini-poker-board.is-royal-card')).toHaveLength(3);
    expect(container.querySelectorAll('.effect-poker .mini-chip')).toHaveLength(3);
    expect(container.querySelectorAll('.effect-poker .mini-poker-win-burst i')).toHaveLength(8);
    expect(container.querySelector('.effect-poker .mini-poker-win')).toHaveTextContent('皇家同花顺');
    expect(container.querySelectorAll('.featured-card[data-opening-motion="rotate"]')).toHaveLength(0);
    [...container.querySelectorAll<HTMLElement>('.game-card-reveal')].forEach((card) => expect(card.style.getPropertyValue('--reveal-distance')).toBe('0px'));
  });

  it('首页显现和游戏卡遵从系统减少动画设置', () => {
    const { container } = render(<HomePage client={clientStub()} />);
    const reveals = container.querySelectorAll('.reveal');
    expect(reveals.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.reveal[data-reduced-motion="respect"]')).toHaveLength(reveals.length);
    expect(container.querySelectorAll('.game-card-surface[data-reduced-motion="respect"]')).toHaveLength(8);
    expect(container.querySelectorAll('.featured-spark[data-reduced-motion="respect"]')).toHaveLength(8);
    expect(screen.getAllByText(/2–4 人 ·/)).toHaveLength(2);
  });

  it('24 点卡片离线仍可进入单人练习，无需昵称或房间连接', () => {
    const client = clientStub();
    const onPractice = vi.fn();
    render(<HomePage client={{ ...client, connection: 'offline' }} onPractice={onPractice} />);
    expect(screen.getByRole('button', { name: '创建24 点速度对决房间' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '单人练习24点' }));
    expect(onPractice).toHaveBeenCalledWith('twenty-four');
    expect(client.createRoom).not.toHaveBeenCalled();
  });

  it('24 点首页摘要跟随共享存档与本标签草稿，读取不改存档 token', async () => {
    const initial = newTwentyFourProgress('practice', fixturePack());
    const saved = await writeTwentyFourProgress(initial, null, () => true);
    if (saved.kind !== 'saved') throw new Error('save failed');
    const onPractice = vi.fn();
    render(<HomePage client={clientStub()} onPractice={onPractice} />);
    fireEvent.click(await screen.findByRole('button', { name: '继续练习24点' }));
    expect(onPractice).toHaveBeenCalledWith('twenty-four');
    expect((await readTwentyFourSnapshot()).token).toBe(saved.token);

    const finished = { ...newTwentyFourProgress('challenge', fixturePack()), phase: 'finished' as const, finishReason: 'time' as const, remainingMs: 0 };
    writeTwentyFourDraft({ progress: finished, baseToken: null });
    fireEvent.focus(window);
    expect(await screen.findByRole('button', { name: '查看上组结果24点' })).toBeInTheDocument();
    expect((await readTwentyFourSnapshot()).token).toBe(saved.token);
  });

  it('24 点较慢的旧读取不会覆盖新通知，坏存档与不可读共享库不冒充续玩', async () => {
    const progress = newTwentyFourProgress('practice', fixturePack());
    let resolveOld: ((snapshot: twentyFourStore.Snapshot) => void) | undefined;
    vi.spyOn(twentyFourStore, 'readTwentyFourSnapshot')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ kind: 'valid', progress, token: 'idb:00000000-0000-0000-0000-000000000001' })
      .mockResolvedValue({ kind: 'unavailable', token: null });
    render(<HomePage client={clientStub()} />);
    fireEvent(window, new Event('gamehall:twenty-four-progress'));
    expect(await screen.findByRole('button', { name: '继续练习24点' })).toBeInTheDocument();
    await act(async () => { resolveOld?.({ kind: 'empty', token: null }); });
    expect(screen.getByRole('button', { name: '继续练习24点' })).toBeInTheDocument();
    fireEvent.focus(window);
    expect(await screen.findByRole('button', { name: '单人练习24点' })).toBeInTheDocument();
  });

  it('搜索、筛选与收藏只改变候选，不会创建房间', () => {
    const client = clientStub();
    render(<HomePage client={client} />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索游戏' }), { target: { value: '连线' } });
    expect(screen.getByRole('button', { name: '创建四子连线房间' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建五子棋房间' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索游戏' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '收藏五子棋' }));
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
    expect(screen.getByRole('button', { name: '创建五子棋房间' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建四子连线房间' })).not.toBeInTheDocument();
    expect(client.createRoom).not.toHaveBeenCalled();
  });

  it('推荐只标记候选，规则窗口支持 Escape、Tab 环绕与焦点恢复', () => {
    const client = clientStub();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<HomePage client={client} />);
    fireEvent.click(screen.getByRole('button', { name: '帮我选一款' }));
    expect(screen.getByText(/推荐你试试 璀璨宝石/)).toBeInTheDocument();
    expect(client.createRoom).not.toHaveBeenCalled();
    const trigger = screen.getByRole('button', { name: '查看璀璨宝石玩法规则' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '璀璨宝石' });
    const close = screen.getByRole('button', { name: '关闭玩法规则' });
    expect(dialog.closest('[inert]')).toBeNull();
    expect(dialog.closest('.rules-backdrop')?.parentElement).toBe(document.body);
    expect(document.querySelector('.site-shell')).toHaveAttribute('inert');
    expect(dialog).toHaveTextContent('15 分');
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByRole('button', { name: '创建璀璨宝石房间' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.site-shell')).not.toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '关闭玩法规则' }));
    expect(trigger).toHaveFocus();
  });

  it('连接中的提示延迟显示且没有无效重连按钮', async () => {
    vi.useFakeTimers();
    render(<HomePage client={clientStub({ connection: 'connecting' })} />);
    expect(screen.queryByText('正在连接实时服务')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_199));
    expect(screen.queryByText('正在连接实时服务')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('正在连接实时服务')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新连接' })).not.toBeInTheDocument();
    await act(async () => { await vi.runAllTimersAsync(); });
  });

  it('离线时立即显示错误和可访问的重连按钮', () => {
    const reconnect = vi.fn();
    render(<HomePage client={clientStub({
      connection: 'offline',
      reconnect,
      error: { event: 'session', commandId: null, code: 'SESSION_FAILED', message: '服务暂不可用', retryable: true },
    })} />);
    expect(screen.getByRole('status')).toHaveTextContent('服务暂不可用');
    fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it.each(['connecting', 'offline'] as const)('%s 时仍能免昵称进入四种电脑练习，联网开房不可操作', async (connection) => {
    const onPractice = vi.fn();
    const client = clientStub({ loading: true, connection });
    render(<HomePage client={client} onPractice={onPractice} />);
    expect(screen.getByRole('button', { name: '创建四子连线房间' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建黑白棋房间' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: '和电脑练习四子连线' }));
    fireEvent.click(await screen.findByRole('button', { name: '和电脑练习黑白棋' }));
    fireEvent.click(await screen.findByRole('button', { name: '和电脑练习点格棋' }));
    fireEvent.click(await screen.findByRole('button', { name: '和电脑练习五子棋' }));
    expect(onPractice.mock.calls).toEqual([['connect-four'], ['reversi'], ['dots-and-boxes'], ['gomoku']]);
    expect(client.createRoom).not.toHaveBeenCalled();
  });

  it('四款独立存档让卡片展示继续练习或查看上局，入口仍由玩家明确选择', async () => {
    expect(saveSoloProgress({ gameId: 'connect-four', state: createConnectFourState(0), history: [], difficulty: 'easy', starter: 'human' })).toBe(true);
    const board = Array<0 | 1 | null>(64).fill(0);
    board[0] = null; board[1] = 1; board[63] = null; board[62] = 1;
    const near = { ...createReversiState(0), board, counts: [60, 2] as [number, number], moveCount: 58 };
    const first = applyReversiAction(near, 0, { type: 'placeDisc', row: 0, col: 0 });
    if (!first.ok) throw new Error('bad fixture');
    const final = applyReversiAction(first.state, 0, { type: 'placeDisc', row: 7, col: 7 });
    if (!final.ok) throw new Error('bad fixture');
    expect(saveSoloProgress({ gameId: 'reversi', state: final.state, history: [], difficulty: 'thoughtful', starter: 'human' })).toBe(true);
    expect(saveSoloProgress({ gameId: 'dots-and-boxes', state: createDotsAndBoxesState(0), history: [], trace: [], difficulty: 'easy', starter: 'human' })).toBe(true);
    expect(saveSoloProgress({ gameId: 'gomoku', state: createGomokuState(0), history: [], gomokuMoves: [], difficulty: 'easy', starter: 'human' })).toBe(true);
    const onPractice = vi.fn();
    render(<HomePage client={clientStub({ connection: 'offline' })} onPractice={onPractice} />);
    fireEvent.click(await screen.findByRole('button', { name: '继续练习四子连线' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看上局练习黑白棋' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续练习点格棋' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续练习五子棋' }));
    expect(onPractice.mock.calls).toEqual([['connect-four'], ['reversi'], ['dots-and-boxes'], ['gomoku']]);
  });

  it('旧大厅在共享存档变化后更新摘要，损坏的旧缓存不能盖掉已迁移棋局', async () => {
    render(<HomePage client={clientStub()} />);
    expect(await screen.findByRole('button', { name: '和电脑练习四子连线' })).toBeInTheDocument();
    await saveShared({ gameId: 'connect-four', state: createConnectFourState(0), history: [], difficulty: 'easy', starter: 'human' });
    expect(await screen.findByRole('button', { name: '继续练习四子连线' })).toBeInTheDocument();
    window.localStorage.setItem(soloProgressKey('connect-four'), '{broken');
    fireEvent.focus(window);
    expect(await screen.findByRole('button', { name: '继续练习四子连线' })).toBeInTheDocument();

    await saveShared({ gameId: 'reversi', state: createReversiState(0), history: [], difficulty: 'easy', starter: 'human' });
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByRole('button', { name: '继续练习黑白棋' })).toBeInTheDocument();
    fireEvent(window, new StorageEvent('storage', { key: 'unrelated-preference' }));
    expect(screen.getByRole('button', { name: '继续练习黑白棋' })).toBeInTheDocument();
  });

  it('昵称区域只负责取名，不再包含创建、加入或在线徽标', () => {
    render(<HomePage client={clientStub()} />);
    const panel = screen.getByLabelText('你的昵称').closest('.identity-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('加入房间');
    expect(panel).not.toHaveTextContent('服务在线');
    expect(panel?.querySelector('button[aria-label^="创建"]')).not.toBeInTheDocument();
  });

  it('点击游戏卡会使用昵称直接创建对应房间', async () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '木纹棋手' } });
    fireEvent.click(screen.getByRole('button', { name: '创建路墙棋房间' }));
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith('木纹棋手', 'quoridor'));
  });

  it('游戏卡使用可聚焦的原生按钮直接开房', async () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom })} />);
    const nickname = screen.getByLabelText('你的昵称');
    fireEvent.change(nickname, { target: { value: '键盘棋手' } });
    const quoridor = screen.getByRole('button', { name: '创建路墙棋房间' });
    quoridor.focus();
    expect(quoridor).toHaveFocus();
    expect(quoridor).toHaveAttribute('type', 'button');
    fireEvent.click(quoridor);
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith('键盘棋手', 'quoridor'));
  });

  it('昵称为空时不会创建房间，并返回聚焦昵称输入', () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom })} />);
    const nickname = screen.getByLabelText('你的昵称');
    fireEvent.click(screen.getByRole('button', { name: '创建五子棋房间' }));
    expect(createRoom).not.toHaveBeenCalled();
    expect(nickname).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('1–16 个可显示字符');
  });

  it('规则窗口创建时空昵称回到输入，超长昵称阻止请求，复合 emoji 按单字计数', async () => {
    const client = clientStub();
    render(<HomePage client={client} />);
    fireEvent.click(screen.getByRole('button', { name: '查看五子棋玩法规则' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建五子棋房间' }));
    await waitFor(() => expect(screen.getByLabelText('你的昵称')).toHaveFocus());
    expect(client.createRoom).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '棋'.repeat(17) } });
    fireEvent.click(screen.getByRole('button', { name: '创建五子棋房间' }));
    expect(screen.getByLabelText('你的昵称')).toHaveAttribute('aria-invalid', 'true');
    expect(client.createRoom).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '👨‍👩‍👧‍👦'.repeat(16) } });
    fireEvent.click(screen.getByRole('button', { name: '创建五子棋房间' }));
    await waitFor(() => expect(client.createRoom).toHaveBeenCalledTimes(1));
  });

  it('创建过程中禁用全部开房入口，避免重复创建', async () => {
    let finish!: (value: { ok: true }) => void;
    const createRoom = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<HomePage client={clientStub({ createRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '稳坐棋手' } });
    fireEvent.click(screen.getByRole('button', { name: '创建五子棋房间' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '创建路墙棋房间' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '创建路墙棋房间' }));
    expect(createRoom).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await waitFor(() => expect(screen.getByRole('button', { name: '创建路墙棋房间' })).not.toBeDisabled());
  });

  it('随机昵称按钮生成雅致昵称并允许继续手动编辑', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<HomePage client={clientStub()} />);
    const nickname = screen.getByLabelText('你的昵称');
    fireEvent.click(screen.getByRole('button', { name: '随机昵称' }));
    expect(nickname).toHaveValue('竹影棋客');
    fireEvent.click(screen.getByRole('button', { name: '随机昵称' }));
    expect(nickname).toHaveValue('竹影闲家');
    fireEvent.change(nickname, { target: { value: '自定义棋手' } });
    expect(nickname).toHaveValue('自定义棋手');
  });

  it('邀请码输入会转大写并过滤易混淆字符', () => {
    render(<HomePage client={clientStub()} />);
    const input = screen.getByLabelText('六位房间邀请码');
    fireEvent.change(input, { target: { value: 'ab201-z9' } });
    expect(input).toHaveValue('AB2Z9');
  });

  it('完整邀请链接会提取 room 参数而不是保留 HTTP 前缀', () => {
    render(<HomePage client={clientStub()} />);
    const input = screen.getByLabelText('六位房间邀请码');
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:5173/?room=35c3ty' } });
    expect(input).toHaveValue('35C3TY');
  });

  it('无 room 的普通查询和直接练习链接退出后不生成伪邀请码，仍可回退到会话房间码', () => {
    window.history.replaceState(null, '', '/?source=round4');
    const first = render(<HomePage client={clientStub()} />);
    expect(screen.getByLabelText('六位房间邀请码')).toHaveValue('');
    first.unmount();
    window.history.replaceState(null, '', '/?practice=reversi&source=summary-watch#board');
    expect(leavePracticeAddress()).toBe('replace');
    expect(window.location.search).toBe('?source=summary-watch');
    render(<HomePage client={clientStub({ session: { sessionId: 'session', socketProof: 'A'.repeat(43), reconnectableRoomCode: 'ABC234' } })} />);
    expect(screen.getByLabelText('六位房间邀请码')).toHaveValue('ABC234');
  });

  it('会预填上一次成功使用的昵称', () => {
    window.localStorage.setItem(NICKNAME_STORAGE_KEY, '常胜棋手');
    render(<HomePage client={clientStub()} />);
    expect(screen.getByLabelText('你的昵称')).toHaveValue('常胜棋手');
  });

  it('邀请码回车只加入房间，不会创建新房间', async () => {
    const createRoom = vi.fn().mockResolvedValue({ ok: true });
    const joinRoom = vi.fn().mockResolvedValue({ ok: true });
    render(<HomePage client={clientStub({ createRoom, joinRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '来客' } });
    const code = screen.getByLabelText('六位房间邀请码');
    fireEvent.change(code, { target: { value: 'ABC234' } });
    fireEvent.submit(code.closest('form')!);
    await waitFor(() => expect(joinRoom).toHaveBeenCalledWith('来客', 'ABC234'));
    expect(joinRoom).toHaveBeenCalledTimes(1);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('展示加入房间失败的服务端错误', async () => {
    const joinRoom = vi.fn().mockResolvedValue({ ok: false, error: { message: '邀请码不存在' } });
    render(<HomePage client={clientStub({ joinRoom })} />);
    fireEvent.change(screen.getByLabelText('你的昵称'), { target: { value: '来客' } });
    fireEvent.change(screen.getByLabelText('六位房间邀请码'), { target: { value: 'ABC234' } });
    fireEvent.click(screen.getByRole('button', { name: '加入房间' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('邀请码不存在');
  });
});
