import { describe, expect, it } from 'vitest';
import { parseSokobanLevel, replaySokobanHistory, sokobanLevels } from '@gamehall/game-core';
import { oppositeSokobanDirection, traceSokobanVisuals } from './sokoban-visuals';

describe('推箱子装饰实体轨迹', () => {
  it('箱子跨过另一只箱子的排序位置时，初始身份仍跟着原箱移动', () => {
    const level = parseSokobanLevel('visual-order', '排序', '测试', [
      '########',
      '# @    #',
      '# $ $  #',
      '#      #',
      '# .  . #',
      '########',
    ]);
    const initial = traceSokobanVisuals(level, '');
    const pushed = traceSokobanVisuals(level, 'D');
    expect(initial.boxes.map((box) => [box.id, box.cell])).toEqual([[0, 18], [1, 20]]);
    expect(pushed.boxes.map((box) => [box.id, box.cell])).toEqual([[0, 26], [1, 20]]);
    expect(replaySokobanHistory(level, 'D').boxes).toEqual([20, 26]);
    expect(traceSokobanVisuals(level, '').boxes).toEqual(initial.boxes);
  });

  it('合法快速折返及悔棋后的视觉坐标与规则重放一致，不接受墙碰撞历史', () => {
    const level = sokobanLevels[0]!;
    for (const history of ['', 'U', 'UD', 'UDR', 'UD', 'UDR', 'UDRR']) {
      const visuals = traceSokobanVisuals(level, history);
      const rules = replaySokobanHistory(level, history);
      expect(visuals.player).toBe(rules.player);
      expect(visuals.boxes.map(({ cell }) => cell).sort((a, b) => a - b)).toEqual(rules.boxes);
    }
    expect(() => traceSokobanVisuals(level, 'UU')).toThrow();
    expect(oppositeSokobanDirection('R')).toBe('L');
  });
});
