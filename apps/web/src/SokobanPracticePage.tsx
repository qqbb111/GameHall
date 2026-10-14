import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { hasSokobanCornerTrap, isSokobanSolved, MAX_SOKOBAN_HISTORY, moveSokoban, replaySokobanHistory, sokobanLevels, type SokobanDirection, type SokobanLevel } from '@gamehall/game-core';
import { mergeSokobanBests, readSokobanAttempt, readSokobanBests, SOKOBAN_BEST_PREFIX, writeSokobanAttempt, writeSokobanBests, type SokobanAttempt, type SokobanBests } from './sokoban-progress';
import { oppositeSokobanDirection, traceSokobanVisuals } from './sokoban-visuals';
import './sokoban-practice.css';

type PendingChange = { kind: 'retry' } | { kind: 'select'; levelId: string };

const directions: ReadonlyArray<{ move: SokobanDirection; label: string; arrow: string }> = [
  { move: 'U', label: '向上移动', arrow: '↑' },
  { move: 'L', label: '向左移动', arrow: '←' },
  { move: 'D', label: '向下移动', arrow: '↓' },
  { move: 'R', label: '向右移动', arrow: '→' },
];

function directionFromKey(key: string): SokobanDirection | null {
  if (key === 'ArrowUp' || key.toLowerCase() === 'w') return 'U';
  if (key === 'ArrowRight' || key.toLowerCase() === 'd') return 'R';
  if (key === 'ArrowDown' || key.toLowerCase() === 's') return 'D';
  if (key === 'ArrowLeft' || key.toLowerCase() === 'a') return 'L';
  return null;
}

function cellLabel(level: SokobanLevel, cell: number, player: number, boxes: readonly number[]): string {
  const position = `第 ${Math.floor(cell / level.width) + 1} 行第 ${cell % level.width + 1} 列`;
  if (level.walls.has(cell)) return `${position}，墙`;
  const target = level.goals.has(cell);
  if (player === cell) return `${position}，玩家${target ? '站在目标上' : ''}`;
  if (boxes.includes(cell)) return `${position}，${target ? '已归位的箱子' : '箱子'}`;
  return `${position}，${target ? '目标' : '地面'}`;
}

function pieceStyle(level: SokobanLevel, cell: number): CSSProperties {
  return { '--piece-x': cell % level.width, '--piece-y': Math.floor(cell / level.width) } as CSSProperties;
}

