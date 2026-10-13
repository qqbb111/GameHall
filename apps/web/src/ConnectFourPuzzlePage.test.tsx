import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectFourPuzzlePage } from './ConnectFourPuzzlePage';
import { connectFourPuzzles, puzzleSolutions } from './connect-four-puzzles';
import { PUZZLE_ATTEMPT_KEY, PUZZLE_COMPLETION_PREFIX, readPuzzleAttempt } from './connect-four-puzzle-progress';

function selectPuzzle(index: number) {
  fireEvent.click(within(screen.getByRole('navigation', { name: '残局关卡选择' })).getByRole('button', { name: new RegExp(`第 ${index + 1} 关`) }));
}
async function drop(col: number) {
  const button = screen.getByRole('button', { name: new RegExp(`^投放第 ${col + 1} 列`) });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

describe('四子连线残局闯关', () => {
  afterEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

  it('九关可选；错着说明原因但不落子，提示标列但不落子，正确着完成并手动进入下一关', async () => {
    render(<ConnectFourPuzzlePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(within(screen.getByRole('navigation', { name: '残局关卡选择' })).getAllByRole('button')).toHaveLength(9);
    const startCount = connectFourPuzzles[0]!.history.length;
    const wrong = [0, 1, 3, 4, 5, 6].find((col) => !puzzleSolutions(connectFourPuzzles[0]!).includes(col))!;
    await drop(wrong);
    expect(screen.getByRole('alert')).toHaveTextContent('还没有连成四子');
    expect(screen.getByRole('grid', { name: new RegExp(`已投放 ${startCount} 枚棋子`) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提示思路' }));
    expect(screen.getByText(/由你决定是否落子/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /投放第 3 列，建议落点/ })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: new RegExp(`已投放 ${startCount} 枚棋子`) })).toBeInTheDocument();
    await drop(2);
    expect(await screen.findByText('本次参考完成')).toBeInTheDocument();
    expect(screen.getByText(/横向连成四子/)).toBeInTheDocument();
    expect(screen.getByText('已通关 1/9')).toBeInTheDocument();
    expect(screen.getByText('独立完成 0 关 · 参考完成 1 关')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一关' }));
    expect(screen.getByRole('heading', { name: '向上连珠' })).toBeInTheDocument();
    expect(screen.getByText('已通关 1/9')).toBeInTheDocument();
  });

  it('防守错着展示对手真实即胜列，选对列后独立完成；珊瑚色关正确展示颜色', async () => {
    render(<ConnectFourPuzzlePage recoveredRoom={false} onExit={vi.fn()} />);
    selectPuzzle(3);
    await drop(0);
    expect(screen.getByRole('alert')).toHaveTextContent(/对手仍能从第 4 列立即连四/);
    expect(screen.getByRole('grid', { name: /已投放 8 枚棋子/ })).toBeInTheDocument();
    await drop(3);
    expect(screen.getByText('本次独立完成')).toBeInTheDocument();
    expect(screen.getByText('独立完成 1 关 · 参考完成 0 关')).toBeInTheDocument();
    selectPuzzle(4);
    expect(screen.getByText('你 · 珊瑚色')).toBeInTheDocument();
    expect(screen.getByText('对手 · 金色')).toBeInTheDocument();
  });

  it('两步题第一手触发真实守方回应，键盘可继续收官；刷新恢复同一轨迹', async () => {
    const { unmount } = render(<ConnectFourPuzzlePage recoveredRoom={false} onExit={vi.fn()} />);
    selectPuzzle(6);
    const first = screen.getByRole('button', { name: '投放第 1 列' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = screen.getByRole('button', { name: '投放第 2 列' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'Enter' });
    fireEvent.click(second);
    expect(screen.getByRole('alert')).toHaveTextContent(/对手可以应在/);
    expect(screen.getByRole('grid', { name: /已投放 10 枚棋子/ })).toBeInTheDocument();
    await drop(2);
    expect(await screen.findByText(/对手已合法应在第 5 列/)).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /已投放 12 枚棋子/ })).toBeInTheDocument();
    expect(readPuzzleAttempt().attempt.moves).toEqual([2, 4]);
    unmount();
    render(<ConnectFourPuzzlePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '先造机会' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /已投放 12 枚棋子/ })).toBeInTheDocument();
    const third = screen.getByRole('button', { name: '投放第 1 列' });
    third.focus();
    fireEvent.keyDown(third, { key: ' ' });
    fireEvent.click(third);
    expect(await screen.findByText('本次独立完成')).toBeInTheDocument();
    expect(readPuzzleAttempt().attempt.moves).toEqual([2, 4, 0]);
    expect(third).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: '下一关' })).toHaveFocus());
  });

  it('Tab 离开棋盘后不抢焦点；坏轨迹提示重新开始，其他练习键保持原值', async () => {
    window.localStorage.setItem('gamehall:solo:connect-four:v1', 'old board');
    window.sessionStorage.setItem(PUZZLE_ATTEMPT_KEY, JSON.stringify({ version: 1, id: 'fork', moves: [2, 0], hintUsed: false, hintShown: false, completed: false }));
    const { unmount } = render(<ConnectFourPuzzlePage recoveredRoom={true} onExit={vi.fn()} />);
    expect(screen.getByText(/本标签的残局记录无法读取/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '补上横线' })).toBeInTheDocument();
    expect(screen.getByText(/好友房已恢复/)).toBeInTheDocument();
    const boardButton = screen.getByRole('button', { name: '投放第 1 列' });
    boardButton.focus();
    fireEvent.keyDown(boardButton, { key: 'Tab' });
    screen.getByRole('button', { name: '重试本关' }).focus();
    await drop(2);
    expect(screen.getByRole('button', { name: '重试本关' })).toHaveFocus();
    expect(window.localStorage.getItem('gamehall:solo:connect-four:v1')).toBe('old board');
    unmount();
  });

  it('完成标记跨标签只增不降级，选择本地已完成关卡仍可重新挑战', async () => {
    window.localStorage.setItem(`${PUZZLE_COMPLETION_PREFIX}bridge:independent`, '1');
    const { rerender } = render(<ConnectFourPuzzlePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByText('独立完成 1 关 · 参考完成 0 关')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提示思路' }));
    await drop(2);
    expect(screen.getByText('本次参考完成')).toBeInTheDocument();
    expect(screen.getByText('独立完成 1 关 · 参考完成 0 关')).toBeInTheDocument();
    window.localStorage.setItem(`${PUZZLE_COMPLETION_PREFIX}tower:reference`, '1');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: `${PUZZLE_COMPLETION_PREFIX}tower:reference`, newValue: '1' })));
    rerender(<ConnectFourPuzzlePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByText('已通关 2/9')).toBeInTheDocument();
    expect(screen.getByText('独立完成 1 关 · 参考完成 1 关')).toBeInTheDocument();
  });

  it('已有独立与参考成果时，存储事件读取失败不清空已知成绩；恢复后仅合并更高成绩', async () => {
    render(<ConnectFourPuzzlePage recoveredRoom={false} onExit={vi.fn()} />);
    await drop(2);
    selectPuzzle(1);
    fireEvent.click(screen.getByRole('button', { name: '提示思路' }));
    await drop(1);
    expect(screen.getByText('独立完成 1 关 · 参考完成 1 关')).toBeInTheDocument();

    const originalGet = Storage.prototype.getItem;
    const brokenRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (this === window.localStorage && key.startsWith(PUZZLE_COMPLETION_PREFIX)) throw Error('temporarily blocked');
      return originalGet.call(this, key);
    });
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: `${PUZZLE_COMPLETION_PREFIX}tower:reference` })));
    expect(screen.getByText('已通关 2/9')).toBeInTheDocument();
    expect(screen.getByText('独立完成 1 关 · 参考完成 1 关')).toBeInTheDocument();
    expect(screen.getByText(/暂不能读取通关记录/)).toBeInTheDocument();

    brokenRead.mockRestore();
    window.localStorage.setItem(`${PUZZLE_COMPLETION_PREFIX}tower:independent`, '1');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: `${PUZZLE_COMPLETION_PREFIX}tower:independent` })));
    expect(screen.getByText('已通关 2/9')).toBeInTheDocument();
    expect(screen.getByText('独立完成 2 关 · 参考完成 0 关')).toBeInTheDocument();
    expect(screen.queryByText(/暂不能读取通关记录/)).not.toBeInTheDocument();
  });

  it('读写通关标记暂不可用时，本页本次胜着仍增加成果，旧成果不丢', async () => {
    window.localStorage.setItem(`${PUZZLE_COMPLETION_PREFIX}bridge:independent`, '1');
    window.localStorage.setItem(`${PUZZLE_COMPLETION_PREFIX}tower:reference`, '1');
    render(<ConnectFourPuzzlePage recoveredRoom={false} onExit={vi.fn()} />);
    selectPuzzle(2);
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (this === window.localStorage && key.startsWith(PUZZLE_COMPLETION_PREFIX)) throw Error('read blocked');
      return originalGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === window.localStorage && key.startsWith(PUZZLE_COMPLETION_PREFIX)) throw Error('write blocked');
      return originalSet.call(this, key, value);
    });
    await drop(3);
    expect(screen.getByText('本次独立完成')).toBeInTheDocument();
    expect(screen.getByText('已通关 3/9')).toBeInTheDocument();
    expect(screen.getByText('独立完成 2 关 · 参考完成 1 关')).toBeInTheDocument();
    expect(screen.getByText(/通关记录暂时无法保存/)).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /已投放 15 枚棋子/ })).toBeInTheDocument();
  });
});
