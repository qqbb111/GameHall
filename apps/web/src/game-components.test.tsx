import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTexasHoldemAction,
  createGomokuState,
  createQuoridorState,
  createTwentyFourState,
  createTexasHoldemState,
  quoridorDefinition,
  texasHoldemDefinition,
  viewTwentyFourState,
} from '@gamehall/game-core';
import { GomokuGame, QuoridorGame, TexasHoldemGame, TwentyFourGame } from './game-components';

describe('game components', () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('五子棋支持方向键移动与 Enter 落子', () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(<GomokuGame state={createGomokuState(0)} mySeat={0} active onAction={onAction} />);
    const center = screen.getByRole('gridcell', { name: '第 8 行第 8 列，空位' });
    center.focus();
    fireEvent.keyDown(center, { key: 'ArrowRight' });
    const target = screen.getByRole('gridcell', { name: '第 8 行第 9 列，空位' });
    expect(target).toHaveFocus();
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(onAction).toHaveBeenCalledWith({ type: 'place', row: 7, col: 8 });
  });

  it('五子棋使用 225 个格点并在标准坐标绘制五个纯视觉星位', () => {
    const { container } = render(<GomokuGame state={createGomokuState(0)} mySeat={0} active onAction={vi.fn()} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(225);
    expect(cells[0]).toHaveAttribute('data-row', '0');
    expect(cells[0]).toHaveAttribute('data-col', '0');
    expect(cells[224]).toHaveAttribute('data-row', '14');
    expect(cells[224]).toHaveAttribute('data-col', '14');
    const gridLayer = container.querySelector('.gomoku-grid-lines');
    const gridLines = gridLayer?.querySelector('svg');
    expect(gridLayer).toHaveAttribute('aria-hidden', 'true');
    expect(gridLines).toHaveAttribute('viewBox', '-0.5 -0.5 15 15');
    expect(gridLines?.querySelector('path')?.getAttribute('d')).toContain('M 14 0 V 14');
    expect(gridLines?.querySelector('rect')).toHaveAttribute('width', '14');
    expect(container.querySelectorAll('.board-star')).toHaveLength(5);
    for (const [row, col] of [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]) {
      expect(container.querySelector(`.gomoku-cell[data-row="${row}"][data-col="${col}"] .board-star`)).not.toBeNull();
    }
    expect(screen.getByText(/方向键移动焦点/)).toHaveClass('sr-only');
  });

  it('路墙棋只在合法目标上触发移动', () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const state = createQuoridorState(0);
    const view = quoridorDefinition.viewFor(state, 0, 0);
    render(<QuoridorGame state={view} mySeat={0} active onAction={onAction} />);
    const legal = view.legalMoves[0]!;
    fireEvent.click(screen.getByRole('gridcell', { name: new RegExp(`第 ${legal.row + 1} 行第 ${legal.col + 1} 列.*可移动`) }));
    expect(onAction).toHaveBeenCalledWith({ type: 'move', row: legal.row, col: legal.col });
  });

  it('路墙棋棋子是两个独立的单体圆形元素', () => {
    const view = quoridorDefinition.viewFor(createQuoridorState(0), 0, 0);
    const { container } = render(<QuoridorGame state={view} mySeat={0} active onAction={vi.fn()} />);
    expect(screen.getAllByRole('gridcell')).toHaveLength(81);
    expect(container.querySelectorAll('.pawn')).toHaveLength(2);
    expect(container.querySelectorAll('.pawn > i')).toHaveLength(2);
  });

  it('路墙棋棋盘和放墙锚点使用方向键单焦点导航', () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const view = quoridorDefinition.viewFor(createQuoridorState(0), 0, 0);
    render(<QuoridorGame state={view} mySeat={0} active onAction={onAction} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
    const pawn = screen.getByRole('gridcell', { name: /第 9 行第 5 列，你的棋子/ });
    pawn.focus();
    fireEvent.keyDown(pawn, { key: 'ArrowUp' });
    expect(screen.getByRole('gridcell', { name: /第 8 行第 5 列/ })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '放置横墙' }));
    const legalWalls = screen.getAllByRole('button', { name: /横墙.*可放置/ }).filter((button) => !button.hasAttribute('disabled'));
    expect(legalWalls.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    legalWalls.find((button) => button.tabIndex === 0)!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toHaveAccessibleName(/横墙.*第 1 行第 2 列.*可放置/);
  });

  it('24 点快捷键生成安全算式并提交', () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const nowMs = 1_000_000;
    const state = createTwentyFourState([
      { id: 0, suit: 'S', rank: 1 },
      { id: 5, suit: 'S', rank: 6 },
      { id: 18, suit: 'H', rank: 6 },
      { id: 37, suit: 'D', rank: 12 },
    ], '(6-1)*(6-1)-1', nowMs);
    render(<TwentyFourGame state={viewTwentyFourState(state, nowMs)} mySeat={0} active serverNowMs={nowMs} onAction={onAction} />);
    const input = screen.getByLabelText('输入算式');
    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    fireEvent.change(input, { target: { value: '6*(12-6-1)' } });
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'submit', expression: '6*(12-6-1)' });
  });

  it('德州扑克只展示自己的手牌并提交跟注/弃牌操作', () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.2 });
    const view = texasHoldemDefinition.viewFor(state, 0, 0);
    render(<TexasHoldemGame state={view} mySeat={0} active onAction={onAction} />);
    expect(screen.getByLabelText('你的手牌').querySelectorAll('.poker-card:not(.is-hidden)')).toHaveLength(2);
    expect(screen.getByLabelText('对手手牌').querySelectorAll('.poker-card.is-hidden')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /跟注/ }));
    expect(onAction).toHaveBeenCalledWith({ type: 'call' });
    expect(screen.getByRole('button', { name: '弃牌' })).toBeInTheDocument();
  });

  it('德州扑克使用实体筹码组合加注并换算本轮目标额', () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.2 });
    const view = texasHoldemDefinition.viewFor(state, 0, 0);
    render(<TexasHoldemGame state={view} mySeat={0} active onAction={onAction} />);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加 25 筹码' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 5 筹码' }));
    fireEvent.click(screen.getByRole('button', { name: '推入加注 40' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'raise', amount: 40 });
  });

  it('德州扑克单手结算保持牌面可见并由存活玩家确认下一手', () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    let state = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.2 });
    const folded = applyTexasHoldemAction(state, 0, { type: 'fold' });
    if (!folded.ok) throw new Error(folded.error.message);
    state = folded.state;
    const view = texasHoldemDefinition.viewFor(state, 0, 0);
    const { container } = render(<TexasHoldemGame state={view} mySeat={0} active members={[
      { seat: 0, nickname: '北风', ready: true, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
      { seat: 1, nickname: '南山', ready: true, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
    ]} onAction={onAction} />);
    expect(screen.getByLabelText('第 1 手结算')).toHaveTextContent('南山 收下底池');
    expect(screen.getByText(/未摊牌的手牌继续保密/)).toBeInTheDocument();
    expect(container.querySelectorAll('.poker-community .poker-card')).toHaveLength(5);
    expect(container.querySelector('.poker-pot-stack')).toBeNull();
    expect(screen.getByLabelText('对手手牌').querySelectorAll('.poker-card.is-hidden')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '准备下一手' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'readyNextHand' });
  });

  it('德州扑克的新公共牌按发牌节奏逐张显现并暂时锁定操作', () => {
    vi.useFakeTimers();
    const onAction = vi.fn().mockResolvedValue(undefined);
    const initialState = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.2 });
    const firstAction = applyTexasHoldemAction(initialState, initialState.turn!, { type: 'call' });
    if (!firstAction.ok) throw new Error(firstAction.error.message);
    const flopAction = applyTexasHoldemAction(firstAction.state, firstAction.state.turn!, { type: 'check' });
    if (!flopAction.ok) throw new Error(flopAction.error.message);
    const initialView = texasHoldemDefinition.viewFor(initialState, 0, 0);
    const flopView = texasHoldemDefinition.viewFor(flopAction.state, 0, 0);
    const { container, rerender } = render(<TexasHoldemGame state={initialView} snapshotVersion={1} mySeat={0} active onAction={onAction} />);

    expect(container.querySelector('.poker-deck')).toBeInTheDocument();
    expect(container.querySelectorAll('.poker-community .poker-card:not(.is-placeholder)')).toHaveLength(0);
    rerender(<TexasHoldemGame state={flopView} snapshotVersion={2} mySeat={0} active onAction={onAction} />);
    expect(screen.getByText('翻牌发牌中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '跟注 0' })).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(300); });
    expect(container.querySelectorAll('.poker-community .poker-card:not(.is-placeholder)')).toHaveLength(1);
    expect(container.querySelector('.poker-community .poker-card.is-dealing')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(900); });
    expect(container.querySelectorAll('.poker-community .poker-card:not(.is-placeholder)')).toHaveLength(2);
    expect(container.querySelectorAll('.poker-community .poker-card.is-dealing')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(900); });
    expect(container.querySelectorAll('.poker-community .poker-card:not(.is-placeholder)')).toHaveLength(3);
    expect(container.querySelectorAll('.poker-community .poker-card.is-dealing')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(container.querySelector('.poker-community .poker-card.is-dealing')).toBeNull();
    expect(screen.getByText('等待好友行动')).toBeInTheDocument();
  });

  it('德州扑克底池托盘按权威金额组合筹码且不会覆盖公共牌', () => {
    const initialState = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.2 });
    const called = applyTexasHoldemAction(initialState, initialState.turn!, { type: 'call' });
    if (!called.ok) throw new Error(called.error.message);
    const { container } = render(<TexasHoldemGame state={texasHoldemDefinition.viewFor(called.state, 0, 0)} mySeat={0} active onAction={vi.fn()} />);
    const pot = screen.getByLabelText('底池筹码 40');
    expect(pot).toHaveAttribute('data-pot-amount', '40');
    expect([...pot.querySelectorAll('[data-chip-value]')].map((chip) => Number(chip.getAttribute('data-chip-value')))).toEqual([25, 10, 5]);
    expect(container.querySelector('.poker-community .poker-chip')).toBeNull();
    expect(screen.getByLabelText('当前底池 40')).toContainElement(pot);
  });

  it('双方 all-in 时公共牌一张一张跑完后才揭晓结算', () => {
    vi.useFakeTimers();
    const onAction = vi.fn().mockResolvedValue(undefined);
    const initialState = createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.2 });
    const firstAllIn = applyTexasHoldemAction(initialState, initialState.turn!, { type: 'allIn' });
    if (!firstAllIn.ok) throw new Error(firstAllIn.error.message);
    const finalAction = applyTexasHoldemAction(firstAllIn.state, firstAllIn.state.turn!, { type: 'allIn' });
    if (!finalAction.ok) throw new Error(finalAction.error.message);
    const initialView = texasHoldemDefinition.viewFor(initialState, 0, 0);
    const finalView = texasHoldemDefinition.viewFor(finalAction.state, 0, 0);
    const { container, rerender } = render(<TexasHoldemGame state={initialView} snapshotVersion={1} mySeat={0} active onAction={onAction} />);

    rerender(<TexasHoldemGame state={finalView} snapshotVersion={2} mySeat={0} active onAction={onAction} />);
    expect(screen.getByText(/ALL-IN · 翻牌发牌中/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/第 1 手结算/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('.poker-community .poker-card:not(.is-placeholder)')).toHaveLength(0);
    expect(screen.getByLabelText('对手手牌').querySelectorAll('.poker-card.is-hidden')).toHaveLength(2);
    expect(screen.queryByText('已淘汰')).not.toBeInTheDocument();
    expect(screen.queryByText('筹码 2000')).not.toBeInTheDocument();
    expect(screen.getAllByText('All-in')).toHaveLength(2);
    const allInPot = screen.getByLabelText('底池筹码 2000');
    expect([...allInPot.querySelectorAll('[data-chip-value]')].map((chip) => Number(chip.getAttribute('data-chip-value')))).toEqual([500, 500, 500, 500]);

    act(() => { vi.advanceTimersByTime(4_000); });
    expect(container.querySelectorAll('.poker-community .poker-card:not(.is-placeholder)')).toHaveLength(4);
    expect(screen.queryByLabelText(/第 1 手结算/)).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3_300); });
    expect(container.querySelectorAll('.poker-community .poker-card:not(.is-placeholder)')).toHaveLength(5);
    expect(screen.getByLabelText(/第 1 手结算/)).toBeInTheDocument();
    expect(screen.getByText(/摊牌获胜|收下底池/)).toBeInTheDocument();
    expect(container.querySelector('.poker-pot-stack')).toBeNull();
    expect(screen.getByLabelText('底池筹码已结算')).toBeInTheDocument();
  });

  it('德州扑克不再提供牌桌音效控制', () => {
    render(<TexasHoldemGame state={texasHoldemDefinition.viewFor(createTexasHoldemState({ seats: [0, 1], dealerSeat: 0, rng: () => 0.2 }), 0, 0)} mySeat={0} active onAction={vi.fn()} />);
    expect(screen.queryByText(/牌桌音效/)).not.toBeInTheDocument();
  });
});
