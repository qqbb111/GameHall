import {
  ArrowRight,
  CircleDot,
  DoorOpen,
  Grid3X3,
  LockKeyhole,
  Play,
  Sparkles,
  Timer,
  Users,
} from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { GameId } from '@gamehall/protocol';
import type { GameHallClient } from './gamehall-client';
import { games, type GameCardInfo } from './games';

function GameGlyph({ kind }: { kind: GameCardInfo['icon'] }) {
  if (kind === 'gomoku') {
    return <div className="mini-board" aria-hidden="true"><i className="mini-stone black" /><i className="mini-stone white" /><i className="mini-stone black second" /></div>;
  }
  if (kind === 'twenty-four') {
    return <div className="mini-card" aria-hidden="true"><strong>24</strong><span>♠</span></div>;
  }
  if (kind === 'quoridor') return <Grid3X3 aria-hidden="true" />;
  if (kind === 'go') return <CircleDot aria-hidden="true" />;
  return <span className="suit-glyph" aria-hidden="true">♣</span>;
}

function sanitizeCode(value: string): string {
  return value.toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '').slice(0, 6);
}

export function HomePage({ client }: { client: GameHallClient }) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState(() => {
    const queryCode = sanitizeCode(new URLSearchParams(window.location.search).get('room') ?? '');
    return queryCode || client.session?.reconnectableRoomCode || '';
  });
  const [selectedGame, setSelectedGame] = useState<GameId>('gomoku');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const gameButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const onlineGames = useMemo(() => games.filter((game) => game.status === 'online'), []);
  const selected = useMemo(() => games.find((game) => game.id === selectedGame)!, [selectedGame]);

  function handleGameKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % onlineGames.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + onlineGames.length) % onlineGames.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = onlineGames.length - 1;
    else return;
    event.preventDefault();
    setSelectedGame(onlineGames[next]!.id as GameId);
    gameButtons.current[next]?.focus();
  }

  async function createRoom() {
    if (!nickname.trim()) return setFormError('请先填写昵称');
    setPending(true);
    setFormError(null);
    const result = await client.createRoom(nickname, selectedGame);
    if (!result.ok) setFormError(result.error.message);
    setPending(false);
  }

  async function joinRoom() {
    if (!nickname.trim()) return setFormError('请先填写昵称');
    if (roomCode.length !== 6) return setFormError('请输入完整的 6 位邀请码');
    setPending(true);
    setFormError(null);
    const result = await client.joinRoom(nickname, roomCode);
    if (!result.ok) setFormError(result.error.message);
    setPending(false);
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="GameHall 首页">
          <span className="brand-mark"><span /></span>
          <span><strong>GameHall</strong><small>好友棋牌桌游馆</small></span>
        </a>
        <div className="topbar-note"><LockKeyhole size={15} /> 私人好友房 · 纯娱乐</div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={15} /> 今晚，和朋友开一局</div>
            <h1>棋逢对手，<br /><em>刚好有空。</em></h1>
            <p>无需注册，一个邀请码就能坐上牌桌。规则清楚、操作顺手，让胜负留在棋盘上。</p>
            <div className="trust-row">
              <span><Users size={16} /> 双人好友房</span>
              <span><Timer size={16} /> 断线 60 秒重连</span>
              <span><LockKeyhole size={16} /> 无充值与筹码</span>
            </div>
          </div>

          <form className="entry-card" aria-label="创建或加入房间" onSubmit={(event) => { event.preventDefault(); void createRoom(); }}>
            <div className="entry-head">
              <div><span>快速开局</span><h2>先取个响亮的名字</h2></div>
              <button className={`online-pill ${client.connection !== 'online' ? 'is-offline' : ''}`} type="button" onClick={client.reconnect} disabled={client.connection === 'online'} aria-live="polite">
                <i />{client.connection === 'online' ? '服务在线' : client.connection === 'connecting' ? '正在连接' : '连接中断'}
              </button>
            </div>

            <label className="field-label" htmlFor="nickname">你的昵称</label>
            <input id="nickname" value={nickname} maxLength={256} onChange={(event) => setNickname(event.target.value)} placeholder="例如：落子无悔" autoComplete="nickname" />

            <label className="field-label" id="game-select-label">选择游戏</label>
            <div className="game-pills" role="radiogroup" aria-labelledby="game-select-label">
              {onlineGames.map((game, index) => (
                <button ref={(element) => { gameButtons.current[index] = element; }} className={selectedGame === game.id ? 'active' : ''} key={game.id} onClick={() => setSelectedGame(game.id as GameId)} onKeyDown={(event) => handleGameKey(event, index)} type="button" role="radio" aria-checked={selectedGame === game.id} tabIndex={selectedGame === game.id ? 0 : -1}>{game.name}</button>
              ))}
            </div>

            <button className="primary-button" type="submit" disabled={pending || client.connection !== 'online'}>
              <Play size={18} fill="currentColor" />创建 {selected.name} 房间<ArrowRight size={18} />
            </button>

            <div className="divider"><span>或使用邀请码</span></div>
            <div className="join-row">
              <input aria-label="六位房间邀请码" className="code-input" value={roomCode} maxLength={6} onChange={(event) => setRoomCode(sanitizeCode(event.target.value))} onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                event.stopPropagation();
                void joinRoom();
              }} placeholder="输入 6 位码" autoCapitalize="characters" spellCheck={false} />
              <button className="secondary-button" type="button" onClick={() => void joinRoom()} disabled={pending || client.connection !== 'online'}><DoorOpen size={18} /> 加入房间</button>
            </div>
            {(formError || client.error) && <p className="form-error" role="alert">{formError ?? client.error?.message}</p>}
          </form>
        </section>

        <section className="catalog" aria-labelledby="catalog-title">
          <div className="section-heading">
            <div><span>GAME TABLES</span><h2 id="catalog-title">今晚玩什么？</h2></div>
            <p>三款游戏已就位，其余玩法将在规则确认后逐一开放。</p>
          </div>
          <div className="game-grid">
            {games.map((game) => (
              <article className={`game-card ${game.status === 'soon' ? 'is-soon' : ''}`} key={game.id}>
                <div className={`game-art accent-${game.accent}`}><GameGlyph kind={game.icon} /></div>
                <div className="game-info">
                  <div className="status-line"><span className={game.status === 'online' ? 'status-live' : 'status-soon'}>{game.status === 'online' ? '可开局 · 2 人' : '开发中'}</span></div>
                  <h3>{game.name}</h3><p>{game.subtitle}</p>
                </div>
                <button type="button" aria-label={game.status === 'online' ? `选择${game.name}` : `${game.name}尚未开放`} disabled={game.status === 'soon'} onClick={() => { setSelectedGame(game.id as GameId); document.querySelector('.entry-card')?.scrollIntoView({ behavior: 'smooth' }); }}>
                  {game.status === 'online' ? <ArrowRight size={18} /> : <LockKeyhole size={16} />}
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer><span>GameHall</span><p>好友相聚，胜负有度。本站仅提供纯娱乐对局。</p></footer>
    </div>
  );
}
