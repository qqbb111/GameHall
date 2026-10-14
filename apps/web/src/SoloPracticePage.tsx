import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  applyConnectFourAction, applyDotsAndBoxesAction, applyGomokuAction, applyReversiAction, createConnectFourState, createDotsAndBoxesState, createGomokuState, createReversiState, legalReversiMoves,
  type ConnectFourState, type DotsAndBoxesState, type GomokuState, type ReversiState,
} from '@gamehall/game-core';
import type { GameActionCommand } from '@gamehall/protocol';
import { ConnectFourGame } from './ConnectFourGame';
import { ReversiGame } from './ReversiGame';
import { DotsAndBoxesGame } from './DotsAndBoxesGame';
import { GomokuGame } from './game-components';
import { openDotsEdges, type DotsEdge } from './dots-solo';
import type { SoloAction, SoloDifficulty, SoloGameId, SoloHint, SoloState } from './solo-ai';
import type { SoloWorkerRequest, SoloWorkerResponse } from './solo-ai.worker';
import { canShareSoloProgress, clearSoloDraft, encodeSoloProgress, readSoloDraft, writeSoloDraft,
  readSoloSnapshot, soloProgressKey, GOMOKU_HISTORY_MAX, type SoloProgress, type SoloSnapshot, type SoloStarter } from './solo-progress';
import { readSharedSoloSnapshot, subscribeSharedSoloProgress, writeSharedSoloProgress } from './solo-shared-store';
import './solo-practice.css';

const names: Record<SoloGameId, string> = { 'connect-four': '四子连线', reversi: '黑白棋', 'dots-and-boxes': '点格棋', gomoku: '五子棋' };
type HintState = { kind: 'idle' | 'pending' } | { kind: 'ready'; hint: SoloHint } | { kind: 'error'; message: string };
type FocusHandoff = { origin: HTMLButtonElement; kind: 'save' | 'computer' | 'conflict-save' | 'adopt'; moved: boolean; settled: boolean };

async function bootProgress(gameId: SoloGameId) {
  const shared = await readSharedSoloSnapshot(gameId);
  let draft = readSoloDraft(gameId);
  if (draft?.pendingToken && shared.read.kind !== 'unavailable' && shared.token === draft.pendingToken) {
    draft = { progress: draft.progress, baseToken: shared.token };
    writeSoloDraft(draft);
  }
  const legacy = shared.read.kind === 'unavailable' && !draft ? readSoloSnapshot(gameId) : null;
  if (draft && shared.token === draft.baseToken && shared.read.kind === 'valid'
    && JSON.stringify(draft.progress) === JSON.stringify(shared.read.progress)) {
    clearSoloDraft(gameId);
    return { shared, draft: null, legacy, progress: shared.read.progress, conflict: null };
  }
  return { shared, draft, legacy, progress: draft?.progress ?? (shared.read.kind === 'valid' ? shared.read.progress : legacy?.read.kind === 'valid' ? legacy.read.progress : null),
    conflict: draft && shared.read.kind !== 'unavailable' && (shared.token !== draft.baseToken || shared.read.kind === 'invalid') ? shared : null };
}

function progressSummary(state: SoloState, starter: SoloStarter, difficulty: SoloDifficulty): string {
  const position = state.kind === 'connect-four'
    ? state.lastMove ? ` · 最近第 ${state.lastMove.col + 1} 列` : ''
    : state.kind === 'reversi' ? ` · 黑 ${state.counts[state.blackPlayer]}：白 ${state.counts[state.blackPlayer === 0 ? 1 : 0]}`
      : state.kind === 'gomoku' ? state.lastMove ? ` · 最近第 ${state.lastMove.row + 1} 行第 ${state.lastMove.col + 1} 列` : ''
        : ` · 你 ${state.scores[0]}：电脑 ${state.scores[1]}`;
  return `${state.kind === 'dots-and-boxes' ? state.edgeCount : state.moveCount} 步 · ${state.phase === 'finished' ? '已结束' : '进行中'}${position} · ${starter === 'human' ? '你先手' : '电脑先手'} · ${difficulty === 'easy' ? '轻松' : '认真'}`;
}

function previewColor(state: SoloState, player: 0 | 1): string {
  if (state.kind === 'connect-four') return state.firstPlayer === player ? '金色' : '珊瑚色';
  if (state.kind === 'dots-and-boxes') return player === 0 ? '金色' : '珊瑚色';
  return state.blackPlayer === player ? '黑色' : '白色';
}

function differentPreviewCells(current: SoloState, saved: SoloState): number[] {
  if (current.kind === 'dots-and-boxes' && saved.kind === 'dots-and-boxes') {
    return [...current.horizontal, ...current.vertical, ...current.boxes].flatMap((cell, index) => {
      const other = [...saved.horizontal, ...saved.vertical, ...saved.boxes][index];
      return cell !== other ? [index] : [];
    });
  }
  if (current.kind === 'dots-and-boxes' || saved.kind === 'dots-and-boxes') return [];
  return current.board.flatMap((cell, index) => {
    const other = saved.board[index];
    return cell !== other || (cell !== null && other !== null && previewColor(current, cell) !== previewColor(saved, other)) ? [index] : [];
  });
}

function ConflictBoardPreview({ title, state, starter, difficulty, differences }: {
  title: string; state: SoloState; starter: SoloStarter; difficulty: SoloDifficulty; differences: number[];
}) {
  if (state.kind === 'dots-and-boxes') {
    return <figure className="solo-conflict-preview"><figcaption><strong>{title}</strong><span>{progressSummary(state, starter, difficulty)}</span></figcaption>
      <div className="solo-preview-legend"><span>你 · 金色</span><span>电脑 · 珊瑚色</span><span>高亮表示两盘归属不同</span></div>
      <div className="solo-dots-preview" aria-hidden="true">{Array.from({ length: 49 }, (_, index) => {
        const gridRow = Math.floor(index / 7), gridCol = index % 7;
        if (gridRow % 2 === 0 && gridCol % 2 === 0) return <span key={index} className="dot" />;
        const box = gridRow % 2 === 1 && gridCol % 2 === 1;
        const horizontal = gridRow % 2 === 0;
        const cellIndex = box ? 24 + Math.floor(gridRow / 2) * 3 + Math.floor(gridCol / 2)
          : horizontal ? Math.floor(gridRow / 2) * 3 + Math.floor(gridCol / 2) : 12 + Math.floor(gridRow / 2) * 4 + Math.floor(gridCol / 2);
        const owner = box ? state.boxes[cellIndex - 24] : horizontal ? state.horizontal[cellIndex] : state.vertical[cellIndex - 12];
        return <span key={index} className={`${box ? 'box' : horizontal ? 'horizontal' : 'vertical'} ${owner === 0 ? 'mine' : owner === 1 ? 'theirs' : ''} ${differences.includes(cellIndex) ? 'is-different' : ''}`} />;
      })}</div>
    </figure>;
  }
  const columns = state.kind === 'connect-four' ? 7 : state.kind === 'gomoku' ? 15 : 8;
  return <figure className="solo-conflict-preview">
    <figcaption><strong>{title}</strong><span>{progressSummary(state, starter, difficulty)}</span></figcaption>
    <div className="solo-preview-legend"><span>你 · {previewColor(state, 0)}</span><span>电脑 · {previewColor(state, 1)}</span></div>
    <div className={`solo-preview-board ${state.kind}`} aria-hidden="true">
      {state.board.map((cell, index) => {
        const color = cell === null ? '' : previewColor(state, cell);
        return <span key={index} className={`${cell === null ? 'is-empty' : color === '金色' ? 'is-gold' : color === '珊瑚色' ? 'is-coral' : color === '黑色' ? 'is-black' : 'is-white'} ${differences.includes(index) ? 'is-different' : ''}`} data-cell={`${Math.floor(index / columns) + 1}-${index % columns + 1}`} data-owner={cell === null ? 'empty' : cell === 0 ? 'human' : 'computer'}><i /></span>;
      })}
    </div>
  </figure>;
}

