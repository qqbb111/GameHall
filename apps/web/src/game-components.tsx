import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  canPlaceQuoridorWall,
  GOMOKU_SIZE,
  type GomokuState,
  type Player,
  type QuoridorView,
  type TwentyFourView,
  type TexasHoldemView,
  type PokerCard,
  type WallOrientation,
} from '@gamehall/game-core';
import type { GameActionCommand, RoomMemberView } from '@gamehall/protocol';

type ActionHandler = (action: GameActionCommand['action']) => Promise<unknown>;
const GOMOKU_STAR_POINTS = new Set(['3,3', '3,11', '7,7', '11,3', '11,11']);
const GOMOKU_GRID_PATH = Array.from({ length: GOMOKU_SIZE }, (_, index) => (
  `M 0 ${index} H ${GOMOKU_SIZE - 1} M ${index} 0 V ${GOMOKU_SIZE - 1}`
)).join(' ');

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
      <div className="board-scroll" aria-label="完整五子棋棋盘">
        <div className="gomoku-board" role="grid" aria-label="15乘15五子棋棋盘" aria-describedby="gomoku-keyboard-help">
          <span className="gomoku-grid-lines" aria-hidden="true">
            <svg viewBox="-0.5 -0.5 15 15" preserveAspectRatio="none" focusable="false">
              <path d={GOMOKU_GRID_PATH} />
              <rect x="0" y="0" width="14" height="14" />
            </svg>
          </span>
          {state.board.map((cell, index) => {
            const row = Math.floor(index / GOMOKU_SIZE);
            const col = index % GOMOKU_SIZE;
            const isLast = state.lastMove?.row === row && state.lastMove.col === col;
            const isWin = state.winningLine.some((coord) => coord.row === row && coord.col === col);
            const isStar = GOMOKU_STAR_POINTS.has(`${row},${col}`);
            const color = cell === null ? '空位' : cell === state.blackPlayer ? '黑子' : '白子';
            return (
              <button
                ref={(element) => { buttons.current[index] = element; }}
                className={`gomoku-cell ${isStar ? 'is-star' : ''} ${myTurn && cell === null ? 'is-playable' : ''} ${isLast ? 'is-last' : ''} ${isWin ? 'is-winning' : ''}`}
                data-row={row}
                data-col={col}
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
                {isStar && <span className="board-star" aria-hidden="true" />}
                {cell !== null && <span className={`stone ${cell === state.blackPlayer ? 'black' : 'white'}`}><i /></span>}
              </button>
            );
          })}
        </div>
      </div>
      <p className="sr-only" id="gomoku-keyboard-help">方向键移动焦点，Enter 或空格落子。最近一步以金色圆点标记。</p>
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
  const track = 'repeat(8, minmax(0, 1fr) minmax(0, .16fr)) minmax(0, 1fr)';

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
        <div className="score-board" key={`${state.scores[0]}-${state.scores[1]}`} aria-label={`比分，你 ${state.scores[mySeat]} 分，对手 ${state.scores[mySeat === 0 ? 1 : 0]} 分`}><b aria-hidden="true" className={mySeat === 0 ? 'mine' : ''}>{state.scores[0]}</b><span aria-hidden="true">:</span><b aria-hidden="true" className={mySeat === 1 ? 'mine' : ''}>{state.scores[1]}</b></div>
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

