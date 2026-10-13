import { useState } from 'react';
import { type DotsAndBoxesState, type EdgeOrientation, type Player } from '@gamehall/game-core';
import type { GameActionCommand } from '@gamehall/protocol';
import './board-games.css';
import { useBoardKeyboardContinuity } from './useBoardKeyboardContinuity';
import { onlineGameHeading, type OnlineGameAvailability } from './online-game-heading';

export function DotsAndBoxesGame({ state, mySeat, active, onAction, opponentLabel = '好友', hintEdge = null, availability, actionPending }: {
  state: DotsAndBoxesState; mySeat: Player; active: boolean; availability?: OnlineGameAvailability; actionPending?: boolean;
  opponentLabel?: string; hintEdge?: { orientation: EdgeOrientation; row: number; col: number } | null;
  onAction: (action: GameActionCommand['action']) => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const busy = actionPending ?? pending;
  const [focusIndex, setFocusIndex] = useState(0);
  const mine = active && state.phase === 'playing' && state.turn === mySeat;
  const open = Array.from({ length: 49 }, (_, index) => index).filter((index) => {
    const gridRow = Math.floor(index / 7), gridCol = index % 7;
    if (gridRow % 2 === gridCol % 2) return false;
    return gridRow % 2 === 0 ? state.horizontal[Math.floor(gridRow / 2) * 3 + Math.floor(gridCol / 2)] === null
      : state.vertical[Math.floor(gridRow / 2) * 4 + Math.floor(gridCol / 2)] === null;
  });
  const currentFocus = open.includes(focusIndex) ? focusIndex : open.toSorted((a, b) => {
    const distance = (index: number) => Math.abs(Math.floor(index / 7) - Math.floor(focusIndex / 7)) + Math.abs(index % 7 - focusIndex % 7);
    return distance(a) - distance(b) || a - b;
  })[0];
  const { boardRef, onKeyDownCapture, onPointerDownCapture } = useBoardKeyboardContinuity(
    mine && !busy, currentFocus === undefined ? null : `[data-grid-index="${currentFocus}"]`,
  );
  async function draw(orientation: EdgeOrientation, row: number, col: number) {
    const taken = orientation === 'H' ? state.horizontal[row * 3 + col] !== null : state.vertical[row * 4 + col] !== null;
    if (!mine || busy || taken) return;
    setPending(true);
    try { await onAction({ type: 'drawEdge', orientation, row, col }); } finally { setPending(false); }
  }
  function arrow(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === 'ArrowRight' ? [0, 1] : event.key === 'ArrowLeft' ? [0, -1]
      : event.key === 'ArrowDown' ? [1, 0] : event.key === 'ArrowUp' ? [-1, 0] : null;
    if (!direction) return;
    event.preventDefault();
    const fromRow = Math.floor(index / 7), fromCol = index % 7;
    const options = open.filter((candidate) => {
      const dr = Math.floor(candidate / 7) - fromRow, dc = candidate % 7 - fromCol;
      return dr * direction[0]! + dc * direction[1]! > 0;
    }).sort((a, b) => {
      const metric = (candidate: number) => {
        const dr = Math.floor(candidate / 7) - fromRow, dc = candidate % 7 - fromCol;
        return (dr * direction[0]! + dc * direction[1]!) * 10 + Math.abs(dr * direction[1]! + dc * direction[0]!);
      };
      return metric(a) - metric(b);
    });
    const next = options[0];
    if (next === undefined) return;
    setFocusIndex(next);
    boardRef.current?.querySelector<HTMLButtonElement>(`button[data-grid-index="${next}"]`)?.focus();
  }
  return <section className="game-surface dots-surface" aria-label="点格棋对局">
    <div className="surface-title"><div><span>连点成格 · 画完第四边得分并继续</span><h2 aria-live="polite">{onlineGameHeading(state.phase === 'finished', '本局结束', availability, actionPending, state.turn === mySeat ? state.lastBoxes.length && state.lastEdge?.player === mySeat ? `你获得 ${state.lastBoxes.length} 分，继续画边` : '轮到你画边' : `等待${opponentLabel}画边`)}</h2></div><div className="dots-scores"><span>你 <b>{state.scores[mySeat]}</b></span><span>{opponentLabel} <b>{state.scores[mySeat === 0 ? 1 : 0]}</b></span></div></div>
    <div ref={boardRef} className="dots-board" role="group" aria-label="4乘4点、3乘3格子的点格棋棋盘" onKeyDownCapture={onKeyDownCapture} onPointerDownCapture={onPointerDownCapture}>{Array.from({ length: 49 }, (_, index) => {
      const gridRow = Math.floor(index / 7), gridCol = index % 7;
      if (gridRow % 2 === 0 && gridCol % 2 === 0) return <span key={index} className="dots-point" aria-hidden="true"><i /></span>;
      if (gridRow % 2 === 1 && gridCol % 2 === 1) {
        const box = Math.floor(gridRow / 2) * 3 + Math.floor(gridCol / 2);
        const owner = state.boxes[box];
        return <span key={index} className={`dots-box ${owner === null ? '' : owner === mySeat ? 'mine' : 'theirs'} ${state.lastBoxes.includes(box) ? 'is-new' : ''}`} aria-label={`第 ${Math.floor(gridRow / 2) + 1} 行第 ${Math.floor(gridCol / 2) + 1} 格${owner === null ? '，未封闭' : owner === mySeat ? '，你获得' : `，${opponentLabel}获得`}`}>{owner === null ? '' : owner === mySeat ? '你' : opponentLabel === '电脑' ? '机' : '友'}</span>;
      }
      const orientation: EdgeOrientation = gridRow % 2 === 0 ? 'H' : 'V';
      const row = Math.floor(gridRow / 2), col = Math.floor(gridCol / 2);
      const owner = orientation === 'H' ? state.horizontal[row * 3 + col] : state.vertical[row * 4 + col];
      const last = state.lastEdge?.orientation === orientation && state.lastEdge.row === row && state.lastEdge.col === col;
      const hinted = hintEdge?.orientation === orientation && hintEdge.row === row && hintEdge.col === col && owner === null;
      return <button key={index} className={`dots-edge ${orientation === 'H' ? 'horizontal' : 'vertical'} ${owner === null ? 'is-open' : owner === mySeat ? 'mine' : 'theirs'} ${last ? 'is-last' : ''} ${hinted ? 'is-hint' : ''}`}
        type="button" disabled={!mine || busy || owner !== null} aria-label={`${orientation === 'H' ? '横边' : '竖边'}，第 ${row + 1} 行第 ${col + 1} 列${owner === null ? '，可画' : '，已画'}`}
        data-grid-index={index} tabIndex={mine && !busy && index === currentFocus ? 0 : -1} onFocus={() => setFocusIndex(index)} onKeyDown={(event) => arrow(event, index)}
        onClick={() => void draw(orientation, row, col)}><i /></button>;
    })}</div>
    <p className="board-hint">点击空边，或用 Tab 进入棋盘后用方向键选边、按 Enter/空格画边。画出一个格子的第四条边即可得 1 分，并继续行动；一次封住两个格子得 2 分。24 条边画完后分高者获胜。</p>
  </section>;
}
