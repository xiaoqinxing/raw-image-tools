import { describe, expect, it } from 'vitest';
import { fitColorChecker } from '../../src/core/colorchecker/fit';
import { chromaGainStats } from '../../src/core/color/ccm';
import { applyHomography, homographyFromCorners } from '../../src/core/colorchecker/geometry';
import { COLOR_CHECKER_CLASSIC_24 } from '../../src/core/color/colorchecker-data';
import { inverse3, mul3Vec } from '../../src/core/color/matrices';
import { srgbDecode } from '../../src/core/color/lab';
import type { Mat3, Point } from '../../src/core/types';

const CAMERA_FROM_SRGB: Mat3 = [
  0.70, 0.20, 0.10,
  0.15, 0.75, 0.10,
  0.10, 0.15, 0.75,
];

/**
 * Rasterize a fake camera capture of the 24-patch chart through a perspective
 * homography and a camera→sRGB transform, then verify the user-facing fit
 * path (sampling + LS + ΔE00 optimization) recovers it.
 */
function makeChart(
  exposure = 1,
  wbGains: [number, number, number] = [1, 1, 1],
): { pixels: Float32Array; w: number; h: number; corners: [Point, Point, Point, Point] } {
  const w = 640;
  const h = 440;
  const pixels = new Float32Array(w * h * 4);
  const corners: [Point, Point, Point, Point] = [
    { x: 24, y: 18 },
    { x: 618, y: 30 },
    { x: 606, y: 418 },
    { x: 18, y: 408 },
  ];
  const hg = homographyFromCorners(corners)!;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const patch = COLOR_CHECKER_CLASSIC_24[r * 6 + c];
      const lin: [number, number, number] = [
        srgbDecode(patch.srgb[0] / 255),
        srgbDecode(patch.srgb[1] / 255),
        srgbDecode(patch.srgb[2] / 255),
      ];
      const cam = mul3Vec(CAMERA_FROM_SRGB, lin).map((v, i) => v * exposure * wbGains[i]) as [number, number, number];
      const u0 = (c + 0.04) / 6;
      const u1 = (c + 0.96) / 6;
      const v0 = (r + 0.04) / 4;
      const v1 = (r + 0.96) / 4;
      for (let v = v0; v < v1; v += 0.0008) {
        for (let u = u0; u < u1; u += 0.0008) {
          const p = applyHomography(hg, u, v);
          const x = Math.round(p.x);
          const y = Math.round(p.y);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = (y * w + x) * 4;
          pixels[i] = cam[0];
          pixels[i + 1] = cam[1];
          pixels[i + 2] = cam[2];
          pixels[i + 3] = 1;
        }
      }
    }
  }
  return { pixels, w, h, corners };
}

