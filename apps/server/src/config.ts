import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ServerConfig = {
  host: string;
  port: number;
  databasePath: string;
  publicOrigin: string;
  allowedOrigins: Set<string>;
  isProduction: boolean;
  isTest: boolean;
  webDistPath: string;
};

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '3000');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
  return port;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';
  const renderOrigin = process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '';
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? (isProduction ? renderOrigin : 'http://127.0.0.1:5173');
  if (isProduction && !publicOrigin && !overrides.publicOrigin) throw new Error('PUBLIC_ORIGIN is required in production');
  const defaultOrigins = isProduction
    ? publicOrigin
    : `${publicOrigin},http://localhost:5173,http://127.0.0.1:5173`;
  const allowed = new Set(
    (process.env.ALLOWED_ORIGINS ?? defaultOrigins)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const defaults: ServerConfig = {
    host: process.env.HOST ?? '0.0.0.0',
    port: parsePort(process.env.PORT),
    databasePath: process.env.DATABASE_PATH ?? path.resolve(process.cwd(), 'storage', 'gamehall.sqlite'),
    publicOrigin,
    allowedOrigins: allowed,
    isProduction,
    isTest,
    webDistPath: fileURLToPath(new URL('../../web/dist', import.meta.url)),
  };
  return { ...defaults, ...overrides };
}
