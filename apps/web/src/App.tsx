import { useEffect, useRef, useState } from 'react';
import { HomePage } from './HomePage';
import { RoomPage } from './RoomPage';
import { SoloPracticePage } from './SoloPracticePage';
import { rememberNickname } from './client-preferences';
import { useGameHallClient } from './gamehall-client';
import type { SoloGameId } from './solo-ai';
import { leavePracticeAddress, practiceFromSearch, pushPracticeAddress } from './solo-navigation';

export function App() {
  const client = useGameHallClient();
  const [practiceRoute, setPracticeRoute] = useState(() => ({ gameId: practiceFromSearch(window.location.search), source: 'initial' as 'initial' | 'push' | 'pop' | 'replace', revision: 0 }));
  const practiceGame = practiceRoute.gameId;
  const view = practiceGame ? `practice:${practiceGame}` : client.room ? `room:${client.room.roomId}` : 'home';
  const previousView = useRef(view);
  const previousRouteRevision = useRef(practiceRoute.revision);

  useEffect(() => {
    const onPopState = () => setPracticeRoute((current) => ({ gameId: practiceFromSearch(window.location.search), source: 'pop', revision: current.revision + 1 }));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const room = client.room;
    if (!room) return;
    const me = room.members.find((member) => member.seat === room.mySeat);
    if (me) rememberNickname(me.nickname);
  }, [client.room]);

  useEffect(() => {
    const routeChanged = previousRouteRevision.current !== practiceRoute.revision;
    previousRouteRevision.current = practiceRoute.revision;
    if (previousView.current === view) return;
    previousView.current = view;
    if (routeChanged && practiceRoute.source === 'pop') return;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (view === 'home' || view.startsWith('practice:')) document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }, [view, practiceRoute]);

  function enterPractice(gameId: SoloGameId) {
    pushPracticeAddress(gameId);
    setPracticeRoute((current) => ({ gameId, source: 'push', revision: current.revision + 1 }));
  }

  function exitPractice() {
    if (leavePracticeAddress() === 'replace') setPracticeRoute((current) => ({ gameId: null, source: 'replace', revision: current.revision + 1 }));
  }

  if (practiceGame) return <SoloPracticePage key={practiceGame} gameId={practiceGame} recoveredRoom={!!client.room} onExit={exitPractice} />;
  return client.room ? <RoomPage client={client} /> : <HomePage client={client} onPractice={enterPractice} />;
}
