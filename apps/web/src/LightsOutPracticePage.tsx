import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { clickLightsOut, lightsOutLevels, MAX_LIGHTS_OUT_HISTORY, replayLightsOutHistory, solveLightsOut } from '@gamehall/game-core';
import { LIGHTS_OUT_BEST_PREFIX, mergeLightsOutBests, readLightsOutAttempt, readLightsOutBests, writeLightsOutAttempt, writeLightsOutBests, type LightsOutAttempt, type LightsOutBests } from './lights-out-progress';
import './lights-out-practice.css';

type PendingChange = { kind: 'retry' } | { kind: 'select'; levelId: string };
const levelTitles = ['初点星灯', '对角回声', '交叉微光', '新灯框', '双岸灯路', '断环之夜', '四角回望', '宽阔灯海', '夜桥余晖', '散落星辰', '第二道光', '最后一盏'] as const;

function countLights(state: number): number {
  let count = 0;
  while (state) { state &= state - 1; count++; }
  return count;
}

function positionLabel(index: number, size: number): string {
  return `第 ${Math.floor(index / size) + 1} 行第 ${index % size + 1} 列`;
}

export function LightsOutPracticePage({ recoveredRoom, onExit }: { recoveredRoom: boolean; onExit: () => void }) {
  const [attemptLoad] = useState(readLightsOutAttempt);
  const [bestLoad] = useState(readLightsOutBests);
  const [attempt, setAttempt] = useState<LightsOutAttempt>(attemptLoad.attempt);
  const attemptRef = useRef(attemptLoad.attempt);
  const [bests, setBests] = useState<LightsOutBests>(bestLoad.bests);
  const bestsRef = useRef(bestLoad.bests);
  const [attemptWarning, setAttemptWarning] = useState(attemptLoad.warning);
  const [bestReadWarning, setBestReadWarning] = useState(bestLoad.warning);
  const [bestReadable, setBestReadable] = useState(bestLoad.readable);
  const [bestWriteWarning, setBestWriteWarning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [hintCell, setHintCell] = useState<number | null>(null);
  const [selectedCell, setSelectedCell] = useState(0);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const changeOrigin = useRef<HTMLElement | null>(null);
  const restoreOrigin = useRef(false);
  const focusAfterChange = useRef<'heading' | 'board' | null>(null);
  const retryFocus = useRef<{ origin: HTMLButtonElement; cell: number } | null>(null);
  const level = lightsOutLevels.find((item) => item.id === attempt.levelId)!;
  const levelIndex = lightsOutLevels.indexOf(level);
  const state = useMemo(() => replayLightsOutHistory(level, attempt.history), [level, attempt.history]);
  const solved = state === 0;
  const remaining = countLights(state);
  const best = bests[level.id];
  const allCompleted = lightsOutLevels.every((item) => bests[item.id] !== undefined);

  function commitAttempt(next: LightsOutAttempt) {
    attemptRef.current = next;
    setAttempt(next);
    setAttemptWarning(writeLightsOutAttempt(next));
  }

  useEffect(() => {
    if (!solved) return;
    const known = mergeLightsOutBests(bestsRef.current, { [level.id]: attempt.history });
    const saved = writeLightsOutBests(known);
    bestsRef.current = saved.bests;
    setBests(saved.bests);
    setBestReadable(saved.readable);
    setBestWriteWarning(saved.warning);
    if (!saved.warning) setBestReadWarning(null);
  }, [attempt.history, level, solved]);

  useEffect(() => {
    const refresh = (event?: StorageEvent) => {
      if (event) {
        if (event.key !== null && !event.key.startsWith(LIGHTS_OUT_BEST_PREFIX)) return;
        try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch { /* report unreadable storage below */ }
      }
      const loaded = readLightsOutBests();
      const known = mergeLightsOutBests(bestsRef.current, loaded.bests);
      const saved = writeLightsOutBests(known);
      bestsRef.current = saved.bests;
      setBests(saved.bests);
      setBestReadable(saved.readable);
      setBestReadWarning(loaded.warning);
      setBestWriteWarning(saved.warning);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useLayoutEffect(() => {
    const reveal = () => {
      const track = trackRef.current;
      const current = track?.querySelector<HTMLButtonElement>('button[aria-current="step"]');
      if (!track || !current) return;
      const viewport = track.getBoundingClientRect();
      const button = current.getBoundingClientRect();
      if (!viewport.width || !button.width) return;
      if (button.left < viewport.left + 8) track.scrollLeft += button.left - viewport.left - 8;
      else if (button.right > viewport.right - 8) track.scrollLeft += button.right - viewport.right + 8;
      if (button.top < viewport.top + 8) track.scrollTop += button.top - viewport.top - 8;
      else if (button.bottom > viewport.bottom - 8) track.scrollTop += button.bottom - viewport.bottom + 8;
    };
    reveal();
    window.addEventListener('resize', reveal);
    return () => window.removeEventListener('resize', reveal);
  }, [attempt.levelId]);

  useEffect(() => {
    if (pendingChange) return;
    const target = focusAfterChange.current;
    focusAfterChange.current = null;
    const element = target === 'heading' ? headingRef.current : target === 'board' ? cellsRef.current[0] : null;
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [attempt, pendingChange]);

  useLayoutEffect(() => {
    const request = retryFocus.current;
    if (!request) return;
    retryFocus.current = null;
    if (attemptWarning || bestReadWarning || bestWriteWarning) return;
    if (document.activeElement !== request.origin && document.activeElement !== document.body) return;
    const cell = cellsRef.current[request.cell];
    cell?.focus({ preventScroll: true });
    cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [attemptWarning, bestReadWarning, bestWriteWarning]);

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
      const first = buttons[0], last = buttons[buttons.length - 1];
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

  function flip(index: number) {
    const current = attemptRef.current;
    const currentLevel = lightsOutLevels.find((item) => item.id === current.levelId)!;
    if (replayLightsOutHistory(currentLevel, current.history) === 0) return;
    if (current.history.length >= MAX_LIGHTS_OUT_HISTORY) {
      setFeedback('本次点击已到上限，请撤销或重新开始本关。');
      return;
    }
    clickLightsOut(currentLevel, 0, index); // Validate the requested cell before saving.
    commitAttempt({ ...current, history: [...current.history, index] });
    setHintCell(null);
    setFeedback('');
  }

  function onCellKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const row = Math.floor(index / level.size), col = index % level.size;
    const next = event.key === 'ArrowUp' && row > 0 ? index - level.size
      : event.key === 'ArrowDown' && row + 1 < level.size ? index + level.size
        : event.key === 'ArrowLeft' && col > 0 ? index - 1
          : event.key === 'ArrowRight' && col + 1 < level.size ? index + 1 : null;
    if (next !== null) {
      event.preventDefault();
      setSelectedCell(next);
      cellsRef.current[next]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flip(index);
    } else if (event.key.startsWith('Arrow')) event.preventDefault();
  }

  function undo() {
    const current = attemptRef.current;
    if (!current.history.length) return;
    commitAttempt({ ...current, history: current.history.slice(0, -1) });
    setHintCell(null);
    setFeedback('');
  }

  function hint() {
    const solution = solveLightsOut(level, replayLightsOutHistory(level, attemptRef.current.history));
    if (!solution) { setFeedback('当前灯面无解；可撤销或重新开始本关。'); return; }
    if (!solution.length) return;
    setHintCell(solution[0]!);
    setFeedback(`建议翻动${positionLabel(solution[0]!, level.size)}；从当前灯面至少还需 ${solution.length} 次翻转。提示不会自动点击。`);
  }

  function change(next: PendingChange) {
    setHintCell(null);
    setFeedback('');
    setSelectedCell(0);
    commitAttempt({ levelId: next.kind === 'select' ? next.levelId : level.id, history: [] });
    focusAfterChange.current = next.kind === 'select' ? 'heading' : 'board';
  }

  function requestChange(next: PendingChange) {
    if (next.kind === 'select' && next.levelId === level.id) return;
    const current = attemptRef.current;
    if (!current.history.length || replayLightsOutHistory(level, current.history) === 0) { change(next); return; }
    changeOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreOrigin.current = true;
    setPendingChange(next);
  }

  function retrySave(event: MouseEvent<HTMLButtonElement>) {
    const origin = document.activeElement === event.currentTarget ? event.currentTarget : null;
    const attemptIssue = writeLightsOutAttempt(attemptRef.current);
    setAttemptWarning(attemptIssue);
    const saved = writeLightsOutBests(bestsRef.current);
    retryFocus.current = origin && !attemptIssue && !saved.warning ? { origin, cell: selectedCell } : null;
    bestsRef.current = saved.bests;
    setBests(saved.bests);
    setBestReadable(saved.readable);
    setBestWriteWarning(saved.warning);
    if (!saved.warning) setBestReadWarning(null);
  }

  return <>
    <main ref={shellRef} className="lights-shell">
      <header className="lights-header"><div><span>本地单人解谜 · 无需昵称</span><h1 tabIndex={-1}>连灯解谜 · 十二关挑战</h1><p>每次翻转一盏灯，也会翻动紧邻的上下左右。让整盘灯都熄灭。</p></div><button type="button" onClick={onExit}>{recoveredRoom ? '返回好友房' : '返回大厅'}</button></header>
      {recoveredRoom && <p className="lights-notice" role="status">好友房已恢复，你可以随时返回原对局。</p>}
      {(attemptWarning || bestReadWarning || bestWriteWarning) && <div className="lights-storage" role="status"><span>{[attemptWarning, bestReadWarning, bestWriteWarning].filter(Boolean).join(' ')}</span><button type="button" onClick={retrySave}>重试保存</button></div>}
      <div className="lights-layout">
        <nav className="lights-levels" aria-label="连灯解谜关卡选择"><div><strong>十二关灯路</strong><p>从 3 × 3 走到 5 × 5，找出熄灯顺序。</p></div><div ref={trackRef} className="lights-level-track">{lightsOutLevels.map((item, index) => <button key={item.id} type="button" aria-current={item.id === level.id ? 'step' : undefined} onClick={() => requestChange({ kind: 'select', levelId: item.id })}><small>第 {index + 1} 关 · {item.size} × {item.size}</small><strong>{levelTitles[index]}</strong>{bests[item.id] && <span>已通关</span>}</button>)}</div></nav>
        <section className="lights-main" aria-labelledby="lights-level-title">
          <div className="lights-intro"><span>第 {levelIndex + 1} / 12 关</span><h2 ref={headingRef} id="lights-level-title" tabIndex={-1}>{levelTitles[levelIndex]} · 第 {levelIndex + 1} 关</h2><p>灯亮时有星芒，熄灭时留下细圆点；提示只标下一格，由你亲手翻动。</p></div>
          <div className="lights-stats"><span>亮灯 <strong>{remaining}</strong></span><span>点击 <strong>{attempt.history.length}</strong></span><span>本关最佳 <strong>{best ? `${best.length} 次` : bestReadable ? '尚未通关' : '暂不可读'}</strong></span></div>
          {solved && <p className="lights-result" role="status"><strong>{levelIndex === 11 && allCompleted ? '十二关都已通关！' : '本关灯光已熄灭！'}</strong><span>你点击了 {attempt.history.length} 次。{levelIndex === 11 ? '可以重试挑战，或从第一关再玩。' : '可手动选择下一关，也可以重试。'}</span></p>}
          {feedback && <p className="lights-feedback" role="status">{feedback}</p>}
          <div className="lights-board-wrap"><div className="lights-board" role="grid" style={{ '--lights-size': level.size } as CSSProperties} aria-label={`第 ${levelIndex + 1} 关灯阵，亮灯 ${remaining} 盏，点击 ${attempt.history.length} 次`}>
            {Array.from({ length: level.size }, (_, row) => <div key={row} role="row" className="lights-row">{Array.from({ length: level.size }, (_, col) => {
              const index = row * level.size + col;
              const lit = Boolean(state >>> index & 1);
              return <button key={index} ref={(node) => { cellsRef.current[index] = node; }} role="gridcell" type="button" className={`lights-cell${lit ? ' is-lit' : ''}${hintCell === index ? ' is-hint' : ''}`} tabIndex={selectedCell === index ? 0 : -1} aria-label={`${positionLabel(index, level.size)}，${lit ? '亮灯' : '熄灭'}，点击翻转`} onFocus={() => setSelectedCell(index)} onKeyDown={(event) => onCellKey(event, index)} onClick={() => flip(index)}><span aria-hidden="true">{lit ? '*' : '·'}</span></button>;
            })}</div>)}
          </div></div>
          <p className="lights-key-help">点击灯格，或用方向键选格、Enter / 空格翻转；Tab 可离开棋盘。</p>
          <div className="lights-actions"><button type="button" onClick={undo} disabled={!attempt.history.length}>撤销一步</button><button type="button" onClick={hint} disabled={solved}>提示一步</button><button type="button" onClick={() => requestChange({ kind: 'retry' })}>重新开始</button>{solved && <button className="is-primary" type="button" onClick={() => requestChange({ kind: 'select', levelId: lightsOutLevels[levelIndex + 1]?.id ?? lightsOutLevels[0]!.id })}>{levelIndex === 11 ? '从第一关再玩' : '下一关'}</button>}</div>
        </section>
      </div>
    </main>
    {pendingChange && createPortal(<div className="lights-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingChange(null); }}><div ref={dialogRef} className="lights-confirm" role="alertdialog" aria-modal="true" aria-labelledby="lights-confirm-title" aria-describedby="lights-confirm-description"><h2 id="lights-confirm-title">{pendingChange.kind === 'retry' ? '重新开始本关？' : '切换关卡？'}</h2><p id="lights-confirm-description">本次 {attempt.history.length} 次点击会清空，已通关的最好成绩仍会保留。</p><div><button ref={cancelRef} type="button" onClick={() => setPendingChange(null)}>继续当前尝试</button><button type="button" className="is-primary" onClick={() => { restoreOrigin.current = false; change(pendingChange); setPendingChange(null); }}>清空并继续</button></div></div></div>, document.body)}
  </>;
}
