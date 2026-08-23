import { HomePage } from './HomePage';
import { RoomPage } from './RoomPage';
import { useGameHallClient } from './gamehall-client';

export function App() {
  const client = useGameHallClient();

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
