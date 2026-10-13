import { Check, Clipboard, DoorOpen, Flag, Link2, LoaderCircle, LogOut, RotateCcw, Send, ShieldCheck, TriangleAlert, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { requireBinaryPlayer, type GomokuState, type ConnectFourState, type ReversiState, type DotsAndBoxesState, type QuoridorView, type TwentyFourView, type SplendorView, type TexasHoldemView } from '@gamehall/game-core';
import type { GameActionCommand, RoomMemberView } from '@gamehall/protocol';
import type { GameHallClient } from './gamehall-client';
import { GomokuGame, QuoridorGame, TexasHoldemGame, TwentyFourGame } from './game-components';
import { ClickSpark, Reveal } from './motion-primitives';
import { resultMessage } from './room-result';
import { SplendorGame } from './SplendorGame';
import { ConnectFourGame } from './ConnectFourGame';
import { ReversiGame } from './ReversiGame';
import { DotsAndBoxesGame } from './DotsAndBoxesGame';
import { gameNames, games } from './games';
import type { OnlineGameAvailability } from './online-game-heading';

const quickMessages = ['👍', '👏', '😄', '🤔', '🔥', '🎉', '😮', '😭'] as const;

function countVisibleCharacters(value: string): number {
  return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value)].length;
}

function truncateVisibleCharacters(value: string, limit: number): string {
  return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value)]
    .slice(0, limit)
    .map((item) => item.segment)
    .join('');
}

function connectionLabel(connection: GameHallClient['connection']): string {
  if (connection === 'online') return '连接正常';
  if (connection === 'connecting') return '正在重连';
  return '连接中断';
}

function PlayerCard({ member, mine, waitingHost = false }: { member: RoomMemberView | undefined; mine: boolean; waitingHost?: boolean }) {
  if (!member) {
    return (
      <div className="player-card is-empty">
        <span className="player-avatar">?</span>
        <div><strong>等待好友加入</strong><small>分享上方邀请码</small></div>
      </div>
    );
  }
  return (
    <div className={`player-card ${mine ? 'is-mine' : ''} ${member.online ? '' : 'is-offline'}`}>
      <span className="player-avatar">{Array.from(member.nickname)[0]}</span>
      <div>
        <strong>{member.nickname}{mine ? '（你）' : ''}</strong>
        <small>{member.online ? waitingHost ? '房主 · 等待开局' : member.ready ? '在线 · 已准备' : '在线 · 未准备' : '暂时离线'}</small>
      </div>
      <i aria-label={member.online ? '在线' : '离线'} />
    </div>
  );
}

