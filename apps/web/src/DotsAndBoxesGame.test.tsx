import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDotsAndBoxesState } from '@gamehall/game-core';
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
});
