import { describe, expect, it } from 'vitest';
import { computeVersion, parseGitLog } from '../../src/core/build-info';

describe('build info', () => {
  it('tracks the commit count in the patch component', () => {
    expect(computeVersion('0.1.0', 0)).toBe('0.1.0');
    expect(computeVersion('0.1.0', 1)).toBe('0.1.1');
    expect(computeVersion('0.1.0', 11)).toBe('0.1.11');
    expect(computeVersion('2.3.4', 125)).toBe('2.3.125');
    expect(computeVersion('2.3.4', 125.9)).toBe('2.3.125');
  });

  it('keeps non-semver or negative counts unchanged', () => {
    expect(computeVersion('dev', 8)).toBe('dev');
    expect(computeVersion('0.1.0', -3)).toBe('0.1.0');
    expect(computeVersion('0.1.0', Number.NaN)).toBe('0.1.0');
  });

  it('parses git log fields without losing spaces in subjects', () => {
    const raw = [
      'a'.repeat(40) + '\x1faaaaaaa\x1f2026-11-07\x1ffeat: add version dialog',
      'b'.repeat(40) + '\x1fbbbbbbb\x1f2026-11-06\x1ffix: handle CRLF',
    ].join('\n');
    expect(parseGitLog(raw)).toEqual([
      { sha: 'a'.repeat(40), short: 'aaaaaaa', date: '2026-11-07', subject: 'feat: add version dialog' },
      { sha: 'b'.repeat(40), short: 'bbbbbbb', date: '2026-11-06', subject: 'fix: handle CRLF' },
    ]);
  });

  it('ignores malformed lines', () => {
    expect(parseGitLog('not enough\x1ffields\n')).toEqual([]);
  });
});
