import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { palette } from '../../src/ui/palette';
import { MIN_PRIMARY_CONTRAST, MIN_TEXT_CONTRAST, contrastRatio } from '../../src/ui/theme';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(join(rootDir, 'src/styles.css'), 'utf8');
const ink = palette.ink;

function rootVars(): Record<string, string> {
  const block = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error(':root block not found in styles.css');
  return Object.fromEntries(
    [...block[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]),
  );
}

function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!rule) throw new Error(`rule ${selector} not found in styles.css`);
  return Object.fromEntries(
    [...rule[1].matchAll(/([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]),
  );
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });
}

const root = rootVars();
const surfaces = [ink[950], ink[900], ink[850], ink[800]];

describe('workbench palette', () => {
  it('keeps the CSS variables in sync with the shared palette', () => {
    expect(root.bg).toBe(ink[950]);
    expect(root.panel).toBe(ink[850]);
    expect(root['panel-2']).toBe(ink[800]);
    expect(root.line).toBe(ink[700]);
    expect(root['line-2']).toBe(ink[600]);
    expect(root.text).toBe(ink[100]);
    expect(root.accent).toBe(palette.accent);
    expect(root.warn).toBe(palette.warn);
    expect(root.danger).toBe(palette.danger);
    expect(root.ok).toBe(palette.ok);
  });

  it('keeps primary text at a comfortable reading contrast', () => {
    expect(contrastRatio(ink[100], ink[950])).toBeGreaterThanOrEqual(MIN_PRIMARY_CONTRAST);
    expect(contrastRatio(ink[200], ink[950])).toBeGreaterThanOrEqual(12);
  });

  it('keeps every text token readable on every workbench surface', () => {
    const textTokens: Array<[string, string]> = (['100', '200', '300', '400', '500'] as const).map((step) => [
      `ink-${step}`,
      ink[Number(step) as keyof typeof ink],
    ]);
    textTokens.push(['muted', root.muted]);
    for (const [name, color] of textTokens) {
      for (const surface of surfaces) {
        expect(contrastRatio(color, surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    }
  });

  it('keeps status badges readable against their own backgrounds', () => {
    for (const selector of ['.badge-ok', '.badge-warn', '.badge-danger']) {
      const rule = declarations(selector);
      expect(rule.background, selector).toMatch(/^#[0-9a-f]{6}$/);
      expect(rule.color, selector).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(rule.color, rule.background), selector).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it('does not render text with a low-contrast ink step', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(rootDir, 'src'))) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/text-ink-(\d{3})/g)) {
        const step = Number(match[1]) as keyof typeof ink;
        const color = ink[step];
        if (!color || surfaces.some((surface) => contrastRatio(color, surface) < MIN_TEXT_CONTRAST)) {
          offenders.push(`${file.slice(rootDir.length)}: text-ink-${step}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
