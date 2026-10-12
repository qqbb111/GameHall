import { useState } from 'react';
import { type DotsAndBoxesState, type EdgeOrientation, type Player } from '@gamehall/game-core';
import type { GameActionCommand } from '@gamehall/protocol';
import './board-games.css';

export function DotsAndBoxesGame({ state, mySeat, active, onAction }: {
  state: DotsAndBoxesState; mySeat: Player; active: boolean;
  onAction: (action: GameActionCommand['action']) => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const mine = active && state.phase === 'playing' && state.turn === mySeat;
  async function draw(orientation: EdgeOrientation, row: number, col: number) {
    const taken = orientation === 'H' ? state.horizontal[row * 3 + col] !== null : state.vertical[row * 4 + col] !== null;
    if (!mine || pending || taken) return;
    setPending(true);
    try { await onAction({ type: 'drawEdge', orientation, row, col }); } finally { setPending(false); }
  }
  return <section className="game-surface dots-surface" aria-label="点格棋对局">
    <div className="surface-title"><div><span>连点成格 · 画完第四边得分并继续</span><h2 aria-live="polite">{state.phase === 'finished' ? '本局结束' : mine ? '轮到你画边' : '等待好友画边'}</h2></div><div className="dots-scores"><span>你 <b>{state.scores[mySeat]}</b></span><span>好友 <b>{state.scores[mySeat === 0 ? 1 : 0]}</b></span></div></div>
    <div className="dots-board" role="group" aria-label="4乘4点、3乘3格子的点格棋棋盘">{Array.from({ length: 49 }, (_, index) => {
      const gridRow = Math.floor(index / 7), gridCol = index % 7;
      if (gridRow % 2 === 0 && gridCol % 2 === 0) return <span key={index} className="dots-point" aria-hidden="true"><i /></span>;
      if (gridRow % 2 === 1 && gridCol % 2 === 1) {
        const box = Math.floor(gridRow / 2) * 3 + Math.floor(gridCol / 2);
        const owner = state.boxes[box];
        return <span key={index} className={`dots-box ${owner === null ? '' : owner === mySeat ? 'mine' : 'theirs'} ${state.lastBoxes.includes(box) ? 'is-new' : ''}`} aria-label={`第 ${Math.floor(gridRow / 2) + 1} 行第 ${Math.floor(gridCol / 2) + 1} 格${owner === null ? '，未封闭' : owner === mySeat ? '，你获得' : '，好友获得'}`}>{owner === null ? '' : owner === mySeat ? '你' : '友'}</span>;
      }
      const orientation: EdgeOrientation = gridRow % 2 === 0 ? 'H' : 'V';
      const row = Math.floor(gridRow / 2), col = Math.floor(gridCol / 2);
      const owner = orientation === 'H' ? state.horizontal[row * 3 + col] : state.vertical[row * 4 + col];
      const last = state.lastEdge?.orientation === orientation && state.lastEdge.row === row && state.lastEdge.col === col;
      return <button key={index} className={`dots-edge ${orientation === 'H' ? 'horizontal' : 'vertical'} ${owner === null ? 'is-open' : owner === mySeat ? 'mine' : 'theirs'} ${last ? 'is-last' : ''}`}
        type="button" disabled={!mine || pending || owner !== null} aria-label={`${orientation === 'H' ? '横边' : '竖边'}，第 ${row + 1} 行第 ${col + 1} 列${owner === null ? '，可画' : '，已画'}`}
        onClick={() => void draw(orientation, row, col)}><i /></button>;
    })}</div>
    <p className="board-hint">点击空边，或用 Tab 选边并按 Enter/空格。画出一个格子的第四条边即可得 1 分，并继续行动；一次封住两个格子得 2 分。24 条边画完后分高者获胜。</p>
  </section>;
}
