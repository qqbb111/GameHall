import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTwentyFourState, viewTwentyFourState } from '@gamehall/game-core';
import type { GameSnapshot, RoomSnapshot } from '@gamehall/protocol';
import type { GameHallClient } from './gamehall-client';
import { RoomPage } from './RoomPage';
import { resultMessage } from './room-result';

const state = createTwentyFourState([
  { id: 0, suit: 'S', rank: 1 },
  { id: 14, suit: 'H', rank: 2 },
  { id: 28, suit: 'D', rank: 3 },
  { id: 42, suit: 'C', rank: 4 },
], '1*2*3*4', 1_000);
const base = viewTwentyFourState(state, 1_000);

describe('RoomPage result copy', () => {
  afterEach(() => vi.useRealTimers());

  it('24 点按真实终局原因展示胜负，恢复超时仍产生可见结果', () => {
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: 0, finishReason: 'score' }, 0)).toContain('5 分');
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: 1, finishReason: 'resign' }, 0)).toContain('认输');
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: 0, finishReason: 'disconnect' }, 0)).toContain('超时未重连');
    expect(resultMessage('twenty-four', { ...base, phase: 'finished', winner: null, finishReason: 'restart_timeout' }, 0)).toContain('和局');
  });

  it('本端重连到仍暂停的 24 点房时按权威快照重锚并冻结题钟', () => {
    vi.useFakeTimers();
    const room = (status: RoomSnapshot['status'], serverTimeMs: number): RoomSnapshot => ({
      roomId: 'room', code: 'ABC234', gameId: 'twenty-four', status, version: 1,
      hostSeat: 0, mySeat: 0, pauseReason: status === 'paused' ? 'disconnect' : null,
      restartDeadlineMs: null, serverTimeMs,
      members: [
        { seat: 0, nickname: '我', ready: true, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
        { seat: 1, nickname: '好友', ready: true, rematchReady: false, online: status !== 'paused', disconnectedAtMs: status === 'paused' ? serverTimeMs : null, disconnectDeadlineMs: status === 'paused' ? serverTimeMs + 60_000 : null },
      ],
    });
    const game = (status: GameSnapshot['status'], serverTimeMs: number): GameSnapshot => ({
      roomId: 'room', gameId: 'twenty-four', status, version: 1, mySeat: 0,
      view: { ...base, deadlineAtMs: 31_000, serverNowMs: serverTimeMs }, serverTimeMs,
    });
    const client = (connection: GameHallClient['connection'], roomValue: RoomSnapshot, gameValue: GameSnapshot): GameHallClient => ({
      loading: false, connection, session: { sessionId: 'session', reconnectableRoomCode: null },
      room: roomValue, game: gameValue, error: null, reactions: [], clearError: vi.fn(), reconnect: vi.fn(),
      createRoom: vi.fn(), joinRoom: vi.fn(), setReady: vi.fn(), leaveRoom: vi.fn(),
      submitGameAction: vi.fn(), requestRematch: vi.fn(), sendReaction: vi.fn(),
    }) as GameHallClient;

    const activeRoom = room('active', 1_000);
    const activeGame = game('active', 1_000);
    const rendered = render(<RoomPage client={client('online', activeRoom, activeGame)} />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('timer')).toHaveAccessibleName('本题剩余 29 秒');

    rendered.rerender(<RoomPage client={client('offline', activeRoom, activeGame)} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('timer')).toHaveAccessibleName('本题剩余 29 秒');

    rendered.rerender(<RoomPage client={client('online', room('paused', 11_000), game('paused', 11_000))} />);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('timer')).toHaveAccessibleName('本题剩余 20 秒');
  });
});
