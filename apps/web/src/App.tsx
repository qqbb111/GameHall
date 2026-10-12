import { useEffect, useRef, useState } from 'react';
import { HomePage } from './HomePage';
import { RoomPage } from './RoomPage';
import { SoloPracticePage } from './SoloPracticePage';
import { rememberNickname } from './client-preferences';
import { useGameHallClient } from './gamehall-client';
import type { SoloGameId } from './solo-ai';

export function App() {
  const client = useGameHallClient();
  const [practiceGame, setPracticeGame] = useState<SoloGameId | null>(null);
  const view = practiceGame ? `practice:${practiceGame}` : client.room ? `room:${client.room.roomId}` : 'home';
  const previousView = useRef(view);

  useEffect(() => {
    const room = client.room;
    if (!room) return;
    const me = room.members.find((member) => member.seat === room.mySeat);
    if (me) rememberNickname(me.nickname);
  }, [client.room]);

  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (view === 'home' || view.startsWith('practice:')) document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }, [view]);

  if (practiceGame) return <SoloPracticePage key={practiceGame} gameId={practiceGame} recoveredRoom={!!client.room} onExit={() => setPracticeGame(null)} />;
  return client.room ? <RoomPage client={client} /> : <HomePage client={client} onPractice={setPracticeGame} />;
}
