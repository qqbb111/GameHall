import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SokobanPracticePage } from './SokobanPracticePage';

function choose(index: number) {
  fireEvent.click(within(screen.getByRole('navigation', { name: '推箱子关卡选择' })).getByRole('button', { name: new RegExp(`第 ${index} 关`) }));
}

describe('推箱子单人界面', () => {
  afterEach(() => vi.restoreAllMocks());

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
});
