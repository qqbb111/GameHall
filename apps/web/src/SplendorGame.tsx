import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { canAffordSplendorCard, gemColors, legalSplendorPayment, tokenColors, type GemColor, type SplendorCard, type SplendorView, type TokenColor, type TokenCounts } from '@gamehall/game-core';
import type { CommandAck, GameActionCommand, RoomMemberView } from '@gamehall/protocol';
import './splendor.css';

const gemNames: Record<TokenColor, string> = { white: '钻石', blue: '蓝宝石', green: '祖母绿', red: '红宝石', black: '缟玛瑙', gold: '黄金' };
const emptyTokens = (): TokenCounts => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });
const total = (tokens: TokenCounts) => tokenColors.reduce((sum, color) => sum + tokens[color], 0);

export function GemMark({ color }: { color: TokenColor }) {
  const outlines = { white: 'M7 5H25L30 13L16 29L2 13Z', blue: 'M10 3H22L29 10V22L22 29H10L3 22V10Z', green: 'M10 2H22L27 7V25L22 30H10L5 25V7Z', red: 'M16 2L29 10V22L16 30L3 22V10Z', black: 'M16 2L31 28H1Z', gold: 'M8 6H24L30 25H2Z' };
  return <span className={`gem-mark gem-${color}`} aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><path d={outlines[color]} fill="currentColor" /><path d="M10 9L22 9L24 21L16 26L8 21Z" fill="none" stroke="#071716" strokeOpacity=".42" strokeWidth="1.4" /><path d="M10 9L16 15L22 9M16 15L8 21M16 15L24 21" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1.2" /></svg></span>;
}

function CardScene({ tier }: { tier: number }) {
  return <svg className="splendor-scene-svg" viewBox="0 0 160 70" aria-hidden="true" focusable="false">
    <circle cx="124" cy="15" r="8" fill="currentColor" opacity=".2" /><path d="M0 63H160M8 67H150" fill="none" stroke="currentColor" opacity=".3" />
    {tier === 1 ? <><path d="M8 62L42 11L66 42L85 20L123 62M84 62L120 36L151 62" fill="currentColor" opacity=".13" /><path d="M8 62L42 11L66 42L85 20L123 62M29 31L42 35L49 24M42 11L55 62M85 20L82 62" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M62 63V48L72 41L82 48V63M68 62V50H76V62" fill="none" stroke="currentColor" /></>
      : tier === 2 ? <><path d="M29 62V27L56 10L85 27V62M85 62V33L121 20L143 33V62" fill="currentColor" opacity=".12" /><path d="M20 28L56 7L92 28M29 27V62H85V27M85 34L121 19L150 34M97 62V34M140 62V34M46 62V43Q56 30 66 43V62M37 32H45M68 32H76M105 42H132M105 50H132" fill="none" stroke="currentColor" strokeWidth="1.7" /></>
      : <><path d="M28 62V32H47V21H65V12H95V21H113V32H132V62Z" fill="currentColor" opacity=".13" /><path d="M20 62H140M28 62V32H47V21H65V12H95V21H113V32H132V62M59 12L80 2L101 12M66 62V40Q80 20 94 40V62M34 40H41M119 40H126M34 50H41M119 50H126M55 27V52M105 27V52" fill="none" stroke="currentColor" strokeWidth="1.6" /></>}
  </svg>;
}

function NobleSeal() { return <svg className="splendor-seal" viewBox="0 0 42 42" aria-hidden="true" focusable="false"><path d="M21 2L36 10V28L21 40L6 28V10Z" fill="none" stroke="currentColor" /><path d="M12 16L17 21L21 12L25 21L30 16L27 28H15Z" fill="currentColor" opacity=".75" /><path d="M16 32H26" stroke="currentColor" /></svg>; }

function CardFace({ card }: { card: SplendorCard }) {
  return <><span className="splendor-card-top"><strong>{card.points || '·'}</strong><GemMark color={card.bonus} /></span>
    <span className="splendor-card-scene"><CardScene tier={card.tier} /></span>
    <span className="splendor-card-cost">{gemColors.filter((color) => card.cost[color]).map((color) => <span key={color} title={gemNames[color]}><GemMark color={color} /><b>{card.cost[color]}</b></span>)}</span>
    <span className="splendor-card-label">{['', '矿场', '工坊', '宫殿'][card.tier]} · {gemNames[card.bonus]}</span></>;
}

