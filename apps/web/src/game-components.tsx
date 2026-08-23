import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  canPlaceQuoridorWall,
  GOMOKU_SIZE,
  type GomokuState,
  type Player,
  type QuoridorView,
  type TwentyFourView,
  type WallOrientation,
} from '@gamehall/game-core';
import type { GameActionCommand } from '@gamehall/protocol';

type ActionHandler = (action: GameActionCommand['action']) => Promise<unknown>;

function playerName(player: Player): string {
  return player === 0 ? '玩家一' : '玩家二';
}

export function GomokuGame({ state, mySeat, active, onAction }: { state: GomokuState; mySeat: Player; active: boolean; onAction: ActionHandler }) {
  const [focusIndex, setFocusIndex] = useState(7 * GOMOKU_SIZE + 7);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const myTurn = active && state.phase === 'playing' && state.turn === mySeat;
  const myColor = state.blackPlayer === mySeat ? '黑方' : '白方';

  function moveFocus(next: number) {
    const bounded = Math.max(0, Math.min(GOMOKU_SIZE * GOMOKU_SIZE - 1, next));
    setFocusIndex(bounded);
    buttons.current[bounded]?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = Math.floor(index / GOMOKU_SIZE);
    const col = index % GOMOKU_SIZE;
    if (event.key === 'ArrowUp' && row > 0) { event.preventDefault(); moveFocus(index - GOMOKU_SIZE); }
    if (event.key === 'ArrowDown' && row < GOMOKU_SIZE - 1) { event.preventDefault(); moveFocus(index + GOMOKU_SIZE); }
    if (event.key === 'ArrowLeft' && col > 0) { event.preventDefault(); moveFocus(index - 1); }
    if (event.key === 'ArrowRight' && col < GOMOKU_SIZE - 1) { event.preventDefault(); moveFocus(index + 1); }
    if ((event.key === 'Enter' || event.key === ' ') && myTurn && state.board[index] === null) {
      event.preventDefault();
      void onAction({ type: 'place', row, col });
    }
  }

  return (
    <section className="game-surface" aria-label="五子棋对局">
      <div className="surface-title">
        <div><span>你执 {myColor}</span><h2 aria-live="polite">{state.phase === 'finished' ? '本局结束' : state.turn === mySeat ? '轮到你落子' : '等待对手落子'}</h2></div>
        <div className={`turn-stone ${state.turn === state.blackPlayer ? 'black' : 'white'}`} aria-label={state.turn === state.blackPlayer ? '当前黑方回合' : '当前白方回合'} />
      </div>
      <div className="board-scroll" aria-label="可横向滚动查看完整棋盘">
        <div className="gomoku-board" role="grid" aria-label="15乘15五子棋棋盘">
          {state.board.map((cell, index) => {
            const row = Math.floor(index / GOMOKU_SIZE);
            const col = index % GOMOKU_SIZE;
            const isLast = state.lastMove?.row === row && state.lastMove.col === col;
            const isWin = state.winningLine.some((coord) => coord.row === row && coord.col === col);
            const color = cell === null ? '空位' : cell === state.blackPlayer ? '黑子' : '白子';
            return (
              <button
                ref={(element) => { buttons.current[index] = element; }}
                className={`gomoku-cell ${myTurn && cell === null ? 'is-playable' : ''} ${isLast ? 'is-last' : ''} ${isWin ? 'is-winning' : ''}`}
                key={index}
                type="button"
                role="gridcell"
                tabIndex={index === focusIndex ? 0 : -1}
                aria-label={`第 ${row + 1} 行第 ${col + 1} 列，${color}${isLast ? '，最近一步' : ''}${isWin ? '，获胜连线' : ''}`}
                aria-disabled={!myTurn || cell !== null}
                onFocus={() => setFocusIndex(index)}
                onKeyDown={(event) => handleKey(event, index)}
                onClick={() => { if (myTurn && cell === null) void onAction({ type: 'place', row, col }); }}
              >
                {cell !== null && <span className={`stone ${cell === state.blackPlayer ? 'black' : 'white'}`}><i /></span>}
              </button>
            );
          })}
        </div>
      </div>
      <p className="board-hint">方向键移动焦点，Enter 或空格落子。最近一步以金色圆点标记。</p>
    </section>
  );
}

