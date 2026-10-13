import { useEffect, useMemo, useRef, useState } from 'react';
import { applyConnectFourAction, type ConnectFourState } from '@gamehall/game-core';
import type { GameActionCommand } from '@gamehall/protocol';
import { ConnectFourGame } from './ConnectFourGame';
import { choosePuzzleReply, connectFourPuzzles, immediatePuzzleWins, openPuzzleColumns, puzzleLineDirection, puzzleSolutions, replayConnectFourPuzzle, type ConnectFourPuzzle } from './connect-four-puzzles';
import { freshPuzzleAttempt, markPuzzleCompleted, mergePuzzleCompletions, puzzleAttemptBoard, PUZZLE_COMPLETION_PREFIX, readPuzzleAttempt, readPuzzleCompletions, savePuzzleAttempt, type PuzzleAttempt, type PuzzleCompletion } from './connect-four-puzzle-progress';
import './connect-four-puzzle-page.css';

const kindLabel = { 'win-now': '一手制胜', defend: '堵住胜着', 'win-in-two': '两步制胜' } as const;
const goalLabel = {
  'win-now': '这一手直接连成四子。',
  defend: '对手下一手有即胜落点；这一手要让对手再无一步获胜的列。',
  'win-in-two': '先下一手，让对手无论怎样合法回应，你下一手都能连成四子。',
} as const;

function columnName(col: number): string { return `第 ${col + 1} 列`; }

function completionExplanation(puzzle: ConnectFourPuzzle, attempt: PuzzleAttempt, board: ConnectFourState): string {
  const first = columnName(attempt.moves[0]!);
  if (puzzle.kind === 'win-now') return `${first}让你${puzzleLineDirection(board)}连成四子。`;
  if (puzzle.kind === 'defend') {
    const threats = immediatePuzzleWins(replayConnectFourPuzzle(puzzle), 1).map(columnName).join('、');
    return `${first}挡住对手原本可从${threats}完成的即胜威胁；这步之后，对手没有一步获胜的落点。`;
  }
  return `你先投${first}，对手在${columnName(attempt.moves[1]!)}应对，你再从${columnName(attempt.moves[2]!)}${puzzleLineDirection(board)}连四。第一手已保证对手任何合法回应都会留下你的即胜着。`;
}

function wrongFirstMove(puzzle: ConnectFourPuzzle, state: ConnectFourState, col: number): string {
  const move = applyConnectFourAction(state, 0, { type: 'drop', col });
  if (!move.ok) return `${columnName(col)}已经放满，请换一列。`;
  if (puzzle.kind === 'win-now') return `${columnName(col)}还没有连成四子；这一关要立即取胜。`;
  if (puzzle.kind === 'defend') {
    const threat = immediatePuzzleWins(move.state, 1)[0];
    return threat === undefined ? '这步未解除全部即胜威胁，请重试。' : `这样落下后，对手仍能从${columnName(threat)}立即连四。`;
  }
  const reply = openPuzzleColumns(move.state).find((candidate) => {
    const answered = applyConnectFourAction(move.state, 1, { type: 'drop', col: candidate });
    return answered.ok && (answered.state.result?.type === 'win' && answered.state.result.winner === 1
      || answered.state.phase === 'playing' && immediatePuzzleWins(answered.state, 0).length === 0);
  });
  return reply === undefined ? '这步还无法保证下一手获胜，请换一列。' : `对手可以应在${columnName(reply)}，让你下一手无法保证连四。`;
}

