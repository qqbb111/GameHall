import { Check, Clipboard, DoorOpen, Link2, LoaderCircle, LogOut, RotateCcw, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { GomokuState, QuoridorView, TwentyFourView } from '@gamehall/game-core';
import type { GameId, Reaction, RoomMemberView } from '@gamehall/protocol';
import type { GameHallClient } from './gamehall-client';
import { GomokuGame, QuoridorGame, TwentyFourGame } from './game-components';
import { resultMessage } from './room-result';

const gameNames: Record<GameId, string> = {
  gomoku: '五子棋',
  quoridor: '路墙棋',
  'twenty-four': '24 点速度对决',
};

const reactionOptions: Reaction[] = ['👍', '👏', '😄', '🤔'];

function connectionLabel(connection: GameHallClient['connection']): string {
  if (connection === 'online') return '连接正常';
  if (connection === 'connecting') return '正在重连';
  return '连接中断';
}

function PlayerCard({ member, mine }: { member: RoomMemberView | undefined; mine: boolean }) {
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
        <small>{member.online ? member.ready ? '在线 · 已准备' : '在线 · 未准备' : '暂时离线'}</small>
      </div>
      <i aria-label={member.online ? '在线' : '离线'} />
    </div>
  );
}

export function RoomPage({ client }: { client: GameHallClient }) {
  const { room, game } = client;
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(room?.serverTimeMs ?? 0);
  const [gameClockNow, setGameClockNow] = useState(room?.serverTimeMs ?? 0);

  useEffect(() => {
    const anchorServerMs = room?.serverTimeMs;
    if (anchorServerMs === undefined) return undefined;
    const anchorMonotonicMs = performance.now();
    const timer = window.setInterval(() => {
      setNow(anchorServerMs + performance.now() - anchorMonotonicMs);
    }, 200);
    return () => window.clearInterval(timer);
  }, [room?.serverTimeMs]);

  const me = room?.members.find((member) => member.seat === room.mySeat);
  const opponent = room?.members.find((member) => member.seat !== room.mySeat);
  const inviteUrl = room ? `${window.location.origin}${window.location.pathname}?room=${room.code}` : '';
  const result = room && game ? resultMessage(room.gameId, game.view, room.mySeat) : null;
  const pauseDeadline = room?.pauseReason === 'restart'
    ? room.restartDeadlineMs
    : room?.members.find((member) => !member.online)?.disconnectDeadlineMs;
  const pauseSeconds = pauseDeadline ? Math.max(0, Math.ceil((pauseDeadline - now) / 1000)) : null;
  const canPlay = room?.status === 'active' && client.connection === 'online';
  useEffect(() => {
    const anchorServerMs = game?.serverTimeMs ?? room?.serverTimeMs;
    if (anchorServerMs === undefined) return undefined;
    if (!canPlay) {
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
  }, [canPlay, game?.serverTimeMs, room?.serverTimeMs, room?.status]);
  const rematchCount = room?.members.filter((member) => member.rematchReady).length ?? 0;
  const statusText = useMemo(() => {
    if (!room) return '';
    if (room.status === 'waiting') return room.members.length < 2 ? '等待好友加入' : '等待双方准备';
    if (room.status === 'paused') return '对局暂停';
    if (room.status === 'finished') return '本局结束';
    return '对局进行中';
  }, [room]);

  if (!room) return null;
  const currentRoom = room;

  async function run(operation: () => Promise<unknown>) {
    setPending(true);
    try { await operation(); } finally { setPending(false); }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      window.prompt('复制下面的邀请链接', inviteUrl);
    }
  }

  async function leaveRoom() {
    const warning = currentRoom.status === 'active' || currentRoom.status === 'paused'
      ? '现在离开将判负，确定离开房间吗？'
      : '确定离开这个房间吗？';
    if (window.confirm(warning)) await run(client.leaveRoom);
  }

  async function resign() {
    if (window.confirm('确定认输并结束本局吗？')) await run(() => client.submitGameAction({ type: 'resign' }));
  }

  return (
    <div className="room-shell">
      <header className="room-topbar">
        <div className="brand" aria-label="GameHall 好友棋牌桌游馆">
          <span className="brand-mark"><span /></span>
          <span><strong>GameHall</strong><small>好友棋牌桌游馆</small></span>
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
              <h1>{statusText}</h1>
            </div>
            <div className="invite-code" aria-label={`房间邀请码 ${room.code}`}>
              <small>房间邀请码</small><strong>{room.code}</strong>
              <button type="button" onClick={() => void copyInvite()} aria-label="复制邀请链接">
                {copied ? <Check size={17} /> : <Clipboard size={17} />}{copied ? '已复制' : '邀请好友'}
              </button>
            </div>
          </div>

          {(room.status === 'paused' || client.connection !== 'online') && (
            <div className="pause-banner" role="status">
              <LoaderCircle size={20} />
              <div>
                <strong>{client.connection !== 'online' ? '正在恢复连接与权威棋盘…' : room.pauseReason === 'restart' ? '服务恢复后等待双方回来' : '好友暂时断线，对局已暂停'}</strong>
                <span>{pauseSeconds === null ? '你的座位和对局状态会保留。' : `${pauseSeconds} 秒内重连即可继续本局。`}</span>
              </div>
            </div>
          )}

          {room.status === 'waiting' && (
            <section className="waiting-panel" aria-labelledby="waiting-title">
              <div className="waiting-emblem"><Link2 /></div>
              <span>FRIEND ROOM</span>
              <h2 id="waiting-title">{room.members.length < 2 ? '把邀请链接发给好友' : '两位玩家已经到齐'}</h2>
              <p>{room.members.length < 2 ? '好友通过六位邀请码或分享链接加入。房间闲置两小时后自动清理。' : '双方点击准备后立即开局；首局阵营由服务器随机分配。'}</p>
              <div className="waiting-seats">
                <PlayerCard member={room.members.find((member) => member.seat === 0)} mine={room.mySeat === 0} />
                <span>VS</span>
                <PlayerCard member={room.members.find((member) => member.seat === 1)} mine={room.mySeat === 1} />
              </div>
              <button className={`ready-button ${me?.ready ? 'is-ready' : ''}`} type="button" disabled={pending || room.members.length < 2 || client.connection !== 'online'} onClick={() => void run(() => client.setReady(!me?.ready))}>
                {me?.ready ? <><Check size={19} /> 已准备，点击取消</> : <><ShieldCheck size={19} /> 我准备好了</>}
              </button>
            </section>
          )}

          {game && room.status !== 'waiting' && (
            <>
              {room.gameId === 'gomoku' && <GomokuGame state={game.view as GomokuState} mySeat={room.mySeat} active={canPlay} onAction={client.submitGameAction} />}
              {room.gameId === 'quoridor' && <QuoridorGame state={game.view as QuoridorView} mySeat={room.mySeat} active={canPlay} onAction={client.submitGameAction} />}
              {room.gameId === 'twenty-four' && <TwentyFourGame key={(game.view as TwentyFourView).round} state={game.view as TwentyFourView} mySeat={room.mySeat} active={canPlay} serverNowMs={gameClockNow} onAction={client.submitGameAction} />}
              {result && (
                <div className="result-panel" role="status">
                  <span>GAME COMPLETE</span><h2>{result}</h2>
                  {room.members.length === 2 ? (
                    <>
                      <button type="button" className={me?.rematchReady ? 'is-ready' : ''} disabled={pending || client.connection !== 'online'} onClick={() => void run(() => client.requestRematch(!me?.rematchReady))}>
                        <RotateCcw size={18} />{me?.rematchReady ? `已申请复赛（${rematchCount}/2）` : '再来一场'}
                      </button>
                      <small>双方确认后自动交换阵营</small>
                    </>
                  ) : <small>好友已离开，本房间无法复赛。</small>}
                </div>
              )}
            </>
          )}
        </section>

        <aside className="room-sidebar" aria-label="房间信息与操作">
          <section>
            <div className="sidebar-title"><span>座位</span><small>2 人房</small></div>
            <PlayerCard member={me} mine />
            <PlayerCard member={opponent} mine={false} />
          </section>
          <section>
            <div className="sidebar-title"><span>快捷表情</span><small>仅固定表情</small></div>
            <div className="reaction-grid">
              {reactionOptions.map((reaction) => <button type="button" key={reaction} disabled={client.connection !== 'online'} onClick={() => void client.sendReaction(reaction)} aria-label={`发送 ${reaction}`}>{reaction}</button>)}
            </div>
          </section>
          <section className="room-rules-note">
            <ShieldCheck size={18} /><div><strong>服务端权威判定</strong><p>所有回合、规则和胜负都由服务器校验，断线恢复时以最新快照为准。</p></div>
          </section>
          <div className="sidebar-actions">
            {(room.status === 'active' || room.status === 'paused') && <button type="button" onClick={() => void resign()} disabled={pending || client.connection !== 'online'}><LogOut size={16} />认输</button>}
            <button type="button" onClick={() => void leaveRoom()} disabled={pending || client.connection !== 'online'}><DoorOpen size={16} />离开房间</button>
          </div>
        </aside>
      </main>

      {client.error && <div className="command-toast" role="alert"><strong>{client.error.message}</strong><button type="button" onClick={client.clearError}>知道了</button></div>}
      <div className="reaction-toasts" aria-live="polite">
        {client.reactions.map((item) => <div key={item.id}><span>{item.reaction}</span><strong>{item.nickname}</strong></div>)}
      </div>
    </div>
  );
}