export function QuoridorGame({ state, mySeat, active, onAction }: { state: QuoridorView; mySeat: Player; active: boolean; onAction: ActionHandler }) {
  const [mode, setMode] = useState<'move' | WallOrientation>('move');
  const [cellFocusIndex, setCellFocusIndex] = useState(() => state.pawns[mySeat].row * 9 + state.pawns[mySeat].col);
  const [wallFocusIndex, setWallFocusIndex] = useState(0);
  const cellButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const wallButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const myTurn = active && state.phase === 'playing' && state.turn === mySeat;
  const legalMoveKeys = new Set(state.legalMoves.map((coord) => `${coord.row},${coord.col}`));
  const goal = state.goalRows[mySeat] === 0 ? '上边' : '下边';
  const track = 'minmax(27px, 1fr) minmax(6px, .16fr) minmax(27px, 1fr) minmax(6px, .16fr) minmax(27px, 1fr) minmax(6px, .16fr) minmax(27px, 1fr) minmax(6px, .16fr) minmax(27px, 1fr) minmax(6px, .16fr) minmax(27px, 1fr) minmax(6px, .16fr) minmax(27px, 1fr) minmax(6px, .16fr) minmax(27px, 1fr) minmax(6px, .16fr) minmax(27px, 1fr)';

  const wallCandidates = useMemo(() => {
    const items: Array<{ row: number; col: number; orientation: WallOrientation; legal: boolean }> = [];
    const orientation = mode === 'move' ? 'H' : mode;
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const legal = state.wallsRemaining[mySeat] > 0 && canPlaceQuoridorWall(state, { row, col, orientation }).ok;
        items.push({ row, col, orientation, legal });
      }
    }
    return items;
  }, [mode, mySeat, state]);
  const firstLegalWallIndex = wallCandidates.findIndex((wall) => wall.legal);
  const rovingWallIndex = wallCandidates[wallFocusIndex]?.legal ? wallFocusIndex : firstLegalWallIndex;
  const wallDescription = state.walls.length === 0
    ? '当前尚未放置墙。'
    : `已放置 ${state.walls.length} 面墙：${state.walls.map((wall) => `${wall.orientation === 'H' ? '横墙' : '竖墙'}锚点第 ${wall.row + 1} 行第 ${wall.col + 1} 列`).join('；')}。`;

  function moveCellFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    let next = index;
    if (event.key === 'ArrowUp' && row > 0) next -= 9;
    else if (event.key === 'ArrowDown' && row < 8) next += 9;
    else if (event.key === 'ArrowLeft' && col > 0) next -= 1;
    else if (event.key === 'ArrowRight' && col < 8) next += 1;
    else if ((event.key === 'Enter' || event.key === ' ') && legalMoveKeys.has(`${row},${col}`) && myTurn) {
      event.preventDefault();
      void onAction({ type: 'move', row, col });
      return;
    } else return;
    event.preventDefault();
    setCellFocusIndex(next);
    cellButtons.current[next]?.focus();
  }

  function moveWallFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let rowStep = 0;
    let colStep = 0;
    if (event.key === 'ArrowUp') rowStep = -1;
    else if (event.key === 'ArrowDown') rowStep = 1;
    else if (event.key === 'ArrowLeft') colStep = -1;
    else if (event.key === 'ArrowRight') colStep = 1;
    else if (event.key === 'Home') {
      event.preventDefault();
      if (firstLegalWallIndex >= 0) {
        setWallFocusIndex(firstLegalWallIndex);
        wallButtons.current[firstLegalWallIndex]?.focus();
      }
      return;
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = wallCandidates.findLastIndex((wall) => wall.legal);
      if (last >= 0) {
        setWallFocusIndex(last);
        wallButtons.current[last]?.focus();
      }
      return;
    } else return;
    event.preventDefault();
    let row = Math.floor(index / 8) + rowStep;
    let col = index % 8 + colStep;
    while (row >= 0 && row < 8 && col >= 0 && col < 8) {
      const next = row * 8 + col;
      if (wallCandidates[next]?.legal) {
        setWallFocusIndex(next);
        wallButtons.current[next]?.focus();
        return;
      }
      row += rowStep;
      col += colStep;
    }
  }

  return (
    <section className="game-surface quoridor-surface" aria-label="路墙棋对局">
      <div className="surface-title">
        <div><span>目标：抵达棋盘{goal}</span><h2 aria-live="polite">{state.phase === 'finished' ? '本局结束' : state.turn === mySeat ? '轮到你行动' : '等待对手行动'}</h2></div>
        <div className="wall-counts"><b>你 {state.wallsRemaining[mySeat]}</b><span>墙</span><b>对手 {state.wallsRemaining[mySeat === 0 ? 1 : 0]}</b></div>
      </div>
      <div className="quoridor-tools" role="toolbar" aria-label="行动方式">
        <button type="button" className={mode === 'move' ? 'active' : ''} onClick={() => setMode('move')}>移动棋子</button>
        <button type="button" className={mode === 'H' ? 'active' : ''} disabled={state.wallsRemaining[mySeat] === 0} onClick={() => setMode('H')}>放置横墙</button>
        <button type="button" className={mode === 'V' ? 'active' : ''} disabled={state.wallsRemaining[mySeat] === 0} onClick={() => setMode('V')}>放置竖墙</button>
      </div>
      <div className="quoridor-wrap">
        <p className="sr-only" id="quoridor-wall-state">{wallDescription}</p>
        <div className={`quoridor-board mode-${mode}`} style={{ gridTemplateColumns: track, gridTemplateRows: track }} role="grid" aria-label="9乘9路墙棋棋盘" aria-describedby="quoridor-wall-state">
          {Array.from({ length: 81 }, (_, index) => {
            const row = Math.floor(index / 9);
            const col = index % 9;
            const player = state.pawns.findIndex((pawn) => pawn.row === row && pawn.col === col);
            const legal = mode === 'move' && myTurn && legalMoveKeys.has(`${row},${col}`);
            return (
              <button
                ref={(element) => { cellButtons.current[index] = element; }}
                className={`quoridor-cell ${legal ? 'is-legal' : ''}`}
                style={{ gridColumn: 2 * col + 1, gridRow: 2 * row + 1 }}
                key={`cell-${row}-${col}`}
                type="button"
                role="gridcell"
                tabIndex={mode === 'move' && index === cellFocusIndex ? 0 : -1}
                aria-label={`第 ${row + 1} 行第 ${col + 1} 列${player >= 0 ? `，${player === mySeat ? '你的棋子' : '对手棋子'}` : ''}${legal ? '，可移动' : ''}`}
                aria-disabled={!legal}
                onFocus={() => setCellFocusIndex(index)}
                onKeyDown={(event) => moveCellFocus(event, index)}
                onClick={() => { if (legal) void onAction({ type: 'move', row, col }); }}
              >
                {player >= 0 && <span className={`pawn player-${player} ${player === mySeat ? 'mine' : ''}`}><i>{player === mySeat ? '你' : '友'}</i></span>}
              </button>
            );
          })}
          {state.walls.map((wall, index) => (
            <span
              aria-hidden="true"
              className={`placed-wall ${wall.orientation === 'H' ? 'horizontal' : 'vertical'}`}
              key={`wall-${index}`}
              style={wall.orientation === 'H'
                ? { gridColumn: `${2 * wall.col + 1} / span 3`, gridRow: 2 * wall.row + 2 }
                : { gridColumn: 2 * wall.col + 2, gridRow: `${2 * wall.row + 1} / span 3` }}
            />
          ))}
          {mode !== 'move' && wallCandidates.map((wall, index) => (
            <button
              ref={(element) => { wallButtons.current[index] = element; }}
              className={`wall-slot ${wall.orientation === 'H' ? 'horizontal' : 'vertical'} ${wall.legal ? 'is-legal' : ''}`}
              key={`slot-${wall.orientation}-${wall.row}-${wall.col}`}
              style={{ gridColumn: 2 * wall.col + 2, gridRow: 2 * wall.row + 2 }}
              type="button"
              disabled={!myTurn || !wall.legal}
              tabIndex={myTurn && index === rovingWallIndex ? 0 : -1}
              aria-label={`${wall.orientation === 'H' ? '横墙' : '竖墙'}，锚点第 ${wall.row + 1} 行第 ${wall.col + 1} 列${wall.legal ? '，可放置' : '，不可放置'}`}
              onFocus={() => setWallFocusIndex(index)}
              onKeyDown={(event) => moveWallFocus(event, index)}
              onClick={() => { if (myTurn && wall.legal) void onAction({ type: 'placeWall', row: wall.row, col: wall.col, orientation: wall.orientation }); }}
            />
          ))}
        </div>
      </div>
      <p className="board-hint">每回合移动一步或放一面墙；任何墙都不能堵死双方的全部路径。</p>
    </section>
  );
}