export function ConnectFourPuzzlePage({ recoveredRoom, onExit }: { recoveredRoom: boolean; onExit: () => void }) {
  const [loaded] = useState(readPuzzleAttempt);
  const [completionLoad] = useState(readPuzzleCompletions);
  const [attempt, setAttempt] = useState(loaded.attempt);
  const [completions, setCompletions] = useState(completionLoad.completions);
  const [attemptNotice, setAttemptNotice] = useState(loaded.warning);
  const [completionReadWarning, setCompletionReadWarning] = useState(completionLoad.warning);
  const [completionWriteWarning, setCompletionWriteWarning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const nextButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef(false);
  const pendingCompletionWrites = useRef<Record<string, PuzzleCompletion>>({});
  const puzzle = connectFourPuzzles.find((entry) => entry.id === attempt.id)!;
  const board = useMemo(() => puzzleAttemptBoard(attempt), [attempt]);
  const index = connectFourPuzzles.indexOf(puzzle);
  const isFinalStep = puzzle.kind === 'win-in-two' && attempt.moves.length === 2 && !attempt.completed;
  const hintColumns = isFinalStep ? immediatePuzzleWins(board, 0) : puzzleSolutions(puzzle, board);
  const hintColumn = attempt.hintShown ? hintColumns[0] ?? null : null;
  const completedCount = Object.keys(completions).length;
  const independentCount = Object.values(completions).filter((value) => value === 'independent').length;

  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key?.startsWith(PUZZLE_COMPLETION_PREFIX)) {
        const current = readPuzzleCompletions();
        setCompletions((known) => mergePuzzleCompletions(known, current.completions));
        setCompletionReadWarning(current.warning);
      }
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);

  useEffect(() => {
    if (attempt.completed && focusNext.current) {
      focusNext.current = false;
      nextButton.current?.focus({ preventScroll: true });
    }
  }, [attempt]);

  function updateAttempt(next: PuzzleAttempt) {
    setAttempt(next);
    setAttemptNotice(savePuzzleAttempt(next) ? null : '本关当前步骤暂时无法保存；刷新后可能需要重做。');
  }

  function selectPuzzle(id: string) {
    if (id === attempt.id) return;
    focusNext.current = false;
    setFeedback('');
    updateAttempt(freshPuzzleAttempt(id));
  }

  function retryPuzzle() {
    focusNext.current = false;
    setFeedback('');
    updateAttempt(freshPuzzleAttempt(attempt.id));
  }

  function showHint() {
    setFeedback('');
    updateAttempt({ ...attempt, hintUsed: true, hintShown: !attempt.hintShown });
  }

  function finishPuzzle(next: PuzzleAttempt) {
    const status: PuzzleCompletion = next.hintUsed ? 'reference' : 'independent';
    const best = mergePuzzleCompletions(completions, { [next.id]: status })[next.id]!;
    const writes = mergePuzzleCompletions(pendingCompletionWrites.current, { [next.id]: best });
    const stillPending: Record<string, PuzzleCompletion> = {};
    for (const [id, grade] of Object.entries(writes)) {
      if (!markPuzzleCompleted(id, grade)) stillPending[id] = grade;
    }
    pendingCompletionWrites.current = stillPending;
    setCompletionWriteWarning(Object.keys(stillPending).length ? '通关记录暂时无法保存；本页仍可继续闯关，刷新后部分成绩可能需要重做。' : null);
    const current = readPuzzleCompletions();
    setCompletions((known) => mergePuzzleCompletions(known, current.completions, { [next.id]: status }));
    setCompletionReadWarning(current.warning);
    updateAttempt(next);
    focusNext.current = Boolean(document.activeElement?.closest('.four-columns'));
    setFeedback('');
  }

  async function handleAction(action: GameActionCommand['action']): Promise<void> {
    if (action.type !== 'drop' || attempt.completed || board.phase !== 'playing' || board.turn !== 0) return;
    const col = action.col;
    if (isFinalStep) {
      if (!immediatePuzzleWins(board, 0).includes(col)) {
        setFeedback(`${columnName(col)}还不能连四；对手已应在${columnName(attempt.moves[1]!)}，请找出真正的收官列。`);
        return;
      }
      finishPuzzle({ ...attempt, moves: [...attempt.moves, col], completed: true, hintShown: false });
      return;
    }
    const start = replayConnectFourPuzzle(puzzle);
    if (!puzzleSolutions(puzzle, start).includes(col)) {
      setFeedback(wrongFirstMove(puzzle, start, col));
      return;
    }
    if (puzzle.kind === 'win-in-two') {
      const first = applyConnectFourAction(start, 0, { type: 'drop', col });
      if (!first.ok) throw new Error('validated puzzle move failed');
      const reply = choosePuzzleReply(first.state);
      updateAttempt({ ...attempt, moves: [col, reply.col], hintShown: false });
      setFeedback(`对手已合法应在${columnName(reply.col)}。现在请你亲自完成第二步。`);
      return;
    }
    finishPuzzle({ ...attempt, moves: [col], completed: true, hintShown: false });
  }

  const color = puzzle.firstPlayer === 0 ? '金色' : '珊瑚色';
  const opponentColor = puzzle.firstPlayer === 0 ? '珊瑚色' : '金色';
  const hintText = isFinalStep
    ? `对手刚应在${columnName(attempt.moves[1]!)}；试着从${columnName(hintColumns[0]!)}完成四连。`
    : puzzle.kind === 'defend'
      ? `对手下一手威胁${immediatePuzzleWins(board, 1).map(columnName).join('、')}；先考虑${columnName(hintColumns[0]!)}。`
      : puzzle.kind === 'win-in-two'
        ? `先让对手的每种应手都留下你的一步胜着；可从${columnName(hintColumns[0]!)}开始。`
        : `找出投下就能连四的一列；可试试${columnName(hintColumns[0]!)}。`;

  return <main className="puzzle-shell">
    <header className="puzzle-header">
      <div><span className="puzzle-eyebrow">本地战术练习 · 无需昵称</span><h1 tabIndex={-1}>四子连线 · 残局闯关</h1><p>看清棋形，自己完成关键落子。</p></div>
      <button type="button" onClick={onExit}>{recoveredRoom ? '返回好友房' : '返回大厅'}</button>
    </header>
    {recoveredRoom && <p className="puzzle-notice" role="status">好友房已恢复，你可以随时返回原对局。</p>}
    {attemptNotice && <p className="puzzle-notice is-warning" role="status">{attemptNotice}</p>}
    {completionReadWarning && <p className="puzzle-notice is-warning" role="status">{completionReadWarning}</p>}
    {completionWriteWarning && <p className="puzzle-notice is-warning" role="status">{completionWriteWarning}</p>}
    <div className="puzzle-layout">
      <nav className="puzzle-list" aria-label="残局关卡选择">
        <div className="puzzle-list-summary"><strong>已通关 {completedCount}/{connectFourPuzzles.length}</strong><span>独立完成 {independentCount} 关 · 参考完成 {completedCount - independentCount} 关</span>{completedCount === connectFourPuzzles.length && <span>全部通关，可选任一关重新挑战。</span>}</div>
        {connectFourPuzzles.map((entry, entryIndex) => <button key={entry.id} type="button" aria-current={entry.id === puzzle.id ? 'step' : undefined} onClick={() => selectPuzzle(entry.id)}>
          <span>第 {entryIndex + 1} 关 · {kindLabel[entry.kind]}</span><strong>{entry.title}</strong><small>{completions[entry.id] === 'independent' ? '独立完成' : completions[entry.id] === 'reference' ? '参考完成' : '待挑战'}</small>
        </button>)}
      </nav>
      <div className="puzzle-main">
        <section className="puzzle-intro" aria-label="本关目标">
          <div><span className="puzzle-eyebrow">第 {index + 1} / {connectFourPuzzles.length} 关 · {kindLabel[puzzle.kind]}</span><h2>{puzzle.title}</h2></div>
          <p>{goalLabel[puzzle.kind]}</p>
          <p className="puzzle-colors"><span>你 · {color}</span><span>对手 · {opponentColor}</span></p>
          {isFinalStep && <p className="puzzle-phase" role="status">你先投了{columnName(attempt.moves[0]!)}，对手应在{columnName(attempt.moves[1]!)}。现在轮到你完成第二步。</p>}
          {attempt.completed && <div className="puzzle-result" role="status"><strong>{attempt.hintUsed ? '本次参考完成' : '本次独立完成'}</strong><p>{completionExplanation(puzzle, attempt, board)}</p></div>}
          {feedback && !attempt.completed && <p className={feedback.startsWith('对手已合法') ? 'puzzle-feedback' : 'puzzle-feedback is-wrong'} role={feedback.startsWith('对手已合法') ? 'status' : 'alert'}>{feedback}</p>}
          {attempt.hintShown && !attempt.completed && <p className="puzzle-hint" role="status">提示：{hintText} 棋盘已标出参考列；由你决定是否落子。</p>}
          <div className="puzzle-controls">
            {!attempt.completed && <button type="button" onClick={showHint}>{attempt.hintShown ? '收起提示' : '提示思路'}</button>}
            <button type="button" onClick={retryPuzzle}>重试本关</button>
            {attempt.completed && <button ref={nextButton} type="button" className="is-primary" onClick={() => selectPuzzle(connectFourPuzzles[index + 1]?.id ?? connectFourPuzzles[0]!.id)}>{index === connectFourPuzzles.length - 1 ? '从第一关再练' : '下一关'}</button>}
          </div>
        </section>
        <ConnectFourGame state={board} mySeat={0} active={!attempt.completed} opponentLabel="对手" hintColumn={hintColumn} statusLabel={attempt.completed ? '本关完成' : isFinalStep ? '轮到你完成第二步' : undefined} onAction={handleAction} />
      </div>
    </div>
  </main>;
}