const pokerRankLabels: Record<number, string> = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J' };
const pokerSuitSymbols: Record<PokerCard['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

function pokerCardLabel(card: PokerCard): string {
  return `${pokerRankLabels[card.rank] ?? card.rank}${pokerSuitSymbols[card.suit]}`;
}

function PokerCardView({ card, hidden = false, placeholder = false, highlighted = false, dealing = false }: { card: PokerCard | null; hidden?: boolean; placeholder?: boolean; highlighted?: boolean; dealing?: boolean }) {
  if (placeholder) return <span className="poker-card is-placeholder" aria-hidden="true" />;
  if (hidden || !card) return <span className="poker-card is-hidden" aria-label="盖牌"><i className="poker-card-back" /></span>;
  const rank = pokerRankLabels[card.rank] ?? card.rank;
  const suit = pokerSuitSymbols[card.suit];
  return <span className={`poker-card ${card.suit === 'H' || card.suit === 'D' ? 'is-red' : ''} ${highlighted ? 'is-highlighted' : ''} ${dealing ? 'is-dealing' : ''}`} aria-label={`${pokerCardLabel(card)}${highlighted ? '，最佳五张牌' : ''}`}>
    <span className="poker-card-corner"><b>{rank}</b><i>{suit}</i></span><strong>{suit}</strong><span className="poker-card-corner is-bottom"><b>{rank}</b><i>{suit}</i></span>
  </span>;
}

const chipValues = [1, 5, 10, 25, 100, 500] as const;

function chipsFor(amount: number): number[] {
  const chips: number[] = [];
  let remaining = amount;
  for (const value of [...chipValues].reverse()) while (remaining >= value) { chips.push(value); remaining -= value; }
  return chips;
}

function Chip({ value, small = false }: { value: number; small?: boolean }) {
  return <span className={`poker-chip chip-${value} ${small ? 'is-small' : ''}`} aria-hidden="true"><i>{value}</i></span>;
}

function pokerSeatName(seat: number, mySeat: number, members: RoomMemberView[]): string {
  if (seat === mySeat) return '你';
  return members.find((member) => member.seat === seat)?.nickname ?? `玩家 ${seat + 1}`;
}

const POKER_SOUND_PREFERENCE = 'gamehall:poker-sound-enabled';
type PokerPresentationStage = 'stable' | 'dealing' | 'runout' | 'showdown' | 'payout';
type PokerSound = 'deal' | 'chip' | 'all-in' | 'payout';
let pokerAudioContext: AudioContext | null = null;

function pokerSoundPreference(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(POKER_SOUND_PREFERENCE) !== 'off';
}

function playPokerSound(sound: PokerSound, enabled: boolean): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    pokerAudioContext ??= new AudioContextConstructor();
    const context = pokerAudioContext;
    if (context.state === 'suspended') void context.resume();
    const now = context.currentTime;
    const settings: Record<PokerSound, { start: number; end: number; duration: number; volume: number; type: OscillatorType }> = {
      deal: { start: 520, end: 260, duration: .14, volume: .018, type: 'triangle' },
      chip: { start: 720, end: 420, duration: .11, volume: .022, type: 'square' },
      'all-in': { start: 150, end: 82, duration: .34, volume: .028, type: 'sine' },
      payout: { start: 440, end: 880, duration: .28, volume: .022, type: 'sine' },
    };
    const setting = settings[sound];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = setting.type;
    oscillator.frequency.setValueAtTime(setting.start, now);
    oscillator.frequency.exponentialRampToValueAtTime(setting.end, now + setting.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(setting.volume, now + .012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + setting.duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + setting.duration + .02);
  } catch {
    // Audio is an enhancement only. Browser policy must not affect play.
  }
}

function pokerStreetForCount(count: number): 'flop' | 'turn' | 'river' | null {
  if (count >= 5) return 'river';
  if (count >= 4) return 'turn';
  if (count >= 3) return 'flop';
  return null;
}

function pokerStreetLabel(street: 'flop' | 'turn' | 'river' | null): string {
  if (street === 'flop') return '翻牌';
  if (street === 'turn') return '转牌';
  if (street === 'river') return '河牌';
  return '发牌';
}

