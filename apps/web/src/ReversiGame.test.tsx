import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createReversiState } from '@gamehall/game-core';
import { ReversiGame } from './ReversiGame';

describe('黑白棋棋盘', () => {
  it('标明合法步与棋子数量，点击合法格提交，非当前回合拒绝操作', () => {
    const onAction = vi.fn().mockResolvedValue({ ok: true });
    const state = createReversiState(0);
    const { rerender } = render(<ReversiGame state={state} mySeat={0} active onAction={onAction} />);
    expect(screen.getByText('黑')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('gridcell', { name: '第 3 行第 4 列，空位，可落子' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'placeDisc', row: 2, col: 3 });
    fireEvent.click(screen.getByRole('gridcell', { name: '第 1 行第 1 列，空位' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    rerender(<ReversiGame state={{ ...state, turn: 1 }} mySeat={0} active onAction={onAction} />);
    expect(screen.getByRole('gridcell', { name: '第 3 行第 4 列，空位' })).toHaveAttribute('aria-disabled', 'true');
  });
});
