import { describe, expect, it } from 'vitest';
import { deltaE00, labToLinearSrgb, linearSrgbToLab, srgbDecode, srgbEncode } from '../../src/core/color/lab';
import { bradfordAdaptation, inverse3, mul3, mul3Vec, D50_XY, D65_XY, deriveCscFromDng, IDENTITY3 } from '../../src/core/color/matrices';

describe('color math', () => {
  it('inverts a matrix', () => {
    const m = [2, 0.2, 0.1, 0.3, 1.5, 0.2, 0.1, 0.4, 1.1] as const;
    const inv = inverse3([...m] as unknown as [number, number, number, number, number, number, number, number, number])!;
    const id = mul3([...m] as never, inv);
    for (let i = 0; i < 9; i++) expect(id[i]).toBeCloseTo(IDENTITY3[i], 9);
  });

  it('Bradford D50->D65 maps white to white', () => {
    const a = bradfordAdaptation(D50_XY, D65_XY);
    const d50 = [0.96422, 1, 0.82521];
    const d65 = mul3Vec(a, d50 as [number, number, number]);
    expect(d65[0]).toBeCloseTo(0.95047, 3);
    expect(d65[1]).toBeCloseTo(1, 6);
    expect(d65[2]).toBeCloseTo(1.08883, 3);
  });

  it('sRGB transfer round-trips', () => {
    for (const v of [0, 0.001, 0.003, 0.0031308, 0.02, 0.18, 0.5, 1]) {
      expect(srgbDecode(srgbEncode(v))).toBeCloseTo(v, 9);
    }
  });

  it('linear sRGB -> Lab -> linear sRGB round-trips', () => {
    const v = [0.18, 0.4, 0.7];
    const lab = linearSrgbToLab(v as [number, number, number]);
    const back = labToLinearSrgb(lab);
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(v[i], 5);
  });

  it('derives identity CSC without metadata', () => {
    const r = deriveCscFromDng(null);
    expect(r.source).toBe('identity');
    expect(r.matrix).toEqual(IDENTITY3);
  });
});

describe('CIEDE2000', () => {
  const cases: Array<[number[], number[], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0],
    [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, -1, 2], [50, 0, 0], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.001], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
    [[50, 2.49, -0.001], [50, -2.49, 0.0012], 7.2195],
    [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
    [[50, -0.001, 2.49], [50, 0.001, -2.49], 4.8045],
    [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
    [[50, 2.5, 0], [50, 3.2972, 0], 1.0],
    [[50, 2.5, 0], [50, 1.8634, 0.5757], 1.0],
    [[50, 2.5, 0], [50, 3.2592, 0.335], 1.0],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
    [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
    [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [a, b, expected] of cases) {
    it(`matches Sharma vector ${expected}`, () => {
      expect(deltaE00(a as [number, number, number], b as [number, number, number])).toBeCloseTo(expected, 3);
    });
  }
});
