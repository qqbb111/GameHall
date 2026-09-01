import { useEffect } from 'react';
import { HomePage } from './HomePage';
import { RoomPage } from './RoomPage';
import { rememberNickname } from './client-preferences';
import { useGameHallClient } from './gamehall-client';

export function App() {
  const client = useGameHallClient();

  useEffect(() => {
    const room = client.room;
    if (!room) return;
    const me = room.members.find((member) => member.seat === room.mySeat);
    if (me) rememberNickname(me.nickname);
  }, [client.room]);

  if (client.loading) {
    return (
      <main className="loading-screen" aria-live="polite">
        <span className="brand-mark"><span /></span>
        <strong>GameHall</strong>
        <p>正在准备好友桌游馆…</p>
      </main>
    );
  }

  return client.room ? <RoomPage client={client} /> : <HomePage client={client} />;
}
