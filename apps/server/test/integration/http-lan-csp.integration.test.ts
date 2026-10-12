import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGameHallServer, type RunningGameHallServer } from '../../src/server';

const running: RunningGameHallServer[] = [];

afterEach(async () => {
  for (const server of running.splice(0).reverse()) await server.close();
});

async function start(isProduction: boolean): Promise<RunningGameHallServer> {
  const server = await createGameHallServer({
    databasePath: ':memory:', host: '127.0.0.1', port: 0, isProduction, isTest: true,
    publicOrigin: isProduction ? 'https://gamehall.example' : 'http://192.168.8.138:3000',
    allowedOrigins: new Set(['http://192.168.8.138:3000']),
    webDistPath: path.resolve('test', 'missing-web-dist'),
  }).start();
  running.push(server);
  return server;
}

describe('HTTP LAN content security policy', () => {
  it('keeps security directives while allowing plain HTTP dev assets to load', async () => {
    const server = await start(false);
    const plain = await fetch(`${server.url}/healthz`);
    expect(plain.status).toBe(200);
    const policy = plain.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain('upgrade-insecure-requests');
    expect(plain.headers.get('x-content-type-options')).toBe('nosniff');

    const secureProxy = await fetch(`${server.url}/healthz`, { headers: { 'X-Forwarded-Proto': 'https' } });
    expect(secureProxy.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
  });

  it('retains HTTPS upgrade policy for production even on a direct HTTP request', async () => {
    const server = await start(true);
    const response = await fetch(`${server.url}/healthz`);
    expect(response.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
  });
});
