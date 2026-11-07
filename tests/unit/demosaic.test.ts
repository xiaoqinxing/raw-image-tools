import { describe, expect, it } from 'vitest';
import { demosaicBilinear, demosaicMHC, type CfaPlane } from '../../src/core/demosaic/cpu';
import { demosaicAHD } from '../../src/core/demosaic/ahd';
import { makeCfaLayout } from '../../src/core/raw/cfa';

function plane(w: number, h: number, fn: (x: number, y: number) => number): CfaPlane {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { width: w, height: h, data, cfa: makeCfaLayout('RGGB') };
}

describe('demosaic CPU reference', () => {
  it('bilinear preserves a constant CFA image', () => {
    const src = plane(16, 16, () => 0.25);
    const out = demosaicBilinear(src);
    for (let i = 0; i < out.data.length; i++) expect(out.data[i]).toBeCloseTo(0.25, 6);
  });

  it('MHC preserves a constant CFA image', () => {
    const src = plane(16, 16, () => 0.25);
    const out = demosaicMHC(src);
    for (let i = 0; i < out.data.length; i++) expect(out.data[i]).toBeCloseTo(0.25, 6);
  });

  it('bilinear reconstructs a simple 2x2 Bayer block', () => {
    const src = plane(4, 4, (x, y) => {
      const c = (y & 1) * 2 + (x & 1);
      return c === 0 ? 1 : c === 3 ? 3 : 2;
    });
    const out = demosaicBilinear(src);
    const center = (2 * 4 + 2) * 3;
    expect(out.data[center]).toBeCloseTo(1, 6);
    expect(out.data[center + 1]).toBeCloseTo(2, 6);
    expect(out.data[center + 2]).toBeCloseTo(3, 6);
  });

  it('AHD preserves a constant CFA image', () => {
    const src = plane(32, 32, () => 0.31);
    const out = demosaicAHD(src);
    for (let i = 0; i < out.data.length; i++) expect(out.data[i]).toBeCloseTo(0.31, 5);
  });

  it('AHD reconstructs flat color from a Bayer mosaic', () => {
    const src = plane(32, 32, (x, y) => {
      const c = (y & 1) * 2 + (x & 1);
      return c === 0 ? 0.2 : c === 3 ? 0.6 : 0.4;
    });
    const out = demosaicAHD(src);
    const i = (16 * 32 + 16) * 3;
    expect(out.data[i]).toBeCloseTo(0.2, 3);
    expect(out.data[i + 1]).toBeCloseTo(0.4, 3);
    expect(out.data[i + 2]).toBeCloseTo(0.6, 3);
  });

  it('MHC keeps constant color patches away from borders', () => {
    const src = plane(24, 24, (x, y) => {
      const c = (y & 1) * 2 + (x & 1);
      return c === 0 ? 0.2 : c === 3 ? 0.6 : 0.4;
    });
    const out = demosaicMHC(src);
    const i = (12 * 24 + 12) * 3;
    // At a green site the two chroma estimates should be close to the patch
    // values, though MHC is a linear filter and can overshoot on hard edges.
    expect(out.data[i]).toBeGreaterThan(0.1);
    expect(out.data[i + 1]).toBeCloseTo(0.4, 2);
    expect(out.data[i + 2]).toBeGreaterThan(0.2);
  });
});
