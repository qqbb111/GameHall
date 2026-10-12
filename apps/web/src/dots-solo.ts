import { applyDotsAndBoxesAction, type DotsAndBoxesAction, type DotsAndBoxesState, type Player } from '@gamehall/game-core';
import type { SoloDifficulty } from './solo-ai';

export type DotsEdge = Extract<DotsAndBoxesAction, { type: 'drawEdge' }>;
export const DOTS_SEARCH_LIMIT = { easy: 700, thoughtful: 5_000 } as const;

export function openDotsEdges(state: DotsAndBoxesState): DotsEdge[] {
  const edges: DotsEdge[] = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
    if (state.horizontal[row * 3 + col] === null) edges.push({ type: 'drawEdge', orientation: 'H', row, col });
  }
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
    if (state.vertical[row * 4 + col] === null) edges.push({ type: 'drawEdge', orientation: 'V', row, col });
  }
  return edges;
}

export function dotsAfter(state: DotsAndBoxesState, edge: DotsEdge): DotsAndBoxesState {
  const result = applyDotsAndBoxesAction(state, state.turn, edge);
  if (!result.ok) throw new Error('invalid dots edge');
  return result.state;
}

function danger(state: DotsAndBoxesState): number {
  let count = 0;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    if (state.boxes[row * 3 + col] !== null) continue;
    const sides = Number(state.horizontal[row * 3 + col] !== null) + Number(state.horizontal[(row + 1) * 3 + col] !== null)
      + Number(state.vertical[row * 4 + col] !== null) + Number(state.vertical[row * 4 + col + 1] !== null);
    if (sides === 3) count++;
  }
  return count;
}

function score(state: DotsAndBoxesState, player: Player): number {
  const rival: Player = player === 0 ? 1 : 0;
  const difference = state.scores[player] - state.scores[rival];
  if (state.phase === 'finished') return difference * 100;
  return difference * 24 + (state.turn === player ? 2 : -2) - danger(state) * (state.turn === player ? -5 : 5);
}

function candidates(state: DotsAndBoxesState): Array<{ edge: DotsEdge; next: DotsAndBoxesState; priority: number }> {
  const beforeDanger = danger(state);
  return openDotsEdges(state).map((edge) => {
    const next = dotsAfter(state, edge);
    const gained = next.scores[state.turn] - state.scores[state.turn];
    // Captures first, then edges that do not create a third side for the rival.
    return { edge, next, priority: gained * 100 - (danger(next) - beforeDanger) * 20 };
  }).sort((a, b) => b.priority - a.priority);
}

function search(state: DotsAndBoxesState, player: Player, depth: number, alpha: number, beta: number, budget: { nodes: number; limit: number }): number {
  budget.nodes++;
  if (state.phase === 'finished' || depth === 0 || budget.nodes >= budget.limit) return score(state, player);
  const maximizing = state.turn === player;
  let best = maximizing ? -Infinity : Infinity;
  for (const { next } of candidates(state)) {
    const value = search(next, player, depth - 1, alpha, beta, budget);
    best = maximizing ? Math.max(best, value) : Math.min(best, value);
    if (maximizing) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
    if (alpha >= beta || budget.nodes >= budget.limit) break;
  }
  return Number.isFinite(best) ? best : score(state, player);
}

export function chooseDotsMove(state: DotsAndBoxesState, difficulty: SoloDifficulty, stats?: { nodes: number }): DotsEdge {
  if (state.phase !== 'playing') throw new Error('finished dots game');
  const moves = candidates(state);
  if (!moves.length) throw new Error('no dots edges');
  if (difficulty === 'easy' && moves[0]!.next.scores[state.turn] - state.scores[state.turn] === 2) return moves[0]!.edge;
  const budget = { nodes: 0, limit: DOTS_SEARCH_LIMIT[difficulty] };
  const depth = difficulty === 'easy' ? 3 : 7;
  let selected = moves[0]!.edge, best = -Infinity;
  for (const { edge, next, priority } of moves) {
    if (budget.nodes >= budget.limit) break;
    const value = search(next, state.turn, depth - 1, -Infinity, Infinity, budget) + priority * 0.01;
    if (value > best) { best = value; selected = edge; }
  }
  if (stats) stats.nodes = budget.nodes;
  return selected;
}

export function dotsHint(state: DotsAndBoxesState): { action: DotsEdge; reason: string } {
  if (state.phase !== 'playing' || state.turn !== 0) throw new Error('hint requires a human turn');
  const action = chooseDotsMove(state, 'thoughtful');
  const next = dotsAfter(state, action);
  const gain = next.scores[0] - state.scores[0];
  return { action, reason: gain ? next.phase === 'finished' ? `这条边能立即获得 ${gain} 分，并结束本局。` : `这条边能立即获得 ${gain} 分，封格后你还能继续画边。` : danger(next) === 0
    ? '这条边暂不送出可立即封闭的格子；你也可以选择其他空边。'
    : '结合后续封格机会，建议考虑这条空边；你仍可自由选择。' };
}
