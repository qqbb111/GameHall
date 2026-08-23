import { createGameHallServer } from './server';

const application = createGameHallServer();
const running = await application.start();

console.log(JSON.stringify({ level: 'info', event: 'server_started', url: running.url, port: running.port }));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', event: 'server_stopping', signal }));
  await running.close();
  process.exitCode = 0;
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export { createGameHallServer } from './server';
