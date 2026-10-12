import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createConnectFourState } from '@gamehall/game-core';
import { ConnectFourGame } from './ConnectFourGame';

describe('四子连线棋盘', () => {
  it('点棋盘任意格可投放所在列，键盘按钮可操作，非当前回合不能提交', async () => {
    const onAction = vi.fn().mockResolvedValue({ ok: true });
    const state = createConnectFourState(0);
    const { rerender } = render(<ConnectFourGame state={state} mySeat={0} active onAction={onAction} />);
    fireEvent.click(screen.getByRole('gridcell', { name: '第 2 行第 3 列，空位' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'drop', col: 2 });
    await waitFor(() => expect(screen.getByRole('button', { name: '投放第 1 列' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '投放第 1 列' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'drop', col: 0 });
    rerender(<ConnectFourGame state={{ ...state, turn: 1 }} mySeat={0} active onAction={onAction} />);
    expect(screen.getByRole('button', { name: '投放第 1 列' })).toBeDisabled();
    fireEvent.click(screen.getByRole('gridcell', { name: '第 2 行第 3 列，空位' }));
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('投放预览使用当前玩家的金色或珊瑚色', () => {
    const state = createConnectFourState(0);
    const { rerender } = render(<ConnectFourGame state={state} mySeat={0} active onAction={vi.fn()} />);
    const cell = screen.getByRole('gridcell', { name: '第 6 行第 1 列，空位' });
    fireEvent.pointerEnter(cell);
    expect(cell).toHaveClass('preview-gold');
    rerender(<ConnectFourGame state={{ ...state, turn: 1 }} mySeat={1} active onAction={vi.fn()} />);
    expect(cell).toHaveClass('preview-coral');
  });
});
