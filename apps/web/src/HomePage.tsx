import {
  ArrowRight,
  CircleDot,
  Dices,
  DoorOpen,
  LockKeyhole,
  Play,
  Timer,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GameId } from '@gamehall/protocol';
import { readRememberedNickname } from './client-preferences';
import type { GameHallClient } from './gamehall-client';
import { games, type GameCardInfo } from './games';
import { ClickSpark, Reveal, SpotlightSurface } from './motion-primitives';
import { generateRandomNickname } from './random-nickname';
import { parseRoomCodeInput, removeRoomQueryFromAddress } from './room-code';

function GameGlyph({ kind }: { kind: GameCardInfo['icon'] }) {
  if (kind === 'gomoku') {
    return (
      <div className="gameplay-effect effect-gomoku" aria-hidden="true">
        <div className="mini-board">
          <span className="gomoku-win-guide" />
          {Array.from({ length: 5 }, (_, index) => <i className={`winning-stone stone-${index + 1}`} key={index} />)}
          <span className="gomoku-win-pulse" />
        </div>
      </div>
    );
  }
  if (kind === 'twenty-four') {
    return (
      <div className="gameplay-effect effect-twenty-four" aria-hidden="true">
        <span className="calculation-ring" />
        <div className="calculation-cards">
          {Array.from({ length: 4 }, (_, index) => <i className={`calculation-card card-${index + 1}`} key={index}>6</i>)}
          <strong className="calculation-result">24</strong>
        </div>
      </div>
    );
  }
  if (kind === 'quoridor') {
    return (
      <div className="gameplay-effect effect-quoridor" aria-hidden="true">
        <div className="mini-quoridor">
          {Array.from({ length: 16 }, (_, index) => <i key={index} />)}
          <span className="quoridor-route route-one" />
          <span className="quoridor-route route-two" />
          <span className="quoridor-route route-three" />
          <span className="mini-quoridor-pawn is-dark" />
          <span className="mini-quoridor-pawn is-light" />
          <b className="quoridor-wall" />
        </div>
      </div>
    );
  }
  if (kind === 'go') return <CircleDot aria-hidden="true" />;
  return <span className="suit-glyph" aria-hidden="true">♣</span>;
}

function HeroEditorial() {
  return (
    <div className="editorial-art" aria-hidden="true">
      <span className="editorial-aurora" />
      <span className="cinematic-beam beam-one" />
      <span className="cinematic-beam beam-two" />
      <div className="cinematic-particles">
        {Array.from({ length: 7 }, (_, index) => <i className={`particle-${index + 1}`} key={index} />)}
      </div>
      <div className="grand-board cinematic-board">
        <span className="grand-board-depth" />
        <span className="grand-board-edge" />
        <span className="grand-board-glow" />
        <span className="grand-board-trail trail-one" />
        <span className="grand-board-trail trail-two" />
        <i className="grand-stone is-dark is-first" />
        <i className="grand-stone is-dark is-second" />
        <i className="grand-stone is-light" />
      </div>
    </div>
  );
}

const HERO_TITLE = '棋逢对手，刚好有空。';
const HERO_TITLE_LINES = ['棋逢对手，', '刚好有空。'] as const;

type HeroTitleStyle = CSSProperties & {
  '--char-delay': string;
  '--char-origin': string;
};

function CinematicHeroTitle() {
  let characterIndex = 0;
  const center = (HERO_TITLE.length - 1) / 2;

  return (
    <h1 className="cinematic-title" aria-label={HERO_TITLE}>
      {HERO_TITLE_LINES.map((line, lineIndex) => (
        <span className={`hero-title-line${lineIndex === 1 ? ' is-gold' : ''}`} aria-hidden="true" key={line}>
          {Array.from(line, (character) => {
            const index = characterIndex++;
            const distanceFromCenter = Math.abs(index - center);
            const style: HeroTitleStyle = {
              '--char-delay': `${330 + distanceFromCenter * 82}ms`,
              '--char-origin': index < center ? '42px' : '-42px',
            };
            return <span className="hero-title-char" style={style} key={`${character}-${index}`}>{character}</span>;
          })}
        </span>
      ))}
    </h1>
  );
}

function ConnectingNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 1_200);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return <div className="connection-notice" role="status"><span><i />正在连接实时服务</span></div>;
}

export function HomePage({ client }: { client: GameHallClient }) {
  const [nickname, setNickname] = useState(readRememberedNickname);
  const [roomCode, setRoomCode] = useState(() => {
    const queryCode = parseRoomCodeInput(window.location.search);
    return queryCode || client.session?.reconnectableRoomCode || '';
  });
  const [pendingGameId, setPendingGameId] = useState<GameId | null>(null);
  const [joinPending, setJoinPending] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const identityPanel = useRef<HTMLDivElement>(null);
  const nicknameInput = useRef<HTMLInputElement>(null);
  const onlineGames = useMemo(() => games.filter((game) => game.status === 'online'), []);
  const comingGames = useMemo(() => games.filter((game) => game.status === 'soon'), []);

  function requestNickname() {
    setNicknameError('先留下昵称，再选择一张桌开局');
    identityPanel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    nicknameInput.current?.focus();
  }

  function randomizeNickname() {
    setNickname((current) => generateRandomNickname(current));
    setNicknameError(null);
  }

  async function createRoom(gameId: GameId) {
    const cleanNickname = nickname.trim();
    if (!cleanNickname) return requestNickname();
    setPendingGameId(gameId);
    setNicknameError(null);
    setCreateError(null);
    const result = await client.createRoom(cleanNickname, gameId);
    if (!result.ok) setCreateError(result.error.message);
    else removeRoomQueryFromAddress();
    setPendingGameId(null);
  }

  async function joinRoom() {
    const cleanNickname = nickname.trim();
    if (!cleanNickname) return requestNickname();
    if (roomCode.length !== 6) return setJoinError('请输入完整的 6 位邀请码');
    setJoinPending(true);
    setNicknameError(null);
    setJoinError(null);
    const result = await client.joinRoom(cleanNickname, roomCode);
    if (!result.ok) setJoinError(result.error.message);
    else removeRoomQueryFromAddress();
    setJoinPending(false);
  }

  return (
    <div className="site-shell">
      <div className="ambient-backdrop" aria-hidden="true">
        <span className="ambient-orb ambient-orb-jade" />
        <span className="ambient-orb ambient-orb-gold" />
        <span className="ambient-ribbon" />
        <span className="ambient-grain" />
      </div>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="GameHall 首页">
          <span className="brand-mark"><span /></span>
          <span><strong>GameHall</strong><small>好友棋牌桌游馆</small></span>
        </a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <Reveal className="hero-kicker" delayMs={1_050} distance={16} respectReducedMotion={false}>
              <div className="eyebrow">今晚，和朋友开一局</div>
            </Reveal>
            <CinematicHeroTitle />
            <Reveal delayMs={1_180} distance={26} respectReducedMotion={false}>
              <p className="hero-description">无需注册，一个邀请码就能坐上牌桌。规则清楚、操作顺手，让胜负留在棋盘上。</p>
            </Reveal>
            <Reveal delayMs={1_310} distance={20} respectReducedMotion={false}>
              <div className="trust-row">
                <span><Users size={16} /> 双人好友房</span>
                <span><Timer size={16} /> 断线 60 秒重连</span>
                <span><LockKeyhole size={16} /> 无充值与筹码</span>
              </div>
            </Reveal>
          </div>

          <Reveal className="hero-editorial-reveal" delayMs={150} distance={34} respectReducedMotion={false}>
            <div className="hero-editorial">
              <HeroEditorial />
              <div className="identity-panel" ref={identityPanel}>
                <div className="identity-heading"><span>YOUR NAME</span><h2>先取个响亮的名字</h2><p>留下称呼，再从下方挑一张桌。</p></div>
                <label className="field-label" htmlFor="nickname">你的昵称</label>
                <div className="nickname-row">
                  <button className="nickname-random" type="button" onClick={randomizeNickname} aria-label="随机昵称" title="换一个雅致昵称">
                    <Dices size={19} />
                  </button>
                  <input ref={nicknameInput} id="nickname" value={nickname} maxLength={256} onChange={(event) => { setNickname(event.target.value); setNicknameError(null); }} placeholder="例如：落子无悔" autoComplete="nickname" />
                </div>
                {nicknameError && <p className="identity-error" role="alert">{nicknameError}</p>}
              </div>
            </div>
          </Reveal>
        </section>

        <section className="catalog" aria-labelledby="catalog-title">
          <Reveal distance={22} respectReducedMotion={false}>
            <div className="section-heading">
              <div><span>FEATURED TABLES</span><h2 id="catalog-title">今晚玩什么？</h2></div>
              <p>三张桌已经亮灯。选一局，把邀请码发给你的对手。</p>
            </div>
          </Reveal>

          {client.connection === 'connecting' && <ConnectingNotice />}
          {client.connection === 'offline' && (
            <div className="connection-notice" role="status">
              <span><i />{client.error?.message ?? '实时服务连接中断'}</span>
              <button type="button" onClick={client.reconnect}>重新连接</button>
            </div>
          )}

          <Reveal className="invite-strip-reveal" delayMs={50} distance={20} respectReducedMotion={false}>
            <form className="invite-strip" aria-label="加入好友房" onSubmit={(event) => { event.preventDefault(); void joinRoom(); }}>
              <div className="invite-copy"><DoorOpen size={19} /><span><strong>已有房间？</strong><small>带上邀请码入席</small></span></div>
              <div className="invite-entry">
                <input aria-label="六位房间邀请码" aria-description="也可以粘贴完整邀请链接" className="code-input" value={roomCode} onChange={(event) => { setRoomCode(parseRoomCodeInput(event.target.value)); setJoinError(null); }} placeholder="房间码或邀请链接" autoCapitalize="characters" spellCheck={false} />
                <button className="secondary-button" type="submit" disabled={joinPending || pendingGameId !== null || client.connection !== 'online'}>{joinPending ? '正在入席' : '加入房间'}<ArrowRight size={17} /></button>
              </div>
              {joinError && <p className="invite-error" role="alert">{joinError}</p>}
            </form>
          </Reveal>

          {createError && <p className="catalog-error" role="alert">{createError}</p>}
          <div className="featured-grid">
            {onlineGames.map((game, index) => (
              <Reveal className="game-card-reveal" delayMs={index * 85} distance={36} key={game.id} respectReducedMotion={false}>
                <ClickSpark className="featured-spark" respectReducedMotion={false}>
                  <SpotlightSurface className="game-card-surface" color="rgba(240, 206, 139, 0.28)" tilt respectReducedMotion={false}>
                    <article className="game-card featured-card">
                      <div className="game-number">0{index + 1}</div>
                      <div className={`game-art accent-${game.accent}`}><span className="game-art-orbit" aria-hidden="true" /><GameGlyph kind={game.icon} /></div>
                    <div className="game-info">
                      <div className="status-line"><span className="status-live">可开局 · 2 人</span></div>
                      <h3>{game.name}</h3><p>{game.subtitle}</p>
                    </div>
                    <button type="button" aria-label={`创建${game.name}房间`} disabled={pendingGameId !== null || joinPending || client.connection !== 'online'} onClick={() => void createRoom(game.id as GameId)}>
                      <Play size={13} fill="currentColor" /><span>{pendingGameId === game.id ? '正在开桌' : '立即开局'}</span><ArrowRight size={18} />
                    </button>
                  </article>
                  </SpotlightSurface>
                </ClickSpark>
              </Reveal>
            ))}
          </div>

          <Reveal className="coming-reveal" delayMs={120} distance={22} respectReducedMotion={false}>
            <div className="coming-heading"><div><span>COMING SOON</span><h3>新玩法即将入席</h3></div><p>规则确认后逐一开放</p></div>
            <div className="coming-grid">
              {comingGames.map((game) => (
                <article className="coming-card" key={game.id}>
                  <div className={`coming-icon accent-${game.accent}`}><GameGlyph kind={game.icon} /></div>
                  <div><span className="coming-status">开发中</span><strong>{game.name}</strong><small>{game.subtitle}</small></div>
                  <button type="button" aria-label={`${game.name}尚未开放`} disabled><LockKeyhole size={15} /></button>
                </article>
              ))}
            </div>
          </Reveal>
        </section>
      </main>
      <footer><span>GameHall</span><p>好友相聚，胜负有度。本站仅提供纯娱乐对局。</p></footer>
    </div>
  );
}
