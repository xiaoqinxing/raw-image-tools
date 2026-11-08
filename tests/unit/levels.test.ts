import { describe, expect, it } from 'vitest';
import { defaultLevelsForBitDepth, normalizeBitDepth } from '../../src/core/raw/levels';

describe('bit-depth default levels', () => {
  it('derives white from the container maximum and black from 1/16 full scale', () => {
    expect(defaultLevelsForBitDepth(8)).toEqual({ black: [16, 16, 16, 16], white: [255, 255, 255, 255] });
    expect(defaultLevelsForBitDepth(10)).toEqual({ black: [64, 64, 64, 64], white: [1023, 1023, 1023, 1023] });
    expect(defaultLevelsForBitDepth(12)).toEqual({ black: [256, 256, 256, 256], white: [4095, 4095, 4095, 4095] });
    expect(defaultLevelsForBitDepth(14)).toEqual({ black: [1024, 1024, 1024, 1024], white: [16383, 16383, 16383, 16383] });
    expect(defaultLevelsForBitDepth(16)).toEqual({ black: [4096, 4096, 4096, 4096], white: [65535, 65535, 65535, 65535] });
  });

  it('normalizes unsupported metadata bit depths to 16-bit', () => {
    expect(normalizeBitDepth(undefined)).toBe(16);
    expect(normalizeBitDepth(9)).toBe(16);
    expect(normalizeBitDepth(12)).toBe(12);
  });
});
