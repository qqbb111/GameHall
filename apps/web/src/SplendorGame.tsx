import { useRef, useState } from 'react';
import { canAffordSplendorCard, gemColors, legalSplendorPayment, tokenColors, type GemColor, type SplendorCard, type SplendorView, type TokenColor, type TokenCounts } from '@gamehall/game-core';
import type { CommandAck, GameActionCommand, RoomMemberView } from '@gamehall/protocol';
import './splendor.css';

const gemNames: Record<TokenColor, string> = { white: '钻石', blue: '蓝宝石', green: '祖母绿', red: '红宝石', black: '缟玛瑙', gold: '黄金' };
const emptyTokens = (): TokenCounts => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });
const total = (tokens: TokenCounts) => tokenColors.reduce((sum, color) => sum + tokens[color], 0);

export function GemMark({ color }: { color: TokenColor }) {
  return <span className={`gem-mark gem-${color}`} aria-hidden="true">{color === 'gold' ? '✦' : '◆'}</span>;
}

function CardFace({ card }: { card: SplendorCard }) {
  return <><span className="splendor-card-top"><strong>{card.points || '·'}</strong><GemMark color={card.bonus} /></span>
    <span className="splendor-card-scene" aria-hidden="true">{['', '◇', '♜', '♛'][card.tier]}</span>
    <span className="splendor-card-cost">{gemColors.filter((color) => card.cost[color]).map((color) => <span key={color}><GemMark color={color} />{card.cost[color]}</span>)}</span>
    <span className="splendor-card-label">{gemNames[card.bonus]}商会 · {card.points} 分</span></>;
}

