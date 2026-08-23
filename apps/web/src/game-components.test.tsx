import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createGomokuState,
  createQuoridorState,
  createTwentyFourState,
  quoridorDefinition,
  viewTwentyFourState,
} from '@gamehall/game-core';
import { GomokuGame, QuoridorGame, TwentyFourGame } from './game-components';

describe('game components', () => {
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

  it('路墙棋只在合法目标上触发移动', () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const state = createQuoridorState(0);
    const view = quoridorDefinition.viewFor(state, 0, 0);
    render(<QuoridorGame state={view} mySeat={0} active onAction={onAction} />);
    const legal = view.legalMoves[0]!;
    fireEvent.click(screen.getByRole('gridcell', { name: new RegExp(`第 ${legal.row + 1} 行第 ${legal.col + 1} 列.*可移动`) }));
    expect(onAction).toHaveBeenCalledWith({ type: 'move', row: legal.row, col: legal.col });
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
});
