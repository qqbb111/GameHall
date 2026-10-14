import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SokobanPracticePage } from './SokobanPracticePage';
import { SOKOBAN_ATTEMPT_KEY, SOKOBAN_BEST_PREFIX, sokobanBestKey, writeSokobanBests } from './sokoban-progress';
import { sokobanLevels } from '@gamehall/game-core';

function choose(index: number) {
  fireEvent.click(within(screen.getByRole('navigation', { name: '推箱子关卡选择' })).getByRole('button', { name: new RegExp(`第 ${index} 关`) }));
}

describe('推箱子单人界面', () => {
  afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); window.localStorage.clear(); });

  it('仅棋盘与方向控制区接受方向键，墙壁不计步，悔棋同时回退推箱统计', () => {
    render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(within(screen.getByRole('navigation', { name: '推箱子关卡选择' })).getAllByRole('button')).toHaveLength(10);
    const board = screen.getByRole('grid', { name: /推到终点棋盘/ });
    const exit = screen.getByRole('button', { name: '返回大厅' });
    exit.focus();
    fireEvent.keyDown(exit, { key: 'ArrowRight' });
    expect(screen.getByText('步数').parentElement).toHaveTextContent('0');
    board.focus();
    fireEvent.keyDown(board, { key: 'ArrowUp' });
    fireEvent.keyDown(board, { key: 'ArrowUp' });
    expect(screen.getByText('步数').parentElement).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    const right = screen.getByRole('button', { name: '向右移动' });
    right.focus();
    fireEvent.keyDown(right, { key: 'd' });
    expect(screen.getByText('步数').parentElement).toHaveTextContent('1');
    expect(screen.getByText('推箱').parentElement).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(screen.getByText('步数').parentElement).toHaveTextContent('0');
    expect(screen.getByText('推箱').parentElement).toHaveTextContent('0');
    expect(right).toHaveFocus();
  });

  it('快速移动、反向和悔棋保持同一视觉实体，阻挡步不动且方向标记跟随实际移动', () => {
    render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    const board = screen.getByRole('grid', { name: /推到终点棋盘/ });
    const player = board.querySelector<HTMLElement>('[data-piece-id="player"]')!;
    const crate = board.querySelector<HTMLElement>('[data-piece-id="box-0"]')!;
    expect(board.querySelectorAll('.sokoban-piece')).toHaveLength(2);
    expect(player.dataset.cell).toBe('16');
    expect(crate.dataset.cell).toBe('17');
    board.focus();
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowRight']) fireEvent.keyDown(board, { key });
    expect(board.querySelector('[data-piece-id="player"]')).toBe(player);
    expect(board.querySelector('[data-piece-id="box-0"]')).toBe(crate);
    expect(player.dataset.cell).toBe('17');
    expect(crate.dataset.cell).toBe('18');
    expect(player.dataset.facing).toBe('R');
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(player.dataset.cell).toBe('16');
    expect(crate.dataset.cell).toBe('17');
    expect(player.dataset.facing).toBe('L');
    fireEvent.keyDown(board, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(board.querySelectorAll('.sokoban-piece')).toHaveLength(2);
    expect(player.dataset.cell).toBe('16');
    expect(crate.dataset.cell).toBe('17');
    fireEvent.keyDown(board, { key: 'ArrowUp' });
    fireEvent.keyDown(board, { key: 'ArrowUp' });
    expect(board.querySelector('[data-piece-id="player"]')).toBe(player);
    expect(player.dataset.cell).toBe('9');
    expect(screen.getByRole('grid', { name: /3步，0次推箱/ })).toBeInTheDocument();
  });

  it('刷新和重试直接建立正确棋面，缩放期间禁用过渡，方向盘与棋格名称照常可用', async () => {
    const first = render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '向右移动' }));
    const oldPiece = screen.getByRole('grid').querySelector('[data-piece-id="player"]');
    first.unmount();
    render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    const board = screen.getByRole('grid', { name: /1步，1次推箱/ });
    const restored = board.querySelector<HTMLElement>('[data-piece-id="player"]')!;
    expect(restored).not.toBe(oldPiece);
    expect(restored.dataset.cell).toBe('17');
    expect(within(board).getByRole('gridcell', { name: '第 3 行第 4 列，玩家' })).toBeInTheDocument();
    fireEvent(window, new Event('resize'));
    expect(board).toHaveClass('is-resizing');
    await waitFor(() => expect(board).not.toHaveClass('is-resizing'));
    fireEvent.click(screen.getByRole('button', { name: '重试本关' }));
    fireEvent.click(screen.getByRole('button', { name: '清空并继续' }));
    const reset = board.querySelector<HTMLElement>('[data-piece-id="player"]')!;
    expect(reset).not.toBe(restored);
    expect(reset.dataset.cell).toBe('16');
    expect(board.querySelectorAll('.sokoban-piece')).toHaveLength(2);
  });

  it('进行中选关需确认，Esc 取消回原焦点；通关后手动下一关无需二次确认', () => {
    render(<SokobanPracticePage recoveredRoom={true} onExit={vi.fn()} />);
    expect(screen.getByText(/好友房已恢复/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '向右移动' }));
    screen.getByRole('button', { name: /第 2 关/ }).focus();
    choose(2);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续当前尝试' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /第 2 关/ })).toHaveFocus();
    expect(screen.getByText('步数').parentElement).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: '重试本关' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空并继续' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /推到终点棋盘/ })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '向右移动' }));
    fireEvent.click(screen.getByRole('button', { name: '向右移动' }));
    expect(screen.getByText('本关完成！')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一关' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '绕到背后' })).toHaveFocus();
  });

  it('末关通关有缺关时只提示本关完成；十关都有合法最佳记录才祝贺全部通关', () => {
    const final = sokobanLevels[9]!;
    const finalPath = 'UUULURRDRRDDLDLLLLLUUULUR';
    window.sessionStorage.setItem(SOKOBAN_ATTEMPT_KEY, JSON.stringify({ version: 1, levelId: final.id, history: finalPath }));
    const first = render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByText('本关完成！')).toBeInTheDocument();
    expect(screen.queryByText('十关都已通关！')).not.toBeInTheDocument();
    expect(screen.getByText(/可以重试挑战，或从第一关再练。/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '从第一关再练' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一关' })).not.toBeInTheDocument();
    first.unmount();

    const paths = ['RR', 'RRURD', 'RDRU', 'RRUUDDLLLLUU', 'RDRUURULDDDLLLLLUU',
      'RRDRUURULRDDRDLL', 'RRRUUDDDLLLLULLUU', 'UDLUURDRUDRDRUU', 'UUURDRLDDRRUUUDRDRUU'];
    writeSokobanBests(Object.fromEntries(sokobanLevels.slice(0, 9).map((level, index) => [level.id, paths[index]!])));
    render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByText('十关都已通关！')).toBeInTheDocument();
    expect(screen.queryByText('本关完成！')).not.toBeInTheDocument();
    expect(screen.queryByText(/手动进入下一关/)).not.toBeInTheDocument();
  });

  it('空局可直接选到后段关卡，选中关卡留在轨道视野内', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    rect.mockImplementation(function (this: Element) {
      if (this.classList.contains('sokoban-level-track')) return { left: 0, right: 160, top: 0, bottom: 100, width: 160, height: 100 } as DOMRect;
      if (this.getAttribute('aria-current') === 'step') return { left: 300, right: 440, top: 150, bottom: 200, width: 140, height: 50 } as DOMRect;
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
    });
    render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    choose(10);
    const track = document.querySelector('.sokoban-level-track')!;
    expect(track.scrollLeft).toBeGreaterThan(0);
    expect(track.scrollTop).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: '最后一圈' })).toHaveFocus();
  });

  it('刷新重放当前步与通关最佳，重试和换关不抹去已完成成绩', () => {
    const first = render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '向右移动' }));
    expect(JSON.parse(window.sessionStorage.getItem(SOKOBAN_ATTEMPT_KEY)!)).toMatchObject({ history: 'R' });
    first.unmount();
    const resumed = render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByRole('grid', { name: /1步，1次推箱/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '向右移动' }));
    expect(screen.getByText('本关完成！')).toBeInTheDocument();
    expect(screen.getByText('本关最佳：2 步 · 2 次推箱')).toBeInTheDocument();
    resumed.unmount();
    render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByText('本关最佳：2 步 · 2 次推箱')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试本关' }));
    expect(screen.getByRole('grid', { name: /0步，0次推箱/ })).toBeInTheDocument();
    expect(screen.getByText('本关最佳：2 步 · 2 次推箱')).toBeInTheDocument();
    choose(2);
    expect(screen.getByRole('heading', { name: '绕到背后' })).toBeInTheDocument();
  });

  it('坏记录和写失败仍可玩，已知通关成绩可手动重试保存', () => {
    window.sessionStorage.setItem(SOKOBAN_ATTEMPT_KEY, '{bad');
    window.localStorage.setItem(SOKOBAN_BEST_PREFIX + 'first-push', JSON.stringify({ version: 1, levelId: 'first-push', history: '' }));
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByText(/尝试记录无法读取/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '向右移动' }));
    fireEvent.click(screen.getByRole('button', { name: '向右移动' }));
    expect(screen.getByText('本关最佳：2 步 · 2 次推箱')).toBeInTheDocument();
    expect(screen.getByText(/最佳成绩暂时无法保存/)).toBeInTheDocument();
    blocked.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    expect(screen.queryByRole('button', { name: '重试保存' })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(sokobanBestKey(sokobanLevels[0]!, 'RR'))!)).toMatchObject({ history: 'RR' });
  });

  it('其他标签写入更优候选后合并并展示，不被本标签较差成绩覆盖', () => {
    render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    for (const label of ['向上移动', '向下移动', '向右移动', '向右移动']) fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByText('本关最佳：4 步 · 2 次推箱')).toBeInTheDocument();
    const betterKey = sokobanBestKey(sokobanLevels[0]!, 'RR');
    window.localStorage.setItem(betterKey, JSON.stringify({ version: 1, levelId: 'first-push', history: 'RR' }));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: betterKey })));
    expect(screen.getByText('本关最佳：2 步 · 2 次推箱')).toBeInTheDocument();
    expect(window.localStorage.getItem(sokobanBestKey(sokobanLevels[0]!, 'UDRR'))).toBeNull();
  });

  it('同分不同路径的 storage 通知收敛后不触发无效回写', () => {
    render(<SokobanPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    for (const label of ['向上移动', '向下移动', '向右移动', '向右移动']) fireEvent.click(screen.getByRole('button', { name: label }));
    const key = sokobanBestKey(sokobanLevels[0]!, 'UDRR');
    window.localStorage.setItem(key, JSON.stringify({ version: 1, levelId: 'first-push', history: 'DURR' }));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    for (let repeat = 0; repeat < 5; repeat++) act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
    expect(writes).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(key)!)).toMatchObject({ history: 'DURR' });
    expect(screen.getByText('本关最佳：4 步 · 2 次推箱')).toBeInTheDocument();
  });
});
