import { useCallback, useEffect, useRef, useState } from 'react';
import { validateTwentyFourExpression } from '@gamehall/game-core';
import { TwentyFourExpressionEditor } from './TwentyFourExpressionEditor';
import { PackGenerator } from './twenty-four-pack';
import { solutionSteps } from './twenty-four-hints';
import { answerSummary, newTwentyFourProgress, tickChallenge, type TwentyFourMode, type TwentyFourProgress } from './twenty-four-practice';
import { clearTwentyFourDraft, readTwentyFourDraft, readTwentyFourSnapshot, subscribeTwentyFourStore, writeTwentyFourDraft, writeTwentyFourProgress, type Snapshot } from './twenty-four-store';
import './solo-practice.css';
import './twenty-four-practice.css';

function summary(progress: TwentyFourProgress): string {
  const result = answerSummary(progress);
  return `${progress.mode === 'practice' ? '不限时练习' : '60 秒挑战'} · ${progress.answers.length}/10 题 · 独立解出 ${result.independent} 题 · 参考解出 ${result.assisted} 题`;
}

export function TwentyFourPracticePage({ recoveredRoom, onExit }: { recoveredRoom: boolean; onExit: () => void }) {
  const [booted, setBooted] = useState(false);
  const [mode, setMode] = useState<TwentyFourMode>('practice');
  const [progress, setProgress] = useState<TwentyFourProgress | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const progressRef = useRef<TwentyFourProgress | null>(null);
  const mounted = useRef(true);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const deadlineMono = useRef(0);
  const [generating, setGenerating] = useState(false);
  const generator = useRef(new PackGenerator());
  const generation = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [conflict, setConflict] = useState<Snapshot | null>(null);
  const conflictRef = useRef<Snapshot | null>(null);
  const knownToken = useRef<string | null>(null);
  const pendingToken = useRef<string | null>(null);
  const epoch = useRef(0);
  const sequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const writing = useRef(false);
  const queuedWrites = useRef(0);
  const [restartOpen, setRestartOpen] = useState(false);
  const restartButton = useRef<HTMLButtonElement>(null);
  const cancelRestart = useRef<HTMLButtonElement>(null);
  const restartDialog = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const moveFocusToNext = useRef(false);
  const moveFocusToInput = useRef(false);

  useEffect(() => {
    let active = true;
    const packGenerator = generator.current;
    void (async () => {
      const shared = await readTwentyFourSnapshot();
      if (!active) return;
      const draft = readTwentyFourDraft();
      knownToken.current = draft?.baseToken ?? (shared.kind === 'valid' || shared.kind === 'invalid' ? shared.token : null);
      pendingToken.current = draft?.pendingToken ?? null;
      const sharedToken = shared.kind === 'valid' || shared.kind === 'invalid' ? shared.token : null;
      if (draft && pendingToken.current && sharedToken === pendingToken.current) {
        knownToken.current = sharedToken;
        pendingToken.current = null;
        if (shared.kind === 'valid' && JSON.stringify(draft.progress) === JSON.stringify(shared.progress)) clearTwentyFourDraft();
        else writeTwentyFourDraft({ progress: draft.progress, baseToken: sharedToken });
      }
      else if (draft && shared.kind === 'valid' && JSON.stringify(draft.progress) === JSON.stringify(shared.progress)) {
        knownToken.current = shared.token;
        pendingToken.current = null;
        clearTwentyFourDraft();
      }
      else if (draft && shared.kind !== 'unavailable' && draft.baseToken !== sharedToken) {
        conflictRef.current = shared; setConflict(shared);
      }
      const loaded = draft?.progress ?? (shared.kind === 'valid' ? shared.progress : null);
      if (loaded) { progressRef.current = loaded; setProgress(loaded); setMode(loaded.mode); setSaveNotice(draft ? '已恢复本标签的练习，计时已暂停' : '已恢复上次练习，计时已暂停'); }
      else if (shared.kind === 'invalid') { conflictRef.current = shared; setConflict(shared); setSaveNotice('共享存档无法通过校验，请开始新题组或选择覆盖。'); }
      else if (shared.kind === 'unavailable') setSaveNotice('共享存档暂不可用；练习会尝试保存在当前标签。');
      setBooted(true);
    })();
    return () => { active = false; packGenerator.cancel(); };
  }, []);

  const markConflict = useCallback((snapshot: Snapshot) => {
    const current = progressRef.current;
    if (runningRef.current && current?.mode === 'challenge' && current.phase !== 'finished') {
      const frozen = tickChallenge(current, Math.max(0, current.remainingMs - (deadlineMono.current - performance.now())));
      progressRef.current = frozen;
      setProgress(frozen);
      writeTwentyFourDraft({ progress: frozen, baseToken: knownToken.current, pendingToken: pendingToken.current });
    }
    runningRef.current = false;
    setRunning(false);
    conflictRef.current = snapshot;
    setConflict(snapshot);
  }, []);

  const persist = useCallback((next: TwentyFourProgress, forceShared = false) => {
    progressRef.current = next;
    setProgress(next);
    const draftSaved = writeTwentyFourDraft({ progress: next, baseToken: knownToken.current, pendingToken: pendingToken.current });
    setUnsaved(!draftSaved);
    const seq = ++sequence.current;
    const thisEpoch = epoch.current;
    if (conflictRef.current || !forceShared && next.mode === 'challenge' && runningRef.current && (seq % 4 !== 0 || queuedWrites.current > 0)) return;
    queuedWrites.current++;
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        if (thisEpoch !== epoch.current || conflictRef.current) return;
        writing.current = true;
        if (pendingToken.current) {
          const shared = await readTwentyFourSnapshot();
          if (shared.kind === 'unavailable') { setSaveNotice('共享保存结果尚待确认；当前标签草稿已保留。'); return; }
          const sharedToken = shared.kind === 'valid' || shared.kind === 'invalid' ? shared.token : null;
          if (sharedToken === pendingToken.current) { knownToken.current = sharedToken; pendingToken.current = null; }
          else if (sharedToken === knownToken.current) { pendingToken.current = null; }
          else { if (mounted.current && thisEpoch === epoch.current) markConflict(shared); return; }
        }
        const snapshot = forceShared ? next : progressRef.current ?? next;
        const result = await writeTwentyFourProgress(snapshot, knownToken.current,
          () => thisEpoch === epoch.current && !conflictRef.current,
          (token) => {
            if (!mounted.current || thisEpoch !== epoch.current || conflictRef.current) return;
            pendingToken.current = token;
            if (progressRef.current) setUnsaved(!writeTwentyFourDraft({ progress: progressRef.current, baseToken: knownToken.current, pendingToken: token }));
          });
        if (!mounted.current || thisEpoch !== epoch.current) return;
        if (result.kind === 'conflict') { markConflict(result.snapshot); return; }
        if (result.kind === 'saved') {
          knownToken.current = result.token;
          pendingToken.current = null;
          if (seq === sequence.current) { clearTwentyFourDraft(); setUnsaved(false); setSaveNotice('进度已保存'); }
          else if (progressRef.current) setUnsaved(!writeTwentyFourDraft({ progress: progressRef.current, baseToken: result.token }));
        } else if (result.kind === 'uncertain') {
          pendingToken.current = result.token;
          if (progressRef.current) setUnsaved(!writeTwentyFourDraft({ progress: progressRef.current, baseToken: knownToken.current, pendingToken: result.token }));
          setSaveNotice('共享保存结果尚待确认；当前标签草稿已保留。');
        } else if (seq === sequence.current) setSaveNotice('共享保存暂不可用；仅当前标签的草稿可恢复。');
      } finally { writing.current = false; queuedWrites.current--; }
    });
  }, [markConflict]);

  const advanceClock = useCallback(() => {
    if (!runningRef.current) return;
    const now = performance.now();
    const current = progressRef.current;
    if (!current || current.mode !== 'challenge' || current.phase === 'finished') return;
    const next = tickChallenge(current, Math.max(0, current.remainingMs - (deadlineMono.current - now)));
    if (next.remainingMs !== current.remainingMs) persist(next, next.phase === 'finished');
    if (next.phase === 'finished') { runningRef.current = false; setRunning(false); setError(null); }
  }, [persist]);
  const pause = useCallback(() => {
    advanceClock();
    runningRef.current = false;
    setRunning(false);
    if (progressRef.current) persist(progressRef.current, true);
  }, [advanceClock, persist]);
  function resume() {
    if (!progressRef.current || progressRef.current.phase === 'finished' || conflictRef.current || document.visibilityState === 'hidden') return;
    if (progressRef.current.mode === 'challenge') deadlineMono.current = performance.now() + progressRef.current.remainingMs;
    runningRef.current = true;
    setRunning(true);
    setSaveNotice(null);
    persist(progressRef.current, true);
  }
  useEffect(() => {
    const interval = window.setInterval(advanceClock, 250);
    const onHidden = () => { if (document.visibilityState === 'hidden') pause(); };
    const onPageHide = () => pause();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', onPageHide); };
  }, [advanceClock, pause]);
  useEffect(() => {
    mounted.current = true;
    const saveEpoch = epoch;
    const packGenerator = generator.current;
    return () => {
      mounted.current = false;
      saveEpoch.current++;
      if (runningRef.current && progressRef.current) {
        const current = progressRef.current;
        const next = current.mode === 'challenge' ? tickChallenge(current, Math.max(0, current.remainingMs - (deadlineMono.current - performance.now()))) : current;
        writeTwentyFourDraft({ progress: next, baseToken: knownToken.current, pendingToken: pendingToken.current });
      }
      packGenerator.cancel();
    };
  }, []);
  useEffect(() => {
    if (!booted) return;
    let active = true;
    const check = async () => {
      if (writing.current || queuedWrites.current || conflictRef.current) return;
      const seq = sequence.current, thisEpoch = epoch.current, token = knownToken.current;
      const shared = await readTwentyFourSnapshot();
      if (!active || seq !== sequence.current || thisEpoch !== epoch.current || token !== knownToken.current || shared.kind === 'unavailable') return;
      const latest = shared.kind === 'valid' || shared.kind === 'invalid' ? shared.token : null;
      if (pendingToken.current && latest === pendingToken.current) {
        knownToken.current = latest;
        pendingToken.current = null;
        if (progressRef.current) persist(progressRef.current, true);
      } else if (latest !== token) markConflict(shared);
    };
    const unsubscribe = subscribeTwentyFourStore(() => { void check(); });
    const onFocus = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [booted, markConflict, persist]);

  async function start(nextMode = mode) {
    if (generating) return;
    pause();
    const request = ++generation.current;
    generator.current.cancel();
    setGenerating(true); setError(null); setRestartOpen(false);
    try {
      const pack = await generator.current.generate();
      if (request !== generation.current) return;
      const next = newTwentyFourProgress(nextMode, pack);
      await saveQueue.current;
      if (request !== generation.current) return;
      epoch.current++;
      conflictRef.current = null; setConflict(null);
      setMode(nextMode);
      setEditorRevision((revision) => revision + 1);
      persist(next, true);
      if (nextMode === 'challenge') deadlineMono.current = performance.now() + 60_000;
      runningRef.current = true; setRunning(true);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error && cause.message !== '已取消生成' ? cause.message : '题组生成失败，请重试');
    } finally { if (request === generation.current) setGenerating(false); }
  }
  function submit(expression: string) {
    advanceClock();
    const current = progressRef.current;
    if (!runningRef.current || !current || current.phase !== 'playing' || conflictRef.current) return;
    const validation = validateTwentyFourExpression(expression, current.pack[current.index]!.cards.map((card) => card.rank));
    if (!validation.ok) { setError(validation.message); return; }
    const answered: TwentyFourProgress = { ...current, phase: 'answered', answers: [...current.answers,
      { kind: current.hints > 0 ? 'assisted' : 'independent', expression: validation.normalized, hints: current.hints }], hints: 0, draft: validation.normalized };
    moveFocusToNext.current = document.activeElement?.id === 'twenty-four-expression' || document.activeElement?.textContent === '提交答案';
    setError(null); persist(answered, true);
  }
  function hint() {
    advanceClock();
    const current = progressRef.current;
    if (!runningRef.current || !current || current.phase !== 'playing' || current.hints >= 3 || conflictRef.current) return;
    persist({ ...current, hints: current.hints + 1 }, true);
  }
  function reveal() {
    advanceClock();
    const current = progressRef.current;
    if (!runningRef.current || !current || current.phase !== 'playing' || conflictRef.current) return;
    moveFocusToNext.current = document.activeElement?.textContent === '查看完整答案';
    persist({ ...current, phase: 'answered', answers: [...current.answers, { kind: 'revealed', expression: null, hints: current.hints }], hints: 0 }, true);
    setError(null);
  }
  function next() {
    advanceClock();
    const current = progressRef.current;
    if (!runningRef.current || !current || current.phase !== 'answered' || conflictRef.current) return;
    moveFocusToInput.current = document.activeElement === nextButton.current;
    const index = current.index + 1;
    const nextProgress: TwentyFourProgress = index === 10
      ? { ...current, index, phase: 'finished', finishReason: 'complete', draft: '', hints: 0 }
      : { ...current, index, phase: 'playing', draft: '', hints: 0 };
    if (index === 10) { runningRef.current = false; setRunning(false); }
    persist(nextProgress, true);
  }
  useEffect(() => {
    if (moveFocusToNext.current && progress?.phase === 'answered') { moveFocusToNext.current = false; nextButton.current?.focus({ preventScroll: true }); }
    if (moveFocusToInput.current && progress?.phase === 'playing') { moveFocusToInput.current = false; document.getElementById('twenty-four-expression')?.focus({ preventScroll: true }); }
  }, [progress?.phase, progress?.index]);

  function requestRestart() {
    if (!progress || progress.phase === 'finished' || progress.index === 0 && progress.draft === '' && progress.hints === 0 && progress.answers.length === 0) { void start(); return; }
    pause(); setRestartOpen(true);
  }
  useEffect(() => {
    if (!restartOpen) return;
    cancelRestart.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setRestartOpen(false); restartButton.current?.focus(); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(restartDialog.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [restartOpen]);
  function exit() { pause(); generator.current.cancel(); generation.current++; onExit(); }
  async function adoptShared() {
    pause(); epoch.current++; await saveQueue.current;
    const snapshot = await readTwentyFourSnapshot();
    if (snapshot.kind !== 'valid') { setError('共享进度暂不可读取，请稍后重试。'); return; }
    knownToken.current = snapshot.token;
    pendingToken.current = null;
    conflictRef.current = null; setConflict(null); clearTwentyFourDraft();
    progressRef.current = snapshot.progress; setProgress(snapshot.progress); setMode(snapshot.progress.mode);
    setEditorRevision((revision) => revision + 1);
    setError(null); setSaveNotice('已切换到另一窗口保存的题组，计时已暂停');
  }
  async function keepCurrent() {
    pause(); await saveQueue.current;
    const local = progressRef.current;
    if (!local) return;
    const latest = await readTwentyFourSnapshot();
    if (latest.kind === 'unavailable') { setError('共享存档暂不可读取，当前进度仍在此标签。'); return; }
    const observed = conflictRef.current;
    const observedToken = observed?.kind === 'valid' || observed?.kind === 'invalid' ? observed.token : null;
    const latestToken = latest.kind === 'valid' || latest.kind === 'invalid' ? latest.token : null;
    if (pendingToken.current && latestToken === pendingToken.current) {
      knownToken.current = latestToken;
      pendingToken.current = null;
      conflictRef.current = null; setConflict(null);
      persist(local, true);
      setError(null); setSaveNotice('已确认当前题组的保存，计时仍暂停');
      return;
    }
    if (latestToken !== observedToken) { conflictRef.current = latest; setConflict(latest); setError('另一窗口又更新了，请重新比较后选择。'); return; }
    const currentEpoch = ++epoch.current;
    const result = await writeTwentyFourProgress(local, latestToken, () => currentEpoch === epoch.current,
      (token) => {
        if (!mounted.current || currentEpoch !== epoch.current) return;
        knownToken.current = latestToken;
        pendingToken.current = token;
        setUnsaved(!writeTwentyFourDraft({ progress: local, baseToken: latestToken, pendingToken: token }));
      });
    if (currentEpoch !== epoch.current) return;
    if (result.kind === 'conflict') { conflictRef.current = result.snapshot; setConflict(result.snapshot); return; }
    if (result.kind === 'uncertain') {
      knownToken.current = latestToken;
      pendingToken.current = result.token;
      setUnsaved(!writeTwentyFourDraft({ progress: local, baseToken: latestToken, pendingToken: result.token }));
      setError('共享保存结果尚待确认，当前进度仍在此标签。');
      return;
    }
    if (result.kind !== 'saved') { setError('保存失败，当前进度仍在此标签。'); return; }
    knownToken.current = result.token;
    pendingToken.current = null;
    conflictRef.current = null; setConflict(null); clearTwentyFourDraft(); setUnsaved(false);
    setError(null); setSaveNotice('当前题组已保存，计时仍暂停');
  }

  const current = progress && progress.phase !== 'finished' ? progress.pack[progress.index] : null;
  const steps = current ? solutionSteps(current.solution) : [];
  const stats = progress ? answerSummary(progress) : null;
  const canOperate = !!progress && running && !conflict && progress.phase !== 'finished';
  return <main className="solo-shell twenty-four-practice">
    <header className="solo-header"><div><span className="solo-eyebrow">本地单人练习</span><h1 tabIndex={-1}>24 点 · 单人练习</h1><p>四张牌各用一次。自己解题，也可以逐步参考一种可行解法。</p></div><button type="button" onClick={exit}>{recoveredRoom ? '返回对局' : '返回大厅'}</button></header>
    {recoveredRoom && <div className="solo-recovered" role="status">已恢复你的好友房。<button type="button" onClick={exit}>返回对局</button></div>}
    {!booted ? <section className="solo-setup"><p role="status">正在读取上次练习…</p></section> : <>
      {saveNotice && <p className="solo-save-note" role="status">{saveNotice}</p>}
      {unsaved && <p className="solo-save-note is-warning" role="status">浏览器无法保存当前草稿；刷新后可能丢失本次进度。</p>}
      {conflict && <div className="solo-conflict" role="status"><strong>另一窗口的 24 点进度已改变</strong>
        <p>当前：{progress ? summary(progress) : '尚未开始'}</p><p>共享：{conflict.kind === 'valid' ? summary(conflict.progress) : conflict.kind === 'empty' ? '暂无记录' : '存档无法校验'}</p>
        <small>选择前不会覆盖另一窗口。计时已暂停。</small><div className="solo-conflict-actions">
          {conflict.kind === 'valid' && <button type="button" onClick={() => void adoptShared()}>接着共享进度</button>}
          {progress && <button type="button" onClick={() => void keepCurrent()}>保存当前题组</button>}
        </div></div>}
      {!progress ? <section className="solo-setup" aria-label="24 点练习设置"><h2>选择玩法</h2>
        <fieldset><legend>题组模式</legend><label><input type="radio" checked={mode === 'practice'} onChange={() => setMode('practice')} />不限时练 10 题</label><label><input type="radio" checked={mode === 'challenge'} onChange={() => setMode('challenge')} />60 秒挑战</label></fieldset>
        <p>每组 10 道可解且不重复的题。答对或看答案后由你手动进入下一题；挑战计时在题间继续。</p>
        <button type="button" className="solo-primary" disabled={generating} onClick={() => void start()}>{generating ? '正在生成 10 道题…' : error ? '重试生成题组' : '开始练习'}</button>
      </section> : <div className="solo-play"><div className="twenty-four-practice-top"><div><span className="solo-eyebrow">{progress.mode === 'practice' ? '不限时练 10 题' : '60 秒挑战'}</span><h2>{progress.phase === 'finished' ? '本组结算' : `第 ${progress.index + 1} / 10 题`}</h2></div>
        {progress.mode === 'challenge' && <div className="twenty-four-practice-timer" role="timer" aria-label={`剩余 ${(progress.remainingMs / 1000).toFixed(1)} 秒`}><span>剩余时间</span><strong>{(progress.remainingMs / 1000).toFixed(1)}s</strong></div>}
      </div>
      <div className="twenty-four-practice-stats"><span>已答 {progress.answers.length}/10</span><span>独立解出 {stats?.independent}</span><span>参考解出 {stats?.assisted}</span><span>查看答案 {stats?.revealed}</span></div>
      <ol className="twenty-four-practice-overview" aria-label="十题概况">{progress.pack.map((_, index) => <li key={index} className={index === progress.index && progress.phase !== 'finished' ? 'current' : ''} aria-current={index === progress.index && progress.phase !== 'finished' ? 'step' : undefined}>
        <span>{index + 1}</span><small>{progress.answers[index]?.kind === 'independent' ? '独立' : progress.answers[index]?.kind === 'assisted' ? '参考' : progress.answers[index]?.kind === 'revealed' ? '看答案' : index === progress.index && progress.phase !== 'finished' ? '当前' : '待答'}</small>
      </li>)}</ol>
      {progress.phase === 'finished' ? <section className="twenty-four-practice-result" aria-label="本组结果"><h3>{progress.finishReason === 'time' ? '时间到，本组结束' : '10 题完成'}</h3><p>答对 {stats?.solved} 题，其中独立解出 {stats?.independent} 题、参考解出 {stats?.assisted} 题；查看答案 {stats?.revealed} 题。</p><button type="button" onClick={() => void start()}>再来一组</button></section> : <>
        <div className="twenty-four-practice-controls"><strong>{running ? progress.phase === 'answered' && progress.mode === 'challenge' ? '题间仍在计时' : '练习进行中' : '已暂停，点击继续后作答'}</strong>
          {running ? <button type="button" onClick={pause}>暂停</button> : <button type="button" disabled={!!conflict} onClick={resume}>继续</button>}
        </div>
        <section className="game-surface twenty-four-surface" aria-label="24 点单人题面">
          <TwentyFourExpressionEditor key={`${editorRevision}-${progress.index}`} cards={current!.cards} canEdit={canOperate && progress.phase === 'playing'}
            showPanel={progress.phase === 'playing'} initialValue={progress.draft} inputId="twenty-four-expression"
            onChange={(draft) => { const old = progressRef.current; if (old?.phase === 'playing') persist({ ...old, draft }); }}
            onSubmit={submit} note="允许分数与负数中间结果；四张牌必须各用一次。" />
          {error && <p className="twenty-four-practice-error" role="alert">{error}</p>}
          {progress.phase === 'playing' && <div className="twenty-four-practice-hints"><div><button type="button" disabled={!canOperate || progress.hints >= 3} onClick={hint}>{progress.hints ? '再看一步' : '提示一步'}</button><button type="button" disabled={!canOperate} onClick={reveal}>查看完整答案</button></div>
            {progress.hints > 0 && <div role="status"><strong>一种可行解法的步骤</strong><ol>{steps.slice(0, progress.hints).map((step, index) => <li key={index}>{step}</li>)}</ol><small>提示仅供参考，不会自动填写或提交。使用提示后答对计为“参考解出”。</small></div>}
          </div>}
          {progress.phase === 'answered' && <div className="solution-card" role="status"><span>{progress.answers[progress.index]?.kind === 'independent' ? '独立解出' : progress.answers[progress.index]?.kind === 'assisted' ? '参考解出' : '已查看答案'}</span><strong>{current!.solution}</strong><p>这是一种可行算式。{progress.mode === 'challenge' ? '进入下一题前，计时仍在继续。' : '准备好后进入下一题。'}</p><button ref={nextButton} type="button" disabled={!canOperate} onClick={next}>{progress.index === 9 ? '查看本组结果' : '下一题'}</button></div>}
        </section>
      </>}
      <div className="solo-actions"><button ref={restartButton} type="button" disabled={generating} onClick={requestRestart}>重新开始</button><button type="button" onClick={exit}>{recoveredRoom ? '返回对局' : '返回大厅'}</button></div>
      <details className="solo-settings"><summary>下组设置</summary><p>切换模式后，重新开始或完成本组再生效。</p><fieldset><legend>题组模式</legend><label><input type="radio" checked={mode === 'practice'} onChange={() => setMode('practice')} />不限时练 10 题</label><label><input type="radio" checked={mode === 'challenge'} onChange={() => setMode('challenge')} />60 秒挑战</label></fieldset></details>
      </div>}
      {error && !progress && <p className="twenty-four-practice-error" role="alert">{error}</p>}
    </>}
    {restartOpen && <div className="solo-confirm-backdrop" onClick={(event) => { if (event.target === event.currentTarget) { setRestartOpen(false); restartButton.current?.focus(); } }}><div ref={restartDialog} className="solo-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="twenty-four-restart-title" aria-describedby="twenty-four-restart-description"><h2 id="twenty-four-restart-title">重新开始这组？</h2><p id="twenty-four-restart-description">当前作答与草稿会清空，并按“{mode === 'practice' ? '不限时练习' : '60 秒挑战'}”生成新题组。</p><div><button ref={cancelRestart} type="button" onClick={() => { setRestartOpen(false); restartButton.current?.focus(); }}>继续这组</button><button type="button" className="is-danger" onClick={() => void start()}>清空并重新开始</button></div></div></div>}
  </main>;
}
