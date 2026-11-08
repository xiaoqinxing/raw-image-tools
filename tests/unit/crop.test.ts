import { describe, expect, it } from 'vitest';
import { cropForAnalysis } from '../../src/core/analysis/crop';

function pixels(w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = i;
    out[i * 4 + 1] = i + 1000;
    out[i * 4 + 2] = i + 2000;
    out[i * 4 + 3] = 1;
  }
  return out;
}

describe('analysis ROI crop', () => {
  it('returns the full buffer when no ROI is set', () => {
    const src = { width: 4, height: 4, data: pixels(4, 4) };
    expect(cropForAnalysis(src, null, 1, 1, false)).toBe(src);
  });

  it('crops to the requested preview rectangle', () => {
    const src = { width: 8, height: 8, data: pixels(8, 8) };
    const out = cropForAnalysis(src, { x: 2, y: 3, w: 3, h: 2 }, 1, 1, false);
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    expect(out.data[0]).toBe(3 * 8 + 2);
    expect(out.data[3 * 4]).toBe(4 * 8 + 2);
  });

  it('aligns the origin to even pixels for raw CFA stages', () => {
    const src = { width: 8, height: 8, data: pixels(8, 8) };
    const out = cropForAnalysis(src, { x: 3, y: 3, w: 2, h: 2 }, 1, 1, true);
    // Origin is pulled back to (2,2), so the first sample keeps RGGB parity.
    expect(out.data[0]).toBe(2 * 8 + 2);
    expect(out.width & 1).toBe(1);
    expect(out.height & 1).toBe(1);
  });

  it('scales image-space ROIs to preview resolution', () => {
    const src = { width: 4, height: 4, data: pixels(4, 4) };
    const out = cropForAnalysis(src, { x: 0, y: 0, w: 8, h: 8 }, 0.5, 0.5, false);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(out.data[0]).toBe(0);
  });
});
