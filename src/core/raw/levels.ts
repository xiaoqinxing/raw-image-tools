import type { BitDepth, Vec4 } from '../types';

export const SUPPORTED_BIT_DEPTHS: BitDepth[] = [8, 10, 12, 14, 16];

/** Clamp arbitrary metadata bit depths to the values the pipeline supports. */
export function normalizeBitDepth(value: number | undefined): BitDepth {
  return value === 8 || value === 10 || value === 12 || value === 14 || value === 16 ? value : 16;
}

/**
 * Default black/white levels for a sensor bit depth.
 *
 * White is the largest DN the container can represent. Black follows the
 * common sensor convention of 1/16 of full scale: 10-bit -> 64,
 * 12-bit -> 256, 14-bit -> 1024, 16-bit -> 4096.
 */
export function defaultLevelsForBitDepth(bitDepth: number): { black: Vec4; white: Vec4 } {
  const bits = normalizeBitDepth(bitDepth);
  const white = 2 ** bits - 1;
  const black = 2 ** Math.max(0, bits - 4);
  return {
    black: [black, black, black, black],
    white: [white, white, white, white],
  };
}