const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;
const rankLabels: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

export function TwentyFourGame({ state, mySeat, active, serverNowMs, onAction }: { state: TwentyFourView; mySeat: Player; active: boolean; serverNowMs: number; onAction: ActionHandler }) {
  const [expression, setExpression] = useState('');
  const remainingMs = Math.max(0, state.deadlineAtMs - serverNowMs);
  const cooldownMs = Math.max(0, state.cooldownUntilMs[mySeat] - serverNowMs);
  const canSubmit = active && state.phase === 'answering' && remainingMs > 0 && cooldownMs <= 0 && expression.trim().length > 0;

  function append(value: string) {
    setExpression((current) => `${current}${value}`.slice(0, 128));
  }

  return (
    <section className="game-surface twenty-four-surface" aria-label="24点速度对决">
      <div className="surface-title score-title">
        <div><span>第 {state.round} 题 · 先得 5 分</span><h2 aria-live="polite">{state.phase === 'answering' ? '抢先算出 24' : state.phase === 'revealing' ? '本题揭晓' : '比赛结束'}</h2></div>
        <div className="score-board" aria-label={`比分，你 ${state.scores[mySeat]} 分，对手 ${state.scores[mySeat === 0 ? 1 : 0]} 分`}><b aria-hidden="true" className={mySeat === 0 ? 'mine' : ''}>{state.scores[0]}</b><span aria-hidden="true">:</span><b aria-hidden="true" className={mySeat === 1 ? 'mine' : ''}>{state.scores[1]}</b></div>
      </div>
      <div className="round-clock" role="timer" aria-label={`本题剩余 ${Math.ceil(remainingMs / 1000)} 秒`}>
        <div><span style={{ width: `${Math.min(100, remainingMs / 300)}%` }} /></div><strong>{(remainingMs / 1000).toFixed(1)}s</strong>
      </div>
      <div className="playing-cards" aria-label="本题四张牌">
        {state.cards.map((card) => (
          <div className={`playing-card ${card.suit === 'H' || card.suit === 'D' ? 'red' : ''}`} key={card.id} aria-label={`${rankLabels[card.rank] ?? card.rank}${suitSymbols[card.suit]}，数值 ${card.rank}`}>
            <span>{rankLabels[card.rank] ?? card.rank}</span><i>{suitSymbols[card.suit]}</i><b>{rankLabels[card.rank] ?? card.rank}</b>
          </div>
        ))}
      </div>
      {state.phase === 'answering' ? (
        <div className="expression-panel">
          <label htmlFor="expression">输入算式</label>
          <div className="expression-row">
            <input id="expression" value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && canSubmit) void onAction({ type: 'submit', expression }); }} placeholder="例如：8/(3-8/3)" autoComplete="off" spellCheck={false} />
            <button type="button" disabled={!canSubmit} onClick={() => void onAction({ type: 'submit', expression })}>提交答案</button>
          </div>
          <div className="math-pad" role="toolbar" aria-label="算式快捷键">
            {['+', '−', '×', '÷', '(', ')'].map((operator) => <button type="button" key={operator} onClick={() => append(operator === '−' ? '-' : operator)}>{operator}</button>)}
            <button type="button" onClick={() => setExpression((current) => current.slice(0, -1))}>退格</button>
            <button type="button" onClick={() => setExpression('')}>清空</button>
          </div>
          <p className={`cooldown-note ${cooldownMs > 0 ? 'visible' : ''}`} aria-live="polite">{cooldownMs > 0 ? `答案不正确，${Math.ceil(cooldownMs / 1000)} 秒后可再次提交` : '允许分数和负数中间结果，四张牌必须各用一次。'}</p>
        </div>
      ) : (
        <div className="solution-card" aria-live="polite">
          <span>{state.roundOutcome?.type === 'correct' ? `${playerName(state.roundOutcome.winner!)} 抢答成功` : '本题无人答出'}</span>
          <strong>{state.solution ?? '正在计算答案'}</strong>
          {state.phase === 'revealing' && <p>下一题即将开始…</p>}
        </div>
      )}
    </section>
  );
}