export function SokobanPracticePage({ recoveredRoom, onExit }: { recoveredRoom: boolean; onExit: () => void }) {
  const [attemptLoad] = useState(readSokobanAttempt);
  const [bestLoad] = useState(readSokobanBests);
  const [attempt, setAttempt] = useState<SokobanAttempt>(attemptLoad.attempt);
  const [attemptWarning, setAttemptWarning] = useState(attemptLoad.warning);
  const [bestReadWarning, setBestReadWarning] = useState(bestLoad.warning);
  const [bestWriteWarning, setBestWriteWarning] = useState<string | null>(null);
  const [bests, setBests] = useState<SokobanBests>(bestLoad.bests);
  const [visualRun, setVisualRun] = useState(0);
  const [facing, setFacing] = useState<SokobanDirection>(() => {
    const last = attemptLoad.attempt.history.at(-1);
    return last === 'U' || last === 'R' || last === 'D' || last === 'L' ? last : 'D';
  });
  const bestsRef = useRef(bests);
  const [feedback, setFeedback] = useState('');
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const levelTrackRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const changeOrigin = useRef<HTMLElement | null>(null);
  const restoreOrigin = useRef(false);
  const focusAfterChange = useRef<'board' | 'heading' | null>(null);
  const retryFocus = useRef<HTMLButtonElement | null>(null);
  const level = sokobanLevels.find((entry) => entry.id === attempt.levelId)!;
  const levelIndex = sokobanLevels.indexOf(level);
  const state = useMemo(() => replaySokobanHistory(level, attempt.history), [level, attempt.history]);
  const visuals = useMemo(() => traceSokobanVisuals(level, attempt.history), [level, attempt.history]);
  const solved = isSokobanSolved(level, state);
  const cornerTrap = !solved && hasSokobanCornerTrap(level, state);
  const best = bests[level.id] ? replaySokobanHistory(level, bests[level.id]) : null;
  const allLevelsCompleted = sokobanLevels.every((entry) => bests[entry.id] !== undefined);

  useEffect(() => {
    const board = boardRef.current;
    const wrap = boardWrapRef.current;
    if (!board || !wrap) return;
    let timer = 0;
    const suppressMotion = () => {
      board.classList.add('is-resizing');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => board.classList.remove('is-resizing'), 120);
    };
    const onResize = () => suppressMotion();
    window.addEventListener('resize', onResize);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      let width: number | null = null;
      observer = new ResizeObserver(([entry]) => {
        const nextWidth = entry?.contentRect.width;
        if (nextWidth === undefined) return;
        if (width !== null && Math.abs(nextWidth - width) > 0.5) suppressMotion();
        width = nextWidth;
      });
      observer.observe(wrap);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
      window.clearTimeout(timer);
      board.classList.remove('is-resizing');
    };
  }, []);

  useEffect(() => {
    if (!solved) return;
    const known = mergeSokobanBests(bestsRef.current, { [level.id]: attempt.history });
    const saved = writeSokobanBests(known);
    bestsRef.current = saved.bests;
    setBests(saved.bests);
    setBestWriteWarning(saved.warning);
    if (!saved.warning) setBestReadWarning(null);
  }, [attempt.history, level, solved]);

  useEffect(() => {
    const refresh = (event?: StorageEvent) => {
      if (event && event.key !== null && !event.key.startsWith(SOKOBAN_BEST_PREFIX)) return;
      const loaded = readSokobanBests();
      const known = mergeSokobanBests(bestsRef.current, loaded.bests);
      const saved = writeSokobanBests(known);
      bestsRef.current = saved.bests;
      setBests(saved.bests);
      setBestReadWarning(saved.warning ? loaded.warning : null);
      setBestWriteWarning(saved.warning);
    };
    const onFocus = () => refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('focus', onFocus); };
  }, []);

  function saveAttempt(next: SokobanAttempt) {
    setAttempt(next);
    setAttemptWarning(writeSokobanAttempt(next));
  }

  function retrySave(event: MouseEvent<HTMLButtonElement>) {
    const origin = document.activeElement === event.currentTarget ? event.currentTarget : null;
    const attemptIssue = writeSokobanAttempt(attempt);
    setAttemptWarning(attemptIssue);
    const saved = writeSokobanBests(bestsRef.current);
    retryFocus.current = origin && !attemptIssue && !saved.warning ? origin : null;
    bestsRef.current = saved.bests;
    setBests(saved.bests);
    setBestWriteWarning(saved.warning);
    if (!saved.warning) setBestReadWarning(null);
  }

  useLayoutEffect(() => {
    const origin = retryFocus.current;
    if (!origin) return;
    retryFocus.current = null;
    if (attemptWarning || bestReadWarning || bestWriteWarning) return;
    if (document.activeElement !== origin && document.activeElement !== document.body) return;
    boardRef.current?.focus({ preventScroll: true });
    boardRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [attemptWarning, bestReadWarning, bestWriteWarning]);

  useLayoutEffect(() => {
    const revealCurrent = () => {
      const track = levelTrackRef.current;
      const current = track?.querySelector<HTMLButtonElement>('button[aria-current="step"]');
      if (!track || !current) return;
      const viewport = track.getBoundingClientRect();
      const button = current.getBoundingClientRect();
      if (!viewport.width || !button.width) return;
      const inset = 8;
      if (button.left < viewport.left + inset) track.scrollLeft += button.left - viewport.left - inset;
      else if (button.right > viewport.right - inset) track.scrollLeft += button.right - viewport.right + inset;
      if (button.top < viewport.top + inset) track.scrollTop += button.top - viewport.top - inset;
      else if (button.bottom > viewport.bottom - inset) track.scrollTop += button.bottom - viewport.bottom + inset;
    };
    revealCurrent();
    window.addEventListener('resize', revealCurrent);
    return () => window.removeEventListener('resize', revealCurrent);
  }, [attempt.levelId]);

  useEffect(() => {
    if (pendingChange) return;
    const target = focusAfterChange.current;
    focusAfterChange.current = null;
    if (target === 'heading') headingRef.current?.focus({ preventScroll: true });
    if (target === 'board') boardRef.current?.focus({ preventScroll: true });
  }, [attempt, pendingChange]);

  useEffect(() => {
    if (!pendingChange) return;
    const shell = shellRef.current;
    const hadInert = shell?.hasAttribute('inert') ?? false;
    const oldOverflow = document.body.style.overflow;
    shell?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setPendingChange(null); return; }
      if (event.key !== 'Tab') return;
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (!hadInert) shell?.removeAttribute('inert');
      document.body.style.overflow = oldOverflow;
      if (restoreOrigin.current) changeOrigin.current?.focus({ preventScroll: true });
      restoreOrigin.current = false;
    };
  }, [pendingChange]);

  function move(direction: SokobanDirection) {
    if (attempt.history.length >= MAX_SOKOBAN_HISTORY) {
      setFeedback('步数已到本次尝试上限，请悔棋或重试本关。');
      return;
    }
    const result = moveSokoban(level, state, direction);
    if (!result.ok) {
      if (result.reason === 'BLOCKED') setFeedback('前方走不通，换个方向试试。');
      return;
    }
    saveAttempt({ ...attempt, history: attempt.history + direction });
    setFacing(direction);
    setFeedback('');
  }

  function onMoveKey(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || pendingChange || solved) return;
    const direction = directionFromKey(event.key);
    if (!direction) return;
    event.preventDefault();
    move(direction);
  }

  function undo() {
    if (!attempt.history) return;
    setFacing(oppositeSokobanDirection(attempt.history.at(-1) as SokobanDirection));
    saveAttempt({ ...attempt, history: attempt.history.slice(0, -1) });
    setFeedback('');
  }

  function change(next: PendingChange) {
    setFeedback('');
    setVisualRun((current) => current + 1);
    setFacing('D');
    saveAttempt({ levelId: next.kind === 'select' ? next.levelId : level.id, history: '' });
    focusAfterChange.current = next.kind === 'select' ? 'heading' : 'board';
  }

  function requestChange(next: PendingChange) {
    if (next.kind === 'select' && next.levelId === level.id) return;
    if (!attempt.history || solved) { change(next); return; }
    changeOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreOrigin.current = true;
    setPendingChange(next);
  }

  function confirmChange() {
    if (!pendingChange) return;
    restoreOrigin.current = false;
    change(pendingChange);
    setPendingChange(null);
  }

  const boardStyle = { '--sokoban-columns': level.width } as CSSProperties;
  return <>
    <main ref={shellRef} className="sokoban-shell">
      <header className="sokoban-header">
        <div><span className="sokoban-eyebrow">本地单人解谜 · 无需昵称</span><h1 tabIndex={-1}>推箱子 · 十关挑战</h1><p>绕到箱子后面，把每一只都送回目标。</p></div>
        <button type="button" onClick={onExit}>{recoveredRoom ? '返回好友房' : '返回大厅'}</button>
      </header>
      {recoveredRoom && <p className="sokoban-notice" role="status">好友房已恢复，你可以随时返回原对局。</p>}
      {(attemptWarning || bestReadWarning || bestWriteWarning) && <div className="sokoban-storage-notice" role="status"><span>{[attemptWarning, bestReadWarning, bestWriteWarning].filter(Boolean).join(' ')}</span><button type="button" onClick={retrySave}>重试保存</button></div>}
      <div className="sokoban-layout">
        <nav className="sokoban-levels" aria-label="推箱子关卡选择">
          <div><strong>十关路线</strong><span>从一只箱子到三只箱子，慢慢学会绕行。</span></div>
          <div ref={levelTrackRef} className="sokoban-level-track">
            {sokobanLevels.map((entry, index) => <button key={entry.id} type="button" aria-current={entry.id === level.id ? 'step' : undefined} onClick={() => requestChange({ kind: 'select', levelId: entry.id })}>
              <small>第 {index + 1} 关 · {entry.initial.boxes.length} 箱</small><strong>{entry.title}</strong>{bests[entry.id] && <span>已通关</span>}{entry.id === level.id && solved && <span>本次已完成</span>}
            </button>)}
          </div>
        </nav>
        <section className="sokoban-main" aria-labelledby="sokoban-level-title">
          <div className="sokoban-intro"><span className="sokoban-eyebrow">第 {levelIndex + 1} / {sokobanLevels.length} 关</span><h2 ref={headingRef} id="sokoban-level-title" tabIndex={-1}>{level.title}</h2><p>{level.description}</p></div>
          <div className="sokoban-toolbar"><span>步数 <strong>{state.steps}</strong></span><span>推箱 <strong>{state.pushes}</strong></span><span>到位 <strong>{state.boxes.filter((box) => level.goals.has(box)).length}/{level.goals.size}</strong></span></div>
          {best && <p className="sokoban-best">本关最佳：{best.steps} 步 · {best.pushes} 次推箱</p>}
          {solved && <div className="sokoban-result" role="status"><strong>{levelIndex === sokobanLevels.length - 1 && allLevelsCompleted ? '十关都已通关！' : '本关完成！'}</strong><span>你走了 {state.steps} 步、推动 {state.pushes} 次。{levelIndex === sokobanLevels.length - 1 ? '可以重试挑战，或从第一关再练。' : '可以重试挑战，也可以手动进入下一关。'}</span></div>}
          {cornerTrap && <p className="sokoban-corner" role="status">有箱子卡在非目标墙角。可以悔棋，重新安排推送顺序。</p>}
          {feedback && <p className="sokoban-feedback" role="status">{feedback}</p>}
          <div ref={boardWrapRef} className="sokoban-board-wrap">
            <div ref={boardRef} className="sokoban-board" role="grid" tabIndex={0} aria-label={`${level.title}棋盘，${state.steps}步，${state.pushes}次推箱`} style={boardStyle} onKeyDown={onMoveKey}>
              {level.rows.map((row, y) => <div key={y} className="sokoban-row" role="row">{[...row].map((_, x) => {
                const cell = y * level.width + x;
                const wall = level.walls.has(cell);
                const goal = level.goals.has(cell);
                const box = state.boxes.includes(cell);
                const player = state.player === cell;
                return <span key={cell} className={`sokoban-cell${wall ? ' is-wall' : ''}${goal ? ' is-goal' : ''}${box ? ' has-box' : ''}${player ? ' has-player' : ''}`} role="gridcell" aria-label={cellLabel(level, cell, state.player, state.boxes)} />;
              })}</div>)}
              <div key={`${level.id}:${visualRun}`} className="sokoban-pieces" aria-hidden="true">
                {visuals.boxes.map(({ id, cell }) => <span key={`box-${id}`} className={`sokoban-piece is-box${level.goals.has(cell) ? ' is-on-goal' : ''}`} data-piece-id={`box-${id}`} data-cell={cell} style={pieceStyle(level, cell)}><i className="sokoban-crate" /></span>)}
                <span key="player" className="sokoban-piece is-player" data-piece-id="player" data-cell={visuals.player} data-facing={facing} style={pieceStyle(level, visuals.player)}><i className="sokoban-player" /></span>
              </div>
            </div>
          </div>
          <div className="sokoban-control-row">
            <div className="sokoban-pad" role="group" aria-label="方向控制区" onKeyDown={onMoveKey}>
              {directions.map(({ move: direction, label, arrow }) => <button key={direction} className={`direction-${direction.toLowerCase()}`} type="button" aria-label={label} onClick={() => move(direction)} disabled={solved}>{arrow}</button>)}
            </div>
            <div className="sokoban-actions"><p>聚焦棋盘或方向按钮后，可用方向键 / WASD 移动。箱子只能推，不能拉。</p><div><button type="button" onClick={undo} disabled={!attempt.history}>悔棋</button><button type="button" onClick={() => requestChange({ kind: 'retry' })}>重试本关</button>{solved && <button className="is-primary" type="button" onClick={() => requestChange({ kind: 'select', levelId: sokobanLevels[levelIndex + 1]?.id ?? sokobanLevels[0]!.id })}>{levelIndex === sokobanLevels.length - 1 ? '从第一关再练' : '下一关'}</button>}</div></div>
          </div>
        </section>
      </div>
    </main>
    {pendingChange && createPortal(<div className="sokoban-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingChange(null); }}>
      <div ref={dialogRef} className="sokoban-confirm" role="alertdialog" aria-modal="true" aria-labelledby="sokoban-confirm-title" aria-describedby="sokoban-confirm-description">
        <h2 id="sokoban-confirm-title">{pendingChange.kind === 'retry' ? '重试这一关？' : '切换关卡？'}</h2>
        <p id="sokoban-confirm-description">本次已走的 {state.steps} 步会清空。你可以先悔棋，再决定下一步。</p>
        <div><button ref={cancelRef} type="button" onClick={() => setPendingChange(null)}>继续当前尝试</button><button className="is-primary" type="button" onClick={confirmChange}>清空并继续</button></div>
      </div>
    </div>, document.body)}
  </>;
}
