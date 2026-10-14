import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(process.cwd(), 'src');
const fontCss = readFileSync(join(src, 'font-faces.css'), 'utf8');
const styles = readFileSync(join(src, 'styles.css'), 'utf8');
const main = readFileSync(join(src, 'main.tsx'), 'utf8');
const faces = [...fontCss.matchAll(/@font-face\s*\{([^}]*)\}/gs)].map((match) => ({
  family: match[1].match(/font-family:\s*'([^']+)'/)?.[1],
  file: match[1].match(/\.\/assets\/fonts\/([^']+\.woff2)/)?.[1],
  ranges: match[1].match(/unicode-range:\s*([^;]+);/)?.[1],
  body: match[1],
}));

function codepoints(rangeText) {
  const result = new Set();
  for (const token of rangeText.split(',')) {
    const match = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/.exec(token.trim());
    expect(match, `Invalid unicode-range token: ${token}`).not.toBeNull();
    const start = Number.parseInt(match[1], 16);
    const end = match[2] ? Number.parseInt(match[2], 16) : start;
    for (let point = start; point <= end; point += 1) {
      expect(result.has(point), `Overlapping interval: ${token}`).toBe(false);
      result.add(point);
    }
  }
  return result;
}

function sourceText(directory) {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (entry.isDirectory()) {
      return entry.name === 'assets' ? '' : sourceText(join(directory, entry.name));
    }
    if (!/\.(?:tsx?|css|html|json)$/.test(entry.name) || entry.name.includes('.test.') || entry.name === 'font-faces.css') {
      return '';
    }
    return readFileSync(join(directory, entry.name), 'utf8');
  }).join('');
}

describe('self-hosted Chinese fonts', () => {
  it('keeps the initial CSS independent of external font stylesheets', () => {
    expect(fontCss + styles).not.toMatch(/@import\b|fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(main).toContain("import './font-faces.css';");
    expect(styles).toContain("'Noto Sans SC', system-ui, sans-serif");
    expect(faces).toHaveLength(4);
    expect(faces.every(({ body }) => body.includes('font-display: swap'))).toBe(true);
  });

  it('ships four readable local WOFF2 assets with both full licenses', () => {
    expect(new Set(faces.map(({ file }) => file)).size).toBe(4);
    for (const { file } of faces) {
      expect(file).toBeDefined();
      const bytes = readFileSync(join(src, 'assets', 'fonts', file));
      expect(bytes.toString('ascii', 0, 4)).toBe('wOF2');
    }
    for (const license of ['OFL-NotoSansSC.txt', 'OFL-NotoSerifSC.txt']) {
      expect(readFileSync(join(src, 'assets', 'fonts', license), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });

  it('uses disjoint ranges and places current UI characters in each core font', () => {
    const uiText = sourceText(src) + readFileSync(join(src, '..', 'index.html'), 'utf8')
      + readFileSync(join(src, '..', '..', '..', 'packages', 'game-core', 'src', 'sokoban.ts'), 'utf8');
    const uiCharacters = new Set([...uiText].map((character) => character.codePointAt(0))
      .filter((point) => point >= 0x20 && point < 0x1F000 && point !== 0x2304));
    for (const family of ['Noto Sans SC', 'Noto Serif SC']) {
      const core = faces.find((face) => face.family === family && face.file?.includes('-core.woff2'));
      const common = faces.find((face) => face.family === family && face.file?.includes('-common.woff2'));
      expect(core?.ranges).toBeDefined();
      expect(common?.ranges).toBeDefined();
      const corePoints = codepoints(core.ranges);
      const commonPoints = codepoints(common.ranges);
      expect([...corePoints].every((point) => !commonPoints.has(point))).toBe(true);
      expect([...uiCharacters].every((point) => corePoints.has(point))).toBe(true);
    }
  });
});
