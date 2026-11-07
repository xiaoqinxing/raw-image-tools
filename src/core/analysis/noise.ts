import FFT from 'fft.js';
import type { NoiseSpectrumResult, Rect } from '../types';

export interface NoiseInput {
  width: number;
  height: number;
  data: Float32Array;
  rect: Rect;
  domain: 'camera-rgb' | 'linear-srgb' | 'display-srgb';
  channel: 0 | 1 | 2 | 3; // R,G,B,Y
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1));
  return w;
}

function toLinear(v: number, domain: string): number {
  if (domain === 'display-srgb') {
    const x = Math.max(0, v);
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }
  return v;
}

export function computeNoiseSpectrum(input: NoiseInput): Omit<NoiseSpectrumResult, keyof import('../types').AnalysisMeta> & { kind: 'noise' } {
  const { width, height, data, rect, domain, channel } = input;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const rw = Math.max(8, Math.min(1024, Math.floor(rect.w)));
  const rh = Math.max(8, Math.min(1024, Math.floor(rect.h)));
  const n = nextPow2(Math.max(rw, rh));
  const fft = new FFT(n);
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = toLinear(data[i], domain);
    const g = toLinear(data[i + 1], domain);
    const b = toLinear(data[i + 2], domain);
    if (channel === 0) return r;
    if (channel === 1) return g;
    if (channel === 2) return b;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // Detrend a plane over the actual ROI.
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sv = 0, sxv = 0, syv = 0, count = 0;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const v = sample(x0 + x, y0 + y);
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      sv += v; sxv += x * v; syv += y * v; count++;
    }
  }
  // Solve normal equations for v = a*x + b*y + c (3x3).
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, count]];
  const B = [sxv, syv, sv];
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  let a = 0, b = 0, c = 0;
  if (Math.abs(d) > 1e-12) {
    const replace = (col: number, val: number[]) => A.map((row, i) => row.map((v, j) => (j === col ? val[i] : v)));
    a = det(replace(0, B)) / d;
    b = det(replace(1, B)) / d;
    c = det(replace(2, B)) / d;
  } else {
    c = count ? sv / count : 0;
  }
  const wx = hann(rw);
  const wy = hann(rh);
  const input2 = new Float64Array(n * n * 2);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const v = (sample(x0 + x, y0 + y) - (a * x + b * y + c)) * wx[x] * wy[y];
      const idx = (y * n + x) * 2;
      input2[idx] = v;
      input2[idx + 1] = 0;
    }
  }
  // Rows.
  const rowIn = fft.createComplexArray();
  const rowOut = fft.createComplexArray();
  const temp = new Float64Array(n * n * 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      rowIn[x * 2] = input2[(y * n + x) * 2];
      rowIn[x * 2 + 1] = input2[(y * n + x) * 2 + 1];
    }
    fft.transform(rowOut, rowIn);
    for (let x = 0; x < n; x++) {
      temp[(y * n + x) * 2] = rowOut[x * 2];
      temp[(y * n + x) * 2 + 1] = rowOut[x * 2 + 1];
    }
  }
  // Columns.
  const colIn = fft.createComplexArray();
  const colOut = fft.createComplexArray();
  const out = new Float64Array(n * n * 2);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      colIn[y * 2] = temp[(y * n + x) * 2];
      colIn[y * 2 + 1] = temp[(y * n + x) * 2 + 1];
    }
    fft.transform(colOut, colIn);
    for (let y = 0; y < n; y++) {
      out[(y * n + x) * 2] = colOut[y * 2];
      out[(y * n + x) * 2 + 1] = colOut[y * 2 + 1];
    }
  }
  // Shifted log power.
  const spectrum = new Float32Array(n * n);
  let maxPower = 0;
  const half = n / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sx2 = (x + half) % n;
      const sy2 = (y + half) % n;
      const re = out[(y * n + x) * 2];
      const im = out[(y * n + x) * 2 + 1];
      const p = re * re + im * im;
      if (p > maxPower) maxPower = p;
      spectrum[sy2 * n + sx2] = p;
    }
  }
  const logMax = Math.log10(1 + maxPower);
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = Math.log10(1 + spectrum[i]) / Math.max(1e-9, logMax);
  // Radial average.
  const radialBins = Math.floor(n / 2);
  const rSum = new Float64Array(radialBins);
  const rCount = new Uint32Array(radialBins);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - half, dy = y - half;
      const r = Math.sqrt(dx * dx + dy * dy);
      const bin = Math.floor((r / half) * (radialBins - 1));
      if (bin >= 0 && bin < radialBins) {
        rSum[bin] += spectrum[y * n + x];
        rCount[bin]++;
      }
    }
  }
  const radial = Array.from({ length: radialBins }, (_, i) => ({
    r: i / Math.max(1, radialBins - 1),
    power: rCount[i] ? rSum[i] / rCount[i] : 0,
  }));
  const psdH = new Float32Array(half);
  const psdV = new Float32Array(half);
  for (let k = 1; k < half; k++) {
    let h = 0, v = 0;
    for (let y = 0; y < n; y++) h += spectrum[y * n + (half + k)];
    for (let x = 0; x < n; x++) v += spectrum[(half + k) * n + x];
    psdH[k] = h / n;
    psdV[k] = v / n;
  }
  return {
    kind: 'noise',
    width: n,
    height: n,
    spectrum,
    radial,
    psdH,
    psdV,
    detrend: 'plane',
    window: 'hann',
  };
}