export function RoomPage({ client }: { client: GameHallClient }) {
  const { room, game } = client;
  const [copiedTarget, setCopiedTarget] = useState<'link' | 'code' | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const [gameActionRequest, setGameActionRequest] = useState<{ roomId: string; id: number } | null>(null);
  const gameActionInFlight = useRef<{ roomId: string; id: number; promise: ReturnType<GameHallClient['submitGameAction']> } | null>(null);
  const gameActionSequence = useRef(0);
  const gameContext = useRef<{ roomId: string; version: number } | null>(null);
  const mounted = useRef(true);
  const [starting, setStarting] = useState(false);
  const pendingRef = useRef(false);
  const [confirmAction, setConfirmAction] = useState<'leave' | 'resign' | null>(null);
  const confirmTriggerRef = useRef<HTMLElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmDialogRef = useRef<HTMLElement | null>(null);
  const roomHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [pokerPresentationLocked, setPokerPresentationLocked] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const followMessagesRef = useRef(true);
  const [now, setNow] = useState(room?.serverTimeMs ?? 0);
  const [gameClockNow, setGameClockNow] = useState(room?.serverTimeMs ?? 0);
  const pauseDeadline = room?.pauseReason === 'restart'
    ? room.restartDeadlineMs
    : room?.members.find((member) => !member.online)?.disconnectDeadlineMs;
  useLayoutEffect(() => {
    gameContext.current = room && game ? { roomId: room.roomId, version: game.version } : null;
  }, [room, game]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; gameContext.current = null; };
  }, []);

  useEffect(() => {
    if (!room?.roomId) return;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    roomHeadingRef.current?.focus({ preventScroll: true });
  }, [room?.roomId]);

  useEffect(() => {
    const anchorServerMs = room?.serverTimeMs;
    if (anchorServerMs === undefined || !pauseDeadline) return undefined;
    const anchorMonotonicMs = performance.now();
    const immediate = window.setTimeout(() => setNow(anchorServerMs), 0);
    const timer = window.setInterval(() => {
      setNow(anchorServerMs + performance.now() - anchorMonotonicMs);
    }, 1_000);
    return () => { window.clearTimeout(immediate); window.clearInterval(timer); };
  }, [pauseDeadline, room?.serverTimeMs]);

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (!confirmAction) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingRef.current) setConfirmAction(null);
      if (event.key !== 'Tab') return;
      const controls = [...(confirmDialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (!controls.length) { event.preventDefault(); confirmDialogRef.current?.focus(); return; }
      const first = controls[0]!, last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!confirmDialogRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      confirmTriggerRef.current?.focus();
    };
  }, [confirmAction]);

  useEffect(() => {
    if (confirmAction && pending) confirmDialogRef.current?.focus();
  }, [confirmAction, pending]);

  useEffect(() => {
    if (!followMessagesRef.current) return;
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [client.messages.length]);

  const me = room?.members.find((member) => member.seat === room.mySeat);
  const opponent = room?.members.find((member) => member.seat !== room.mySeat);
  const inviteUrl = room ? `${window.location.origin}${window.location.pathname}?room=${room.code}` : '';
  const result = !(room?.gameId === 'texas-holdem' && pokerPresentationLocked) && room && game ? resultMessage(room.gameId, game.view, room.mySeat) : null;
  const pokerBetweenHands = room?.gameId === 'texas-holdem' && (game?.view as TexasHoldemView | undefined)?.phase === 'hand-complete';
  const pauseSeconds = pauseDeadline ? Math.max(0, Math.ceil((pauseDeadline - now) / 1000)) : null;
  const canPlay = room?.status === 'active' && client.connection === 'online';
  const availability: OnlineGameAvailability = client.connection !== 'online' ? 'reconnecting'
    : room?.status === 'paused' ? room.pauseReason === 'restart' ? 'paused-restart' : 'paused-peer' : null;
  const gameActionPending = Boolean(gameActionRequest && gameActionRequest.roomId === room?.roomId);
  const canSubmitGameAction = canPlay && !gameActionPending;
  useEffect(() => {
    const anchorServerMs = game?.serverTimeMs ?? room?.serverTimeMs;
    if (anchorServerMs === undefined) return undefined;
    const shouldTick = room?.gameId === 'twenty-four' && canPlay && (game?.view as TwentyFourView | undefined)?.phase === 'answering';
    if (!shouldTick) {
      if (room?.status !== 'paused') return undefined;
      const reanchor = window.setTimeout(() => setGameClockNow(anchorServerMs), 0);
      return () => window.clearTimeout(reanchor);
    }
    const anchorMonotonicMs = performance.now();
    const updateClock = () => {
      setGameClockNow(anchorServerMs + performance.now() - anchorMonotonicMs);
    };
    const immediate = window.setTimeout(updateClock, 0);
    const timer = window.setInterval(updateClock, 200);
    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(timer);
    };
  }, [canPlay, game?.serverTimeMs, game?.view, room?.gameId, room?.serverTimeMs, room?.status]);
  const rematchCount = room?.members.filter((member) => member.rematchReady).length ?? 0;
  const multiplayer = room?.gameId === 'splendor' || room?.gameId === 'texas-holdem';
  const statusText = useMemo(() => {
    if (!room) return '';
    if (room.status === 'waiting') return room.members.length < 2 ? '等待好友加入' : multiplayer ? '等待准备与房主开局' : '等待双方准备';
    if (room.status === 'paused') return '对局暂停';
    if (room.status === 'finished') return '本局结束';
    return '对局进行中';
  }, [multiplayer, room]);

  if (!room) return null;
  const currentRoom = room;
  const gameInfo = games.find((candidate) => candidate.id === room.gameId);
  const isHost = room.mySeat === room.hostSeat;
  const hostStartLabel = starting ? '正在开局…' : client.connection !== 'online' ? '等待连接恢复' : room.members.length < 2 ? '等待好友加入'
    : room.members.some((member) => !member.online) ? '等待成员上线'
      : room.members.some((member) => member.seat !== room.hostSeat && !member.ready) ? '等待其他成员准备' : '开始游戏';

  async function run(operation: () => Promise<unknown>, start = false) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true); setStarting(start);
    try { await operation(); } finally { pendingRef.current = false; setPending(false); setStarting(false); }
  }

  function submitRoomGameAction(action: GameActionCommand['action']): ReturnType<GameHallClient['submitGameAction']> {
    const context = gameContext.current;
    if (!context || context.roomId !== currentRoom.roomId) {
      return Promise.resolve({ ok: false, error: { commandId: null, event: 'game:action', code: 'ACTION_UNAVAILABLE', message: '对局暂时不能操作', retryable: false } });
    }
    const inFlight = gameActionInFlight.current;
    if (inFlight?.roomId === context.roomId) return inFlight.promise;
    if (context.version !== game?.version || !canPlay) {
      return Promise.resolve({ ok: false, error: { commandId: null, event: 'game:action', code: 'ACTION_UNAVAILABLE', message: '对局暂时不能操作', retryable: false } });
    }
    const request = { roomId: context.roomId, id: ++gameActionSequence.current };
    const promise = client.submitGameAction(action);
    gameActionInFlight.current = { ...request, promise };
    setGameActionRequest(request);
    const settle = () => {
      if (gameActionInFlight.current?.id === request.id) gameActionInFlight.current = null;
      if (mounted.current && gameContext.current?.roomId === request.roomId) {
        setGameActionRequest((previous) => previous?.id === request.id ? null : previous);
      }
    };
    void promise.then(settle, settle);
    return promise;
  }

  async function copyInvite(target: 'link' | 'code') {
    const value = target === 'link' ? inviteUrl : currentRoom.code;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTarget(target);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedTarget(null), 1_800);
    } catch {
      window.prompt(target === 'link' ? '复制下面的邀请链接' : '复制下面的房间码', value);
    }
  }

  function openConfirmation(action: 'leave' | 'resign', trigger: HTMLElement) {
    confirmTriggerRef.current = trigger;
    setConfirmAction(action);
  }

  async function confirmOperation() {
    if (!confirmAction || pending) return;
    const action = confirmAction;
    pendingRef.current = true;
    setPending(true);
    try {
      const result = action === 'leave'
        ? await client.leaveRoom()
        : await client.submitGameAction({ type: 'resign' });
      if (result.ok) setConfirmAction(null);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function sendMessage(content: string) {
    if (pending || client.connection !== 'online') return;
    setPending(true);
    try {
      const result = await client.sendMessage(content);
      if (result.ok) setMessageDraft('');
    } finally {
      setPending(false);
    }
  }

  function handleMessageScroll() {
    const list = messageListRef.current;
    if (!list) return;
    followMessagesRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 24;
  }

  return (
    <div className={`room-shell room-status-${room.status} ${room.gameId === 'splendor' ? 'splendor-room' : room.gameId === 'texas-holdem' ? 'poker-room' : ''}`}>
      <header className="room-topbar">
        <div className="room-topbar-left">
          <button className="brand room-brand-button" type="button" aria-label="返回主界面并离开房间" onClick={(event) => openConfirmation('leave', event.currentTarget)}>
            <span className="brand-mark"><span /></span>
            <span><strong>GameHall</strong><small>好友棋牌桌游馆</small></span>
          </button>
          <div className="room-top-actions">
            {(room.status === 'active' || room.status === 'paused') && !pokerBetweenHands && (
              <button className="room-top-action is-resign" type="button" onClick={(event) => openConfirmation('resign', event.currentTarget)} disabled={pending || client.connection !== 'online'} aria-label="认输">
                <Flag size={18} /><span>认输</span>
              </button>
            )}
            <button className="room-top-action is-leave" type="button" onClick={(event) => openConfirmation('leave', event.currentTarget)} disabled={pending || client.connection !== 'online'} aria-label="离开房间">
              <DoorOpen size={18} /><span>离开房间</span>
            </button>
          </div>
        </div>
        <div className={`connection-badge is-${client.connection}`} aria-live="polite">
          {client.connection === 'online' ? <Wifi size={15} /> : <WifiOff size={15} />}{connectionLabel(client.connection)}
        </div>
      </header>

      <main className="room-layout">
        <section className="room-main">
          <div className="room-heading">
            <div>
              <span>{gameNames[room.gameId]} · 私人好友房</span>
              <h1 ref={roomHeadingRef} tabIndex={-1}>{statusText}</h1>
            </div>
            <div className="invite-code" aria-label={`房间邀请码 ${room.code}`}>
              <small>房间邀请码</small><strong>{room.code}</strong>
              <div className="invite-actions" aria-live="polite">
                <button className={`copy-button is-primary ${copiedTarget === 'link' ? 'is-copied' : ''}`} type="button" onClick={() => void copyInvite('link')} aria-label="复制邀请链接">
                  {copiedTarget === 'link' ? <Check size={17} /> : <Link2 size={17} />}{copiedTarget === 'link' ? '链接已复制' : '邀请好友'}
                </button>
                <button className={`copy-button is-code ${copiedTarget === 'code' ? 'is-copied' : ''}`} type="button" onClick={() => void copyInvite('code')} aria-label="复制六位房间码">
                  {copiedTarget === 'code' ? <Check size={15} /> : <Clipboard size={15} />}{copiedTarget === 'code' ? '房间码已复制' : '复制房间码'}
                </button>
              </div>
            </div>
          </div>

          {(room.status === 'paused' || client.connection !== 'online') && (
            <div className="pause-banner" role="status">
              <LoaderCircle size={20} />
              <div>
                <strong>{client.connection !== 'online' ? '正在恢复连接与对局…' : room.pauseReason === 'restart' ? multiplayer ? '服务恢复后等待全员回来' : '服务恢复后等待双方回来' : '好友暂时断线，对局已暂停'}</strong>
                <span>{pauseSeconds === null ? '你的座位和对局状态会保留。' : `${pauseSeconds} 秒内重连即可继续本局。`}</span>
              </div>
            </div>
          )}

          {room.status === 'waiting' && (
            <Reveal className="waiting-reveal" distance={28} key={`waiting-${room.members.length}`}>
              <section className="waiting-panel" aria-labelledby="waiting-title">
                <div className="waiting-emblem"><Link2 /></div>
                <span>FRIEND ROOM</span>
                <h2 id="waiting-title">{room.members.length < 2 ? '把邀请链接发给好友' : multiplayer ? `${room.members.length} 位玩家已入席` : '两位玩家已经到齐'}</h2>
                <p>{multiplayer ? `支持 2–4 人。其他成员准备且全员在线后，房主 ${room.members.find((member) => member.seat === room.hostSeat)?.nickname ?? ''} 点击开始游戏即可开局；每局随机首家。` : room.members.length < 2 ? '好友通过六位邀请码或分享链接加入。房间闲置两小时后自动清理。' : '双方点击准备后立即开局；首局阵营由服务器随机分配。'}</p>
                <div className={`waiting-seats ${multiplayer ? 'is-multiplayer' : ''}`}>
                  {multiplayer ? [0, 1, 2, 3].map((seat) => <PlayerCard key={seat} member={room.members.find((member) => member.seat === seat)} mine={room.mySeat === seat} waitingHost={seat === room.hostSeat} />) : <>
                  <PlayerCard key={room.members.find((member) => member.seat === 0)?.nickname ?? 'empty-0'} member={room.members.find((member) => member.seat === 0)} mine={room.mySeat === 0} />
                  <span>VS</span>
                  <PlayerCard key={room.members.find((member) => member.seat === 1)?.nickname ?? 'empty-1'} member={room.members.find((member) => member.seat === 1)} mine={room.mySeat === 1} />
                  </>}
                </div>
                <ClickSpark className="ready-spark">
                  {multiplayer && isHost ? <button className="ready-button" type="button" disabled={pending || hostStartLabel !== '开始游戏'} onClick={() => void run(client.startRoom, true)}>{pending ? <LoaderCircle size={19} /> : <ShieldCheck size={19} />}{hostStartLabel}</button> : <button className={`ready-button ${me?.ready ? 'is-ready' : ''}`} type="button" disabled={pending || room.members.length < 2 || client.connection !== 'online'} onClick={() => void run(() => client.setReady(!me?.ready))}>
                    {me?.ready ? <><Check size={19} /> 已准备，点击取消</> : <><ShieldCheck size={19} /> 我准备好了</>}
                  </button>}
                </ClickSpark>
              </section>
            </Reveal>
          )}

          {game && room.status !== 'waiting' && (
            <div key={room.roomId} className={`game-stage ${result ? 'has-result' : ''}`}>
              {room.gameId === 'splendor' && <SplendorGame key={game.version} state={game.view as SplendorView} mySeat={room.mySeat} active={canSubmitGameAction} members={room.members} onAction={submitRoomGameAction} availability={availability} actionPending={gameActionPending} />}
              {room.gameId === 'gomoku' && <GomokuGame state={game.view as GomokuState} mySeat={requireBinaryPlayer(room.mySeat)} active={canSubmitGameAction} onAction={submitRoomGameAction} availability={availability} actionPending={gameActionPending} />}
              {room.gameId === 'connect-four' && <ConnectFourGame state={game.view as ConnectFourState} mySeat={requireBinaryPlayer(room.mySeat)} active={canSubmitGameAction} onAction={submitRoomGameAction} availability={availability} actionPending={gameActionPending} />}
              {room.gameId === 'reversi' && <ReversiGame state={game.view as ReversiState} mySeat={requireBinaryPlayer(room.mySeat)} active={canSubmitGameAction} onAction={submitRoomGameAction} availability={availability} actionPending={gameActionPending} />}
              {room.gameId === 'dots-and-boxes' && <DotsAndBoxesGame state={game.view as DotsAndBoxesState} mySeat={requireBinaryPlayer(room.mySeat)} active={canSubmitGameAction} onAction={submitRoomGameAction} availability={availability} actionPending={gameActionPending} />}
              {room.gameId === 'quoridor' && <QuoridorGame state={game.view as QuoridorView} mySeat={requireBinaryPlayer(room.mySeat)} active={canSubmitGameAction} onAction={submitRoomGameAction} availability={availability} actionPending={gameActionPending} />}
              {room.gameId === 'twenty-four' && <TwentyFourGame key={(game.view as TwentyFourView).round} state={game.view as TwentyFourView} mySeat={requireBinaryPlayer(room.mySeat)} active={canSubmitGameAction} serverNowMs={gameClockNow} onAction={submitRoomGameAction} />}
              {room.gameId === 'texas-holdem' && <TexasHoldemGame snapshotVersion={game.version} state={game.view as TexasHoldemView} mySeat={room.mySeat} active={canSubmitGameAction} members={room.members} onAction={submitRoomGameAction} onPresentationLockChange={setPokerPresentationLocked} availability={availability} actionPending={gameActionPending} />}
              {result && (
                <Reveal className="result-reveal" distance={20} key={result}>
                  <div className="result-panel" role="status">
                    <span>GAME COMPLETE</span><h2>{result}</h2>
                    {multiplayer ? <><p>返回等待区后可继续邀请好友，所有人重新准备。</p>{isHost ? <button type="button" disabled={pending || client.connection !== 'online'} onClick={() => void run(client.reopenRoom)}><RotateCcw size={19} /> 保留邀请码，返回等待区</button> : <small>等待房主返回等待区</small>}</> : room.members.length === 2 ? (
                      <>
                        <ClickSpark className="rematch-spark">
                          <button type="button" className={me?.rematchReady ? 'is-ready' : ''} disabled={pending || client.connection !== 'online'} onClick={() => void run(() => client.requestRematch(!me?.rematchReady))} aria-pressed={Boolean(me?.rematchReady)}>
                            <RotateCcw size={19} />
                            <span><strong>{me?.rematchReady ? '已同意再来一局' : '再来一局'}</strong><small>同意人数 {rematchCount}/2</small></span>
                          </button>
                        </ClickSpark>
                        <small>双方确认后自动交换阵营</small>
                      </>
                    ) : <small>好友已离开，本房间无法复赛。</small>}
                  </div>
                </Reveal>
              )}
            </div>
          )}
        </section>

        <aside className="room-sidebar" aria-label="房间信息与操作">
          <section>
            <div className="sidebar-title"><span>座位</span><small>{multiplayer ? '2–4 人房' : '2 人房'}</small></div>
            {multiplayer ? room.members.map((member) => <div key={member.seat}><PlayerCard member={member} mine={member.seat === room.mySeat} waitingHost={room.status === 'waiting' && member.seat === room.hostSeat} />{member.seat === room.hostSeat && room.status !== 'waiting' && <small>房主</small>}</div>) : <>
            <PlayerCard member={me} mine />
            <PlayerCard member={opponent} mine={false} />
            </>}
          </section>
          <section className="room-messages-panel">
            <div className="sidebar-title"><span>房间消息</span><small>最近 100 条</small></div>
            <div className="message-list" ref={messageListRef} onScroll={handleMessageScroll} aria-live="polite" aria-label="房间消息记录">
              {client.messages.length === 0 && <p className="message-empty">说句话，等好友入席。</p>}
              {client.messages.map((message) => (
                <article className={`room-message ${(message.isMine ?? (!multiplayer && message.seat === room.mySeat)) ? 'is-mine' : 'is-theirs'}`} key={message.messageId}>
                  <div><strong>{(message.isMine ?? (!multiplayer && message.seat === room.mySeat)) ? '你' : message.nickname}</strong><time>{new Date(message.sentAtMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
                  <p>{message.content}</p>
                </article>
              ))}
            </div>
            <div className="quick-message-grid" aria-label="快捷表情">
              {quickMessages.map((message) => <button type="button" key={message} disabled={pending || client.connection !== 'online'} onClick={() => void sendMessage(message)} aria-label={`发送 ${message}`}>{message}</button>)}
            </div>
            <form className="message-composer" onSubmit={(event) => { event.preventDefault(); if (messageDraft.trim()) void sendMessage(messageDraft); }}>
              <label htmlFor="room-message-input">发一条消息</label>
              <div>
                <input
                  id="room-message-input"
                  type="text"
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(truncateVisibleCharacters(event.target.value, 100))}
                  disabled={client.connection !== 'online'}
                  placeholder="最多 100 个字"
                  autoComplete="off"
                />
                <button type="submit" disabled={pending || client.connection !== 'online' || messageDraft.trim().length === 0} aria-label="发送消息"><Send size={16} /></button>
              </div>
              <small aria-live="polite">{countVisibleCharacters(messageDraft)} / 100</small>
            </form>
          </section>
          <section className="room-rules-note">
            <ShieldCheck size={18} /><div><strong>{gameNames[room.gameId]}怎么玩</strong><p>{gameInfo?.rules}</p></div>
          </section>
        </aside>
      </main>

      {client.error && <div className="command-toast" role="alert"><strong>{client.error.message}</strong><button type="button" onClick={client.clearError}>知道了</button></div>}
      <div className="message-toasts" aria-live="polite">
        {client.messageToasts.map((item) => <div key={item.id}><strong>{item.nickname}</strong><span>{item.content}</span></div>)}
      </div>

      {confirmAction && (
        <div className="confirm-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !pending) setConfirmAction(null); }}>
          <section ref={confirmDialogRef} tabIndex={-1} className={`confirm-dialog is-${confirmAction}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
            <button className="confirm-close" type="button" onClick={() => setConfirmAction(null)} disabled={pending} aria-label="关闭确认窗口"><X size={18} /></button>
            <div className="confirm-icon">{confirmAction === 'leave' ? <DoorOpen size={27} /> : <TriangleAlert size={27} />}</div>
            <span>{confirmAction === 'leave' ? 'LEAVE TABLE' : 'CONCEDE GAME'}</span>
            <h2 id="confirm-title">{confirmAction === 'leave' ? '确认离开房间？' : '确认认输？'}</h2>
            <p id="confirm-description">
              {multiplayer ? confirmAction === 'leave' ? '离开后返回主界面。进行中的对局会中止，不计胜负；房主离开会将房主身份交给最早入房的在线成员。' : '本局会立即中止，不计胜负。你仍可留在房间查看分数，由房主返回等待区再开。' : confirmAction === 'leave'
                ? (room.status === 'active' || room.status === 'paused' ? '对局尚未结束，现在离开将由服务器判负并返回主界面。' : '离开后将返回主界面；房主离开等待中的房间会关闭房间。')
                : '本局会立即结束并判对手获胜，你仍会留在房间查看结算并可申请复赛。'}
            </p>
            <div className="confirm-actions">
              <button ref={cancelButtonRef} type="button" onClick={() => setConfirmAction(null)} disabled={pending}>再想想</button>
              <button className="is-danger" type="button" onClick={() => void confirmOperation()} disabled={pending}>
                {pending ? <LoaderCircle className="spin" size={17} /> : confirmAction === 'leave' ? <LogOut size={17} /> : <Flag size={17} />}
                {confirmAction === 'leave' ? '确认离开' : '确认认输'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