function initialState(gameId: SoloGameId, starter: SoloStarter): SoloState {
  return gameId === 'connect-four' ? createConnectFourState(starter === 'human' ? 0 : 1)
    : gameId === 'reversi' ? createReversiState(starter === 'human' ? 0 : 1)
      : gameId === 'gomoku' ? createGomokuState(starter === 'human' ? 0 : 1) : createDotsAndBoxesState(starter === 'human' ? 0 : 1);
}

function computerAction(state: SoloState, action: SoloAction | undefined): SoloState | null {
  if (state.turn !== 1 || state.phase !== 'playing') return null;
  if (state.kind === 'connect-four') {
    if (action?.type !== 'drop' || !Number.isInteger(action.col) || state.board[action.col] !== null) return null;
    const result = applyConnectFourAction(state, 1, action);
    return result.ok ? result.state : null;
  }
  if (state.kind === 'dots-and-boxes') {
    if (action?.type !== 'drawEdge') return null;
    const result = applyDotsAndBoxesAction(state, 1, action);
    return result.ok ? result.state : null;
  }
  if (state.kind === 'gomoku') {
    if (action?.type !== 'place') return null;
    const result = applyGomokuAction(state, 1, action);
    return result.ok ? result.state : null;
  }
  if (action?.type !== 'placeDisc' || !legalReversiMoves(state.board, 1).some(({ row, col }) => row === action.row && col === action.col)) return null;
  const result = applyReversiAction(state, 1, action);
  return result.ok ? result.state : null;
}

function validHumanHint(state: SoloState, hint: SoloHint | undefined): hint is SoloHint {
  if (state.phase !== 'playing' || state.turn !== 0 || !hint || typeof hint.reason !== 'string' || hint.reason.length < 1 || hint.reason.length > 120) return false;
  const action = hint.action;
  if (state.kind === 'connect-four') {
    if (action?.type !== 'drop' || !Number.isInteger(action.col) || action.col < 0 || action.col >= 7 || state.board[action.col] !== null) return false;
    return applyConnectFourAction(state, 0, action).ok;
  }
  if (state.kind === 'dots-and-boxes') {
    return action?.type === 'drawEdge' && openDotsEdges(state).some((edge) => edge.orientation === action.orientation && edge.row === action.row && edge.col === action.col);
  }
  if (state.kind === 'gomoku') return action?.type === 'place' && applyGomokuAction(state, 0, action).ok;
  if (action?.type !== 'placeDisc' || !Number.isInteger(action.row) || !Number.isInteger(action.col)) return false;
  if (!legalReversiMoves(state.board, 0).some(({ row, col }) => row === action.row && col === action.col)) return false;
  return applyReversiAction(state, 0, action).ok;
}

function resultText(state: SoloState): string {
  if (state.result?.type === 'draw') return '平局，来一局新的？';
  if (state.result?.type === 'win') return state.result.winner === 0 ? '你赢了！' : '电脑赢了，再试一次？';
  if (state.kind === 'dots-and-boxes' && state.lastBoxes.length) return state.turn === 0
    ? `你获得 ${state.lastBoxes.length} 分，还能继续画边` : `电脑获得 ${state.lastBoxes.length} 分，正在继续画边…`;
  return state.turn === 0 ? '轮到你' : '电脑正在思考…';
}

