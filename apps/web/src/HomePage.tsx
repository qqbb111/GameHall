import {
  ArrowRight,
  CircleDot,
  Dices,
  DoorOpen,
  Heart,
  LockKeyhole,
  Search,
  Shuffle,
  Timer,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { GameId } from '@gamehall/protocol';
import type { SoloGameId } from './solo-ai';
import { readSoloProgress, soloProgressKey } from './solo-progress';
import { readFavoriteGames, readRememberedNickname, rememberFavoriteGames } from './client-preferences';
import type { GameHallClient } from './gamehall-client';
import { games, type GameCardInfo } from './games';
import { ClickSpark, Reveal, SpotlightSurface } from './motion-primitives';
import { generateRandomNickname } from './random-nickname';
import { parseRoomCodeInput, removeRoomQueryFromAddress } from './room-code';
import { GemMark } from './GemMark';
import './splendor.css';
import './board-games.css';

function GameGlyph({ kind }: { kind: GameCardInfo['icon'] }) {
  if (kind === 'connect-four') return <div className="home-four" aria-hidden="true">{[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0].map((value,index)=><i key={index} className={value ? 'coral' : 'gold'} />)}</div>;
  if (kind === 'reversi') return <div className="home-reversi" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} className={index === 5 || index === 10 ? 'white' : index === 6 || index === 9 ? 'black' : ''} />)}</div>;
  if (kind === 'dots-and-boxes') return <svg className="home-dots" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><path d="M15 15H105V105H15V15M45 15V105M75 15V105M15 45H105M15 75H105" /><rect x="16" y="16" width="28" height="28" /><rect x="46" y="46" width="28" height="28" /><circle cx="15" cy="15" r="4" /><circle cx="45" cy="15" r="4" /><circle cx="75" cy="15" r="4" /><circle cx="105" cy="15" r="4" /><circle cx="15" cy="45" r="4" /><circle cx="105" cy="45" r="4" /><circle cx="15" cy="75" r="4" /><circle cx="105" cy="75" r="4" /><circle cx="15" cy="105" r="4" /><circle cx="45" cy="105" r="4" /><circle cx="75" cy="105" r="4" /><circle cx="105" cy="105" r="4" /></svg>;
  if (kind === 'splendor') return <div className="splendor-home-gems" data-motion="hover-replay" aria-hidden="true">
    <svg className="splendor-gem-aura" viewBox="0 0 240 160" focusable="false"><ellipse cx="120" cy="87" rx="100" ry="48" /><ellipse cx="120" cy="87" rx="82" ry="37" /><path d="M120 2V25M120 139V158M8 87H28M212 87H232M34 25L50 40M190 134L208 150M205 24L188 40M30 150L48 134" /></svg>
    <span className="splendor-gem-dust">{Array.from({ length: 6 }, (_, index) => <i key={index} style={{ '--spark-index': index } as CSSProperties} />)}</span>
    <GemMark color="blue" detailed /><GemMark color="green" detailed /><GemMark color="gold" detailed />
  </div>;
  if (kind === 'gomoku') {
    return (
      <div className="gameplay-effect effect-gomoku" aria-hidden="true">
        <div className="mini-board">
          <svg className="gomoku-grid" viewBox="0 0 89 89" focusable="false">{Array.from({ length: 5 }, (_, index) => { const position = 14.5 + index * 15; return <path key={index} d={`M14.5 ${position}H74.5M${position} 14.5V74.5`} />; })}</svg>
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
          {['♠', '♥', '♣', '♦'].map((suit, index) => <i className={`calculation-card card-${index + 1} ${index % 2 ? 'is-red' : 'is-black'}`} key={suit} data-suit={suit}>
            <span className="mini-card-corner">6<span>{suit}</span></span>
            <span className="mini-card-pips">{Array.from({ length: 6 }, (_, pip) => <span key={pip}>{suit}</span>)}</span>
            <span className="mini-card-corner is-bottom">6<span>{suit}</span></span>
          </i>)}
        </div>
        <strong className="calculation-result">24</strong>
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
  if (kind === 'texas-holdem') {
    return (
      <div className="gameplay-effect effect-poker" data-motion="hover-replay" data-community-cards="5" aria-hidden="true">
        <div className="mini-poker-table">
          <span className="mini-poker-table-line" />
          <span className="mini-poker-pot"><i className="mini-chip chip-gold" /><i className="mini-chip chip-red" /><i className="mini-chip chip-blue" /></span>
          <span className="mini-poker-hole hole-one">A<small>♠</small></span>
          <span className="mini-poker-hole hole-two">K<small>♠</small></span>
          <span className="mini-poker-community">
            {['4♥', '2♣', 'Q♠', 'J♠', '10♠'].map((label, index) => <span className={`mini-poker-board board-${index + 1} ${index >= 2 ? 'is-royal-card' : 'is-base-card'}`} key={label}><b>{label.slice(0, -1)}</b><small>{label.slice(-1)}</small></span>)}
          </span>
          <span className="mini-poker-win-burst">{Array.from({ length: 8 }, (_, index) => <i key={index} style={{ '--burst-index': index } as CSSProperties} />)}</span>
          <strong className="mini-poker-win">皇家同花顺</strong>
        </div>
      </div>
    );
  }
  if (kind === 'go') return <CircleDot aria-hidden="true" />;
  return <span className="suit-glyph" aria-hidden="true">♣</span>;
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
    <h1 className="cinematic-title" aria-label={HERO_TITLE} tabIndex={-1}>
      {HERO_TITLE_LINES.map((line, lineIndex) => (
        <span className={`hero-title-line${lineIndex === 1 ? ' is-gold' : ''}`} aria-hidden="true" key={line}>
          {Array.from(line, (character) => {
            const index = characterIndex++;
            const distanceFromCenter = Math.abs(index - center);
            const style: HeroTitleStyle = {
              '--char-delay': `${80 + distanceFromCenter * 28}ms`,
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

function durationLabel(game: GameCardInfo): string {
  return game.duration?.includes('分钟') ? `约 ${game.duration}` : game.duration ?? '';
}

function validNickname(value: string): boolean {
  const count = [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value.trim())].length;
  return count >= 1 && count <= 16;
}

type PracticeSummary = Record<SoloGameId, 'none' | 'active' | 'finished'>;

function readPracticeSummary(gameId: SoloGameId): PracticeSummary[SoloGameId] {
  const saved = readSoloProgress(gameId);
  return saved.kind === 'valid' ? saved.progress.state.phase === 'finished' ? 'finished' : 'active' : 'none';
}

function practiceButtonLabel(summary: PracticeSummary[SoloGameId]): string {
  return summary === 'finished' ? '查看上局练习' : summary === 'active' ? '继续练习' : '和电脑练习';
}

export function HomePage({ client, onPractice }: { client: GameHallClient; onPractice?: (gameId: SoloGameId) => void }) {
  const [practiceSaves, setPracticeSaves] = useState<PracticeSummary>(() => ({ 'connect-four': readPracticeSummary('connect-four'), reversi: readPracticeSummary('reversi') }));
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
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'quick' | 'strategy' | 'party' | 'favorites'>('all');
  const [favorites, setFavorites] = useState(readFavoriteGames);
  const [selectedRules, setSelectedRules] = useState<GameCardInfo | null>(null);
  const [suggestedId, setSuggestedId] = useState<GameId | null>(null);
  const identityPanel = useRef<HTMLDivElement>(null);
  const nicknameInput = useRef<HTMLInputElement>(null);
  const catalogSection = useRef<HTMLElement>(null);
  const ruleDialog = useRef<HTMLDivElement>(null);
  const ruleTrigger = useRef<HTMLElement | null>(null);
  const restoreRuleFocus = useRef(true);
  const onlineGames = useMemo(() => games.filter((game) => game.status === 'online'), []);
  const comingGames = useMemo(() => games.filter((game) => game.status === 'soon'), []);
  const visibleGames = onlineGames.filter((game) => {
    const matchesSearch = `${game.name} ${game.subtitle}`.toLocaleLowerCase('zh-CN').includes(search.trim().toLocaleLowerCase('zh-CN'));
    const matchesFilter = filter === 'all' || filter === 'favorites' && favorites.includes(game.id) || filter !== 'favorites' && game.categories?.includes(filter);
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    const refresh = (gameId?: SoloGameId) => setPracticeSaves((current) => {
      const next = gameId ? { ...current, [gameId]: readPracticeSummary(gameId) }
        : { 'connect-four': readPracticeSummary('connect-four'), reversi: readPracticeSummary('reversi') };
      return next['connect-four'] === current['connect-four'] && next.reversi === current.reversi ? current : next;
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key === null) refresh();
      else if (event.key === soloProgressKey('connect-four')) refresh('connect-four');
      else if (event.key === soloProgressKey('reversi')) refresh('reversi');
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!selectedRules) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = document.querySelector<HTMLElement>('.site-shell');
    background?.setAttribute('inert', '');
    ruleDialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSelectedRules(null); }
      if (event.key !== 'Tab') return;
      const buttons = [...(ruleDialog.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      if (!buttons.length) return;
      const first = buttons[0]!, last = buttons[buttons.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; background?.removeAttribute('inert'); if (restoreRuleFocus.current) ruleTrigger.current?.focus(); restoreRuleFocus.current = true; };
  }, [selectedRules]);

  function toggleFavorite(id: string) {
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((favorite) => favorite !== id) : [...current, id];
      rememberFavoriteGames(next);
      return next;
    });
  }

  function suggestGame() {
    if (!visibleGames.length) return;
    const next = visibleGames[Math.floor(Math.random() * visibleGames.length)]!;
    setSuggestedId(next.id as GameId);
    document.getElementById(`game-${next.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  function requestNickname() {
    setNicknameError('昵称请填写 1–16 个可显示字符');
    identityPanel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    if (selectedRules) window.setTimeout(() => nicknameInput.current?.focus(), 0);
    else nicknameInput.current?.focus();
  }

  function randomizeNickname() {
    setNickname((current) => generateRandomNickname(current));
    setNicknameError(null);
  }

  function scrollToCatalog() {
    catalogSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function createRoom(gameId: GameId) {
    const cleanNickname = nickname.trim();
    if (!validNickname(cleanNickname)) return requestNickname();
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
    if (!validNickname(cleanNickname)) return requestNickname();
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
            <Reveal className="hero-kicker" delayMs={0} distance={12}>
              <div className="eyebrow">今晚，和朋友开一局</div>
            </Reveal>
            <CinematicHeroTitle />
            <Reveal delayMs={80} distance={12}>
              <p className="hero-description">选一款游戏，创建私人房间，再邀请好友入席。</p>
            </Reveal>
            <Reveal delayMs={120} distance={12}>
              <div className="trust-row">
                <span><Users size={16} /> 2–4 人好友房</span>
                <span><Timer size={16} /> 断线 60 秒重连</span>
                <span><LockKeyhole size={16} /> 无充值与现金筹码</span>
              </div>
            </Reveal>
            <button className="hero-catalog-link" type="button" onClick={scrollToCatalog}>看看有什么游戏 <ArrowRight size={16} /></button>
          </div>

          <Reveal className="hero-editorial-reveal" delayMs={60} distance={16}>
            <div className="hero-editorial">
              <div className="identity-panel" ref={identityPanel}>
                <div className="identity-heading"><span>YOUR NAME</span><h2>先留下称呼</h2><p>选好游戏后，用这个名字创建房间。</p></div>
                <label className="field-label" htmlFor="nickname">你的昵称</label>
                <div className="nickname-row">
                  <button className="nickname-random" type="button" onClick={randomizeNickname} aria-label="随机昵称" title="换一个雅致昵称">
                    <Dices size={19} />
                  </button>
                  <input ref={nicknameInput} id="nickname" value={nickname} maxLength={256} aria-invalid={!!nicknameError} aria-describedby={nicknameError ? 'nickname-error' : undefined} onChange={(event) => { setNickname(event.target.value); setNicknameError(null); }} placeholder="例如：落子无悔（最多 16 字）" autoComplete="nickname" />
                </div>
                {nicknameError && <p className="identity-error" id="nickname-error" role="alert">{nicknameError}</p>}
              </div>
              <form className="invite-strip" aria-label="加入好友房" onSubmit={(event) => { event.preventDefault(); void joinRoom(); }}>
                <div className="invite-copy"><DoorOpen size={19} /><span><strong>已有房间？</strong><small>输入邀请码，直接加入好友</small></span></div>
                <div className="invite-entry">
                  <input aria-label="六位房间邀请码" aria-description="也可以粘贴完整邀请链接" className="code-input" value={roomCode} onChange={(event) => { setRoomCode(parseRoomCodeInput(event.target.value)); setJoinError(null); }} placeholder="房间码或邀请链接" autoCapitalize="characters" spellCheck={false} />
                  <button className="secondary-button" type="submit" disabled={joinPending || pendingGameId !== null || client.connection !== 'online'}>{joinPending ? '正在入席' : '加入房间'}<ArrowRight size={17} /></button>
                </div>
                {joinError && <p className="invite-error" role="alert">{joinError}</p>}
              </form>
            </div>
          </Reveal>
        </section>

        <section className="catalog" aria-labelledby="catalog-title" ref={catalogSection}>
          <Reveal distance={12}>
            <div className="section-heading">
              <div><span>FEATURED TABLES</span><h2 id="catalog-title">今晚玩什么？</h2></div>
              <p>八张桌已经亮灯。选一局，把邀请码发给好友。</p>
            </div>
          </Reveal>

          {client.connection === 'connecting' && <ConnectingNotice />}
          {client.connection === 'offline' && (
            <div className="connection-notice" role="status">
              <span><i />{client.error?.message ?? '实时服务连接中断'}</span>
              <button type="button" onClick={client.reconnect}>重新连接</button>
            </div>
          )}
          {client.connection === 'online' && client.error?.event === 'room:closed' && (
            <div className="connection-notice" role="status">
              <span>{client.error.message}</span>
              <button type="button" onClick={client.clearError}>知道了</button>
            </div>
          )}

          <div className="catalog-tools">
            <label className="catalog-search"><Search size={18} aria-hidden="true" /><span className="sr-only">搜索游戏</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索游戏名称或玩法" /></label>
            <div className="catalog-filters" role="group" aria-label="筛选游戏">
              {([['all', '全部'], ['quick', '轻松短局'], ['strategy', '策略棋盘'], ['party', '多人桌游'], ['favorites', '收藏']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
            </div>
            <button className="suggest-button" type="button" disabled={!visibleGames.length} onClick={suggestGame}><Shuffle size={16} /> 帮我选一款</button>
          </div>
          {suggestedId && visibleGames.some((game) => game.id === suggestedId) && <p className="suggestion-note" role="status">推荐你试试 {games.find((game) => game.id === suggestedId)?.name}。看看规则，再决定是否创建房间。</p>}

          {createError && <p className="catalog-error" role="alert">{createError}</p>}
          <div className="featured-grid">
            {visibleGames.map((game, index) => (
              <Reveal className="game-card-reveal" delayMs={Math.min(index * 35, 140)} distance={0} key={game.id}>
                <ClickSpark className="featured-spark">
                  <SpotlightSurface className="game-card-surface" color="rgba(240, 206, 139, 0.28)" tilt>
                    <article className={`game-card featured-card ${suggestedId === game.id ? 'is-suggested' : ''}`} id={`game-${game.id}`}>
                      <div className="game-number">0{index + 1}</div>
                      <div className={`game-art accent-${game.accent}`}><span className="game-art-orbit" aria-hidden="true" /><GameGlyph kind={game.icon} /></div>
                    <div className="game-info">
                      <div className="status-line"><span className="status-live">{game.players} · {durationLabel(game)}</span>{game.newGame && <span className="game-new">新玩法</span>}</div>
                      <h3>{game.name}</h3><p>{game.subtitle}</p>
                      <span className="game-difficulty">上手：{game.difficulty}</span>
                    </div>
                    <div className="card-utilities">
                      <button type="button" onClick={(event) => { ruleTrigger.current = event.currentTarget; setSelectedRules(game); }} aria-label={`查看${game.name}玩法规则`}>玩法规则</button>
                      <button type="button" aria-label={`${favorites.includes(game.id) ? '取消收藏' : '收藏'}${game.name}`} aria-pressed={favorites.includes(game.id)} onClick={() => toggleFavorite(game.id)}><Heart size={16} fill={favorites.includes(game.id) ? 'currentColor' : 'none'} /></button>
                    </div>
                    {game.id === 'connect-four' || game.id === 'reversi' ? <div className="card-actions">
                      <button type="button" className="card-create" aria-label={`创建${game.name}房间`} disabled={pendingGameId !== null || joinPending || client.connection !== 'online'} onClick={() => void createRoom(game.id as GameId)}>创建房间 <ArrowRight size={16} /></button>
                      <button type="button" className="card-practice" data-practice-game={game.id} aria-label={`${practiceButtonLabel(practiceSaves[game.id as SoloGameId])}${game.name}`} onClick={() => onPractice?.(game.id as SoloGameId)}>{practiceButtonLabel(practiceSaves[game.id as SoloGameId])}</button>
                    </div> : <button type="button" aria-label={`创建${game.name}房间`} disabled={pendingGameId !== null || joinPending || client.connection !== 'online'} onClick={() => void createRoom(game.id as GameId)}>
                      <span>{pendingGameId === game.id ? '正在创建' : '创建房间'}</span><ArrowRight size={18} />
                    </button>}
                  </article>
                  </SpotlightSurface>
                </ClickSpark>
              </Reveal>
            ))}
          </div>
          {!visibleGames.length && <div className="catalog-empty"><p>没有符合条件的游戏。</p>{search && <button type="button" onClick={() => setSearch('')}>清空搜索</button>}{filter !== 'all' && <button type="button" onClick={() => setFilter('all')}>查看全部</button>}</div>}

          <Reveal className="coming-reveal" delayMs={80} distance={12}>
            <details className="coming-details">
              <summary>更多玩法正在准备 · {comingGames.length} 款</summary>
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
            </details>
          </Reveal>
        </section>
      </main>
      {selectedRules && createPortal(<div className="rules-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRules(null); }}>
        <div ref={ruleDialog} className="rules-dialog" role="dialog" aria-modal="true" aria-labelledby="rules-title" aria-describedby="rules-description">
          <button type="button" className="rules-close" onClick={() => setSelectedRules(null)} aria-label="关闭玩法规则">×</button>
          <span>玩法规则</span><h2 id="rules-title">{selectedRules.name}</h2>
          <p id="rules-description">{selectedRules.rules}</p>
          <div className="rules-meta">{selectedRules.players} · {durationLabel(selectedRules)} · {selectedRules.difficulty}</div>
          <button type="button" className="rules-create" disabled={pendingGameId !== null || client.connection !== 'online'} onClick={() => { const gameId = selectedRules.id as GameId; restoreRuleFocus.current = false; setSelectedRules(null); void createRoom(gameId); }}>创建{selectedRules.name}房间</button>
        </div>
      </div>, document.body)}
      <footer><span>GameHall</span><p>好友相聚，胜负有度。本站仅提供纯娱乐对局。</p></footer>
    </div>
  );
}
