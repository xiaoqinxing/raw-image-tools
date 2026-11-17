import { describe, expect, it } from 'vitest';
import {
  cfaAt,
  cfaChannelAt,
  effectivePattern,
  isMonoCfa,
  makeCfaLayout,
  patternFromCdesc,
  patternFromFilters,
} from '../../src/core/raw/cfa';

describe('CFA layout', () => {
  it('maps a Y layout to one monochrome channel', () => {
    const cfa = makeCfaLayout('Y', { x: 1, y: 1 });
    expect(cfa.sites).toEqual(['Y', 'Y', 'Y', 'Y']);
    expect(cfa.siteChannels).toEqual([0, 0, 0, 0]);
    expect(cfaAt(cfa, 3, 5)).toBe('Y');
    expect(cfaChannelAt(cfa, 4, 6)).toBe(0);
    expect(effectivePattern(cfa)).toBe('Y');
    expect(isMonoCfa(cfa)).toBe(true);
  });

  it('detects mono from LibRaw cdesc and filters', () => {
    expect(patternFromCdesc('Y')).toBe('Y');
    expect(patternFromCdesc('Y000')).toBe('Y');
    expect(patternFromFilters(0)).toBe('Y');
    expect(patternFromFilters(0x94949494)).toBe('RGGB');
  });

  it('keeps the 2x2 phase for Bayer origins', () => {
    const cfa = makeCfaLayout('RGGB', { x: 1, y: 0 });
    expect(cfa.sites).toEqual(['G1', 'R', 'B', 'G2']);
    expect(isMonoCfa(cfa)).toBe(false);
  });
});
