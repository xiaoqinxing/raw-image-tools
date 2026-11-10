import type { ColorCheckerTarget } from '../types';
import {
  labToLinearSrgb,
  labToLch,
  lchToLab,
  linearSrgbToLab,
  type Lab,
  type Lch,
} from './lab';

export interface AdjustedTargets {
  /** Linear sRGB targets used by the least-squares step. */
  linear: Array<[number, number, number]>;
  /** Lab targets used by the ΔE00 / chroma objective. */
  lab: Lab[];
  /** True when chroma had to be reduced to stay inside sRGB. */
  clipped: boolean[];
  gamutClippedCount: number;
}

export function isLinearSrgbInGamut(rgb: [number, number, number], eps = 1e-6): boolean {
  return rgb.every((v) => Number.isFinite(v) && v >= -eps && v <= 1 + eps);
}

/**
 * Keep L* and hue, reduce chroma until the colour fits in linear sRGB.
 * This is the least surprising target mapping for a 3×3 CCM fit.
 */
export function gamutMapLab(lab: Lab): { rgb: [number, number, number]; lab: Lab; clipped: boolean } {
  const clampedL: Lab = [Math.max(0, Math.min(100, lab[0])), lab[1], lab[2]];
  const direct = labToLinearSrgb(clampedL);
  if (isLinearSrgbInGamut(direct)) {
    const rgb = direct.map((v) => Math.max(0, Math.min(1, v))) as [number, number, number];
    return { rgb, lab: linearSrgbToLab(rgb), clipped: false };
  }

  const lch = labToLch(clampedL);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const test = lchToLab({ ...lch, C: lch.C * mid } satisfies Lch);
    if (isLinearSrgbInGamut(labToLinearSrgb(test))) lo = mid;
    else hi = mid;
  }
  const mapped = lchToLab({ ...lch, C: lch.C * lo } satisfies Lch);
  const rgb = labToLinearSrgb(mapped).map((v) => Math.max(0, Math.min(1, v))) as [number, number, number];
  return { rgb, lab: linearSrgbToLab(rgb), clipped: true };
}

/**
 * Apply a global target saturation/hue to the reference patches.
 * Neutral patches are protected so a look adjustment cannot tint the grays.
 */
export function adjustReferenceTargets(
  linear: Array<[number, number, number]>,
  labs: Lab[],
  target: ColorCheckerTarget,
): AdjustedTargets {
  const saturation = Math.max(0, Math.min(200, target.saturation)) / 100;
  const hue = Math.max(-60, Math.min(60, target.hue));
  if (Math.abs(saturation - 1) < 1e-9 && Math.abs(hue) < 1e-9) {
    return {
      linear: linear.map((v) => [...v] as [number, number, number]),
      lab: labs.map((v) => [...v] as Lab),
      clipped: linear.map(() => false),
      gamutClippedCount: 0,
    };
  }

  const outLinear: Array<[number, number, number]> = [];
  const outLab: Lab[] = [];
  const clipped: boolean[] = [];
  for (let i = 0; i < linear.length; i++) {
    const originalLab = labs[i] ?? linearSrgbToLab(linear[i]);
    const lch = labToLch(originalLab);
    if (lch.C < 0.5) {
      outLinear.push([...linear[i]] as [number, number, number]);
      outLab.push([...originalLab] as Lab);
      clipped.push(false);
      continue;
    }
    const adjusted: Lab = lchToLab({
      L: Math.max(0, Math.min(100, lch.L)),
      C: lch.C * saturation,
      h: lch.h + hue,
    });
    const mapped = gamutMapLab(adjusted);
    outLinear.push(mapped.rgb);
    outLab.push(mapped.lab);
    clipped.push(mapped.clipped);
  }
  return {
    linear: outLinear,
    lab: outLab,
    clipped,
    gamutClippedCount: clipped.filter(Boolean).length,
  };
}
