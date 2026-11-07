import type { DngColorMeta, Mat3, Vec4 } from '../types';

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mat3(a: number[]): Mat3 {
  return [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]];
}

export function isMat3(v: unknown): v is Mat3 {
  if (!Array.isArray(v) || v.length !== 9) return false;
  return v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

export function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

export function inverse3(m: Mat3): Mat3 | null {
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const id = 1 / d;
  return [
    (m[4] * m[8] - m[5] * m[7]) * id,
    (m[2] * m[7] - m[1] * m[8]) * id,
    (m[1] * m[5] - m[2] * m[4]) * id,
    (m[5] * m[6] - m[3] * m[8]) * id,
    (m[0] * m[8] - m[2] * m[6]) * id,
    (m[2] * m[3] - m[0] * m[5]) * id,
    (m[3] * m[7] - m[4] * m[6]) * id,
    (m[1] * m[6] - m[0] * m[7]) * id,
    (m[0] * m[4] - m[1] * m[3]) * id,
  ];
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function mul3Vec(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function normalizeRows(m: Mat3): Mat3 {
  const out = [...m] as Mat3;
  for (let r = 0; r < 3; r++) {
    const s = m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2];
    if (Math.abs(s) > 1e-9) {
      out[r * 3] /= s;
      out[r * 3 + 1] /= s;
      out[r * 3 + 2] /= s;
    }
  }
  return out;
}

export function matrixNearIdentity(m: Mat3, eps = 1e-6): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY3[i]) <= eps);
}

export function sanitizeMat3(m: Mat3, fallback: Mat3 = IDENTITY3): Mat3 {
  return isMat3(m) ? m : fallback;
}

export const SRGB_TO_XYZ_D65: Mat3 = [
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.0721750,
  0.0193339, 0.1191920, 0.9503041,
];

export const XYZ_D65_TO_SRGB: Mat3 = [
  3.2404542, -1.5371385, -0.4985314,
  -0.9692660, 1.8760108, 0.0415560,
  0.0556434, -0.2040259, 1.0572252,
];

export const BRADFORD: Mat3 = [
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296,
];

export const BRADFORD_INV: Mat3 = [
  0.9869929, -0.1470543, 0.1599627,
  0.4323053, 0.5183603, 0.0492912,
  -0.0085287, 0.0400428, 0.9684867,
];

export function xyToXYZ(xy: [number, number], Y = 1): [number, number, number] {
  const [x, y] = xy;
  if (y <= 1e-9) return [0, 0, 0];
  return [(x * Y) / y, Y, ((1 - x - y) * Y) / y];
}

/** Bradford chromatic adaptation in XYZ. */
export function bradfordAdaptation(srcXY: [number, number], dstXY: [number, number]): Mat3 {
  const src = xyToXYZ(srcXY);
  const dst = xyToXYZ(dstXY);
  const srcCone = mul3Vec(BRADFORD, src);
  const dstCone = mul3Vec(BRADFORD, dst);
  const scale: Mat3 = [
    dstCone[0] / srcCone[0], 0, 0,
    0, dstCone[1] / srcCone[1], 0,
    0, 0, dstCone[2] / srcCone[2],
  ];
  return mul3(BRADFORD_INV, mul3(scale, BRADFORD));
}

export const D50_XY: [number, number] = [0.34567, 0.3585];
export const D55_XY: [number, number] = [0.33242, 0.34743];
export const D65_XY: [number, number] = [0.31271, 0.32902];
export const D75_XY: [number, number] = [0.29902, 0.31485];
export const A_XY: [number, number] = [0.44757, 0.40745];
export const B_XY: [number, number] = [0.34842, 0.35161];
export const C_XY: [number, number] = [0.31006, 0.31616];
export const F2_XY: [number, number] = [0.37208, 0.37529];
export const F11_XY: [number, number] = [0.38052, 0.37713];

