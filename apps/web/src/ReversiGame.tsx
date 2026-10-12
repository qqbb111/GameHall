import { useRef, useState, type KeyboardEvent } from 'react';
import { legalReversiMoves, type Player, type ReversiState } from '@gamehall/game-core';
import type { GameActionCommand } from '@gamehall/protocol';
import './board-games.css';

export function ReversiGame({ state, mySeat, active, onAction, opponentLabel = '好友' }: {
  state: ReversiState; mySeat: Player; active: boolean; opponentLabel?: string;
  onAction: (action: GameActionCommand['action']) => Promise<unknown>;
}) {
  const [focusIndex, setFocusIndex] = useState(19);
  const [pending, setPending] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const mine = active && state.phase === 'playing' && state.turn === mySeat;
  const legal = new Set(legalReversiMoves(state.board, state.turn).map(({ row, col }) => row * 8 + col));
  const flipped = new Set(state.lastFlipped.map(({ row, col }) => row * 8 + col));
  async function place(index: number) {
    if (!mine || pending || !legal.has(index)) return;
    setPending(true);
    try { await onAction({ type: 'placeDisc', row: Math.floor(index / 8), col: index % 8 }); } finally { setPending(false); }
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = Math.floor(index / 8), col = index % 8;
    let next = index;
    if (event.key === 'ArrowUp' && row > 0) next -= 8;
    else if (event.key === 'ArrowDown' && row < 7) next += 8;
    else if (event.key === 'ArrowLeft' && col > 0) next--;
    else if (event.key === 'ArrowRight' && col < 7) next++;
    else return;
    event.preventDefault(); setFocusIndex(next); buttons.current[next]?.focus();
  }
  const myColor = state.blackPlayer === mySeat ? '黑' : '白';
  return <section className="game-surface reversi-surface" aria-label="黑白棋对局">
    <div className="surface-title"><div><span>你执{myColor} · 夹住对方棋子后翻转</span><h2 aria-live="polite">{state.phase === 'finished' ? '本局结束' : mine ? '轮到你落子' : `等待${opponentLabel}落子`}</h2></div><div className="reversi-scores"><span>黑 <b>{state.counts[state.blackPlayer]}</b></span><span>白 <b>{state.counts[state.blackPlayer === 0 ? 1 : 0]}</b></span></div></div>
    {state.lastPass !== null && state.phase === 'playing' && <p className="reversi-pass" role="status">{state.lastPass === mySeat ? `你暂无合法步，已自动跳过；${opponentLabel}继续落子。` : `${opponentLabel}暂无合法步，轮到你继续落子。`}</p>}
    <div className="reversi-board" role="grid" aria-label="8乘8黑白棋棋盘" aria-describedby="reversi-help">{state.board.map((cell, index) => {
      const row = Math.floor(index / 8), col = index % 8;
      const last = state.lastMove?.row === row && state.lastMove.col === col;
      return <button key={index} ref={(element) => { buttons.current[index] = element; }} type="button" role="gridcell" tabIndex={focusIndex === index ? 0 : -1}
        className={`reversi-cell ${mine && legal.has(index) ? 'is-legal' : ''} ${last ? 'is-last' : ''} ${flipped.has(index) ? 'is-flipped' : ''}`}
        aria-label={`第 ${row + 1} 行第 ${col + 1} 列，${cell === null ? '空位' : cell === state.blackPlayer ? '黑棋' : '白棋'}${mine && legal.has(index) ? '，可落子' : ''}`}
        aria-disabled={!mine || !legal.has(index) || pending} onFocus={() => setFocusIndex(index)} onKeyDown={(event) => key(event, index)} onClick={() => void place(index)}>
        {cell !== null ? <i className={cell === state.blackPlayer ? 'black' : 'white'} /> : mine && legal.has(index) ? <i className="legal-hint" /> : null}
      </button>;
    })}</div>
    <p className="board-hint" id="reversi-help">高亮圆点是合法落子点。点击落子，或用方向键移动焦点、Enter/空格落子。横、竖、斜夹住的对方棋子全部翻面；无合法步自动跳过，双方都无步或满盘时棋子多者获胜。</p>
  </section>;
}
