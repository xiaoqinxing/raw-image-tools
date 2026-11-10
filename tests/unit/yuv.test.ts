import { describe, expect, it } from 'vitest';
import { applyCscTransform, cscTransform, CSC_STANDARDS, RGB_TO_YUV, YUV_TO_RGB } from '../../src/core/color/yuv';
import { mul3, mul3Vec, IDENTITY3 } from '../../src/core/color/matrices';

describe('CSC YUV matrices', () => {
  for (const standard of CSC_STANDARDS) {
    it(`${standard} Y row sums to 1 and chroma rows sum to 0`, () => {
      const m = RGB_TO_YUV[standard];
      expect(m[0] + m[1] + m[2]).toBeCloseTo(1, 9);
      expect(m[3] + m[4] + m[5]).toBeCloseTo(0, 9);
      expect(m[6] + m[7] + m[8]).toBeCloseTo(0, 9);
    });

    it(`${standard} RGB -> YUV -> RGB round-trips`, () => {
      const id = mul3(YUV_TO_RGB[standard], RGB_TO_YUV[standard]);
      for (let i = 0; i < 9; i++) expect(id[i]).toBeCloseTo(IDENTITY3[i], 6);
    });

    it(`${standard} maps white to Y=1, Cb=Cr=0`, () => {
      const yuv = mul3Vec(RGB_TO_YUV[standard], [1, 1, 1]);
      expect(yuv[0]).toBeCloseTo(1, 9);
      expect(yuv[1]).toBeCloseTo(0, 9);
      expect(yuv[2]).toBeCloseTo(0, 9);
    });
  }
});

describe('CSC adjustments', () => {
  it('neutral adjustments are an exact identity transform', () => {
    const t = cscTransform({ standard: 'bt709', saturation: 100, contrast: 100, hue: 0, brightness: 0 });
    expect(t.matrix).toEqual(IDENTITY3);
    expect(t.offset).toEqual([0, 0, 0]);
  });

  it('saturation 0 produces neutral gray', () => {
    const t = cscTransform({ standard: 'bt709', saturation: 0, contrast: 100, hue: 0, brightness: 0 });
    const out = applyCscTransform(t, [0.8, 0.2, 0.3]);
    expect(out[0]).toBeCloseTo(out[1], 9);
    expect(out[1]).toBeCloseTo(out[2], 9);
  });

  it('contrast pivots around 0.5 in the gamma-encoded domain', () => {
    const t = cscTransform({ standard: 'bt709', saturation: 100, contrast: 200, hue: 0, brightness: 0 });
    const out = applyCscTransform(t, [0.6, 0.6, 0.6]);
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(0.7, 6);
  });

  it('brightness maps -100..100 to -0.5..0.5 on Y', () => {
    const t = cscTransform({ standard: 'bt709', saturation: 100, contrast: 100, hue: 0, brightness: 20 });
    const out = applyCscTransform(t, [0.4, 0.4, 0.4]);
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(0.5, 6);
  });

  it('hue rotation keeps luminance and changes chroma', () => {
    const t = cscTransform({ standard: 'bt709', saturation: 100, contrast: 100, hue: 90, brightness: 0 });
    const out = applyCscTransform(t, [0.8, 0.3, 0.2]);
    const before = applyCscTransform(
      cscTransform({ standard: 'bt709', saturation: 100, contrast: 100, hue: 0, brightness: 0 }),
      [0.8, 0.3, 0.2],
    );
    const y = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(y(out)).toBeCloseTo(y(before), 6);
    expect(out[1]).not.toBeCloseTo(before[1], 3);
  });
});
