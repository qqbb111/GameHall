import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  external: ['node:sqlite'],
  noExternal: ['@gamehall/game-core', '@gamehall/protocol'],
});
