import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { applyConnectFourAction, createConnectFourState } from '@gamehall/game-core';
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

  it('列选择只有一个 Tab 入口，方向键跳过满列，Home/End 到两端', () => {
    let state = createConnectFourState(0);
    for (let move = 0; move < 6; move += 1) {
      const result = applyConnectFourAction(state, state.turn, { type: 'drop', col: 1 });
      if (!result.ok) throw new Error('setup failed');
      state = result.state;
    }
    const { rerender } = render(<ConnectFourGame state={state} mySeat={0} active onAction={vi.fn()} />);
    const first = screen.getByRole('button', { name: '投放第 1 列' });
    expect(document.querySelectorAll('.four-columns button[tabindex="0"]')).toHaveLength(1);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const third = screen.getByRole('button', { name: '投放第 3 列' });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third, { key: 'End' });
    const last = screen.getByRole('button', { name: '投放第 7 列' });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Home' });
    expect(first).toHaveFocus();
    expect(document.querySelectorAll('.four-columns button[tabindex="0"]')).toHaveLength(1);
    rerender(<ConnectFourGame state={{ ...state, turn: 1 }} mySeat={0} active onAction={vi.fn()} />);
    expect(document.querySelectorAll('.four-columns button[tabindex="0"]')).toHaveLength(0);
  });

  it('键盘投放待提交、电脑回应后续接列，Tab 离开后不抢焦点也不重复提交', async () => {
    let resolve!: () => void;
    const onAction = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const initial = createConnectFourState(0);
    const { rerender } = render(<><ConnectFourGame state={initial} mySeat={0} active onAction={onAction} /><button>悔棋</button></>);
    const second = screen.getByRole('button', { name: '投放第 2 列' });
    screen.getByRole('button', { name: '投放第 1 列' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'Enter' });
    fireEvent.click(second);
    fireEvent.click(second);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(second).toBeDisabled();
    const human = applyConnectFourAction(initial, 0, { type: 'drop', col: 1 });
    if (!human.ok) throw new Error('human move failed');
    rerender(<><ConnectFourGame state={human.state} mySeat={0} active onAction={onAction} /><button>悔棋</button></>);
    act(() => second.blur());
    await act(async () => resolve());
    const computer = applyConnectFourAction(human.state, 1, { type: 'drop', col: 0 });
    if (!computer.ok) throw new Error('computer move failed');
    rerender(<><ConnectFourGame state={computer.state} mySeat={0} active onAction={onAction} /><button>悔棋</button></>);
    await waitFor(() => expect(second).toHaveFocus());
    expect(onAction).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(second, { key: 'Tab' });
    screen.getByRole('button', { name: '悔棋' }).focus();
    rerender(<><ConnectFourGame state={{ ...computer.state, turn: 1 }} mySeat={0} active onAction={onAction} /><button>悔棋</button></>);
    rerender(<><ConnectFourGame state={computer.state} mySeat={0} active onAction={onAction} /><button>悔棋</button></>);
    expect(screen.getByRole('button', { name: '悔棋' })).toHaveFocus();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('指针移出棋盘后不恢复焦点，暂停和终局不投放，并清理全局监听', () => {
    const onAction = vi.fn().mockResolvedValue({ ok: true });
    const remove = vi.spyOn(document, 'removeEventListener');
    const state = createConnectFourState(0);
    const { rerender, unmount } = render(<><ConnectFourGame state={state} mySeat={0} active onAction={onAction} /><button>重开</button></>);
    const first = screen.getByRole('button', { name: '投放第 1 列' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.pointerDown(screen.getByRole('button', { name: '重开' }));
    screen.getByRole('button', { name: '重开' }).focus();
    rerender(<><ConnectFourGame state={{ ...state, turn: 1 }} mySeat={0} active onAction={onAction} /><button>重开</button></>);
    rerender(<><ConnectFourGame state={state} mySeat={0} active onAction={onAction} /><button>重开</button></>);
    expect(screen.getByRole('button', { name: '重开' })).toHaveFocus();
    rerender(<><ConnectFourGame state={state} mySeat={0} active={false} onAction={onAction} /><button>重开</button></>);
    fireEvent.click(screen.getByRole('gridcell', { name: '第 6 行第 1 列，空位' }));
    rerender(<><ConnectFourGame state={{ ...state, phase: 'finished' }} mySeat={0} active onAction={onAction} /><button>重开</button></>);
    fireEvent.click(screen.getByRole('gridcell', { name: '第 6 行第 1 列，空位' }));
    expect(onAction).not.toHaveBeenCalled();
    unmount();
    expect(remove).toHaveBeenCalledWith('focusin', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    remove.mockRestore();
  });
});