export function SplendorGame({ state, mySeat, active, members, onAction }: {
  state: SplendorView; mySeat: number; active: boolean; members: RoomMemberView[];
  onAction: (action: GameActionCommand['action']) => Promise<CommandAck>;
}) {
  const [selected, setSelected] = useState<SplendorCard | null>(null);
  const [blindTier, setBlindTier] = useState<1 | 2 | 3 | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const forced = useRef<HTMLElement>(null);
  const supply = useRef<HTMLElement>(null);
  const personal = useRef<HTMLElement>(null);
  const [coloredPayment, setColoredPayment] = useState<TokenCounts>(emptyTokens);
  const [colors, setColors] = useState<GemColor[]>([]);
  const [takeMode, setTakeMode] = useState<'different' | 'same'>('different');
  const [returned, setReturned] = useState<TokenCounts>(emptyTokens);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const [localError, setLocalError] = useState('');
  const me = state.players.find((player) => player.seat === mySeat)!;
  const name = (seat: number) => members.find((member) => member.seat === seat)?.nickname ?? `玩家 ${seat + 1}`;
  const myTurn = active && state.turn === mySeat && state.phase !== 'finished';
  const canAct = myTurn && state.phase === 'action' && !pending;
  const reserved = me.reserved ?? [];
  const isReserved = selected && reserved.some((card) => card.id === selected.id);
  const required = selected ? gemColors.reduce((sum, color) => sum + Math.max(0, selected.cost[color] - me.bonuses[color]), 0) : 0;
  const payment = { ...coloredPayment, gold: required - gemColors.reduce((sum, color) => sum + coloredPayment[color], 0) };
  const availableColors = gemColors.filter((color) => state.supply[color] > 0).length;
  const legalTake = takeMode === 'same' ? colors.length === 2 && state.supply[colors[0]!] >= 4
    : colors.length > 0 && (availableColors >= 3 ? colors.length === 3 : colors.length <= availableColors);
  const hasAction = availableColors > 0 || [...Object.values(state.market).flat(), ...reserved].some((card) => canAffordSplendorCard(me, card))
    || (me.reservedCount < 3 && Object.values(state.market).some((cards) => cards.length > 0))
    || (me.reservedCount < 3 && Object.values(state.deckCounts).some((count) => count > 0));

  useEffect(() => {
    if (!selected && !blindTier) return;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus(); };
  }, [selected, blindTier]);

  useEffect(() => {
    if (myTurn && (state.phase === 'return-tokens' || state.phase === 'choose-noble')) {
      forced.current?.focus({ preventScroll: true });
      forced.current?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    }
  }, [myTurn, state.phase]);

  function dialogKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !sending.current) { event.preventDefault(); setSelected(null); setBlindTier(null); }
    if (event.key !== 'Tab') return;
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)') ?? [])];
    const first = items[0]; const last = items.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  }

  async function send(action: GameActionCommand['action']) {
    if (sending.current || !myTurn) return;
    sending.current = true; setPending(true); setLocalError('');
    try {
      const result = await onAction(action);
      if (result.ok) { setSelected(null); setBlindTier(null); setColors([]); setReturned(emptyTokens()); }
      else setLocalError(result.error.message);
    } catch { setLocalError('操作未完成，请检查连接后重试。'); }
    finally { sending.current = false; setPending(false); }
  }

  function selectCard(card: SplendorCard) {
    const suggested = emptyTokens();
    for (const color of gemColors) suggested[color] = Math.min(me.tokens[color], Math.max(0, card.cost[color] - me.bonuses[color]));
    setColoredPayment(suggested); setSelected(card);
  }

  function cardButton(card: SplendorCard) {
    const affordable = canAffordSplendorCard(me, card);
    return <button key={card.id} type="button" className={`splendor-card card-${card.bonus} ${affordable ? 'is-affordable' : ''}`}
      aria-label={`${card.id}，${gemNames[card.bonus]}奖励，${card.points}分${affordable ? '，可购买' : ''}，费用 ${gemColors.filter((color) => card.cost[color]).map((color) => `${gemNames[color]}${card.cost[color]}`).join('、')}`} onClick={() => selectCard(card)}><CardFace card={card} /></button>;
  }

  return <section className="game-surface splendor-surface" aria-label="璀璨宝石对局">
    <div className="surface-title"><div><span>璀璨宝石 · 经典基础版 · {state.playerCount} 人</span>
      <h2 aria-live="polite">{state.phase === 'finished' ? '商会结算' : !active ? '对局已暂停' : state.turn === mySeat ? '轮到你行动' : `等待 ${name(state.turn)}`}</h2></div>
      <span className={`splendor-round ${state.finalRound ? 'is-final' : ''}`}>{state.finalRound ? '最后一轮' : '目标 15 分'}</span></div>

    <div className="splendor-players">{state.players.map((player) => <details className={`splendor-player ${player.seat === state.turn ? 'is-current' : ''}`} key={player.seat}>
      <summary><span className="splendor-player-heading"><span>{name(player.seat)}{player.seat === mySeat ? '（你）' : ''}</span><strong>{player.score} 分</strong></span>
        <span className="splendor-bonus-row" aria-label="永久折扣">{gemColors.map((color) => <span key={color} title={`${gemNames[color]}永久折扣`}><GemMark color={color} /><span className="sr-only">{gemNames[color]}</span>{player.bonuses[color]}</span>)}</span>
        <small>{player.seat === state.startingPlayer ? '首家 · ' : ''}宝石 {total(player.tokens)} · 保留 {player.reservedCount}/3 <span aria-hidden="true">⌄</span></small></summary>
      <p>宝石 {total(player.tokens)}/10 · 发展卡 {player.purchased.length} · 保留 {player.reservedCount}/3 · 贵族 {player.nobles.length}</p>
      <div className="splendor-holdings">{tokenColors.map((color) => <span key={color}>{gemNames[color]} {player.tokens[color]}</span>)}</div>
      <div className="splendor-owned-cards">{player.purchased.map((card) => <span key={card.id}>{card.id} · {gemNames[card.bonus]} · {card.points}分</span>)}</div>
      {player.nobles.map((noble) => <span key={noble.id}>{noble.id} 贵族 · 3分 </span>)}
    </details>)}</div>

    {(state.phase === 'return-tokens' || state.phase === 'choose-noble') && <section className="splendor-required" ref={forced} tabIndex={-1} aria-label={state.phase === 'return-tokens' ? '归还超额宝石' : '选择来访贵族'}>
      <h3>{state.phase === 'choose-noble' ? myTurn ? '请选择下方一位来访贵族' : `等待 ${name(state.turn)} 选择贵族` : myTurn ? `请归还 ${total(me.tokens) - 10} 枚宝石` : `等待 ${name(state.turn)} 归还宝石`}</h3>
      {state.phase === 'return-tokens' && myTurn ? <><p>可以归还刚拿到的宝石或黄金，完成后才能结束回合。</p><div className="splendor-count-inputs">{tokenColors.map((color) => <label key={color}><GemMark color={color} />归还{gemNames[color]}<input type="number" min={0} max={me.tokens[color]} value={returned[color]} disabled={pending} onChange={(event) => setReturned((current) => ({ ...current, [color]: Number(event.target.value) }))} /></label>)}</div>
        <button className="splendor-confirm" type="button" disabled={pending || total(returned) !== total(me.tokens) - 10 || tokenColors.some((color) => !Number.isInteger(returned[color]) || returned[color] < 0 || returned[color] > me.tokens[color])} onClick={() => void send({ type: 'returnTokens', tokens: returned })}>确认归还</button></> : <p>{state.phase === 'choose-noble' ? '每回合只能获得一位贵族，完成选择后再切换玩家。' : '全桌等待这项必选操作完成。'}</p>}
    </section>}
    <div className="splendor-table-heading"><h3>贵族来访</h3><span>永久奖励达标 · 每回合至多一位</span></div>
    <div className="splendor-nobles" aria-label="公共贵族">{state.nobles.map((noble) => {
      const eligible = gemColors.every((color) => me.bonuses[color] >= noble.requirement[color]);
      return <button className={`splendor-noble ${eligible ? 'is-eligible' : ''}`} key={noble.id} type="button"
        disabled={!myTurn || pending || state.phase !== 'choose-noble' || !eligible} onClick={() => void send({ type: 'chooseNoble', nobleId: noble.id })}
        aria-label={`选择贵族 ${noble.id}，3分，${gemColors.filter((color) => noble.requirement[color]).map((color) => `${gemNames[color]}奖励 ${noble.requirement[color]}`).join('，')}`}>
        <span className="splendor-noble-heading"><NobleSeal /><span>{noble.id}<strong>3 分</strong></span></span><span className="splendor-noble-cost">{gemColors.filter((color) => noble.requirement[color]).map((color) => <span key={color} title={gemNames[color]}><GemMark color={color} />{noble.requirement[color]}</span>)}</span>
      </button>;
    })}</div>

    <div className="splendor-table-heading"><h3>发展卡市场</h3><span>点击卡牌购买或保留</span></div>
    {([3, 2, 1] as const).map((tier) => <div className="splendor-market" key={tier} aria-label={`${tier} 阶市场`}>
      <button type="button" className={`splendor-deck tier-${tier}`} disabled={!canAct || me.reservedCount >= 3 || !state.deckCounts[tier]}
        onClick={() => setBlindTier(tier)} aria-label={`盲抽保留 ${tier} 阶顶牌，剩余 ${state.deckCounts[tier]} 张`}>
        <strong>{'◆'.repeat(tier)}</strong><span>{tier} 阶</span><small>盲抽保留 · {state.deckCounts[tier]}</small>
      </button>
      <div className="splendor-market-cards">{state.market[tier].map(cardButton)}{Array.from({ length: 4 - state.market[tier].length }, (_, index) => <span className="splendor-card-empty" key={`empty-${index}`}>已售罄</span>)}</div>
    </div>)}

    <section className="splendor-supply" aria-label="公共宝石供应" ref={supply} tabIndex={-1}>
      <div className="splendor-tool-heading"><h3>宝石供应</h3><div role="group" aria-label="拿取方式">
        <button type="button" aria-pressed={takeMode === 'different'} onClick={() => { setTakeMode('different'); setColors([]); }}>拿不同颜色</button>
        <button type="button" aria-pressed={takeMode === 'same'} onClick={() => { setTakeMode('same'); setColors([]); }}>拿两枚同色</button></div></div>
      <div className="splendor-token-bank">{tokenColors.map((color) => <button key={color} type="button"
        aria-label={`${gemNames[color]} ${state.supply[color]}`}
        className={`splendor-token ${colors.includes(color as GemColor) ? 'is-selected' : ''}`} aria-pressed={colors.includes(color as GemColor)}
        disabled={!canAct || color === 'gold' || state.supply[color] < (takeMode === 'same' ? 4 : 1)}
        onClick={() => { if (color === 'gold') return; setColors((current) => takeMode === 'same' ? [color, color] : current.includes(color) ? current.filter((item) => item !== color) : current.length < 3 ? [...current, color] : current); }}>
        <GemMark color={color} /><span>{gemNames[color]}</span><strong>{state.supply[color]}</strong>
      </button>)}</div>
      <div className="splendor-action-bar"><span>{colors.length ? `已选择 ${colors.map((color) => gemNames[color]).join('、')}` : '黄金通过保留卡牌获得'}</span>
        <button type="button" className="splendor-confirm" disabled={!canAct || !legalTake} onClick={() => void send({ type: 'takeTokens', colors })}>{pending ? '正在确认…' : '确认拿取'}</button>
        {!hasAction && <button type="button" disabled={!canAct} onClick={() => void send({ type: 'pass' })}>无合法行动，跳过</button>}</div>
    </section>

    <section className="splendor-personal" aria-label="你的商会" ref={personal} tabIndex={-1}><h3>你的商会 <small>{total(me.tokens)}/10 枚宝石 · {me.score} 分</small></h3>
      <div className="splendor-inventory">{tokenColors.map((color) => <span key={color}><GemMark color={color} />{gemNames[color]} <b>{me.tokens[color]}</b>{color !== 'gold' && <small>永久 −{me.bonuses[color]}</small>}</span>)}</div>
      <h4>你的保留牌 <small>{me.reservedCount}/3 · 仅自己可见</small></h4><div className="splendor-reserved">{reserved.map(cardButton)}{!reserved.length && <p>保留一张明牌或盲抽顶牌，若供应尚有黄金即可获得一枚。</p>}</div>
    </section>

    {(selected || blindTier) && <div className="splendor-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !pending) { setSelected(null); setBlindTier(null); } }}><section className="splendor-card-detail" role="dialog" aria-modal="true" aria-label="卡牌操作面板" ref={dialog} tabIndex={-1} onKeyDown={dialogKeys}>
      <div className="splendor-tool-heading"><span className="splendor-eyebrow">商会 · 卡牌交易</span><button type="button" disabled={pending} onClick={() => { setSelected(null); setBlindTier(null); }}>关闭卡牌详情</button></div>
      {selected ? <><div className="splendor-detail-preview"><div className={`splendor-card card-${selected.bonus}`}><CardFace card={selected} /></div><div><h3>{gemNames[selected.bonus]}{['', '矿场', '工坊', '宫殿'][selected.tier]}</h3><p>{selected.points} 声望分 · 永久{gemNames[selected.bonus]}折扣 +1</p><small>{selected.id} · {isReserved ? '你的保留牌' : `${selected.tier} 阶市场`}</small></div></div>
      <p>折扣后需支付 {required} 枚。下方选择普通宝石数量，剩余费用使用黄金。</p>
      <div className="splendor-count-inputs">{gemColors.map((color) => <label key={color}><GemMark color={color} />支付{gemNames[color]}<select value={coloredPayment[color]} disabled={!canAct} onChange={(event) => setColoredPayment((current) => ({ ...current, [color]: Number(event.target.value) }))}>
        {Array.from({ length: Math.min(me.tokens[color], Math.max(0, selected.cost[color] - me.bonuses[color])) + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select><small>费用 {selected.cost[color]} − 折扣 {me.bonuses[color]}</small></label>)}</div>
      <p>使用黄金 <strong>{payment.gold}</strong> / 持有 {me.tokens.gold}</p><div className="splendor-detail-actions">
        <button type="button" className="splendor-confirm" disabled={!canAct || !legalSplendorPayment(me, selected, payment)} onClick={() => void send({ type: 'purchase', source: isReserved ? { kind: 'reserved', cardId: selected.id } : { kind: 'market', tier: selected.tier, cardId: selected.id }, payment })}>确认购买</button>
        {!isReserved && <button type="button" disabled={!canAct || me.reservedCount >= 3} onClick={() => void send({ type: 'reserve', source: { kind: 'market', tier: selected.tier, cardId: selected.id } })}>确认保留{state.supply.gold ? '，获得 1 黄金' : '，黄金已取完'}</button>}</div></>
        : <><h3>盲抽保留 {blindTier} 阶顶牌</h3><p>保留后仅你可见这张牌。{state.supply.gold ? '同时获得一枚黄金。' : '公共黄金已取完，本次只保留卡牌。'}你当前保留 {me.reservedCount}/3 张。</p><button className="splendor-confirm" type="button" disabled={!canAct || me.reservedCount >= 3} onClick={() => { if (blindTier) void send({ type: 'reserve', source: { kind: 'deck', tier: blindTier } }); }}>确认盲抽保留</button></>}
      {localError && <p className="splendor-error" role="alert">{localError}</p>}
    </section></div>}
    {localError && !selected && !blindTier && <p className="splendor-error" role="alert">{localError}</p>}
    {state.result && <div className="splendor-standings" aria-label="本局分数">{state.result.standings.map((item) => <p key={item.seat}><strong>{name(item.seat)}</strong><span>{item.score} 分 · {item.purchasedCards} 张发展卡{state.result?.type === 'completed' && state.result.winners.includes(item.seat) ? ' · 获胜' : ''}</span></p>)}</div>}
    <details className="splendor-help"><summary>规则与线上约定</summary><p>每回合选择拿宝石、保留或购买。拿不同颜色时取三种，供应不足三种时可取一或两种可用颜色；同色取两枚时，拿取前供应必须至少四枚。</p>
      <p>购买的卡牌提供永久折扣和分数。黄金可替代任意颜色，即使你有该色宝石；保留牌最多三张，回合结束宝石最多十枚。贵族只看永久奖励，每回合最多获得一位。</p>
      <p>达到十五分后打完本轮，所有人行动次数相同；最高分获胜，同分时已购买卡牌较少者获胜，仍相同则共享胜利。</p>
      <p>线上约定：随机首家，不设回合计时；断线暂停，六十秒未恢复或有人认输、离开则中止且不计胜负。服务重启提供十分钟恢复窗口。只有无合法行动才可跳过，全员连续无合法行动则中止。房主可保留邀请码返回等待区再开。</p>
    </details>
    {state.phase !== 'finished' && <nav className="splendor-mobile-actions" aria-label="桌面快捷操作"><span>{!active ? '对局暂停' : myTurn ? '轮到你' : '等待好友'}</span>
      <button type="button" onClick={() => { const target = state.phase === 'action' ? supply : forced; target.current?.focus({ preventScroll: true }); target.current?.scrollIntoView({ block: 'center', behavior: 'instant' }); }}>{state.phase === 'action' ? '拿取宝石' : '必选操作'}</button>
      <button type="button" onClick={() => { personal.current?.focus({ preventScroll: true }); personal.current?.scrollIntoView({ block: 'center', behavior: 'instant' }); }}>我的商会</button></nav>}
  </section>;
}
