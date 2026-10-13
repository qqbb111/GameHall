export type OnlineGameAvailability = 'reconnecting' | 'paused-peer' | 'paused-restart' | null;

export function onlineGameHeading(finished: boolean, finishedText: string, availability: OnlineGameAvailability | undefined, actionPending: boolean | undefined, turnText: string): string {
  if (finished) return finishedText;
  if (availability === 'reconnecting') return '正在恢复连接与对局';
  if (availability === 'paused-restart') return '等待大家回到对局';
  if (availability === 'paused-peer') return '好友暂时离线，对局已暂停';
  if (actionPending) return '正在确认你的操作';
  return turnText;
}
