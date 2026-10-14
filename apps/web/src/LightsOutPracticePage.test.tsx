import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lightsOutLevels, solveLightsOut } from '@gamehall/game-core';
import { LightsOutPracticePage } from './LightsOutPracticePage';
import { LIGHTS_OUT_ATTEMPT_KEY, lightsOutBestKey, writeLightsOutBests } from './lights-out-progress';

const first = lightsOutLevels[0]!;
const solution = solveLightsOut(first, first.initial)!;
const cells = () => within(screen.getByRole('grid')).getAllByRole('gridcell');
const choose = (number: number) => fireEvent.click(within(screen.getByRole('navigation', { name: '连灯解谜关卡选择' })).getByRole('button', { name: new RegExp(`第 ${number} 关`) }));

describe('连灯解谜单人页面', () => {
  afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); window.localStorage.clear(); });

  it('棋格亮暗有名称和形状；方向键只在棋格内移焦，Enter / 空格各翻转一次，Tab 可离开', () => {
    render(<LightsOutPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(cells()).toHaveLength(9);
    expect(cells()[0]).toHaveAccessibleName('第 1 行第 1 列，亮灯，点击翻转');
    expect(cells()[0]).toHaveTextContent('*');
    const exit = screen.getByRole('button', { name: '返回大厅' });
    exit.focus();
    fireEvent.keyDown(exit, { key: 'ArrowRight' });
    expect(exit).toHaveFocus();
    cells()[0]!.focus();
    fireEvent.keyDown(cells()[0]!, { key: 'ArrowRight' });
    expect(cells()[1]).toHaveFocus();
    expect(cells()[1]).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(cells()[1]!, { key: 'Enter' });
    expect(screen.getByRole('grid', { name: /点击 1 次/ })).toBeInTheDocument();
    fireEvent.keyDown(cells()[1]!, { key: ' ' });
    expect(screen.getByRole('grid', { name: /点击 2 次/ })).toBeInTheDocument();
    expect(cells()[0]).toHaveAccessibleName('第 1 行第 1 列，亮灯，点击翻转');
    expect(fireEvent.keyDown(cells()[1]!, { key: 'Tab' })).toBe(true);
  });

  it('提示仅标一格不代走；快速点击、撤销、刷新继续与通关best保留', () => {
    const mounted = render(<LightsOutPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '提示一步' }));
    expect(screen.getByText(/提示不会自动点击/)).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /点击 0 次/ })).toBeInTheDocument();
    expect(cells()[solution[0]!]).toHaveClass('is-hint');
    fireEvent.click(cells()[solution[0]!]!);
    fireEvent.click(cells()[solution[1]!]!);
    expect(screen.getByText('本关灯光已熄灭！')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提示一步' })).toBeDisabled();
    expect(screen.getByText('本关最佳').parentElement).toHaveTextContent('2 次');
    expect(JSON.parse(window.sessionStorage.getItem(LIGHTS_OUT_ATTEMPT_KEY)!)).toMatchObject({ history: solution });
    expect(window.localStorage.getItem(lightsOutBestKey(first, solution))).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销一步' }));
    expect(screen.queryByText('本关灯光已熄灭！')).not.toBeInTheDocument();
    expect(screen.getByText('本关最佳').parentElement).toHaveTextContent('2 次');
    mounted.unmount();
    render(<LightsOutPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByRole('grid', { name: /点击 1 次/ })).toBeInTheDocument();
    expect(screen.getByText('本关最佳').parentElement).toHaveTextContent('2 次');
  });

  it('进行中切关与重试需确认；Esc 恢复原焦点，空局与通关后切关直接进行', () => {
    const focusedScroll: Element[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { focusedScroll.push(this); });
    render(<LightsOutPracticePage recoveredRoom={true} onExit={vi.fn()} />);
    expect(screen.getByText(/好友房已恢复/)).toBeInTheDocument();
    choose(2);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '对角回声 · 第 2 关' })).toHaveFocus();
    expect(focusedScroll.at(-1)).toBe(screen.getByRole('heading', { name: '对角回声 · 第 2 关' }));
    fireEvent.click(cells()[0]!);
    const retry = screen.getByRole('button', { name: '重新开始' });
    retry.focus();
    fireEvent.click(retry);
    expect(screen.getByRole('button', { name: '继续当前尝试' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(screen.getByRole('grid', { name: /点击 1 次/ })).toBeInTheDocument();
    choose(3);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空并继续' }));
    expect(screen.getByRole('heading', { name: '交叉微光 · 第 3 关' })).toHaveFocus();
    expect(focusedScroll.at(-1)).toBe(screen.getByRole('heading', { name: '交叉微光 · 第 3 关' }));
    expect(screen.getByRole('grid', { name: /点击 0 次/ })).toBeInTheDocument();
    fireEvent.click(cells()[0]!);
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    fireEvent.click(screen.getByRole('button', { name: '清空并继续' }));
    expect(cells()[0]).toHaveFocus();
    expect(focusedScroll.at(-1)).toBe(cells()[0]);
    choose(1);
    for (const index of solution) fireEvent.click(cells()[index]!);
    fireEvent.click(screen.getByRole('button', { name: '下一关' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '对角回声 · 第 2 关' })).toHaveFocus();
  });

  it('256次有界点击达到上限时自然停住，撤销和重开仍可用', () => {
    window.sessionStorage.setItem(LIGHTS_OUT_ATTEMPT_KEY, JSON.stringify({ version: 1, levelId: first.id, history: Array(256).fill(0) }));
    render(<LightsOutPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    fireEvent.click(cells()[0]!);
    expect(screen.getByText(/点击已到上限/)).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /点击 256 次/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销一步' }));
    expect(screen.getByRole('grid', { name: /点击 255 次/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    fireEvent.click(screen.getByRole('button', { name: '清空并继续' }));
    expect(screen.getByRole('grid', { name: /点击 0 次/ })).toBeInTheDocument();
  });

  it('末关有缺关时只称本关完成，十二关都有有效记录才祝贺全部通关', () => {
    const last = lightsOutLevels[11]!;
    const lastWin = solveLightsOut(last, last.initial)!;
    window.sessionStorage.setItem(LIGHTS_OUT_ATTEMPT_KEY, JSON.stringify({ version: 1, levelId: last.id, history: lastWin }));
    const initial = render(<LightsOutPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByText('本关灯光已熄灭！')).toBeInTheDocument();
    expect(screen.queryByText('十二关都已通关！')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '从第一关再玩' })).toBeInTheDocument();
    initial.unmount();
    writeLightsOutBests(Object.fromEntries(lightsOutLevels.slice(0, 11).map((level) => [level.id, solveLightsOut(level, level.initial)!])));
    render(<LightsOutPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    expect(screen.getByText('十二关都已通关！')).toBeInTheDocument();
  });

  it('写失败时留住本页已知通关，恢复后手动重试；其他标签更优成绩不降级', () => {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    render(<LightsOutPracticePage recoveredRoom={false} onExit={vi.fn()} />);
    for (const index of solution) fireEvent.click(cells()[index]!);
    expect(screen.getByText('本关最佳').parentElement).toHaveTextContent('2 次');
    expect(screen.getByText(/成绩暂时无法保存/)).toBeInTheDocument();
    blocked.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    expect(window.localStorage.getItem(lightsOutBestKey(first, solution))).not.toBeNull();
    expect(screen.queryByRole('button', { name: '重试保存' })).not.toBeInTheDocument();
    const worse = [0, 0, ...solution];
    window.localStorage.setItem(lightsOutBestKey(first, worse), JSON.stringify({ version: 1, levelId: first.id, history: worse }));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: lightsOutBestKey(first, worse) })));
    expect(screen.getByText('本关最佳').parentElement).toHaveTextContent('2 次');
  });
});