describe('ColorChecker fit path', () => {
  it('recovers a perspective-corrected chart through a non-symmetric camera matrix', () => {
    const { pixels, w, h, corners } = makeChart();
    const result = fitColorChecker({
      pixels,
      width: w,
      height: h,
      corners,
      referenceId: 'classic24-pre2014-d65',
      inset: 0.5,
    });
    expect(result.validCount).toBeGreaterThanOrEqual(20);
    expect(result.meanDE00).toBeLessThan(0.1);
    expect(result.maxDE00).toBeLessThan(0.5);
    // CCM now directly holds the camera -> linear sRGB profile. The synthetic
    // chart applies CAMERA_FROM_SRGB as sRGB -> camera, so the fit recovers its inverse.
    const cameraToSrgb = inverse3(CAMERA_FROM_SRGB)!;
    expect(result.matrixCcm[0]).toBeCloseTo(cameraToSrgb[0], 2);
    expect(result.matrixCcm[4]).toBeCloseTo(cameraToSrgb[4], 2);
    expect(result.matrixCcm[8]).toBeCloseTo(cameraToSrgb[8], 2);
    // A recovered camera matrix must not invent a chroma boost.
    expect(result.saturationGain).toBeCloseTo(100, 0);
    expect(result.saturationCount).toBe(18);
  });

  it('is independent of chart exposure and residual WB gain', () => {
    for (const [exposure, gains] of [
      [0.6, [1, 1, 1]],
      [1.6, [1, 1, 1]],
      [1.0, [1.3, 1, 0.8]],
    ] as Array<[number, [number, number, number]]>) {
      const { pixels, w, h, corners } = makeChart(exposure, gains);
      const result = fitColorChecker({
        pixels,
        width: w,
        height: h,
        corners,
        inset: 0.5,
      });
      expect(result.meanDE00).toBeLessThan(0.1);
      expect(result.maxDE00).toBeLessThan(0.5);
    }
  });

  it('applies per-patch weights and ignores a zero-weight patch in the fit', () => {
    const { pixels, w, h, corners } = makeChart();
    const weights = Array.from({ length: 24 }, () => 1);
    weights[23] = 0;
    const result = fitColorChecker({
      pixels,
      width: w,
      height: h,
      corners,
      inset: 0.5,
      weights,
    });
    expect(result.usedCount).toBe(23);
    expect(result.weights?.[23]).toBe(0);
    expect(result.patches[23].used).toBe(false);
    expect(result.meanDE00).toBeLessThan(0.1);
  });

  it('exposes adjusted targets and standard-reference metrics', () => {
    const { pixels, w, h, corners } = makeChart();
    const result = fitColorChecker({
      pixels,
      width: w,
      height: h,
      corners,
      inset: 0.5,
      target: { saturation: 120, hue: 8 },
    });
    expect(result.targetSaturation).toBe(120);
    expect(result.targetHue).toBe(8);
    expect(result.meanDE00Standard).toBeTypeOf('number');
    expect(result.warnings.join(' ')).toContain('目标已调整');
    expect(result.samples?.length).toBe(24);
    expect(result.samples?.[0].quad.length).toBe(4);
    // Raising the target saturation must raise the achieved chroma above the
    // standard reference, and the relative-to-target figure stays meaningful.
    expect(result.saturationGain).toBeGreaterThan(105);
    expect(result.saturationGainTarget).toBeTypeOf('number');
    expect(result.saturationCount).toBe(18);
  });

  it('reports the chroma-priority objective and components', () => {
    const { pixels, w, h, corners } = makeChart();
    const result = fitColorChecker({
      pixels,
      width: w,
      height: h,
      corners,
      inset: 0.5,
      objective: 'chroma',
    });
    expect(result.objective).toBe('chroma');
    expect(result.meanChromaError).toBeTypeOf('number');
    expect(result.patches[0].dEChroma).toBeTypeOf('number');
  });
});

const lab = (L: number, a: number, b: number): [number, number, number] => [L, a, b];

describe('chroma gain statistics', () => {
  it('reports 100% when the measured chroma matches the reference', () => {
    const stats = chromaGainStats([
      { measuredLab: lab(50, 40, 0), refLab: lab(50, 40, 0), weight: 1 },
      { measuredLab: lab(60, 0, 30), refLab: lab(60, 0, 30), weight: 2 },
    ]);
    expect(stats.gain).toBeCloseTo(100, 9);
    expect(stats.gainTarget).toBeCloseTo(100, 9);
    expect(stats.count).toBe(2);
  });

  it('reports 120% when every chroma is boosted by 20%', () => {
    const stats = chromaGainStats([
      { measuredLab: lab(50, 48, 0), refLab: lab(50, 40, 0), weight: 1 },
      { measuredLab: lab(60, 0, 36), refLab: lab(60, 0, 30), weight: 3 },
    ]);
    expect(stats.gain).toBeCloseTo(120, 9);
    expect(stats.gainTarget).toBeCloseTo(120, 9);
  });

  it('compares against the standard reference when the target is adjusted', () => {
    const stats = chromaGainStats([
      { measuredLab: lab(50, 48, 0), refLab: lab(50, 48, 0), standardRefLab: lab(50, 40, 0), weight: 1 },
    ]);
    expect(stats.gain).toBeCloseTo(120, 9);
    expect(stats.gainTarget).toBeCloseTo(100, 9);
  });

  it('ignores zero weights and neutral patches', () => {
    const stats = chromaGainStats([
      { measuredLab: lab(50, 0, 0), refLab: lab(50, 0, 0), weight: 1 },
      { measuredLab: lab(50, 80, 0), refLab: lab(50, 40, 0), weight: 0 },
      { measuredLab: lab(50, 40, 0), refLab: lab(50, 40, 0), weight: 2 },
    ]);
    expect(stats.count).toBe(1);
    expect(stats.gain).toBeCloseTo(100, 9);
  });

  it('returns a safe NaN when nothing contributes', () => {
    const stats = chromaGainStats([]);
    expect(stats.count).toBe(0);
    expect(Number.isNaN(stats.gain)).toBe(true);
    expect(Number.isNaN(stats.gainTarget)).toBe(true);
  });
});
