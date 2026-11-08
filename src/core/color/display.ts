import type { ChannelId, Domain, Vec4 } from '../types';
import { srgbEncode } from './lab';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Encode a stage RGB triple for display exactly like the preview shader.
 * `raw-cfa` is a single-channel domain, so the sample is replicated and
 * gamma 2.2 encoded; camera/linear sRGB use sRGB encoding; display sRGB is
 * already encoded.
 */
export function displayRgb(domain: Domain, rgb: readonly [number, number, number], linearView = false): [number, number, number] {
  if (domain === 'raw-cfa') {
    const v = Math.pow(clamp01(rgb[0]), 1 / 2.2);
    return [v, v, v];
  }
  if (domain === 'camera-rgb' || domain === 'linear-srgb') {
    if (domain === 'linear-srgb' && linearView) {
      return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
    }
    return [srgbEncode(clamp01(rgb[0])), srgbEncode(clamp01(rgb[1])), srgbEncode(clamp01(rgb[2]))];
  }
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}

export function toRgb8(display: readonly [number, number, number]): [number, number, number] {
  return display.map((v) => Math.round(clamp01(v) * 255)) as [number, number, number];
}

/** Normalize white-balance multipliers to an R:G:B ratio with green = 1. */
export function wbRatios(multipliers: Vec4): [number, number, number] {
  const green = (multipliers[1] + multipliers[2]) / 2;
  const g = Number.isFinite(green) && Math.abs(green) > 1e-9 ? green : 1;
  return [multipliers[0] / g, 1, multipliers[3] / g];
}

/** Collapse Bayer sites to the RGB channel users see on the camera. */
export function cfaChannelLabel(channel: ChannelId): 'R' | 'G' | 'B' {
  if (channel === 'R') return 'R';
  if (channel === 'B') return 'B';
  return 'G';
}
