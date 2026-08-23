import type { GameId } from '@gamehall/protocol';

export type GameCardInfo = {
  id: GameId | 'go' | 'guanpai' | 'zhajinhua' | 'luosong' | 'niuniu';
  name: string;
  subtitle: string;
  status: 'online' | 'soon';
  icon: 'gomoku' | 'quoridor' | 'twenty-four' | 'cards' | 'go';
  accent: string;
};

export const games: GameCardInfo[] = [
  { id: 'gomoku', name: '五子棋', subtitle: '15 路自由规则 · 双人对弈', status: 'online', icon: 'gomoku', accent: 'amber' },
  { id: 'quoridor', name: '路墙棋', subtitle: '步步为营 · 路径与墙的博弈', status: 'online', icon: 'quoridor', accent: 'jade' },
  { id: 'twenty-four', name: '24 点速度对决', subtitle: '四牌抢答 · 先得 5 分', status: 'online', icon: 'twenty-four', accent: 'blue' },
  { id: 'go', name: '围棋', subtitle: '规则确认中', status: 'soon', icon: 'go', accent: 'ink' },
  { id: 'guanpai', name: '关牌', subtitle: '规则确认中', status: 'soon', icon: 'cards', accent: 'ink' },
  { id: 'zhajinhua', name: '炸金花', subtitle: '规则确认中', status: 'soon', icon: 'cards', accent: 'ink' },
  { id: 'luosong', name: '罗松', subtitle: '规则确认中', status: 'soon', icon: 'cards', accent: 'ink' },
  { id: 'niuniu', name: '牛牛', subtitle: '规则确认中', status: 'soon', icon: 'cards', accent: 'ink' },
];

export const gameNames: Record<GameId, string> = {
  gomoku: '五子棋',
  quoridor: '路墙棋',
  'twenty-four': '24 点速度对决',
};