export function SplendorGame({ state, mySeat, active, members, onAction }: {
  state: SplendorView; mySeat: number; active: boolean; members: RoomMemberView[];
  onAction: (action: GameActionCommand['action']) => Promise<CommandAck>;
}) {
  const [selected, setSelected] = useState<SplendorCard | null>(null);
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

  async function send(action: GameActionCommand['action']) {
    if (sending.current || !myTurn) return;
    sending.current = true; setPending(true); setLocalError('');
    try {
      const result = await onAction(action);
      if (result.ok) { setSelected(null); setColors([]); setReturned(emptyTokens()); }
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
      aria-label={`${card.id}，${gemNames[card.bonus]}奖励，${card.points}分${affordable ? '，可购买' : ''}`} onClick={() => selectCard(card)}><CardFace card={card} /></button>;
  }

  return <section className="game-surface splendor-surface" aria-label="璀璨宝石对局">
    <div className="surface-title"><div><span>璀璨宝石 · 经典基础版 · {state.playerCount} 人</span>
      <h2 aria-live="polite">{state.phase === 'finished' ? '商会结算' : !active ? '对局已暂停' : state.turn === mySeat ? '轮到你行动' : `等待 ${name(state.turn)}`}</h2></div>
      <span className={`splendor-round ${state.finalRound ? 'is-final' : ''}`}>{state.finalRound ? '最后一轮' : '目标 15 分'}</span></div>

    <div className="splendor-players">{state.players.map((player) => <details className={`splendor-player ${player.seat === state.turn ? 'is-current' : ''}`} key={player.seat}>
      <summary><span>{name(player.seat)}{player.seat === mySeat ? '（你）' : ''}{player.seat === state.startingPlayer ? ' · 首家' : ''}</span><strong>{player.score} 分</strong></summary>
      <div className="splendor-bonus-row">{gemColors.map((color) => <span key={color} title={`${gemNames[color]}永久折扣`}><GemMark color={color} />−{player.bonuses[color]}</span>)}</div>
      <p>宝石 {total(player.tokens)}/10 · 发展卡 {player.purchased.length} · 保留 {player.reservedCount}/3 · 贵族 {player.nobles.length}</p>
      <div className="splendor-holdings">{tokenColors.map((color) => <span key={color}>{gemNames[color]} {player.tokens[color]}</span>)}</div>
      <div className="splendor-owned-cards">{player.purchased.map((card) => <span key={card.id}>{card.id} · {gemNames[card.bonus]} · {card.points}分</span>)}</div>
      {player.nobles.map((noble) => <span key={noble.id}>{noble.id} 贵族 · 3分 </span>)}
    </details>)}</div>

    <div className="splendor-nobles" aria-label="公共贵族">{state.nobles.map((noble) => {
      const eligible = gemColors.every((color) => me.bonuses[color] >= noble.requirement[color]);
      return <button className={`splendor-noble ${eligible ? 'is-eligible' : ''}`} key={noble.id} type="button"
        disabled={!myTurn || pending || state.phase !== 'choose-noble' || !eligible} onClick={() => void send({ type: 'chooseNoble', nobleId: noble.id })}
        aria-label={`选择贵族 ${noble.id}，3分，${gemColors.filter((color) => noble.requirement[color]).map((color) => `${gemNames[color]}奖励 ${noble.requirement[color]}`).join('，')}`}>
        <span>♛ {noble.id} · 3 分</span><span className="splendor-noble-cost">{gemColors.filter((color) => noble.requirement[color]).map((color) => <span key={color}><GemMark color={color} />{noble.requirement[color]}</span>)}</span>
      </button>;
    })}</div>

    {([3, 2, 1] as const).map((tier) => <div className="splendor-market" key={tier} aria-label={`${tier} 阶市场`}>
      <button type="button" className={`splendor-deck tier-${tier}`} disabled={!canAct || me.reservedCount >= 3 || !state.deckCounts[tier]}
        onClick={() => void send({ type: 'reserve', source: { kind: 'deck', tier } })} aria-label={`盲抽保留 ${tier} 阶顶牌，剩余 ${state.deckCounts[tier]} 张`}>
        <strong>{'◆'.repeat(tier)}</strong><span>{tier} 阶</span><small>盲抽保留 · {state.deckCounts[tier]}</small>
      </button>
      <div className="splendor-market-cards">{state.market[tier].map(cardButton)}{Array.from({ length: 4 - state.market[tier].length }, (_, index) => <span className="splendor-card-empty" key={`empty-${index}`}>已售罄</span>)}</div>
    </div>)}

    <section className="splendor-supply" aria-label="公共宝石供应">
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

    <section className="splendor-personal" aria-label="你的商会"><h3>你的商会 <small>{total(me.tokens)}/10 枚宝石 · {me.score} 分</small></h3>
      <div className="splendor-inventory">{tokenColors.map((color) => <span key={color}><GemMark color={color} />{gemNames[color]} <b>{me.tokens[color]}</b>{color !== 'gold' && <small>永久 −{me.bonuses[color]}</small>}</span>)}</div>
      <h4>你的保留牌 <small>{me.reservedCount}/3 · 仅自己可见</small></h4><div className="splendor-reserved">{reserved.map(cardButton)}{!reserved.length && <p>保留一张明牌或盲抽顶牌，若供应尚有黄金即可获得一枚。</p>}</div>
    </section>

    {state.phase === 'return-tokens' && <section className="splendor-required" aria-label="归还超额宝石"><h3>{myTurn ? `请归还 ${total(me.tokens) - 10} 枚宝石` : `等待 ${name(state.turn)} 归还宝石`}</h3>
      {myTurn && <><p>可以归还刚拿到的宝石或黄金，完成后才能结束回合。</p><div className="splendor-count-inputs">{tokenColors.map((color) => <label key={color}><GemMark color={color} />归还{gemNames[color]}<input type="number" min={0} max={me.tokens[color]} value={returned[color]} disabled={pending} onChange={(event) => setReturned((current) => ({ ...current, [color]: Number(event.target.value) }))} /></label>)}</div>
        <button className="splendor-confirm" type="button" disabled={pending || total(returned) !== total(me.tokens) - 10 || tokenColors.some((color) => !Number.isInteger(returned[color]) || returned[color] < 0 || returned[color] > me.tokens[color])} onClick={() => void send({ type: 'returnTokens', tokens: returned })}>确认归还</button></>}
    </section>}
    {state.phase === 'choose-noble' && <div className="splendor-required" role="status"><h3>{myTurn ? '请选择上方一位符合条件的贵族' : `等待 ${name(state.turn)} 选择贵族`}</h3><p>每回合只能获得一位贵族，不能放弃符合条件的来访。</p></div>}

    {selected && <section className="splendor-card-detail" aria-label="卡牌操作面板"><div className="splendor-tool-heading"><h3>{selected.id} · {gemNames[selected.bonus]}奖励 · {selected.points} 分</h3><button type="button" onClick={() => setSelected(null)}>关闭卡牌详情</button></div>
      <p>折扣后需支付 {required} 枚。下方选择普通宝石数量，剩余费用使用黄金。</p>
      <div className="splendor-count-inputs">{gemColors.map((color) => <label key={color}><GemMark color={color} />支付{gemNames[color]}<select value={coloredPayment[color]} disabled={!canAct} onChange={(event) => setColoredPayment((current) => ({ ...current, [color]: Number(event.target.value) }))}>
        {Array.from({ length: Math.min(me.tokens[color], Math.max(0, selected.cost[color] - me.bonuses[color])) + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select><small>费用 {selected.cost[color]} − 折扣 {me.bonuses[color]}</small></label>)}</div>
      <p>使用黄金 <strong>{payment.gold}</strong> / 持有 {me.tokens.gold}</p><div className="splendor-detail-actions">
        <button type="button" className="splendor-confirm" disabled={!canAct || !legalSplendorPayment(me, selected, payment)} onClick={() => void send({ type: 'purchase', source: isReserved ? { kind: 'reserved', cardId: selected.id } : { kind: 'market', tier: selected.tier, cardId: selected.id }, payment })}>确认购买</button>
        {!isReserved && <button type="button" disabled={!canAct || me.reservedCount >= 3} onClick={() => void send({ type: 'reserve', source: { kind: 'market', tier: selected.tier, cardId: selected.id } })}>确认保留{state.supply.gold ? '，获得 1 黄金' : '，黄金已取完'}</button>}</div>
    </section>}
    {localError && <p role="alert">{localError}</p>}
    {state.result && <div className="splendor-standings" aria-label="本局分数">{state.result.standings.map((item) => <p key={item.seat}><strong>{name(item.seat)}</strong><span>{item.score} 分 · {item.purchasedCards} 张发展卡{state.result?.type === 'completed' && state.result.winners.includes(item.seat) ? ' · 获胜' : ''}</span></p>)}</div>}
    <details className="splendor-help"><summary>规则与线上约定</summary><p>每回合选择拿宝石、保留或购买。拿不同颜色时取三种，供应不足三种时可取一或两种可用颜色；同色取两枚时，拿取前供应必须至少四枚。</p>
      <p>购买的卡牌提供永久折扣和分数。黄金可替代任意颜色，即使你有该色宝石；保留牌最多三张，回合结束宝石最多十枚。贵族只看永久奖励，每回合最多获得一位。</p>
      <p>达到十五分后打完本轮，所有人行动次数相同；最高分获胜，同分时已购买卡牌较少者获胜，仍相同则共享胜利。</p>
      <p>线上约定：随机首家，不设回合计时；断线暂停，六十秒未恢复或有人认输、离开则中止且不计胜负。服务重启提供十分钟恢复窗口。只有无合法行动才可跳过，全员连续无合法行动则中止。房主可保留邀请码返回等待区再开。</p>
    </details>
  </section>;
}
