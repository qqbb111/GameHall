const nicknameOpeners = [
  '竹影',
  '月下',
  '松间',
  '听雨',
  '云外',
  '山居',
  '临江',
  '闲庭',
  '青石',
  '灯下',
  '长亭',
  '清风',
] as const;

const nicknameClosers = [
  '棋客',
  '闲家',
  '弈者',
  '访客',
  '听松',
  '观棋',
  '拾子',
  '落墨',
  '候月',
  '入局',
  '寻胜',
  '慢手',
] as const;

function randomIndex(length: number, random: () => number): number {
  const value = random();
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999) : 0;
  return Math.floor(normalized * length);
}

export function generateRandomNickname(
  currentNickname = '',
  random: () => number = Math.random,
): string {
  const combinations = nicknameOpeners.length * nicknameClosers.length;
  let index = randomIndex(combinations, random);
  let nickname = `${nicknameOpeners[Math.floor(index / nicknameClosers.length)]}${nicknameClosers[index % nicknameClosers.length]}`;

  if (nickname === currentNickname.trim()) {
    index = (index + 1) % combinations;
    nickname = `${nicknameOpeners[Math.floor(index / nicknameClosers.length)]}${nicknameClosers[index % nicknameClosers.length]}`;
  }

  return nickname;
}
