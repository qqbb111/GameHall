import { useId } from 'react';
import type { TokenColor } from '@gamehall/game-core';

const shapes: Record<TokenColor, number[][]> = {
  white: [[8,6],[24,6],[30,13],[16,29],[2,13]],
  blue: [[10,3],[22,3],[29,10],[29,22],[22,29],[10,29],[3,22],[3,10]],
  green: [[10,2],[22,2],[27,7],[27,25],[22,30],[10,30],[5,25],[5,7]],
  red: [[16,2],[29,10],[29,22],[16,30],[3,22],[3,10]],
  black: [[16,2],[30,28],[2,28]],
  gold: [[8,6],[24,6],[30,25],[2,25]],
};
const palettes: Record<TokenColor, [string, string, string]> = {
  white: ['#ffffff', '#bfdfeb', '#476d88'], blue: ['#b4eaff', '#268be6', '#102f80'],
  green: ['#bcffe0', '#20be86', '#07523f'], red: ['#ffd2dd', '#e54972', '#780d35'],
  black: ['#dfd9f4', '#71648e', '#211d35'], gold: ['#fff3bf', '#dca342', '#815017'],
};

/** Shared silhouettes; detailed facets are reserved for the larger illustrations. */
export function GemMark({ color, detailed = false }: { color: TokenColor; detailed?: boolean }) {
  const id = useId();
  const outer = shapes[color]!;
  const centerY = color === 'black' ? 19 : 16;
  const inner = outer.map(([x, y]) => [16 + (x! - 16) * .56, centerY + (y! - centerY) * .56]);
  const points = (vertices: number[][]) => vertices.map((point) => point.join(',')).join(' ');
  const [light, body, dark] = palettes[color];
  return <span className={`gem-mark gem-${color} ${detailed ? 'gem-detailed' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 32 34" focusable="false">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={light} /><stop offset=".4" stopColor={body} /><stop offset="1" stopColor={dark} /></linearGradient>
        <linearGradient id={`${id}-table`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor={light} stopOpacity=".95" /><stop offset=".35" stopColor={body} /><stop offset=".7" stopColor={dark} /><stop offset="1" stopColor={light} /></linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff" stopOpacity=".9" /><stop offset=".5" stopColor={light} stopOpacity=".12" /><stop offset="1" stopColor={dark} /></linearGradient>
      </defs>
      <polygon points={points(outer)} transform="translate(0 1.4)" fill={dark} />
      <polygon points={points(outer)} fill={`url(#${id}-body)`} />
      {outer.map((point, index) => {
        const next = (index + 1) % outer.length;
        return <g key={index}>
          <polygon points={points([point, outer[next]!, inner[next]!, inner[index]!])} fill={index < outer.length / 2 ? light : dark} opacity={index % 2 ? '.6' : '.25'} />
          {detailed && <polygon points={points([point, inner[next]!, inner[index]!])} fill={index % 2 ? '#fff' : body} opacity=".22" />}
        </g>;
      })}
      <polygon points={points(inner)} fill={`url(#${id}-table)`} stroke={light} strokeOpacity=".6" strokeWidth=".35" />
      <polygon points={points(outer)} fill="none" stroke={`url(#${id}-edge)`} strokeWidth=".7" strokeLinejoin="round" />
      {detailed && <><path d="M10 10L20 8L13 16Z" fill="#fff" opacity=".3" /><path d="M9 7v4M7 9h4" stroke="#fff" strokeWidth=".6" strokeLinecap="round" opacity=".9" /></>}
    </svg>
  </span>;
}