export function TexasHoldemGame({ state, snapshotVersion = 0, mySeat, active, members = [], onAction, onPresentationLockChange }: { state: TexasHoldemView; snapshotVersion?: number; mySeat: number; active: boolean; members?: RoomMemberView[]; onAction: ActionHandler; onPresentationLockChange?: (locked: boolean) => void }) {
  const me = state.players.find((player) => player.seat === mySeat);
  const [selectedWager, setSelectedWager] = useState<{ snapshotVersion: number; chips: number[] }>({ snapshotVersion, chips: [] });
  const [displayedCommunityCount, setDisplayedCommunityCount] = useState(state.communityCards.length);
  const [presentationStage, setPresentationStage] = useState<PokerPresentationStage>('stable');
  const [presentationStreet, setPresentationStreet] = useState(pokerStreetForCount(state.communityCards.length));
  const [dealingIndex, setDealingIndex] = useState(-1);
  const [burning, setBurning] = useState(false);
  const [showdownVisible, setShowdownVisible] = useState(state.phase === 'hand-complete' || state.phase === 'finished');
  const [payoutActive, setPayoutActive] = useState(false);
  const [potPulseKey, setPotPulseKey] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(pokerSoundPreference);
  const previousSnapshotRef = useRef({ version: snapshotVersion, handNumber: state.handNumber, phase: state.phase, communityCount: state.communityCards.length, pot: state.pot });
  const timersRef = useRef<number[]>([]);
  // The ref is only the transition baseline; it is updated by the presentation effect below.
  /* eslint-disable react-hooks/refs */
  const previousSnapshot = previousSnapshotRef.current;
  const selectedChips = selectedWager.snapshotVersion === snapshotVersion ? selectedWager.chips : [];
  const selectedAmount = selectedChips.reduce((sum, value) => sum + value, 0);
  const isNewSnapshot = snapshotVersion !== previousSnapshot.version;
  const sameHandHasNewCards = state.handNumber === previousSnapshot.handNumber && state.communityCards.length > previousSnapshot.communityCount;
  const reachesSettlement = ['hand-complete', 'finished'].includes(state.phase) && !['hand-complete', 'finished'].includes(previousSnapshot.phase);
  const pendingSnapshotPresentation = isNewSnapshot && (sameHandHasNewCards || reachesSettlement);
  const presentationLocked = presentationStage !== 'stable' || pendingSnapshotPresentation;
  /* eslint-enable react-hooks/refs */
  const canAct = Boolean(!presentationLocked && active && me?.seat === state.turn && me.availableActions.some((action) => action !== 'readyNextHand'));
  const wagerMin = me?.minimumWager ?? 0;
  const wagerMax = me?.maximumWager ?? 0;
  const wagerType = me?.availableActions.includes('bet') ? 'bet' : 'raise';
  const minimumAdditional = Math.max(0, wagerMin - (me?.streetCommitted ?? 0));
  const maximumAdditional = Math.max(0, wagerMax - (me?.streetCommitted ?? 0));
  const selectedTarget = (me?.streetCommitted ?? 0) + selectedAmount;
  const wagerValid = selectedAmount >= minimumAdditional && selectedAmount <= maximumAdditional;

  function submitWager() {
    if (!me || !canAct || !me.availableActions.includes(wagerType) || !wagerValid) return;
    void onAction({ type: wagerType, amount: selectedTarget });
  }

  useLayoutEffect(() => {
    onPresentationLockChange?.(presentationLocked);
  }, [onPresentationLockChange, presentationLocked]);

  useEffect(() => {
    const clearTimers = () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
    };
    const schedule = (delay: number, callback: () => void) => {
      const timer = window.setTimeout(callback, delay);
      timersRef.current.push(timer);
    };
    const previous = previousSnapshotRef.current;
    if (snapshotVersion === previous.version) return clearTimers;
    previousSnapshotRef.current = { version: snapshotVersion, handNumber: state.handNumber, phase: state.phase, communityCount: state.communityCards.length, pot: state.pot };
    clearTimers();
    if (state.pot > previous.pot) {
      setPotPulseKey((value) => value + 1);
      playPokerSound('chip', soundEnabled);
    }
    if (state.handNumber !== previous.handNumber) {
      setDisplayedCommunityCount(state.communityCards.length);
      setPresentationStreet(pokerStreetForCount(state.communityCards.length));
      setPresentationStage('stable');
      setShowdownVisible(state.phase === 'hand-complete' || state.phase === 'finished');
      setPayoutActive(false);
      setBurning(false);
      setDealingIndex(-1);
      return clearTimers;
    }
    const addedFrom = previous.communityCount;
    const addedTo = state.communityCards.length;
    const addedCards = addedTo > addedFrom;
    const showdown = state.lastHandResult?.reason === 'showdown' && ['hand-complete', 'finished'].includes(state.phase);
    const runout = showdown && addedCards;
    const settlementArrived = ['hand-complete', 'finished'].includes(state.phase) && !['hand-complete', 'finished'].includes(previous.phase);
    if (!addedCards && !settlementArrived) return clearTimers;

    setShowdownVisible(!showdown);
    setPayoutActive(false);
    setDisplayedCommunityCount(Math.min(addedFrom, addedTo));
    setPresentationStage(addedCards ? (runout ? 'runout' : 'dealing') : showdown ? 'showdown' : 'payout');
    if (runout) playPokerSound('all-in', soundEnabled);
    let cursor = 0;
    let lastRevealAt = 0;
    for (let index = addedFrom; index < addedTo; index += 1) {
      const newStreet = index === 0 || index === 3 || index === 4;
      if (newStreet) {
        schedule(cursor, () => { setBurning(true); setPresentationStreet(pokerStreetForCount(index + 1)); });
        cursor += 210;
        schedule(cursor, () => setBurning(false));
      }
      const revealAt = cursor;
      lastRevealAt = revealAt;
      schedule(revealAt, () => {
        setDisplayedCommunityCount(index + 1);
        setDealingIndex(index);
        playPokerSound('deal', soundEnabled);
      });
      cursor += runout ? 620 : 520;
      if (newStreet && index > addedFrom) cursor += runout ? 320 : 180;
    }
    const boardFinishAt = addedCards ? lastRevealAt + (runout ? 820 : 700) : 260;
    if (showdown) {
      schedule(boardFinishAt, () => { setShowdownVisible(true); setPresentationStage('showdown'); });
      schedule(boardFinishAt + 520, () => { setPayoutActive(true); setPresentationStage('payout'); playPokerSound('payout', soundEnabled); });
      schedule(boardFinishAt + 1_000, () => { setPayoutActive(false); setPresentationStage('stable'); setDealingIndex(-1); });
    } else if (settlementArrived) {
      schedule(boardFinishAt + 480, () => { setPayoutActive(true); setPresentationStage('payout'); playPokerSound('payout', soundEnabled); });
      schedule(boardFinishAt + 860, () => { setPayoutActive(false); setPresentationStage('stable'); setDealingIndex(-1); });
    } else {
      schedule(boardFinishAt, () => { setPresentationStage('stable'); setDealingIndex(-1); });
    }
    return clearTimers;
  }, [snapshotVersion, soundEnabled, state.communityCards.length, state.handNumber, state.lastHandResult?.reason, state.phase, state.pot]);

  useEffect(() => () => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
  }, []);

  const settlement = state.lastHandResult;
  const winningCardIds = new Set(!presentationLocked && showdownVisible ? settlement?.hands.flatMap((hand) => hand.value.bestFive.map((card) => card.id)) ?? [] : []);
  const readyCount = state.players.filter((player) => !player.eliminated && player.readyForNextHand).length;
  const liveCount = state.players.filter((player) => !player.eliminated).length;
  const showSettlement = Boolean(settlement && ['hand-complete', 'finished'].includes(state.phase) && !presentationLocked && showdownVisible);
  const inferredRunout = pendingSnapshotPresentation && state.lastHandResult?.reason === 'showdown' && sameHandHasNewCards;
  const stageLabel = presentationLocked
    ? `${presentationStage === 'runout' || inferredRunout ? 'ALL-IN · ' : ''}${presentationStage === 'payout' ? '筹码结算中' : presentationStage === 'showdown' ? '摊牌揭晓' : `${pokerStreetLabel(presentationStreet ?? pokerStreetForCount(Math.max(3, displayedCommunityCount + 1)))}发牌中`}`
    : state.phase === 'finished' ? '整局结束' : state.phase === 'hand-complete' ? '本手结算' : state.turn === mySeat ? '轮到你行动' : '等待好友行动';

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    window.localStorage.setItem(POKER_SOUND_PREFERENCE, next ? 'on' : 'off');
    if (next) playPokerSound('chip', true);
  }

  return (
    <section className={`game-surface texas-holdem-surface ${presentationLocked ? 'is-presenting' : ''} ${payoutActive ? 'is-payout-active' : ''}`} aria-label="德州扑克牌桌">
      <div className="surface-title poker-title">
        <div><span>第 {state.handNumber} 手 · 无限注 · 固定盲注 10 / 20</span><h2 aria-live="polite">{stageLabel}</h2></div>
        <button className="poker-sound-toggle" type="button" aria-pressed={soundEnabled} onClick={toggleSound}>{soundEnabled ? '牌桌音效：开' : '牌桌音效：静音'}</button>
        <div className="poker-pot-summary"><small>底池</small><strong>{state.pot}</strong></div>
      </div>
      {showSettlement && settlement && (
        <section className="poker-settlement" aria-label={`第 ${settlement.handNumber} 手结算`}>
          <div className="poker-settlement-heading">
            <div><span>HAND {String(settlement.handNumber).padStart(2, '0')}</span><h3>{settlement.reason === 'fold' ? `${pokerSeatName(settlement.winners[0]!, mySeat, members)} 收下底池` : `${settlement.winners.map((seat) => pokerSeatName(seat, mySeat, members)).join('、')} 摊牌获胜`}</h3></div>
            <strong>{settlement.payouts.map((payout) => `${pokerSeatName(payout.seat, mySeat, members)} +${payout.amount}`).join(' · ')}</strong>
          </div>
          {settlement.reason === 'fold' ? <p className="poker-fold-result">其他玩家均已弃牌，未弃牌玩家直接获得底池；未摊牌的手牌继续保密。</p> : (
            <div className="poker-showdown-list">
              {settlement.hands.map((hand) => {
                const player = state.players.find((item) => item.seat === hand.seat);
                const winner = settlement.winners.includes(hand.seat);
                return <article className={winner ? 'is-winner' : ''} key={hand.seat}>
                  <div><strong>{pokerSeatName(hand.seat, mySeat, members)}</strong><span>{hand.value.label}</span><small>比较值 {hand.value.tiebreakers.map((rank) => pokerRankLabels[rank] ?? rank).join(' · ')}</small></div>
                  <div className="poker-result-cards">{player?.holeCards?.map((card) => <PokerCardView key={card.id} card={card} highlighted={winningCardIds.has(card.id)} />)}</div>
                </article>;
              })}
            </div>
          )}
          <div className="poker-pot-results">{settlement.pots.map((pot, index) => <span key={`${pot.amount}-${index}`}><small>{index === 0 ? '主池' : `边池 ${index}`}</small><b>{pot.amount}</b><em>→ {pot.winners.map((seat) => pokerSeatName(seat, mySeat, members)).join('、')}</em></span>)}</div>
          {state.phase === 'hand-complete' && <div className="poker-next-hand">
            <span>下一手确认 <b>{readyCount}/{liveCount}</b></span>
            {state.players.filter((player) => !player.eliminated).map((player) => <small className={player.readyForNextHand ? 'is-ready' : ''} key={player.seat}>{pokerSeatName(player.seat, mySeat, members)} · {player.readyForNextHand ? '已确认' : '等待确认'}</small>)}
            {me?.availableActions.includes('readyNextHand') && <button type="button" disabled={!active} onClick={() => void onAction({ type: 'readyNextHand' })}>准备下一手</button>}
            {me?.readyForNextHand && <strong>已确认，等待其他玩家</strong>}
          </div>}
        </section>
      )}
      <div className="poker-community" aria-label={`公共牌，共 ${displayedCommunityCount} 张`}>
        <div className="poker-deck" aria-hidden="true"><span className="poker-deck-card" /><small>牌堆</small></div>
        {burning && <span className="poker-burn-card" aria-hidden="true"><i className="poker-card-back" /></span>}
        {state.communityCards.slice(0, displayedCommunityCount).map((card, index) => <PokerCardView key={card.id} card={card} dealing={dealingIndex === index} highlighted={winningCardIds.has(card.id)} />)}
        {Array.from({ length: 5 - displayedCommunityCount }, (_, index) => <PokerCardView key={`empty-${index}`} card={null} placeholder />)}
      </div>
      {potPulseKey > 0 && <div className="poker-pot-flight" key={potPulseKey} aria-hidden="true"><Chip value={25} small /><Chip value={5} small /><Chip value={1} small /></div>}
      <div className="poker-seats" aria-label="玩家座位">
        {state.players.map((player) => {
          const isMine = player.seat === mySeat;
          const isTurn = player.seat === state.turn;
          const revealHoleCards = isMine || !['hand-complete', 'finished'].includes(state.phase) || (showdownVisible && settlement?.reason === 'showdown');
          return (
            <article className={`poker-seat ${isMine ? 'is-mine' : ''} ${isTurn ? 'is-turn' : ''} ${player.folded ? 'is-folded' : ''} ${player.eliminated ? 'is-eliminated' : ''} ${payoutActive && settlement?.winners.includes(player.seat) ? 'is-payout-target' : ''}`} key={player.seat}>
              <div className="poker-seat-heading"><strong>{pokerSeatName(player.seat, mySeat, members)}</strong><span>{player.eliminated ? '已淘汰' : player.allIn ? 'All-in' : player.folded ? '已弃牌' : `筹码 ${player.stack}`}</span></div>
              <div className="poker-hole-cards" aria-label={isMine ? '你的手牌' : '对手手牌'}>
                {player.holeCards && revealHoleCards ? player.holeCards.map((card) => <PokerCardView key={card.id} card={card} highlighted={winningCardIds.has(card.id)} />) : player.eliminated && !player.holeCards ? <span className="poker-eliminated-mark">OUT</span> : <><PokerCardView card={null} hidden /><PokerCardView card={null} hidden /></>}
              </div>
              <small>投入 {player.totalCommitted}{player.seat === state.dealerSeat ? ' · 庄' : ''}{player.seat === state.smallBlindSeat ? ' · 小盲' : ''}{player.seat === state.bigBlindSeat ? ' · 大盲' : ''}</small>
            </article>
          );
        })}
      </div>
      {canAct && me && (
        <div className="poker-actions" role="toolbar" aria-label="德州扑克操作">
          {me.availableActions.includes('fold') && <button type="button" className="is-muted" onClick={() => void onAction({ type: 'fold' })}>弃牌</button>}
          {me.availableActions.includes('check') && <button type="button" onClick={() => void onAction({ type: 'check' })}>过牌</button>}
          {me.availableActions.includes('call') && <button type="button" onClick={() => void onAction({ type: 'call' })}>跟注 {me.toCall}</button>}
          {me.availableActions.includes('allIn') && <button type="button" className="is-danger" onClick={() => void onAction({ type: 'allIn' })}>All-in</button>}
          {(me.availableActions.includes('bet') || me.availableActions.includes('raise')) && (
            <div className="poker-wager-control">
              <div className="poker-wager-summary" aria-live="polite"><span>本次投入 <b>{selectedAmount}</b></span><span>本轮下注至 <b>{selectedTarget}</b></span></div>
              <div className="poker-chip-tray" aria-label="选择筹码">
                {chipValues.map((value) => <button type="button" key={value} aria-label={`添加 ${value} 筹码`} disabled={selectedAmount + value > maximumAdditional} onClick={() => setSelectedWager({ snapshotVersion, chips: [...selectedChips, value] })}><Chip value={value} /></button>)}
              </div>
              <div className="poker-selected-stack" aria-label={`已选择 ${selectedAmount} 筹码`}>{selectedChips.slice(-9).map((value, index) => <Chip key={`${value}-${index}`} value={value} small />)}</div>
              <div className="poker-wager-buttons">
                <button type="button" className="is-secondary" disabled={selectedChips.length === 0} onClick={() => setSelectedWager({ snapshotVersion, chips: selectedChips.slice(0, -1) })}>撤回一枚</button>
                <button type="button" className="is-secondary" disabled={selectedChips.length === 0} onClick={() => setSelectedWager({ snapshotVersion, chips: [] })}>清空</button>
                <button type="button" className="is-secondary" onClick={() => setSelectedWager({ snapshotVersion, chips: chipsFor(minimumAdditional) })}>最小{wagerType === 'bet' ? '下注' : '加注'}</button>
                <button type="button" disabled={!wagerValid} onClick={submitWager}>{wagerType === 'bet' ? '推入下注' : '推入加注'} {selectedTarget}</button>
              </div>
              {!wagerValid && <small className="poker-wager-hint">至少再投入 {minimumAdditional}，最多 {maximumAdditional}</small>}
            </div>
          )}
        </div>
      )}
      <p className="poker-help">点击筹码表示本次追加投入；系统会换算成本轮目标总额。平局与边池均由服务端结算。</p>
    </section>
  );
}
