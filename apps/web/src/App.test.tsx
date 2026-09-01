import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameHallClient } from './gamehall-client';
import { NICKNAME_STORAGE_KEY } from './client-preferences';

const mocks = vi.hoisted(() => ({ useClient: vi.fn() }));

vi.mock('./gamehall-client', () => ({ useGameHallClient: mocks.useClient }));
vi.mock('./HomePage', () => ({ HomePage: () => <div>home</div> }));
vi.mock('./RoomPage', () => ({ RoomPage: () => <div>room</div> }));

import { App } from './App';

describe('App nickname persistence', () => {
  afterEach(() => {
    window.localStorage.clear();
    mocks.useClient.mockReset();
  });

  it('房间快照出现后保存服务端确认的本人昵称', async () => {
    mocks.useClient.mockReturnValue({
      loading: false,
      room: {
        roomId: 'room', code: 'ABC234', gameId: 'gomoku', status: 'waiting', version: 1,
        hostSeat: 0, mySeat: 1, pauseReason: null, restartDeadlineMs: null, serverTimeMs: 1_000,
        members: [
          { seat: 0, nickname: '好友', ready: false, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
          { seat: 1, nickname: '规范化昵称', ready: false, rematchReady: false, online: true, disconnectedAtMs: null, disconnectDeadlineMs: null },
        ],
      },
    } as GameHallClient);

    render(<App />);
    await waitFor(() => expect(window.localStorage.getItem(NICKNAME_STORAGE_KEY)).toBe('规范化昵称'));
  });
});