export function illuminantXY(code: number | undefined): [number, number] | null {
  switch (code) {
    case 1: return D65_XY;
    case 2: return F2_XY;
    case 3: return A_XY;
    case 4: return D65_XY;
    case 9: return D65_XY;
    case 10: return D65_XY;
    case 11: return D75_XY;
    case 12: return D65_XY;
    case 13: return D50_XY;
    case 14: return F2_XY;
    case 15: return F11_XY;
    case 16: return A_XY;
    case 17: return B_XY;
    case 18: return C_XY;
    case 19: return D55_XY;
    case 20: return D65_XY;
    case 21: return D75_XY;
    case 22: return D50_XY;
    case 23: return A_XY;
    default: return null;
  }
}

export interface CscResult {
  matrix: Mat3;
  source: 'forward' | 'color' | 'identity';
  warnings: string[];
}

/**
 * Derive the camera-RGB (white balanced) -> linear sRGB matrix from DNG tags.
 * ForwardMatrix is preferred. ColorMatrix is XYZ->camera, so it is inverted.
 */
export function deriveCscFromDng(color: DngColorMeta | null): CscResult {
  const warnings: string[] = [];
  if (!color) {
    return { matrix: IDENTITY3, source: 'identity', warnings: ['没有 DNG 色彩元数据；CSC 使用单位矩阵。'] };
  }
  const fm = color.forwardMatrix1 ?? color.forwardMatrix2;
  if (fm) {
    const adapt = bradfordAdaptation(D50_XY, D65_XY);
    const m = mul3(XYZ_D65_TO_SRGB, mul3(adapt, fm));
    if (!isMat3(m)) return { matrix: IDENTITY3, source: 'identity', warnings: ['ForwardMatrix 含非法数值。'] };
    if (det3(m) === 0) warnings.push('ForwardMatrix 推导矩阵奇异。');
    return { matrix: m, source: 'forward', warnings };
  }
  const cm = color.colorMatrix1 ?? color.colorMatrix2;
  if (cm) {
    const camToXyz = inverse3(cm);
    if (!camToXyz) {
      return { matrix: IDENTITY3, source: 'identity', warnings: ['ColorMatrix 不可逆；CSC 使用单位矩阵。'] };
    }
    const illumCode = color.colorMatrix1 ? color.calibrationIlluminant1 : color.calibrationIlluminant2;
    const srcWhite = illuminantXY(illumCode) ?? color.asShotWhiteXY ?? D65_XY;
    const adapt = bradfordAdaptation(srcWhite, D65_XY);
    const m = mul3(XYZ_D65_TO_SRGB, mul3(adapt, camToXyz));
    if (!isMat3(m)) return { matrix: IDENTITY3, source: 'identity', warnings: ['ColorMatrix 推导结果含非法数值。'] };
    if (color.asShotWhiteXY && !illuminantXY(illumCode)) {
      warnings.push('ColorMatrix 校准光源未知，使用 AsShotWhiteXY 做适应。');
    }
    return { matrix: m, source: 'color', warnings };
  }
  return { matrix: IDENTITY3, source: 'identity', warnings: ['DNG 缺少 ColorMatrix/ForwardMatrix；CSC 使用单位矩阵。'] };
}

export function ccmFromTotal(total: Mat3, csc: Mat3): Mat3 | null {
  const inv = inverse3(csc);
  if (!inv) return null;
  return mul3(inv, total);
}

/** White balance multipliers from AsShotNeutral, normalized to G=1. */
export function wbFromAsShotNeutral(neutral: [number, number, number]): Vec4 {
  const r = neutral[0] > 0 ? 1 / neutral[0] : 1;
  const g = neutral[1] > 0 ? 1 / neutral[1] : 1;
  const b = neutral[2] > 0 ? 1 / neutral[2] : 1;
  const ref = g || 1;
  return [r / ref, 1, 1, b / ref];
}

export function matrixToString(m: Mat3, digits = 6): string {
  return m.map((v, i) => `${v >= 0 ? ' ' : ''}${v.toFixed(digits)}${i % 3 === 2 ? '\n' : ' '}`).join('');
}
