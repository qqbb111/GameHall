import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SPLENDOR_CARDS, createSplendorState, splendorDefinition, type SplendorState } from '@gamehall/game-core';
import { SplendorGame } from './SplendorGame';

function setup(state = createSplendorState({ playerCount: 2, startingPlayer: 0 }), active = true, onAction = vi.fn().mockResolvedValue({ ok: true })) {
  const view = splendorDefinition.viewFor(state, 0, 0);
  const rendered = render(<SplendorGame state={view} mySeat={0} active={active} members={[]} onAction={onAction} />);
  return { ...rendered, onAction };
}
describe('璀璨宝石操作', () => {
  it('选择宝石后确认提交，等待回执时防止重复', () => {
    const onAction = vi.fn(() => new Promise(() => {}));
    setup(undefined, true, onAction);
    fireEvent.click(screen.getByRole('button', { name: '钻石 4' }));
    fireEvent.click(screen.getByRole('button', { name: '蓝宝石 4' }));
    expect(screen.getByRole('button', { name: '确认拿取' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '祖母绿 4' }));
    fireEvent.click(screen.getByRole('button', { name: '确认拿取' }));
    fireEvent.click(screen.getByRole('button', { name: '正在确认…' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ type: 'takeTokens', colors: ['white', 'blue', 'green'] });
  });

  it('卡牌详情默认普通宝石优先，允许手动用黄金替代', async () => {
    const state = createSplendorState({ playerCount: 2, startingPlayer: 0 });
    state.market[1][0] = SPLENDOR_CARDS.find((card) => card.id === 'L1-01')!;
    state.players[0]!.tokens.red = 2; state.players[0]!.tokens.black = 1; state.players[0]!.tokens.gold = 1;
    const { onAction } = setup(state);
    fireEvent.click(screen.getByRole('button', { name: /L1-01，/ }));
    expect(screen.getByLabelText(/支付红宝石/)).toHaveValue('2');
    fireEvent.change(screen.getByLabelText(/支付红宝石/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认购买' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'purchase', source: { kind: 'market', tier: 1, cardId: 'L1-01' }, payment: { white: 0, blue: 0, green: 0, red: 1, black: 1, gold: 1 } }));
  });

  it('保留明牌需确认，并显示服务端错误', async () => {
    const state = createSplendorState({ playerCount: 2, startingPlayer: 0 });
    const onAction = vi.fn().mockResolvedValue({ ok: false, error: { message: '状态已更新' } });
    setup(state, true, onAction);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${state.market[3][0]!.id}，`) }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认保留，获得 1 黄金' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('状态已更新'));
  });

  it('归还数量必须准确，强制阶段禁止主行动', async () => {
    const state: SplendorState = createSplendorState({ playerCount: 2, startingPlayer: 0 });
    state.phase = 'return-tokens'; state.players[0]!.tokens = { white: 3, blue: 3, green: 3, red: 2, black: 0, gold: 0 };
    const { onAction } = setup(state);
    expect(screen.getByRole('button', { name: '确认拿取' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '确认归还' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/归还钻石/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认归还' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'returnTokens', tokens: { white: 1, blue: 0, green: 0, red: 0, black: 0, gold: 0 } }));
  });

  it('只能选择符合条件的一位贵族', async () => {
    const state = createSplendorState({ playerCount: 2, startingPlayer: 0 }); state.phase = 'choose-noble';
    state.players[0]!.bonuses = { white: 4, blue: 4, green: 4, red: 4, black: 4 };
    const { onAction } = setup(state);
    fireEvent.click(screen.getAllByRole('button', { name: /选择贵族/ })[0]!);
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'chooseNoble', nobleId: state.nobles[0]!.id }));
  });

  it('暂停时所有提交关闭；对手保留牌只显示数量', () => {
    const state = createSplendorState({ playerCount: 2, startingPlayer: 0 });
    const secret = state.decks[3].pop()!; state.players[1]!.reserved.push(secret);
    setup(state, false);
    expect(screen.getByRole('heading', { name: '对局已暂停' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认拿取' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: new RegExp(secret.id) })).not.toBeInTheDocument();
  });
});
