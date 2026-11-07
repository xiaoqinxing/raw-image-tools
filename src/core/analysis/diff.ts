import type { DiffResult } from '../types';

export interface DiffInput {
  width: number;
  height: number;
  a: Float32Array;
  b: Float32Array;
  domain: 'raw-cfa' | 'camera-rgb' | 'linear-srgb' | 'display-srgb';
  domainB?: 'raw-cfa' | 'camera-rgb' | 'linear-srgb' | 'display-srgb';
  gain: number;
  signed: boolean;
}

function toDisplay(v: number, domain: string): number {
  if (domain === 'display-srgb') return v;
  const x = Math.max(0, v);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

export function computeDiff(input: DiffInput): Omit<DiffResult, keyof import('../types').AnalysisMeta> & { kind: 'diff' } {
  const { width, height, a, b, domain, domainB, gain, signed } = input;
  let sumAbs = 0;
  let sumSq = 0;
  let maxDiff = 0;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      const av = toDisplay(a[o + c], domain);
      const bv = toDisplay(b[o + c], domainB ?? domain);
      const d = av - bv;
      sumAbs += Math.abs(d);
      sumSq += d * d;
      if (Math.abs(d) > maxDiff) maxDiff = Math.abs(d);
      let v: number;
      if (signed) v = Math.max(0, Math.min(1, 0.5 + d * gain * 0.5));
      else v = Math.max(0, Math.min(1, Math.abs(d) * gain));
      rgba[o + c] = Math.round(Math.pow(v, 1 / 2.4) * 255);
    }
    rgba[o + 3] = 255;
  }
  const n = Math.max(1, width * height * 3);
  const mae = sumAbs / n;
  const mse = sumSq / n;
  const psnrDb = mse > 1e-15 ? 10 * Math.log10(1 / mse) : Infinity;
  return {
    kind: 'diff',
    a: { imageId: '', stage: 'levels' },
    b: { imageId: '', stage: 'levels' },
    metrics: { mae, psnrDb, maxDiff },
    width,
    height,
    gain,
    mode: signed ? 'signed' : 'abs',
    rgba,
  };
}
