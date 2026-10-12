import { useEffect, useRef, useState } from 'react';
import {
  applyConnectFourAction, applyReversiAction, createConnectFourState, createReversiState, legalReversiMoves,
  type ConnectFourState, type ReversiState,
} from '@gamehall/game-core';
import type { GameActionCommand } from '@gamehall/protocol';
import { ConnectFourGame } from './ConnectFourGame';
import { ReversiGame } from './ReversiGame';
import type { SoloAction, SoloDifficulty, SoloGameId, SoloState } from './solo-ai';
import type { SoloWorkerRequest, SoloWorkerResponse } from './solo-ai.worker';
import './solo-practice.css';

type Starter = 'human' | 'computer';
const names: Record<SoloGameId, string> = { 'connect-four': '四子连线', reversi: '黑白棋' };

function initialState(gameId: SoloGameId, starter: Starter): SoloState {
  return gameId === 'connect-four' ? createConnectFourState(starter === 'human' ? 0 : 1)
    : createReversiState(starter === 'human' ? 0 : 1);
}

function computerAction(state: SoloState, action: SoloAction | undefined): SoloState | null {
  if (state.turn !== 1 || state.phase !== 'playing') return null;
  if (state.kind === 'connect-four') {
    if (action?.type !== 'drop' || !Number.isInteger(action.col) || state.board[action.col] !== null) return null;
    const result = applyConnectFourAction(state, 1, action);
    return result.ok ? result.state : null;
  }
  if (action?.type !== 'placeDisc' || !legalReversiMoves(state.board, 1).some(({ row, col }) => row === action.row && col === action.col)) return null;
  const result = applyReversiAction(state, 1, action);
  return result.ok ? result.state : null;
}

function resultText(state: SoloState): string {
  if (state.result?.type === 'draw') return '平局，来一局新的？';
  if (state.result?.type === 'win') return state.result.winner === 0 ? '你赢了！' : '电脑赢了，再试一次？';
  return state.turn === 0 ? '轮到你' : '电脑正在思考…';
}

