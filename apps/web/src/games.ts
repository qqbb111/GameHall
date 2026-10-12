import type { GameId } from '@gamehall/protocol';

export type GameCardInfo = {
  id: GameId | 'go' | 'guanpai' | 'zhajinhua' | 'luosong' | 'niuniu';
  name: string;
  subtitle: string;
  status: 'online' | 'soon';
  icon: 'gomoku' | 'quoridor' | 'twenty-four' | 'texas-holdem' | 'cards' | 'go' | 'splendor' | 'connect-four' | 'reversi' | 'dots-and-boxes';
  accent: string;
  players?: string;
  duration?: string;
  difficulty?: string;
  categories?: readonly ('quick' | 'strategy' | 'party')[];
  rules?: string;
  newGame?: boolean;
};

export const games: GameCardInfo[] = [
  { id: 'splendor', name: '璀璨宝石', subtitle: '收集宝石 · 兑换发展卡', status: 'online', icon: 'splendor', accent: 'jade', players: '2–4 人', duration: '30–45 分钟', difficulty: '中等', categories: ['strategy', 'party'], rules: '轮流拿宝石或购买发展卡，累积卡牌奖励与贵族分数。有人达到 15 分后完成本轮，分数最高者获胜。' },
  { id: 'gomoku', name: '五子棋', subtitle: '15 路棋盘 · 抢先连五', status: 'online', icon: 'gomoku', accent: 'amber', players: '2 人', duration: '10–20 分钟', difficulty: '易上手', categories: ['quick', 'strategy'], rules: '双方轮流在交叉点落子，先将五枚己方棋子横、竖或斜向连成一线获胜。满盘未分胜负则和棋。' },
  { id: 'connect-four', name: '四子连线', subtitle: '七列下落 · 抢先连四', status: 'online', icon: 'connect-four', accent: 'amber', players: '2 人', duration: '5–10 分钟', difficulty: '易上手', categories: ['quick', 'strategy'], rules: '双方轮流选择一列投放棋子，棋子会落在该列最低空位。先横、竖或斜向连成四子者获胜。', newGame: true },
  { id: 'reversi', name: '黑白棋', subtitle: '夹住棋子 · 翻转阵地', status: 'online', icon: 'reversi', accent: 'jade', players: '2 人', duration: '15–25 分钟', difficulty: '中等', categories: ['strategy'], rules: '轮流在合法位置落子，把夹在新棋子与己方旧棋子之间的对方棋子翻为己方。双方都无棋可下时，棋子多者获胜。', newGame: true },
  { id: 'dots-and-boxes', name: '点格棋', subtitle: '连点封格 · 连续得分', status: 'online', icon: 'dots-and-boxes', accent: 'blue', players: '2 人', duration: '5–10 分钟', difficulty: '易上手', categories: ['quick'], rules: '轮流连接相邻两点。画出一个格子的第四条边可得 1 分并继续画边；全部边画完后，得分高者获胜。', newGame: true },
  { id: 'quoridor', name: '路墙棋', subtitle: '先到对岸 · 用墙绕路', status: 'online', icon: 'quoridor', accent: 'jade', players: '2 人', duration: '15–25 分钟', difficulty: '中等', categories: ['strategy'], rules: '每回合走一步或放一堵墙。墙可以阻挡对手，但不能封死任何一方的通路。先让棋子到达对岸获胜。' },
  { id: 'twenty-four', name: '24 点速度对决', subtitle: '四牌抢答 · 先得 5 分', status: 'online', icon: 'twenty-four', accent: 'blue', players: '2 人', duration: '5–15 分钟', difficulty: '易上手', categories: ['quick'], rules: '用四张牌的数字各一次，通过加减乘除和括号算出 24。双方同时抢答，先得到 5 分者获胜。' },
  { id: 'texas-holdem', name: '德州扑克', subtitle: '好友牌局 · 比较牌型', status: 'online', icon: 'texas-holdem', accent: 'amber', players: '2–4 人', duration: '多手牌局，时长随节奏', difficulty: '需熟悉规则', categories: ['party', 'strategy'], rules: '每人持有两张底牌，与桌面五张公共牌组合成最佳五张牌。每轮可跟注、加注或弃牌；只使用局内娱乐筹码，不涉及现金。' },
  { id: 'go', name: '围棋', subtitle: '规则确认中', status: 'soon', icon: 'go', accent: 'ink' },
  { id: 'guanpai', name: '关牌', subtitle: '规则确认中', status: 'soon', icon: 'cards', accent: 'ink' },
  { id: 'zhajinhua', name: '炸金花', subtitle: '规则确认中', status: 'soon', icon: 'cards', accent: 'ink' },
  { id: 'luosong', name: '罗松', subtitle: '规则确认中', status: 'soon', icon: 'cards', accent: 'ink' },
  { id: 'niuniu', name: '牛牛', subtitle: '规则确认中', status: 'soon', icon: 'cards', accent: 'ink' },
];

export const gameNames: Record<GameId, string> = {
  splendor: '璀璨宝石',
  gomoku: '五子棋',
  'connect-four': '四子连线',
  reversi: '黑白棋',
  'dots-and-boxes': '点格棋',
  quoridor: '路墙棋',
  'twenty-four': '24 点速度对决',
  'texas-holdem': '德州扑克',
};
