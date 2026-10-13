import { useState } from 'react';
import { CONNECT_FOUR_COLS, CONNECT_FOUR_ROWS, type ConnectFourState, type Player } from '@gamehall/game-core';
import type { GameActionCommand } from '@gamehall/protocol';
import './board-games.css';
import { useBoardKeyboardContinuity } from './useBoardKeyboardContinuity';
import { onlineGameHeading, type OnlineGameAvailability } from './online-game-heading';

export function ConnectFourGame({ state, mySeat, active, onAction, opponentLabel = '好友', hintColumn = null, availability, actionPending, statusLabel }: {
  state: ConnectFourState; mySeat: Player; active: boolean; opponentLabel?: string; hintColumn?: number | null; availability?: OnlineGameAvailability; actionPending?: boolean; statusLabel?: string | undefined;
  onAction: (action: GameActionCommand['action']) => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const busy = actionPending ?? pending;
  const [hovered, setHovered] = useState<number | null>(null);
  const [focusColumn, setFocusColumn] = useState(0);
  const mine = active && state.phase === 'playing' && state.turn === mySeat;
  const isGold = state.firstPlayer === mySeat;
  const openColumns = Array.from({ length: CONNECT_FOUR_COLS }, (_, col) => col).filter((col) => state.board[col] === null);
  const currentColumn = openColumns.includes(focusColumn) ? focusColumn : openColumns.toSorted((a, b) =>
    Math.abs(a - focusColumn) - Math.abs(b - focusColumn) || a - b)[0];
  const { boardRef, onKeyDownCapture, onPointerDownCapture } = useBoardKeyboardContinuity(
    mine && !busy, currentColumn === undefined ? null : `[data-col="${currentColumn}"]`,
  );
  function moveFocus(event: React.KeyboardEvent<HTMLButtonElement>, col: number) {
    const next = event.key === 'Home' ? openColumns[0] : event.key === 'End' ? openColumns.at(-1)
      : event.key === 'ArrowLeft' ? openColumns.filter((candidate) => candidate < col).at(-1)
        : event.key === 'ArrowRight' ? openColumns.find((candidate) => candidate > col) : undefined;
    if (!['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    if (next === undefined) return;
    setFocusColumn(next);
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-col="${next}"]`)?.focus();
  }
  async function drop(col: number) {
    if (!mine || busy || state.board[col] !== null) return;
    setPending(true);
    try { await onAction({ type: 'drop', col }); } finally { setPending(false); }
  }
  return <section className="game-surface connect-four-surface" aria-label="四子连线对局">
    <div className="surface-title"><div><span>你执 {isGold ? '金色' : '珊瑚色'} · 率先连成四子</span><h2 aria-live="polite">{statusLabel ?? onlineGameHeading(state.phase === 'finished', '本局结束', availability, actionPending, state.turn === mySeat ? '轮到你投放棋子' : `等待${opponentLabel}投放`)}</h2></div><span className="four-turn-badge">{state.moveCount}/42 步</span></div>
    <div ref={boardRef} className="four-columns" role="group" aria-label="选择投放列" onKeyDownCapture={onKeyDownCapture} onPointerDownCapture={onPointerDownCapture}>{Array.from({ length: CONNECT_FOUR_COLS }, (_, col) => <button key={col} type="button" className={hintColumn === col ? 'is-hint' : ''} disabled={!mine || busy || state.board[col] !== null} aria-label={`投放第 ${col + 1} 列${state.board[col] !== null ? '，已满' : ''}${hintColumn === col ? '，建议落点' : ''}`} data-col={col} tabIndex={mine && !busy && col === currentColumn ? 0 : -1} onFocus={() => setFocusColumn(col)} onKeyDown={(event) => moveFocus(event, col)} onClick={() => void drop(col)}>↓ <span>{col + 1}</span></button>)}</div>
    <div className={`four-board ${mine ? 'is-interactive' : ''}`} role="grid" aria-label={`7 列 6 行四子连线棋盘，已投放 ${state.moveCount} 枚棋子`} onPointerLeave={() => setHovered(null)}>{Array.from({ length: CONNECT_FOUR_ROWS * CONNECT_FOUR_COLS }, (_, index) => {
      const cell = state.board[index]; const row = Math.floor(index / 7); const col = index % 7;
      const last = state.lastMove?.row === row && state.lastMove.col === col;
      const win = state.winningLine.some((entry) => entry.row === row && entry.col === col);
      const preview = mine && hovered === col && cell === null && (row === CONNECT_FOUR_ROWS - 1 || state.board[(row + 1) * 7 + col] !== null);
      const suggested = hintColumn === col && cell === null && (row === CONNECT_FOUR_ROWS - 1 || state.board[(row + 1) * 7 + col] !== null);
      return <span key={index} className={`four-hole ${win ? 'is-winning' : ''} ${suggested ? 'is-hint' : ''} ${preview ? `is-preview ${isGold ? 'preview-gold' : 'preview-coral'}` : ''}`} role="gridcell" aria-label={`第 ${row + 1} 行第 ${col + 1} 列，${cell === null ? '空位' : cell === state.firstPlayer ? '金色棋子' : '珊瑚色棋子'}${suggested ? '，建议落点' : ''}`} onPointerEnter={() => setHovered(col)} onClick={() => void drop(col)}><i className={`${cell === null ? '' : cell === state.firstPlayer ? 'gold' : 'coral'} ${last ? 'is-last' : ''}`} /></span>;
    })}</div>
    <p className="board-hint">点击列或棋盘投放；键盘用 Tab 进入列选择，左右方向键切换可用列，Home/End 跳到首/末列，Enter 或空格投放。棋子会落在该列最低的空位；横、竖、斜任意四子相连即获胜，棋盘放满则和棋。</p>
  </section>;
}