export function SoloPracticePage({ gameId, recoveredRoom, onExit }: {
  gameId: SoloGameId; recoveredRoom: boolean; onExit: () => void;
}) {
  const [boot, setBoot] = useState<Awaited<ReturnType<typeof bootProgress>> | null>(null);
  const bootReadyRef = useRef(false);
  const [difficulty, setDifficulty] = useState<SoloDifficulty>('easy');
  const [starter, setStarter] = useState<SoloStarter>('human');
  const [activeDifficulty, setActiveDifficulty] = useState<SoloDifficulty>('easy');
  const [activeStarter, setActiveStarter] = useState<SoloStarter>('human');
  const activeDifficultyRef = useRef(activeDifficulty);
  const activeStarterRef = useRef(activeStarter);
  const [state, setState] = useState<SoloState | null>(null);
  const stateRef = useRef<SoloState | null>(null);
  const history = useRef<SoloState[]>([]);
  const trace = useRef<DotsEdge[]>([]);
  const gomokuMoves = useRef<Array<{ row: number; col: number }>>([]);
  const [historyLength, setHistoryLength] = useState(0);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [shareLimited, setShareLimited] = useState(!canShareSoloProgress());
  const [localOnly, setLocalOnly] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [conflict, setConflict] = useState<SoloSnapshot | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const conflictRef = useRef<SoloSnapshot | null>(null);
  const conflictChoiceGeneration = useRef(0);
  const knownTokenRef = useRef<string | null>(null);
  const pendingTokenRef = useRef<string | null>(null);
  const latestProgressRef = useRef<SoloProgress | null>(null);
  const saveSequence = useRef(0);
  const saveEpoch = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const queuedWrites = useRef(0);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [round, setRound] = useState(0);
  const roundFocusMode = useRef<'explicit' | 'adopt'>('explicit');
  const workerRef = useRef<Worker | null>(null);
  const requestGeneration = useRef(0);
  const [hintState, setHintState] = useState<HintState>({ kind: 'idle' });
  const hintWorkerRef = useRef<Worker | null>(null);
  const hintGeneration = useRef(0);
  const hintTimeoutRef = useRef<number | null>(null);
  const hintButtonRef = useRef<HTMLButtonElement | null>(null);
  const adoptButtonRef = useRef<HTMLButtonElement | null>(null);
  const hintRequesterFocused = useRef(false);
  const hintFocusTarget = useRef<'adopt' | 'button' | null>(null);
  const humanMoveAt = useRef(0);
  const playStatus = useRef<HTMLElement | null>(null);
  const retrySaveButton = useRef<HTMLButtonElement | null>(null);
  const conflictSaveButton = useRef<HTMLButtonElement | null>(null);
  const conflictAdoptButton = useRef<HTMLButtonElement | null>(null);
  const focusHandoff = useRef<FocusHandoff | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const shellRef = useRef<HTMLElement | null>(null);
  const restartButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelRestartRef = useRef<HTMLButtonElement | null>(null);
  const restartDialogRef = useRef<HTMLDivElement | null>(null);
  const restartOpenRef = useRef(false);
  const restoreRestartFocus = useRef(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const pending = focusHandoff.current;
      if (pending && event.target instanceof Node && !pending.origin.contains(event.target)) pending.moved = true;
    };
    const onFocus = (event: FocusEvent) => {
      const pending = focusHandoff.current;
      if (pending && event.target !== pending.origin && event.target !== document.body) pending.moved = true;
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('focusin', onFocus, true);
      focusHandoff.current = null;
    };
  }, []);

  function beginHandoff(origin: HTMLButtonElement, kind: FocusHandoff['kind']): FocusHandoff | null {
    const pending = document.activeElement === origin ? { origin, kind, moved: false, settled: false } : null;
    focusHandoff.current = pending;
    return pending;
  }

  function settleHandoff(pending: FocusHandoff | null) {
    if (!pending || focusHandoff.current !== pending) return;
    pending.settled = true;
    setFocusTick((current) => current + 1);
  }

  const finishHandoff = useCallback((pending: FocusHandoff, target: HTMLElement | null) => {
    if (focusHandoff.current !== pending) return;
    focusHandoff.current = null;
    if (pending.moved || restartOpenRef.current || !target
        || (document.activeElement !== pending.origin && document.activeElement !== document.body)) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, []);

  useLayoutEffect(() => {
    const pending = focusHandoff.current;
    if (!pending?.settled) return;
    if (pending.kind === 'adopt') {
      if (!resolvingConflict) {
        const button = conflictAdoptButton.current ?? conflictSaveButton.current;
        finishHandoff(pending, button && !button.disabled ? button : playStatus.current);
      }
      return;
    }
    if (pending.kind === 'computer') { finishHandoff(pending, playStatus.current); return; }
    if (pending.kind === 'save' && conflict) {
      finishHandoff(pending, conflictAdoptButton.current ?? conflictSaveButton.current);
      return;
    }
    const button = pending.kind === 'save' ? retrySaveButton.current : conflictSaveButton.current;
    if (button) { finishHandoff(pending, button); return; }
    finishHandoff(pending, playStatus.current);
  }, [focusTick, shareLimited, localOnly, unsaved, conflict, error, resolvingConflict, finishHandoff]);

  function retrySaving(event: MouseEvent<HTMLButtonElement>) {
    const pending = beginHandoff(event.currentTarget, 'save');
    const current = stateRef.current;
    if (!current) { focusHandoff.current = null; return; }
    void Promise.resolve(persist(current)).then(() => settleHandoff(pending), () => settleHandoff(pending));
  }

  function retryComputer(event: MouseEvent<HTMLButtonElement>) {
    const pending = beginHandoff(event.currentTarget, 'computer');
    setError(null);
    setRetry((current) => current + 1);
    settleHandoff(pending);
  }

  function requestSaveCurrent(event: MouseEvent<HTMLButtonElement>) {
    const pending = beginHandoff(event.currentTarget, 'conflict-save');
    void saveCurrentOverShared().then(() => settleHandoff(pending), () => settleHandoff(pending));
  }

  function requestResumeShared(event: MouseEvent<HTMLButtonElement>) {
    const pending = beginHandoff(event.currentTarget, 'adopt');
    void resumeShared().then((adopted) => {
      if (!adopted) settleHandoff(pending);
    }, () => {
      settleHandoff(pending);
    });
  }

  useEffect(() => {
    let active = true;
    void bootProgress(gameId).then((loaded) => {
      if (!active || bootReadyRef.current) return;
      bootReadyRef.current = true;
      const progress = loaded.progress;
      if (progress) {
        history.current = [...progress.history];
        trace.current = [...(progress.trace ?? [])];
        gomokuMoves.current = [...(progress.gomokuMoves ?? [])];
        stateRef.current = progress.state;
        activeDifficultyRef.current = progress.difficulty;
        activeStarterRef.current = progress.starter;
        setDifficulty(progress.difficulty);
        setStarter(progress.starter);
        setActiveDifficulty(progress.difficulty);
        setActiveStarter(progress.starter);
        setState(progress.state);
        setHistoryLength(progress.history.length);
      }
      knownTokenRef.current = loaded.draft?.baseToken ?? loaded.legacy?.token ?? loaded.shared.token;
      pendingTokenRef.current = loaded.draft?.pendingToken ?? null;
      latestProgressRef.current = loaded.draft?.progress ?? null;
      conflictRef.current = loaded.conflict;
      setConflict(loaded.conflict);
      setLocalOnly(loaded.shared.read.kind === 'unavailable' && !!progress);
      setUnsaved(loaded.shared.read.kind === 'unavailable' && !loaded.draft && loaded.legacy?.read.kind !== 'valid' && !!progress);
      setSaveNotice(loaded.draft ? '已恢复本标签上次练习' : loaded.shared.read.kind === 'valid'
        || loaded.legacy?.read.kind === 'valid' ? '已恢复上次练习' : loaded.shared.read.kind === 'invalid' ? '上次练习没能恢复，可以开始新一局。' : null);
      setBoot(loaded);
    });
    return () => { active = false; };
  }, [gameId]);

  const showConflict = useCallback((snapshot: SoloSnapshot) => {
    conflictRef.current = snapshot;
    setConflict(snapshot);
    setConflictNotice(null);
  }, []);

  const persist = useCallback((current: SoloState) => {
    const progress: SoloProgress = { gameId, state: current, history: [...history.current],
      ...(gameId === 'dots-and-boxes' ? { trace: [...trace.current] } : {}),
      ...(gameId === 'gomoku' ? { gomokuMoves: [...gomokuMoves.current] } : {}),
      difficulty: activeDifficultyRef.current, starter: activeStarterRef.current };
    latestProgressRef.current = progress;
    const sequence = ++saveSequence.current;
    const epoch = saveEpoch.current;
    const draftSaved = writeSoloDraft({ progress, baseToken: knownTokenRef.current, pendingToken: pendingTokenRef.current });
    setUnsaved(!draftSaved);
    if (!canShareSoloProgress()) { setShareLimited(true); return; }
    setShareLimited(false);
    if (conflictRef.current) return;
    queuedWrites.current++;
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        if (epoch !== saveEpoch.current || conflictRef.current) return;
        if (pendingTokenRef.current) {
          const shared = await readSharedSoloSnapshot(gameId);
          if (shared.read.kind === 'unavailable') { setLocalOnly(true); return; }
          if (shared.token === pendingTokenRef.current) { knownTokenRef.current = shared.token; pendingTokenRef.current = null; }
          else if (shared.token === knownTokenRef.current) { pendingTokenRef.current = null; }
          else { showConflict(shared); return; }
        }
        const result = await writeSharedSoloProgress(progress, knownTokenRef.current,
          () => epoch === saveEpoch.current && !conflictRef.current,
          (token) => {
            if (epoch !== saveEpoch.current || conflictRef.current) return;
            pendingTokenRef.current = token;
            if (latestProgressRef.current) setUnsaved(!writeSoloDraft({ progress: latestProgressRef.current, baseToken: knownTokenRef.current, pendingToken: token }));
          });
        if (epoch !== saveEpoch.current) return;
        if (result.kind === 'conflict') { showConflict(result.snapshot); return; }
        if (result.kind === 'unsupported') { setShareLimited(true); return; }
        if (result.kind === 'uncertain') {
          pendingTokenRef.current = result.token;
          if (latestProgressRef.current) setUnsaved(!writeSoloDraft({ progress: latestProgressRef.current, baseToken: knownTokenRef.current, pendingToken: result.token }));
          setLocalOnly(true);
          return;
        }
        if (result.kind !== 'saved') {
          if (sequence !== saveSequence.current) return;
          const currentDraft = readSoloDraft(gameId);
          let latestDraftSaved = false;
          try {
            latestDraftSaved = !!currentDraft && !!latestProgressRef.current
              && encodeSoloProgress(currentDraft.progress) === encodeSoloProgress(latestProgressRef.current);
          } catch { /* Invalid latest progress cannot be treated as a saved draft. */ }
          setUnsaved(!latestDraftSaved);
          setLocalOnly(latestDraftSaved);
          return;
        }
        knownTokenRef.current = result.token;
        pendingTokenRef.current = null;
        if (sequence === saveSequence.current) {
          clearSoloDraft(gameId);
          setUnsaved(false);
        } else if (latestProgressRef.current) {
          setUnsaved(!writeSoloDraft({ progress: latestProgressRef.current, baseToken: result.token }));
        }
        setLocalOnly(false);
        const latest = await readSharedSoloSnapshot(gameId);
        if (epoch !== saveEpoch.current || knownTokenRef.current !== result.token) return;
        if (latest.read.kind !== 'unavailable' && (latest.token !== result.token || latest.read.kind === 'invalid')) showConflict(latest);
      } finally { queuedWrites.current--; }
    });
    return saveQueue.current;
  }, [gameId, showConflict]);

  useEffect(() => {
    if (!boot) return;
    let active = true;
    const saveEpochForCleanup = saveEpoch;
    const checkShared = async (event?: StorageEvent) => {
      if (event && event.key !== null && event.key !== soloProgressKey(gameId)) return;
      if (queuedWrites.current || conflictRef.current) return;
      const tokenBeforeRead = knownTokenRef.current;
      const sequenceBeforeRead = saveSequence.current;
      const epochBeforeRead = saveEpoch.current;
      const latest = await readSharedSoloSnapshot(gameId);
      if (active && tokenBeforeRead === knownTokenRef.current && sequenceBeforeRead === saveSequence.current
          && epochBeforeRead === saveEpoch.current && !queuedWrites.current && latest.read.kind !== 'unavailable') {
        if (pendingTokenRef.current && latest.token === pendingTokenRef.current) {
          knownTokenRef.current = latest.token;
          pendingTokenRef.current = null;
          if (stateRef.current) persist(stateRef.current);
        } else if (latest.token !== knownTokenRef.current || latest.read.kind === 'invalid') showConflict(latest);
      }
    };
    const onStorage = (event: StorageEvent) => { void checkShared(event); };
    const onVisible = () => { if (document.visibilityState === 'visible') void checkShared(); };
    window.addEventListener('storage', onStorage);
    const unsubscribe = subscribeSharedSoloProgress((changedGame) => { if (changedGame === gameId) void checkShared(); });
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    if (boot.draft && !boot.conflict && stateRef.current) persist(stateRef.current);
    return () => {
      active = false;
      saveEpochForCleanup.current++;
      unsubscribe();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [gameId, boot, persist, showConflict]);

  function cancelComputer() {
    requestGeneration.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setThinking(false);
  }

  function cancelHint() {
    hintGeneration.current++;
    hintFocusTarget.current = null;
    if (hintTimeoutRef.current !== null) window.clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = null;
    hintWorkerRef.current?.terminate();
    hintWorkerRef.current = null;
    setHintState({ kind: 'idle' });
  }

  useEffect(() => () => {
    hintGeneration.current++;
    if (hintTimeoutRef.current !== null) window.clearTimeout(hintTimeoutRef.current);
    hintWorkerRef.current?.terminate();
    hintWorkerRef.current = null;
  }, []);

  useEffect(() => {
    if (restartOpenRef.current) { hintFocusTarget.current = null; return; }
    if (hintFocusTarget.current === 'adopt' && hintState.kind === 'ready') {
      adoptButtonRef.current?.focus({ preventScroll: true });
      hintFocusTarget.current = null;
    } else if (hintFocusTarget.current === 'button' && hintState.kind === 'idle') {
      hintButtonRef.current?.focus({ preventScroll: true });
      hintFocusTarget.current = null;
    }
  }, [hintState.kind]);

  function requestHint() {
    const currentState = stateRef.current;
    if (!currentState || currentState.phase !== 'playing' || currentState.turn !== 0) return;
    hintRequesterFocused.current = document.activeElement === hintButtonRef.current;
    cancelHint();
    const generation = hintGeneration.current;
    const stateJson = JSON.stringify(currentState);
    let worker: Worker;
    try { worker = new Worker(new URL('./solo-ai.worker.ts', import.meta.url), { type: 'module' }); }
    catch { setHintState({ kind: 'error', message: '暂时无法给出建议，请重试。' }); return; }
    hintWorkerRef.current = worker;
    setHintState({ kind: 'pending' });
    const stillCurrent = () => hintWorkerRef.current === worker && hintGeneration.current === generation
      && stateRef.current === currentState && JSON.stringify(stateRef.current) === stateJson;
    const finish = () => {
      if (hintTimeoutRef.current !== null) window.clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = null;
      worker.terminate();
      if (hintWorkerRef.current === worker) hintWorkerRef.current = null;
    };
    const fail = () => { if (!stillCurrent()) return; finish(); setHintState({ kind: 'error', message: '这次没算出建议，请重试或直接落子。' }); };
    worker.onmessage = (event: MessageEvent<SoloWorkerResponse>) => {
      if (!stillCurrent() || event.data?.requestId !== generation) return;
      if (event.data.error || !validHumanHint(currentState, event.data.hint)) { fail(); return; }
      if (!restartOpenRef.current && (document.activeElement === hintButtonRef.current || hintRequesterFocused.current && document.activeElement === document.body)) hintFocusTarget.current = 'adopt';
      finish();
      setHintState({ kind: 'ready', hint: event.data.hint });
    };
    worker.onerror = (event) => { event.preventDefault(); fail(); };
    const request: SoloWorkerRequest = { requestId: generation, purpose: 'hint', gameId, difficulty: 'thoughtful', stateJson };
    try {
      worker.postMessage(request);
      hintTimeoutRef.current = window.setTimeout(fail, 7_000);
    } catch { fail(); }
  }

  useEffect(() => {
    if (!state || state.phase !== 'playing' || state.turn !== 1) return;
    const generation = ++requestGeneration.current;
    const stateJson = JSON.stringify(state);
    let responseTimer: number | null = null;
    let timeoutTimer: number | null = null;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./solo-ai.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      queueMicrotask(() => {
        if (requestGeneration.current !== generation || stateRef.current !== state) return;
        setError('电脑暂时无法启动，请点“重试这步”');
        setThinking(false);
      });
      return;
    }
    workerRef.current = worker;
    queueMicrotask(() => {
      if (workerRef.current !== worker || requestGeneration.current !== generation) return;
      setThinking(true);
      setError(null);
    });
    const current = () => workerRef.current === worker && requestGeneration.current === generation
      && stateRef.current === state && JSON.stringify(stateRef.current) === stateJson;
    const stopWaiting = () => {
      if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
      timeoutTimer = null;
    };
    const fail = (message: string) => {
      if (!current()) return;
      stopWaiting();
      setError(message);
      setThinking(false);
      worker.terminate(); workerRef.current = null;
    };
    worker.onmessage = (event: MessageEvent<SoloWorkerResponse>) => {
      if (!current() || event.data.requestId !== generation) return;
      if (event.data.error) {
        fail(event.data.error);
        return;
      }
      stopWaiting();
      const applyReply = () => {
        if (!current()) return;
        const next = computerAction(state, event.data.action);
        if (!next) { fail('电脑这步未能落下，请点“重试这步”'); return; }
        worker.terminate(); workerRef.current = null;
        if (state.kind === 'dots-and-boxes' && event.data.action?.type === 'drawEdge') trace.current.push(event.data.action);
        if (state.kind === 'gomoku' && event.data.action?.type === 'place') gomokuMoves.current.push({ row: event.data.action.row, col: event.data.action.col });
        stateRef.current = next;
        setState(next);
        persist(next);
        setThinking(false);
      };
      const animated = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const delay = !animated ? 0 : state.kind === 'dots-and-boxes'
        ? state.lastEdge?.player === 0 ? Math.max(0, 350 - (performance.now() - humanMoveAt.current)) : 240
        : state.lastMove?.player === 0 ? Math.max(0, 350 - (performance.now() - humanMoveAt.current)) : 0;
      if (delay > 0) responseTimer = window.setTimeout(applyReply, delay);
      else applyReply();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail('电脑暂时无法完成这步，请点“重试这步”');
    };
    const request: SoloWorkerRequest = { requestId: generation, purpose: 'move', gameId, difficulty: activeDifficulty, stateJson };
    try {
      worker.postMessage(request);
      timeoutTimer = window.setTimeout(() => fail('电脑等得太久了，请点“重试这步”'), 7_000);
    } catch { fail('电脑暂时无法开始计算，请点“重试这步”'); }
    return () => {
      stopWaiting();
      if (responseTimer !== null) window.clearTimeout(responseTimer);
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [state, gameId, activeDifficulty, retry, persist]);

  useEffect(() => {
    if (!round) return;
    const mode = roundFocusMode.current;
    roundFocusMode.current = 'explicit';
    if (mode === 'adopt') {
      const pending = focusHandoff.current;
      if (pending?.kind === 'adopt') finishHandoff(pending, playStatus.current);
      return;
    }
    playStatus.current?.focus({ preventScroll: true });
    playStatus.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [round, finishHandoff]);

  function start() {
    focusHandoff.current = null;
    roundFocusMode.current = 'explicit';
    cancelComputer();
    cancelHint();
    const next = initialState(gameId, starter);
    history.current = [];
    trace.current = [];
    gomokuMoves.current = [];
    setHistoryLength(0);
    stateRef.current = next;
    activeDifficultyRef.current = difficulty;
    activeStarterRef.current = starter;
    setActiveDifficulty(difficulty);
    setActiveStarter(starter);
    setState(next);
    persist(next);
    setSaveNotice(null);
    setError(null);
    setRound((current) => current + 1);
  }

  function requestRestart() {
    const current = stateRef.current;
    if (!current || current.phase === 'finished' || (current.kind === 'dots-and-boxes' ? current.edgeCount : current.moveCount) === 0) { start(); return; }
    restartOpenRef.current = true;
    hintFocusTarget.current = null;
    setConfirmRestart(true);
  }

  function closeRestart(restoreFocus = true) {
    restartOpenRef.current = false;
    restoreRestartFocus.current = restoreFocus;
    setConfirmRestart(false);
  }

  useEffect(() => {
    if (!confirmRestart) return;
    const shell = shellRef.current;
    const restartButton = restartButtonRef.current;
    const hadInert = shell?.hasAttribute('inert') ?? false;
    const oldOverflow = document.body.style.overflow;
    shell?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    cancelRestartRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRestart(); return; }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(restartDialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      if (!buttons.length) return;
      const first = buttons[0]!;
      const last = buttons[buttons.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !restartDialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !restartDialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (!hadInert) shell?.removeAttribute('inert');
      document.body.style.overflow = oldOverflow;
      if (restoreRestartFocus.current) restartButton?.focus({ preventScroll: true });
      restoreRestartFocus.current = false;
    };
  }, [confirmRestart]);

  function undo() {
    const previous = history.current.pop();
    if (!previous) return;
    cancelComputer();
    cancelHint();
    if (previous.kind === 'dots-and-boxes') trace.current = trace.current.slice(0, previous.edgeCount);
    if (previous.kind === 'gomoku') gomokuMoves.current = gomokuMoves.current.slice(0, previous.moveCount);
    stateRef.current = previous;
    setState(previous);
    setHistoryLength(history.current.length);
    persist(previous);
    setError(null);
    setRound((current) => current + 1);
  }

  async function humanAction(action: GameActionCommand['action']): Promise<boolean> {
    const current = stateRef.current;
    if (!current || current.phase !== 'playing' || current.turn !== 0 || thinking || restartOpenRef.current) return false;
    let next: SoloState | null = null;
    if (current.kind === 'connect-four' && action.type === 'drop') {
      const result = applyConnectFourAction(current, 0, action);
      if (result.ok) next = result.state;
    } else if (current.kind === 'reversi' && action.type === 'placeDisc') {
      const result = applyReversiAction(current, 0, action);
      if (result.ok) next = result.state;
    } else if (current.kind === 'dots-and-boxes' && action.type === 'drawEdge') {
      const result = applyDotsAndBoxesAction(current, 0, action);
      if (result.ok) next = result.state;
    } else if (current.kind === 'gomoku' && action.type === 'place') {
      const result = applyGomokuAction(current, 0, action);
      if (result.ok) next = result.state;
    }
    if (!next) return false;
    cancelHint();
    history.current.push(current);
    if (current.kind === 'gomoku' && history.current.length > GOMOKU_HISTORY_MAX) history.current.shift();
    if (action.type === 'drawEdge') trace.current.push(action);
    if (current.kind === 'gomoku' && action.type === 'place') gomokuMoves.current.push({ row: action.row, col: action.col });
    humanMoveAt.current = performance.now();
    setHistoryLength(history.current.length);
    stateRef.current = next;
    setState(next);
    persist(next);
    setSaveNotice(null);
    setError(null);
    return true;
  }

  function adoptHint() {
    if (hintState.kind !== 'ready') return;
    void humanAction(hintState.hint.action).then((applied) => { if (applied) playStatus.current?.focus({ preventScroll: true }); });
  }

  async function resumeShared(): Promise<boolean> {
    const observed = conflictRef.current;
    if (resolvingConflict || !observed || observed.read.kind !== 'valid') return false;
    const choice = ++conflictChoiceGeneration.current;
    const sequence = saveSequence.current;
    const epoch = saveEpoch.current;
    setResolvingConflict(true);
    const latest = await readSharedSoloSnapshot(gameId);
    if (choice !== conflictChoiceGeneration.current || epoch !== saveEpoch.current || sequence !== saveSequence.current
        || conflictRef.current !== observed) { setResolvingConflict(false); return false; }
    if (latest.read.kind === 'unavailable') {
      setConflictNotice('共享进度暂不可读取，请稍后重试。');
      setResolvingConflict(false);
      return false;
    }
    if (latest.token !== observed.token || latest.read.kind !== observed.read.kind) {
      showConflict(latest);
      setConflictNotice('另一窗口又更新了，请按新预览选择。');
      setResolvingConflict(false);
      return false;
    }
    if (latest.read.kind !== 'valid') { setResolvingConflict(false); return false; }
    saveEpoch.current++;
    cancelComputer();
    cancelHint();
    const progress = observed.read.progress;
    stateRef.current = progress.state;
    history.current = [...progress.history];
    trace.current = [...(progress.trace ?? [])];
    gomokuMoves.current = [...(progress.gomokuMoves ?? [])];
    setHistoryLength(progress.history.length);
    activeDifficultyRef.current = progress.difficulty;
    activeStarterRef.current = progress.starter;
    setDifficulty(progress.difficulty);
    setStarter(progress.starter);
    setActiveDifficulty(progress.difficulty);
    setActiveStarter(progress.starter);
    knownTokenRef.current = latest.token;
    pendingTokenRef.current = null;
    latestProgressRef.current = null;
    clearSoloDraft(gameId);
    conflictRef.current = null;
    setConflict(null);
    setConflictNotice(null);
    setResolvingConflict(false);
    setUnsaved(false);
    setLocalOnly(false);
    setSaveNotice('已接着另一窗口保存的练习');
    setError(null);
    setState(progress.state);
    roundFocusMode.current = 'adopt';
    setRound((current) => current + 1);
    return true;
  }

  async function saveCurrentOverShared() {
    if (!conflict || resolvingConflict) return;
    setResolvingConflict(true);
    const seenSequence = saveSequence.current;
    const seenEpoch = saveEpoch.current;
    const latest = await readSharedSoloSnapshot(gameId);
    if (seenEpoch !== saveEpoch.current || seenSequence !== saveSequence.current || conflictRef.current !== conflict) {
      setResolvingConflict(false);
      return;
    }
    if (latest.read.kind === 'unavailable') {
      setLocalOnly(true); setResolvingConflict(false); return;
    }
    if (pendingTokenRef.current && latest.token === pendingTokenRef.current) {
      knownTokenRef.current = latest.token;
      pendingTokenRef.current = null;
      conflictRef.current = null;
      setConflict(null);
      setResolvingConflict(false);
      if (stateRef.current) persist(stateRef.current);
      return;
    }
    if (latest.token !== conflict.token || latest.read.kind !== conflict.read.kind) {
      showConflict(latest);
      setResolvingConflict(false);
      return;
    }
    const current = stateRef.current;
    if (!current) { setResolvingConflict(false); return; }
    const progress: SoloProgress = { gameId, state: current, history: [...history.current],
      ...(gameId === 'dots-and-boxes' ? { trace: [...trace.current] } : {}),
      ...(gameId === 'gomoku' ? { gomokuMoves: [...gomokuMoves.current] } : {}),
      difficulty: activeDifficultyRef.current, starter: activeStarterRef.current };
    const sequence = saveSequence.current;
    const epoch = ++saveEpoch.current;
    const result = await writeSharedSoloProgress(progress, latest.token,
      () => epoch === saveEpoch.current && sequence === saveSequence.current,
      (token) => {
        if (epoch !== saveEpoch.current || sequence !== saveSequence.current) return;
        knownTokenRef.current = latest.token;
        pendingTokenRef.current = token;
        writeSoloDraft({ progress, baseToken: latest.token, pendingToken: token });
      });
    if (epoch !== saveEpoch.current) return;
    setResolvingConflict(false);
    if (result.kind === 'conflict') { showConflict(result.snapshot); return; }
    if (result.kind === 'superseded') return;
    if (result.kind !== 'saved') { setLocalOnly(true); return; }
    knownTokenRef.current = result.token;
    pendingTokenRef.current = null;
    const afterWrite = await readSharedSoloSnapshot(gameId);
    if (epoch !== saveEpoch.current) return;
    if (afterWrite.token !== result.token || afterWrite.read.kind === 'invalid') {
      showConflict(afterWrite);
      return;
    }
    conflictRef.current = null;
    setConflict(null);
    if (sequence === saveSequence.current) {
      latestProgressRef.current = null;
      clearSoloDraft(gameId);
      setUnsaved(false);
      setLocalOnly(false);
      setSaveNotice('当前棋局已保存');
    } else if (latestProgressRef.current) {
      if (stateRef.current) persist(stateRef.current);
    }
  }

  function exit() {
    cancelComputer();
    cancelHint();
    onExit();
  }

  const name = names[gameId];
  const color = state?.kind === 'connect-four'
    ? state.firstPlayer === 0 ? '金色' : '珊瑚色'
    : state?.kind === 'reversi' || state?.kind === 'gomoku' ? state.blackPlayer === 0 ? '黑色' : '白色' : state?.kind === 'dots-and-boxes' ? '金色' : '';
  const opponentColor = state?.kind === 'connect-four' ? color === '金色' ? '珊瑚色' : '金色'
    : state?.kind === 'dots-and-boxes' ? '珊瑚色' : color === '黑色' ? '白色' : '黑色';
  const hint = hintState.kind === 'ready' ? hintState.hint : null;
  const hintSpot = hint?.action.type === 'drop' ? `第 ${hint.action.col + 1} 列`
    : hint?.action.type === 'placeDisc' ? `第 ${hint.action.row + 1} 行第 ${hint.action.col + 1} 列`
    : hint?.action.type === 'place' ? `第 ${hint.action.row + 1} 行第 ${hint.action.col + 1} 列`
    : hint?.action.type === 'drawEdge' ? `${hint.action.orientation === 'H' ? '横边' : '竖边'}第 ${hint.action.row + 1} 行第 ${hint.action.col + 1} 列` : '';
  const savedConflictProgress = conflict?.read.kind === 'valid' ? conflict.read.progress : null;
  const differentCells = state && savedConflictProgress ? differentPreviewCells(state, savedConflictProgress.state) : [];
  const previewColumns = gameId === 'connect-four' ? 7 : gameId === 'reversi' ? 8 : gameId === 'gomoku' ? 15 : 4;
  const differenceDescription = gameId === 'dots-and-boxes'
    ? differentCells.map((index) => index < 12 ? `横边第 ${Math.floor(index / 3) + 1} 行第 ${index % 3 + 1} 列`
      : index < 24 ? `竖边第 ${Math.floor((index - 12) / 4) + 1} 行第 ${(index - 12) % 4 + 1} 列`
        : `方格第 ${Math.floor((index - 24) / 3) + 1} 行第 ${(index - 24) % 3 + 1} 列`).join('、')
    : differentCells.map((index) => `第 ${Math.floor(index / previewColumns) + 1} 行第 ${index % previewColumns + 1} 列`).join('、');
  return <><main className="solo-shell" ref={shellRef}>
    <header className="solo-header">
      <div><span className="solo-eyebrow">本地单人练习</span><h1 tabIndex={-1}>与电脑练习 · {name}</h1><p>自己练一局，随时可以悔棋或重开。</p></div>
      {(!recoveredRoom || !boot) && <button type="button" className="solo-back" onClick={exit}>{recoveredRoom ? '返回对局' : '返回大厅'}</button>}
    </header>
    {!boot ? <section className="solo-setup" aria-label="读取练习"><p role="status">正在读取上次练习…</p></section> : <>
    {recoveredRoom && <div className="solo-recovered" role="status">已恢复你的好友房。<button type="button" onClick={exit}>返回对局</button></div>}
    {saveNotice && <p className="solo-save-note" role="status">{saveNotice}</p>}
    {unsaved && <p className="solo-save-note is-warning" role="status">当前浏览器无法保存，刷新后会重新开始。</p>}
    {shareLimited && !unsaved && state && <p className="solo-save-note is-warning" role="status">此浏览器暂不能安全同步多窗口；这盘只保存在当前标签，刷新仍可继续。<button ref={retrySaveButton} type="button" onClick={retrySaving}>重试保存</button></p>}
    {localOnly && !shareLimited && !unsaved && !conflict && <p className="solo-save-note is-warning" role="status">暂时未能同步到其他窗口，这盘仍保存在当前标签。<button ref={retrySaveButton} type="button" onClick={retrySaving}>重试保存</button></p>}
    {conflict && state && <div className="solo-conflict" role="status">
      <div className="solo-conflict-intro"><strong>另一窗口更新了这款练习</strong><p>当前棋盘：{progressSummary(state, activeStarter, activeDifficulty)}</p><p>已保存：{conflict.read.kind === 'valid' ? progressSummary(conflict.read.progress.state, conflict.read.progress.starter, conflict.read.progress.difficulty) : conflict.read.kind === 'empty' ? '记录已清除' : conflict.read.kind === 'invalid' ? '记录损坏，无法预览' : '记录暂不可读取，无法预览'}</p>{conflictNotice && <p className="solo-conflict-notice" role="alert">{conflictNotice}</p>}<small>你可以继续在当前棋盘落子；选择前不会覆盖另一窗口的进度。</small></div>
      {savedConflictProgress && <div className="solo-conflict-compare">
        <p>{differentCells.length === 0 ? '两盘棋子的归属和显示颜色相同，请比较设置和进度。' : gameId === 'dots-and-boxes' ? `两盘有 ${differentCells.length} 条边或方格归属不同；金色边框标出差异。` : `两盘有 ${differentCells.length} 格棋子归属或颜色不同；金色边框标出差异。`}</p>
        {differentCells.length > 0 && <span className="solo-preview-accessible">差异位置：{differenceDescription}。</span>}
        <div className="solo-conflict-previews"><ConflictBoardPreview title="当前棋盘" state={state} starter={activeStarter} difficulty={activeDifficulty} differences={differentCells} /><ConflictBoardPreview title="已保存" state={savedConflictProgress.state} starter={savedConflictProgress.starter} difficulty={savedConflictProgress.difficulty} differences={differentCells} /></div>
      </div>}
      {conflict.read.kind !== 'valid' && <p className="solo-conflict-unavailable">{conflict.read.kind === 'empty' ? '共享记录已清除，没有可预览的棋盘。' : conflict.read.kind === 'invalid' ? '共享记录损坏，不能显示棋盘；请确认当前局面后再保存。' : '暂时无法读取共享记录，不能显示棋盘。'}</p>}
      <div className="solo-conflict-actions">{conflict.read.kind === 'valid' && <button ref={conflictAdoptButton} type="button" disabled={resolvingConflict} onClick={requestResumeShared}>{resolvingConflict ? '正在核对…' : '接着已保存的练习'}</button>}<button ref={conflictSaveButton} type="button" disabled={resolvingConflict || shareLimited} onClick={requestSaveCurrent}>{resolvingConflict ? '正在保存…' : '保存当前棋局'}</button></div>
    </div>}
    {!state ? <section className="solo-setup" aria-label="练习设置">
      <h2>开始前选一下</h2>
      <fieldset><legend>难度</legend><label><input type="radio" name="solo-difficulty" checked={difficulty === 'easy'} onChange={() => setDifficulty('easy')} />轻松</label><label><input type="radio" name="solo-difficulty" checked={difficulty === 'thoughtful'} onChange={() => setDifficulty('thoughtful')} />认真</label></fieldset>
      <fieldset><legend>谁先手</legend><label><input type="radio" name="solo-starter" checked={starter === 'human'} onChange={() => setStarter('human')} />我先手</label><label><input type="radio" name="solo-starter" checked={starter === 'computer'} onChange={() => setStarter('computer')} />电脑先手</label></fieldset>
      <p>{gameId === 'connect-four' ? '先手执金色，点击整列投放，先连成四子获胜。' : gameId === 'reversi' ? '先手执黑色，夹住对方棋子才能落子；无合法步会自动跳过。' : gameId === 'gomoku' ? '先手执黑色，在 15 路棋盘上轮流落子，先连成五子获胜。' : '轮流画空边，封成一格得 1 分并继续行动；24 条边画完按得分结算。'}</p>
      <button type="button" className="solo-primary" onClick={start}>开始练习</button>
    </section> : <div className="solo-play">
      <div className="solo-toolbar">
        <div><span>你 · {color}</span><span>电脑 · {opponentColor}</span><span>{activeStarter === 'human' ? '你先手' : '电脑先手'} · {activeDifficulty === 'easy' ? '轻松' : '认真'}</span></div>
        <strong ref={playStatus} tabIndex={-1} role="status" aria-live="polite">{error ? '电脑这步遇到问题' : resultText(state)}</strong>
      </div>
      {error && <div className="solo-error" role="alert">{error}<button type="button" onClick={retryComputer}>重试这步</button></div>}
      {state.phase === 'playing' && state.turn === 0 && <div className="solo-hint-bar">
        {hintState.kind === 'ready' ? <div className="solo-hint-result" role="status"><p><strong>建议：{hintSpot}</strong> · {hintState.hint.reason}</p><div><button ref={adoptButtonRef} type="button" onClick={adoptHint}>采用这步</button><button type="button" onClick={() => { cancelHint(); hintFocusTarget.current = 'button'; }}>取消提示</button></div></div>
          : <><button ref={hintButtonRef} type="button" onClick={requestHint} disabled={hintState.kind === 'pending'}>{hintState.kind === 'pending' ? '正在寻找落点…' : hintState.kind === 'error' ? '重试提示' : '提示一步'}</button>{hintState.kind === 'error' && <span role="status">{hintState.message}</span>}{hintState.kind === 'idle' && <small>建议仅供参考，你可以自行落子。</small>}</>}
      </div>}
      {state.kind === 'connect-four'
        ? <ConnectFourGame key={round} state={state as ConnectFourState} mySeat={0} active={!thinking} opponentLabel="电脑" hintColumn={hint?.action.type === 'drop' ? hint.action.col : null} onAction={humanAction} />
        : state.kind === 'reversi' ? <ReversiGame key={round} state={state as ReversiState} mySeat={0} active={!thinking} opponentLabel="电脑" hintCell={hint?.action.type === 'placeDisc' ? hint.action : null} onAction={humanAction} />
          : state.kind === 'gomoku' ? <GomokuGame key={round} state={state as GomokuState} mySeat={0} active={!thinking} opponentLabel="电脑" hintCell={hint?.action.type === 'place' ? hint.action : null} onAction={humanAction} />
            : <DotsAndBoxesGame key={round} state={state as DotsAndBoxesState} mySeat={0} active={!thinking} opponentLabel="电脑" hintEdge={hint?.action.type === 'drawEdge' ? hint.action : null} onAction={humanAction} />}
      <div className="solo-actions">
        <button type="button" onClick={undo} disabled={!historyLength} title={!historyLength ? '还没有可以悔的棋' : '撤回上一轮你的落子和电脑应手'}>悔棋</button>
        <button ref={restartButtonRef} type="button" onClick={requestRestart}>重新开始</button>
        <button type="button" onClick={exit}>{recoveredRoom ? '返回对局' : '返回大厅'}</button>
      </div>
      <details className="solo-settings"><summary>新一局设置</summary><p>更改选项后，点击“重新开始”才会生效；当前棋局继续保留。</p>
        <fieldset><legend>难度</legend><label><input type="radio" name="next-difficulty" checked={difficulty === 'easy'} onChange={() => setDifficulty('easy')} />轻松</label><label><input type="radio" name="next-difficulty" checked={difficulty === 'thoughtful'} onChange={() => setDifficulty('thoughtful')} />认真</label></fieldset>
        <fieldset><legend>谁先手</legend><label><input type="radio" name="next-starter" checked={starter === 'human'} onChange={() => setStarter('human')} />我先手</label><label><input type="radio" name="next-starter" checked={starter === 'computer'} onChange={() => setStarter('computer')} />电脑先手</label></fieldset>
      </details>
    </div>}</>}
  </main>{confirmRestart && createPortal(<div className="solo-confirm-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeRestart(); }}>
    <div ref={restartDialogRef} className="solo-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="solo-restart-title" aria-describedby="solo-restart-description">
      <h2 id="solo-restart-title">重新开始这局？</h2>
      <p id="solo-restart-description">这盘练习会清空，新一局会用“{starter === 'human' ? '我先手' : '电脑先手'} · {difficulty === 'easy' ? '轻松' : '认真'}”设置。</p>
      <div><button ref={cancelRestartRef} type="button" onClick={() => closeRestart()}>继续这盘</button><button type="button" className="is-danger" onClick={() => { closeRestart(false); start(); }}>清空并重新开始</button></div>
    </div>
  </div>, document.body)}</>;
}
