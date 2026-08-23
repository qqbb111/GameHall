import type { GomokuState, Player, QuoridorView, TwentyFourView } from '@gamehall/game-core';
import type { GameId } from '@gamehall/protocol';

export function resultMessage(gameId: GameId, view: unknown, mySeat: Player): string | null {
  if (gameId === 'twenty-four') {
    const state = view as TwentyFourView;
    if (state.phase !== 'finished') return null;
    if (state.finishReason === 'restart_timeout') return '服务恢复等待超时，本场按和局结束。';
    if (state.winner === null) return '本场已经结束，再来一场？';
    if (state.finishReason === 'disconnect') return state.winner === mySeat ? '好友超时未重连，你赢得本场。' : '你因断线超时输掉了本场。';
    if (state.finishReason === 'resign') return state.winner === mySeat ? '好友认输，你赢得本场。' : '你已认输，本场结束。';
    if (state.finishReason === 'leave') return state.winner === mySeat ? '好友离开房间，你赢得本场。' : '你已离开，本场结束。';
    return state.winner === mySeat ? '你先拿到 5 分，赢下本场！' : '好友先拿到 5 分，再来一场？';
  }
  const state = view as GomokuState | QuoridorView;
  if (state.phase !== 'finished' || !state.result) return null;
  if (state.result.type === 'draw') return '棋盘战成和局，再来一场？';
  if (state.result.reason === 'disconnect') return state.result.winner === mySeat ? '好友超时未重连，你赢得本局。' : '你因断线超时输掉了本局。';
  if (state.result.reason === 'resign') return state.result.winner === mySeat ? '好友认输，你赢得本局。' : '你已认输，本局结束。';
  if (state.result.reason === 'leave') return state.result.winner === mySeat ? '好友离开房间，你赢得本局。' : '你已离开，本局结束。';
  return state.result.winner === mySeat ? '漂亮！你赢得了本局。' : '好友赢得了本局，再来一场？';
}
