import { useLayoutEffect, useRef, useState } from 'react';
import type { FourCards } from '@gamehall/game-core';

type Snapshot = { text: string; start: number; end: number };
const rankLabels: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const suits = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;

export function TwentyFourExpressionEditor({ cards, canEdit, canSubmit = true, initialValue = '', onChange, onSubmit, note = '允许分数和负数中间结果，四张牌必须各用一次。', noteAlert = false, inputId = 'expression', showPanel = true }: {
  cards: FourCards; canEdit: boolean; canSubmit?: boolean; initialValue?: string;
  onChange?: (value: string) => void; onSubmit: (expression: string) => void;
  note?: string | undefined; noteAlert?: boolean; inputId?: string; showPanel?: boolean;
}) {
  const [expression, setExpression] = useState(initialValue);
  const [available, setAvailable] = useState({ canUndo: false, canRedo: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const beforeComposition = useRef<Snapshot | null>(null);
  const selection = useRef({ start: 0, end: 0 });
  const pending = useRef<{ start: number; end: number } | null>(null);
  const history = useRef<{ past: Snapshot[]; future: Snapshot[]; lastNative: { kind: string; caret: number } | null }>({ past: [], future: [], lastNative: null });
  const submitEnabled = canEdit && canSubmit && expression.trim().length > 0;

  useLayoutEffect(() => {
    if (!pending.current || !inputRef.current) return;
    const next = pending.current;
    pending.current = null;
    inputRef.current.focus();
    inputRef.current.setSelectionRange(next.start, next.end);
    selection.current = next;
  }, [expression]);

  function snapshot(): Snapshot {
    const input = inputRef.current;
    return { text: expression, start: input?.selectionStart ?? selection.current.start, end: input?.selectionEnd ?? selection.current.end };
  }
  function update(next: string) { setExpression(next); onChange?.(next); }
  function remember(before: Snapshot, nativeKind: string | null = null, nextCaret = 0) {
    const current = history.current;
    const contiguous = (nativeKind === 'insertText' || nativeKind === 'deleteContentBackward')
      && current.lastNative?.kind === nativeKind && current.lastNative.caret === before.start && before.start === before.end;
    if (!contiguous) {
      current.past.push(before);
      if (current.past.length > 64) current.past.shift();
    }
    current.future = [];
    current.lastNative = nativeKind === 'insertText' || nativeKind === 'deleteContentBackward' ? { kind: nativeKind, caret: nextCaret } : null;
    setAvailable({ canUndo: current.past.length > 0, canRedo: false });
  }
  function restore(redo: boolean) {
    if (!canEdit || composing.current) return;
    const current = history.current;
    const source = redo ? current.future : current.past;
    const destination = redo ? current.past : current.future;
    const previous = source.pop();
    if (!previous) return;
    destination.push(snapshot());
    current.lastNative = null;
    setAvailable({ canUndo: current.past.length > 0, canRedo: current.future.length > 0 });
    pending.current = { start: previous.start, end: previous.end };
    selection.current = pending.current;
    if (previous.text === expression) {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(previous.start, previous.end);
      pending.current = null;
    } else update(previous.text);
  }
  function replace(next: string, start: number, end = start) {
    if (next === expression) {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(start, end);
      selection.current = { start, end };
      return;
    }
    remember(snapshot());
    pending.current = { start, end };
    selection.current = pending.current;
    update(next);
  }
  function edit(value: string, backspace = false) {
    if (!canEdit || composing.current) return;
    const input = inputRef.current;
    const start = input?.selectionStart ?? expression.length;
    const end = input?.selectionEnd ?? expression.length;
    const from = backspace && start === end ? Math.max(0, start - 1) : start;
    const next = `${expression.slice(0, from)}${value}${expression.slice(end)}`;
    if (next.length > 128) { input?.focus(); return; }
    replace(next, from + value.length);
  }
  return <>
    <div className="playing-cards" aria-label="本题四张牌">
      {cards.map((card) => <button type="button" className={`playing-card ${card.suit === 'H' || card.suit === 'D' ? 'red' : ''}`} key={card.id}
        aria-label={`${rankLabels[card.rank] ?? card.rank}${suits[card.suit]}，输入数值 ${card.rank}`} disabled={!canEdit}
        onPointerDown={(event) => event.preventDefault()} onClick={() => edit(String(card.rank))}>
        <span>{rankLabels[card.rank] ?? card.rank}</span><i>{suits[card.suit]}</i><b>{rankLabels[card.rank] ?? card.rank}</b>
      </button>)}
    </div>
    {showPanel && <div className="expression-panel">
      <label htmlFor={inputId}>输入算式</label>
      <div className="expression-row">
        <input ref={inputRef} id={inputId} value={expression} maxLength={128} disabled={!canEdit}
          onSelect={(event) => { selection.current = { start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 }; }}
          onChange={(event) => {
            if (!canEdit) return;
            const next = event.currentTarget.value.slice(0, 128);
            const start = Math.min(event.currentTarget.selectionStart ?? next.length, next.length);
            const end = Math.min(event.currentTarget.selectionEnd ?? start, next.length);
            if (next === expression) { selection.current = { start, end }; return; }
            if (!composing.current) remember({ text: expression, ...selection.current }, (event.nativeEvent as InputEvent).inputType ?? null, start);
            selection.current = { start, end };
            update(next);
          }}
          onCompositionStart={() => { composing.current = true; beforeComposition.current = snapshot(); }}
          onCompositionEnd={(event) => {
            composing.current = false;
            const before = beforeComposition.current;
            beforeComposition.current = null;
            const next = event.currentTarget.value.slice(0, 128);
            if (before && before.text !== next) remember(before);
            if (next !== expression) update(next);
            selection.current = { start: event.currentTarget.selectionStart ?? next.length, end: event.currentTarget.selectionEnd ?? next.length };
          }}
          onBeforeInput={(event) => { const kind = (event.nativeEvent as InputEvent).inputType; if (kind === 'historyUndo' || kind === 'historyRedo') { event.preventDefault(); restore(kind === 'historyRedo'); } }}
          onKeyDown={(event) => {
            if (composing.current || event.nativeEvent.isComposing) return;
            if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
              event.preventDefault(); restore(event.key.toLowerCase() === 'y' || event.shiftKey); return;
            }
            if (event.key === 'Enter' && submitEnabled) { event.preventDefault(); onSubmit(expression); }
          }} placeholder="例如：8/(3-8/3)" autoComplete="off" spellCheck={false} />
        <button type="button" disabled={!submitEnabled} onClick={() => onSubmit(expression)}>提交答案</button>
      </div>
      <div className="math-pad" role="toolbar" aria-label="算式快捷键">
        {['+', '−', '×', '÷', '(', ')'].map((operator) => <button type="button" key={operator} disabled={!canEdit} onPointerDown={(event) => event.preventDefault()} onClick={() => edit(operator === '−' ? '-' : operator === '×' ? '*' : operator === '÷' ? '/' : operator)}>{operator}</button>)}
        <button type="button" disabled={!canEdit} onPointerDown={(event) => event.preventDefault()} onClick={() => edit('', true)}>退格</button>
        <button type="button" disabled={!canEdit} onPointerDown={(event) => event.preventDefault()} onClick={() => { if (canEdit && !composing.current) replace('', 0); }}>清空</button>
        <button type="button" disabled={!canEdit || !available.canUndo} onPointerDown={(event) => event.preventDefault()} onClick={() => restore(false)}>撤销</button>
        <button type="button" disabled={!canEdit || !available.canRedo} onPointerDown={(event) => event.preventDefault()} onClick={() => restore(true)}>重做</button>
      </div>
      <p className={`cooldown-note ${noteAlert ? 'visible' : ''}`} aria-live="polite">{note}</p>
    </div>}
  </>;
}
