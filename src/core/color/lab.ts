import type { Mat3 } from '../types';
import { SRGB_TO_XYZ_D65 } from './matrices';

export type Lab = [number, number, number];

export const D65_WHITE_XYZ: [number, number, number] = [0.95047, 1.0, 1.08883];

export function srgbDecode(v: number): number {
  const x = Math.max(0, v);
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

export function srgbEncode(v: number): number {
  const x = Math.max(0, v);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

export function linearToSrgbVec(v: [number, number, number]): [number, number, number] {
  return [srgbEncode(v[0]), srgbEncode(v[1]), srgbEncode(v[2])];
}

export function srgbToLinearVec(v: [number, number, number]): [number, number, number] {
  return [srgbDecode(v[0]), srgbDecode(v[1]), srgbDecode(v[2])];
}

export function linearSrgbToXyz(v: [number, number, number]): [number, number, number] {
  return [
    SRGB_TO_XYZ_D65[0] * v[0] + SRGB_TO_XYZ_D65[1] * v[1] + SRGB_TO_XYZ_D65[2] * v[2],
    SRGB_TO_XYZ_D65[3] * v[0] + SRGB_TO_XYZ_D65[4] * v[1] + SRGB_TO_XYZ_D65[5] * v[2],
    SRGB_TO_XYZ_D65[6] * v[0] + SRGB_TO_XYZ_D65[7] * v[1] + SRGB_TO_XYZ_D65[8] * v[2],
  ];
}

export function xyzToLab(xyz: [number, number, number], white: [number, number, number] = D65_WHITE_XYZ): Lab {
  const eps = 216 / 24389;
  const kappa = 24389 / 27;
  const f = (t: number) => (t > eps ? Math.cbrt(t) : (kappa * t + 16) / 116);
  const fx = f(xyz[0] / white[0]);
  const fy = f(xyz[1] / white[1]);
  const fz = f(xyz[2] / white[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz(lab: Lab, white: [number, number, number] = D65_WHITE_XYZ): [number, number, number] {
  const fy = (lab[0] + 16) / 116;
  const fx = fy + lab[1] / 500;
  const fz = fy - lab[2] / 200;
  const eps = 216 / 24389;
  const kappa = 24389 / 27;
  const inv = (f: number) => {
    const c = f * f * f;
    return c > eps ? c : (116 * f - 16) / kappa;
  };
  return [inv(fx) * white[0], inv(fy) * white[1], inv(fz) * white[2]];
}

export function linearSrgbToLab(v: [number, number, number]): Lab {
  return xyzToLab(linearSrgbToXyz(v));
}

export function srgb8ToLab(r: number, g: number, b: number): Lab {
  return linearSrgbToLab([srgbDecode(r / 255), srgbDecode(g / 255), srgbDecode(b / 255)]);
}

export function labToLinearSrgb(lab: Lab): [number, number, number] {
  const xyz = labToXyz(lab);
  return [
    3.2404542 * xyz[0] - 1.5371385 * xyz[1] - 0.4985314 * xyz[2],
    -0.9692660 * xyz[0] + 1.8760108 * xyz[1] + 0.0415560 * xyz[2],
    0.0556434 * xyz[0] - 0.2040259 * xyz[1] + 1.0572252 * xyz[2],
  ];
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function rad(degValue: number): number {
  return (degValue * Math.PI) / 180;
}

export interface DeltaE00Parts {
  dE00: number;
  dC: number;
  dH: number;
  dL: number;
}

export function deltaE00Parts(lab1: Lab, lab2: Lab): DeltaE00Parts {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  const hue = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const h = deg(Math.atan2(b, a));
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    const dh = h2p - h1p;
    if (Math.abs(dh) <= 180) dhp = dh;
    else if (dh > 180) dhp = dh - 360;
    else dhp = dh + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = 0;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else {
    const sum = h1p + h2p;
    if (Math.abs(h1p - h2p) <= 180) hbarp = sum / 2;
    else if (sum < 360) hbarp = (sum + 360) / 2;
    else hbarp = (sum - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.20 * Math.cos(rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * Rc;

  const tL = dLp / SL;
  const tC = dCp / SC;
  const tH = dHp / SH;
  const dE00 = Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
  return { dE00, dC: dCp, dH: dHp, dL: dLp };
}

export function deltaE00(lab1: Lab, lab2: Lab): number {
  return deltaE00Parts(lab1, lab2).dE00;
}

export function matrixApply(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}