export function SoloPracticePage({ gameId, recoveredRoom, onExit }: {
  gameId: SoloGameId; recoveredRoom: boolean; onExit: () => void;
}) {
  const [difficulty, setDifficulty] = useState<SoloDifficulty>('easy');
  const [starter, setStarter] = useState<Starter>('human');
  const [activeDifficulty, setActiveDifficulty] = useState<SoloDifficulty>('easy');
  const [activeStarter, setActiveStarter] = useState<Starter>('human');
  const [state, setState] = useState<SoloState | null>(null);
  const stateRef = useRef<SoloState | null>(null);
  const history = useRef<SoloState[]>([]);
  const [historyLength, setHistoryLength] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [round, setRound] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const requestGeneration = useRef(0);
  const humanMoveAt = useRef(0);
  const playStatus = useRef<HTMLElement | null>(null);

  function cancelComputer() {
    requestGeneration.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setThinking(false);
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
        stateRef.current = next;
        setState(next);
        setThinking(false);
      };
      const animated = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const delay = animated && state.lastMove?.player === 0 ? Math.max(0, 350 - (performance.now() - humanMoveAt.current)) : 0;
      if (delay > 0) responseTimer = window.setTimeout(applyReply, delay);
      else applyReply();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail('电脑暂时无法完成这步，请点“重试这步”');
    };
    const request: SoloWorkerRequest = { requestId: generation, gameId, difficulty: activeDifficulty, stateJson };
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
  }, [state, gameId, activeDifficulty, retry]);

  useEffect(() => {
    if (!round) return;
    playStatus.current?.focus({ preventScroll: true });
    playStatus.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }, [round]);

  function start() {
    cancelComputer();
    const next = initialState(gameId, starter);
    history.current = [];
    setHistoryLength(0);
    stateRef.current = next;
    setActiveDifficulty(difficulty);
    setActiveStarter(starter);
    setState(next);
    setError(null);
    setRound((current) => current + 1);
  }

  function undo() {
    const previous = history.current.pop();
    if (!previous) return;
    cancelComputer();
    stateRef.current = previous;
    setState(previous);
    setHistoryLength(history.current.length);
    setError(null);
    setRound((current) => current + 1);
  }

  async function humanAction(action: GameActionCommand['action']) {
    const current = stateRef.current;
    if (!current || current.phase !== 'playing' || current.turn !== 0 || thinking) return;
    let next: SoloState | null = null;
    if (current.kind === 'connect-four' && action.type === 'drop') {
      const result = applyConnectFourAction(current, 0, action);
      if (result.ok) next = result.state;
    } else if (current.kind === 'reversi' && action.type === 'placeDisc') {
      const result = applyReversiAction(current, 0, action);
      if (result.ok) next = result.state;
    }
    if (!next) return;
    history.current.push(current);
    humanMoveAt.current = performance.now();
    setHistoryLength(history.current.length);
    stateRef.current = next;
    setState(next);
    setError(null);
  }

  function exit() {
    cancelComputer();
    onExit();
  }

  const name = names[gameId];
  const color = state?.kind === 'connect-four'
    ? state.firstPlayer === 0 ? '金色' : '珊瑚色'
    : state?.kind === 'reversi' ? state.blackPlayer === 0 ? '黑色' : '白色' : '';
  const opponentColor = state?.kind === 'connect-four' ? color === '金色' ? '珊瑚色' : '金色' : color === '黑色' ? '白色' : '黑色';
  return <main className="solo-shell">
    <header className="solo-header">
      <div><span className="solo-eyebrow">本地单人练习</span><h1 tabIndex={-1}>与电脑练习 · {name}</h1><p>自己练一局，随时可以悔棋或重开。</p></div>
      {!recoveredRoom && <button type="button" className="solo-back" onClick={exit}>返回大厅</button>}
    </header>
    {recoveredRoom && <div className="solo-recovered" role="status">已恢复你的好友房。<button type="button" onClick={exit}>返回对局</button></div>}
    {!state ? <section className="solo-setup" aria-label="练习设置">
      <h2>开始前选一下</h2>
      <fieldset><legend>难度</legend><label><input type="radio" name="solo-difficulty" checked={difficulty === 'easy'} onChange={() => setDifficulty('easy')} />轻松</label><label><input type="radio" name="solo-difficulty" checked={difficulty === 'thoughtful'} onChange={() => setDifficulty('thoughtful')} />认真</label></fieldset>
      <fieldset><legend>谁先手</legend><label><input type="radio" name="solo-starter" checked={starter === 'human'} onChange={() => setStarter('human')} />我先手</label><label><input type="radio" name="solo-starter" checked={starter === 'computer'} onChange={() => setStarter('computer')} />电脑先手</label></fieldset>
      <p>{gameId === 'connect-four' ? '先手执金色，点击整列投放，先连成四子获胜。' : '先手执黑色，夹住对方棋子才能落子；无合法步会自动跳过。'}</p>
      <button type="button" className="solo-primary" onClick={start}>开始练习</button>
    </section> : <div className="solo-play">
      <div className="solo-toolbar">
        <div><span>你 · {color}</span><span>电脑 · {opponentColor}</span><span>{activeStarter === 'human' ? '你先手' : '电脑先手'} · {activeDifficulty === 'easy' ? '轻松' : '认真'}</span></div>
        <strong ref={playStatus} tabIndex={-1} role="status" aria-live="polite">{error ? '电脑这步遇到问题' : resultText(state)}</strong>
      </div>
      {error && <div className="solo-error" role="alert">{error}<button type="button" onClick={() => { setError(null); setRetry((current) => current + 1); }}>重试这步</button></div>}
      {state.kind === 'connect-four'
        ? <ConnectFourGame key={round} state={state as ConnectFourState} mySeat={0} active={!thinking} opponentLabel="电脑" onAction={humanAction} />
        : <ReversiGame key={round} state={state as ReversiState} mySeat={0} active={!thinking} opponentLabel="电脑" onAction={humanAction} />}
      <div className="solo-actions">
        <button type="button" onClick={undo} disabled={!historyLength} title={!historyLength ? '还没有可以悔的棋' : '撤回上一轮你的落子和电脑应手'}>悔棋</button>
        <button type="button" onClick={start}>重新开始</button>
        <button type="button" onClick={exit}>{recoveredRoom ? '返回对局' : '返回大厅'}</button>
      </div>
      <details className="solo-settings"><summary>新一局设置</summary><p>更改选项后，点击“重新开始”才会生效；当前棋局继续保留。</p>
        <fieldset><legend>难度</legend><label><input type="radio" name="next-difficulty" checked={difficulty === 'easy'} onChange={() => setDifficulty('easy')} />轻松</label><label><input type="radio" name="next-difficulty" checked={difficulty === 'thoughtful'} onChange={() => setDifficulty('thoughtful')} />认真</label></fieldset>
        <fieldset><legend>谁先手</legend><label><input type="radio" name="next-starter" checked={starter === 'human'} onChange={() => setStarter('human')} />我先手</label><label><input type="radio" name="next-starter" checked={starter === 'computer'} onChange={() => setStarter('computer')} />电脑先手</label></fieldset>
      </details>
    </div>}
  </main>;
}
