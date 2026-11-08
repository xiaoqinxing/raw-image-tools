import { describe, expect, it } from 'vitest';
import { fitColorChecker } from '../../src/core/colorchecker/fit';
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
function makeChart(): { pixels: Float32Array; w: number; h: number; corners: [Point, Point, Point, Point] } {
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
      const cam = mul3Vec(CAMERA_FROM_SRGB, lin);
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
    const csc = inverse3(CAMERA_FROM_SRGB)!;
    const result = fitColorChecker({
      pixels,
      width: w,
      height: h,
      corners,
      csc,
      referenceId: 'classic24-pre2014-d65',
      inset: 0.5,
    });
    expect(result.validCount).toBeGreaterThanOrEqual(20);
    expect(result.meanDE00).toBeLessThan(0.1);
    expect(result.maxDE00).toBeLessThan(0.5);
    // The fitted CCM (after removing the known CSC) should be near identity.
    expect(result.matrixCcm[0]).toBeCloseTo(1, 2);
    expect(result.matrixCcm[4]).toBeCloseTo(1, 2);
    expect(result.matrixCcm[8]).toBeCloseTo(1, 2);
  });
});
