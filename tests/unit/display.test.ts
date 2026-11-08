import { describe, expect, it } from 'vitest';
import { cfaChannelLabel, displayRgb, toRgb8, wbRatios } from '../../src/core/color/display';
import { srgbEncode } from '../../src/core/color/lab';

describe('probe display encoding', () => {
  it('encodes camera/linear RGB with the sRGB transfer function', () => {
    const rgb = displayRgb('linear-srgb', [0, 0.18, 1]);
    expect(rgb[0]).toBeCloseTo(0, 9);
    expect(rgb[1]).toBeCloseTo(srgbEncode(0.18), 9);
    expect(rgb[2]).toBeCloseTo(1, 9);
  });

  it('keeps display-sRGB values and clamps out-of-range samples', () => {
    const rgb = displayRgb('display-srgb', [-0.2, 0.5, 1.4]);
    expect(rgb).toEqual([0, 0.5, 1]);
    expect(toRgb8(rgb)).toEqual([0, 128, 255]);
  });

  it('replicates the single raw channel with gamma 2.2', () => {
    const rgb = displayRgb('raw-cfa', [0.25, 0.9, 0.1]);
    const expected = Math.pow(0.25, 1 / 2.2);
    expect(rgb[0]).toBeCloseTo(expected, 9);
    expect(rgb[1]).toBeCloseTo(expected, 9);
    expect(rgb[2]).toBeCloseTo(expected, 9);
  });

  it('maps display values to 8-bit', () => {
    expect(toRgb8([0, 0.5, 1])).toEqual([0, 128, 255]);
  });

  it('shows linear values without the display transform when requested', () => {
    const rgb: [number, number, number] = [0.18, 0.5, 1.4];
    expect(displayRgb('linear-srgb', rgb, true)).toEqual([0.18, 0.5, 1]);
    expect(displayRgb('camera-rgb', rgb, true)).not.toEqual([0.18, 0.5, 1]);
  });

  it('normalizes white-balance multipliers to an R:G:B ratio with green at 1', () => {
    expect(wbRatios([2, 1, 1, 0.5])).toEqual([2, 1, 0.5]);
    expect(wbRatios([1.9, 2, 2, 0.95])).toEqual([0.95, 1, 0.475]);
    expect(wbRatios([1, 0, 0, 1])).toEqual([1, 1, 1]);
  });

  it('collapses Bayer sites to the displayed RGB channel', () => {
    expect(cfaChannelLabel('R')).toBe('R');
    expect(cfaChannelLabel('G1')).toBe('G');
    expect(cfaChannelLabel('G2')).toBe('G');
    expect(cfaChannelLabel('B')).toBe('B');
  });
});
