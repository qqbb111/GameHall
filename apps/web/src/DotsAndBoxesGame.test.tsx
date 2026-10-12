import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { applyDotsAndBoxesAction, createDotsAndBoxesState } from '@gamehall/game-core';
import { DotsAndBoxesGame } from './DotsAndBoxesGame';

describe('点格棋棋盘', () => {
  it('空边可点击与键盘聚焦，已占边及非己方回合不可提交', () => {
    const onAction = vi.fn().mockResolvedValue({ ok: true });
    const state = createDotsAndBoxesState(0);
    const { rerender } = render(<DotsAndBoxesGame state={state} mySeat={0} active onAction={onAction} />);
    const first = screen.getByRole('button', { name: '横边，第 1 行第 1 列，可画' });
    expect(first).toBeEnabled();
    fireEvent.click(first);
    expect(onAction).toHaveBeenCalledWith({ type: 'drawEdge', orientation: 'H', row: 0, col: 0 });
    rerender(<DotsAndBoxesGame state={{ ...state, horizontal: [0, ...state.horizontal.slice(1)], edgeCount: 1, turn: 1 }} mySeat={0} active onAction={onAction} />);
    expect(screen.getByRole('button', { name: '横边，第 1 行第 1 列，已画' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '竖边，第 1 行第 1 列，可画' })).toBeDisabled();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('提示只高亮空边，棋盘只有一个 Tab 入口且方向键移动焦点', () => {
    const onAction = vi.fn().mockResolvedValue({ ok: true });
    const state = createDotsAndBoxesState(0);
    const { rerender } = render(<DotsAndBoxesGame state={state} mySeat={0} active opponentLabel="电脑"
      hintEdge={{ orientation: 'H', row: 0, col: 0 }} onAction={onAction} />);
    const first = screen.getByRole('button', { name: '横边，第 1 行第 1 列，可画' });
    expect(first).toHaveClass('is-hint');
    expect(document.querySelectorAll('.dots-edge[tabindex="0"]')).toHaveLength(1);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '竖边，第 1 行第 2 列，可画' })).toHaveFocus();
    expect(document.querySelectorAll('.dots-edge[tabindex="0"]')).toHaveLength(1);
    expect(screen.getByText('电脑')).toBeInTheDocument();
    rerender(<DotsAndBoxesGame state={state} mySeat={0} active opponentLabel="电脑" hintEdge={null} onAction={onAction} />);
    expect(first).not.toHaveClass('is-hint');
  });

  it('键盘画边经过待提交和电脑回合后续接空边，离开棋盘则不夺回焦点', async () => {
    let resolve!: () => void;
    const onAction = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const initial = createDotsAndBoxesState(0);
    const { rerender } = render(<><DotsAndBoxesGame state={initial} mySeat={0} active onAction={onAction} /><button>提示一步</button></>);
    const first = screen.getByRole('button', { name: '横边，第 1 行第 1 列，可画' });
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    fireEvent.click(first);
    expect(first).toBeDisabled();
    expect(onAction).toHaveBeenCalledTimes(1);
    const human = applyDotsAndBoxesAction(initial, 0, { type: 'drawEdge', orientation: 'H', row: 0, col: 0 });
    if (!human.ok) throw new Error('human move failed');
    rerender(<><DotsAndBoxesGame state={human.state} mySeat={0} active onAction={onAction} /><button>提示一步</button></>);
    act(() => { first.blur(); });
    await act(async () => resolve());
    expect(onAction).toHaveBeenCalledTimes(1);
    const computer = applyDotsAndBoxesAction(human.state, 1, { type: 'drawEdge', orientation: 'H', row: 0, col: 1 });
    if (!computer.ok) throw new Error('computer move failed');
    rerender(<><DotsAndBoxesGame state={computer.state} mySeat={0} active onAction={onAction} /><button>提示一步</button></>);
    await waitFor(() => expect(screen.getByRole('button', { name: '竖边，第 1 行第 1 列，可画' })).toHaveFocus());
    expect(onAction).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: '提示一步' }).focus();
    rerender(<><DotsAndBoxesGame state={{ ...computer.state, turn: 1 }} mySeat={0} active onAction={onAction} /><button>提示一步</button></>);
    rerender(<><DotsAndBoxesGame state={computer.state} mySeat={0} active onAction={onAction} /><button>提示一步</button></>);
    expect(screen.getByRole('button', { name: '提示一步' })).toHaveFocus();
  });

  it('封格同回合移到相邻空边，暂停或终局不提交', async () => {
    let state = createDotsAndBoxesState(0);
    for (const [actor, edge] of [[0, { orientation: 'H', row: 0, col: 0 }], [1, { orientation: 'V', row: 0, col: 0 }],
      [0, { orientation: 'H', row: 1, col: 0 }], [1, { orientation: 'H', row: 0, col: 1 }]] as const) {
      const next = applyDotsAndBoxesAction(state, actor, { type: 'drawEdge', ...edge });
      if (!next.ok) throw new Error('setup failed');
      state = next.state;
    }
    // The next human edge closes the upper-left box and keeps the turn.
    const ready = { ...state, turn: 0 as const };
    const onAction = vi.fn().mockResolvedValue({ ok: true });
    const { rerender } = render(<DotsAndBoxesGame state={ready} mySeat={0} active onAction={onAction} />);
    const closing = screen.getByRole('button', { name: '竖边，第 1 行第 2 列，可画' });
    closing.focus();
    fireEvent.keyDown(closing, { key: 'Enter' });
    fireEvent.click(closing);
    const result = applyDotsAndBoxesAction(ready, 0, { type: 'drawEdge', orientation: 'V', row: 0, col: 1 });
    if (!result.ok) throw new Error('closing move failed');
    rerender(<DotsAndBoxesGame state={result.state} mySeat={0} active onAction={onAction} />);
    act(() => closing.blur());
    await waitFor(() => expect(document.activeElement).toMatchObject({ disabled: false }));
    expect(document.activeElement).toHaveClass('dots-edge');
    expect(onAction).toHaveBeenCalledTimes(1);
    rerender(<DotsAndBoxesGame state={result.state} mySeat={0} active={false} onAction={onAction} />);
    fireEvent.click(screen.getAllByRole('button', { name: /可画/ })[0]!);
    rerender(<DotsAndBoxesGame state={{ ...result.state, phase: 'finished' }} mySeat={0} active onAction={onAction} />);
    fireEvent.click(screen.getAllByRole('button', { name: /可画/ })[0]!);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
