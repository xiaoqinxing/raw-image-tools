import type { CscStandard, Mat3 } from '../types';
import { IDENTITY3, inverse3, mul3 } from './matrices';

export type Vec3 = [number, number, number];

/**
 * Full-range, non-constant-luminance RGB -> YCbCr matrices.
 * Y row sums to 1; Cb/Cr rows sum to 0. Input RGB is the working RGB
 * (linear sRGB in this project) already converted to the display transfer
 * function before the CSC stage.
 */
export const RGB_TO_YUV: Record<CscStandard, Mat3> = {
  bt709: [
    0.2126, 0.7152, 0.0722,
    -0.1146, -0.3854, 0.5,
    0.5, -0.4542, -0.0458,
  ],
  bt601: [
    0.299, 0.587, 0.114,
    -0.1687, -0.3313, 0.5,
    0.5, -0.4187, -0.0813,
  ],
  bt2020: [
    0.2627, 0.678, 0.0593,
    -0.1396, -0.3604, 0.5,
    0.5, -0.4598, -0.0402,
  ],
};

export const CSC_STANDARDS: CscStandard[] = ['bt709', 'bt601', 'bt2020'];

export const CSC_STANDARD_LABELS: Record<CscStandard, string> = {
  bt709: 'BT.709',
  bt601: 'BT.601',
  bt2020: 'BT.2020',
};

/** Inverse of a full-range YCbCr matrix, computed once. */
export const YUV_TO_RGB: Record<CscStandard, Mat3> = {
  bt709: inverse3(RGB_TO_YUV.bt709)!,
  bt601: inverse3(RGB_TO_YUV.bt601)!,
  bt2020: inverse3(RGB_TO_YUV.bt2020)!,
};

export interface CscTransform {
  matrix: Mat3;
  offset: Vec3;
}

export interface CscAdjustments {
  standard: CscStandard;
  /** 0..200 (%) */
  saturation: number;
  /** 0..200 (%) */
  contrast: number;
  /** -180..180 degrees */
  hue: number;
  /** -100..100, mapped to -0.5..0.5 */
  brightness: number;
}

const CONTRAST_PIVOT = 0.5;

export function clampCscAdjustments(a: CscAdjustments): CscAdjustments {
  return {
    standard: a.standard,
    saturation: Math.max(0, Math.min(200, a.saturation)),
    contrast: Math.max(0, Math.min(200, a.contrast)),
    hue: Math.max(-180, Math.min(180, a.hue)),
    brightness: Math.max(-100, Math.min(100, a.brightness)),
  };
}

/**
 * Compose RGB -> YUV -> (brightness, contrast, saturation, hue) -> RGB into a
 * single affine transform: out = matrix * rgb + offset.
 */
export function cscTransform(input: CscAdjustments): CscTransform {
  const a = clampCscAdjustments(input);
  const rgbToYuv = RGB_TO_YUV[a.standard];
  const yuvToRgb = YUV_TO_RGB[a.standard];

  const s = a.saturation / 100;
  const c = a.contrast / 100;
  const b = a.brightness / 200;
  const theta = (a.hue * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Y' = c*Y + 0.5*(1-c) + b; Cb/Cr are scaled by saturation then hue-rotated.
  const adjust: Mat3 = [
    c, 0, 0,
    0, s * cos, -s * sin,
    0, s * sin, s * cos,
  ];
  const offsetYuv: Vec3 = [CONTRAST_PIVOT * (1 - c) + b, 0, 0];

  const matrix = mul3(yuvToRgb, mul3(adjust, rgbToYuv));
  const offset: Vec3 = [
    yuvToRgb[0] * offsetYuv[0] + yuvToRgb[1] * offsetYuv[1] + yuvToRgb[2] * offsetYuv[2],
    yuvToRgb[3] * offsetYuv[0] + yuvToRgb[4] * offsetYuv[1] + yuvToRgb[5] * offsetYuv[2],
    yuvToRgb[6] * offsetYuv[0] + yuvToRgb[7] * offsetYuv[1] + yuvToRgb[8] * offsetYuv[2],
  ];

  if (
    a.saturation === 100 &&
    a.contrast === 100 &&
    a.hue === 0 &&
    a.brightness === 0
  ) {
    return { matrix: [...IDENTITY3] as Mat3, offset: [0, 0, 0] };
  }
  return { matrix, offset };
}

export function applyCscTransform(t: CscTransform, rgb: Vec3): Vec3 {
  return [
    t.matrix[0] * rgb[0] + t.matrix[1] * rgb[1] + t.matrix[2] * rgb[2] + t.offset[0],
    t.matrix[3] * rgb[0] + t.matrix[4] * rgb[1] + t.matrix[5] * rgb[2] + t.offset[1],
    t.matrix[6] * rgb[0] + t.matrix[7] * rgb[1] + t.matrix[8] * rgb[2] + t.offset[2],
  ];
}
