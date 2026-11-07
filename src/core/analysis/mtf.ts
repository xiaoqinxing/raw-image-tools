import FFT from 'fft.js';
import type { MtfResult, Rect } from '../types';

export interface MtfInput {
  width: number;
  height: number;
  data: Float32Array;
  rect: Rect;
  domain: 'camera-rgb' | 'linear-srgb' | 'display-srgb';
}

function toLinear(v: number, domain: string): number {
  if (domain === 'display-srgb') {
    const x = Math.max(0, v);
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }
  return v;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

interface EdgeFit {
  a: number;
  b: number;
  angleDeg: number;
  contrast: number;
  crossings: number;
}

function fitEdge(values: (x: number, y: number) => number, rect: Rect): EdgeFit | null {
  const pts: Array<[number, number]> = [];
  let globalMin = Infinity;
  let globalMax = -Infinity;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    let rowMin = Infinity, rowMax = -Infinity;
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const v = values(x, y);
      rowMin = Math.min(rowMin, v);
      rowMax = Math.max(rowMax, v);
    }
    if (rowMax - rowMin < 0.04) continue;
    globalMin = Math.min(globalMin, rowMin);
    globalMax = Math.max(globalMax, rowMax);
    const thr = (rowMin + rowMax) / 2;
    for (let x = rect.x + 1; x < rect.x + rect.w; x++) {
      const v0 = values(x - 1, y) - thr;
      const v1 = values(x, y) - thr;
      if (v0 === 0 || v0 * v1 <= 0) {
        const denom = Math.abs(v0) + Math.abs(v1);
        const sub = denom > 1e-12 ? (x - 1) + Math.abs(v0) / denom : x - 0.5;
        pts.push([sub, y]);
        break;
      }
    }
  }
  if (pts.length < 8 || !(globalMax > globalMin)) return null;
  // Least squares x = a*y + b.
  let sy = 0, sx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) {
    sy += y; sx += x; syy += y * y; sxy += x * y;
  }
  const n = pts.length;
  const denom = n * syy - sy * sy;
  if (Math.abs(denom) < 1e-9) return null;
  const a = (n * sxy - sy * sx) / denom;
  const b = (sx - a * sy) / n;
  return {
    a,
    b,
    angleDeg: (Math.atan(a) * 180) / Math.PI,
    contrast: (globalMax - globalMin) / Math.max(1e-9, globalMax + globalMin),
    crossings: n,
  };
}

function mtfFromRoi(values: (x: number, y: number) => number, rect: Rect, edge: EdgeFit): { curve: Array<{ f: number; mtf: number }>; mtf50: number; mtf10: number } | null {
  const oversampling = 4;
  const norm = Math.sqrt(1 + edge.a * edge.a);
  const dmin = -(rect.w + rect.h) / 2;
  const dmax = (rect.w + rect.h) / 2;
  const bins = Math.ceil((dmax - dmin) * oversampling) + 1;
  const sums = new Float64Array(bins);
  const counts = new Uint32Array(bins);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const d = (x - edge.a * y - edge.b) / norm;
      const bin = Math.floor((d - dmin) * oversampling);
      if (bin < 0 || bin >= bins) continue;
      sums[bin] += values(x, y);
      counts[bin]++;
    }
  }
  const esf = new Float64Array(bins);
  let valid = 0;
  for (let i = 0; i < bins; i++) {
    if (counts[i]) {
      esf[i] = sums[i] / counts[i];
      valid++;
    }
  }
  if (valid < 8) return null;
  // Fill gaps by nearest valid value.
  for (let i = 1; i < bins; i++) if (!counts[i]) esf[i] = esf[i - 1];
  for (let i = bins - 2; i >= 0; i--) if (!counts[i]) esf[i] = esf[i + 1];
  const lsf = new Float64Array(bins - 1);
  for (let i = 0; i < bins - 1; i++) lsf[i] = esf[i + 1] - esf[i];
  // Hann window. Do not subtract the mean: the derivative LSF already has
  // near-zero DC, and the DC magnitude is the normalization factor.
  for (let i = 0; i < lsf.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (lsf.length - 1));
    lsf[i] *= w;
  }
  const n = nextPow2(lsf.length * 2);
  const fft = new FFT(n);
  const input = fft.createComplexArray();
  for (let i = 0; i < lsf.length; i++) input[i * 2] = lsf[i];
  const out = fft.createComplexArray();
  fft.transform(out, input);
  const mag = new Float64Array(n / 2);
  let dc = 0;
  for (let k = 0; k < n / 2; k++) {
    const re = out[k * 2], im = out[k * 2 + 1];
    mag[k] = Math.hypot(re, im);
    if (k === 0) dc = mag[0];
  }
  if (dc <= 1e-15) return null;
  const curve: Array<{ f: number; mtf: number }> = [];
  const maxF = 0.5;
  const step = 1 / 128;
  const sample = (f: number) => {
    const k = (f * n) / oversampling;
    const i0 = Math.floor(k);
    const i1 = Math.min(mag.length - 1, i0 + 1);
    const t = k - i0;
    return (mag[i0] * (1 - t) + mag[i1] * t) / dc;
  };
  for (let f = 0; f <= maxF + 1e-9; f += step) curve.push({ f, mtf: Math.max(0, sample(f)) });
  const cross = (target: number) => {
    for (let i = 1; i < curve.length; i++) {
      if (curve[i].mtf <= target) {
        const a = curve[i - 1], b = curve[i];
        const t = (a.mtf - target) / Math.max(1e-12, a.mtf - b.mtf);
        return a.f + t * (b.f - a.f);
      }
    }
    return 0;
  };
  return { curve, mtf50: cross(0.5), mtf10: cross(0.1) };
}

export function computeMtf(input: MtfInput): Omit<MtfResult, keyof import('../types').AnalysisMeta> & { kind: 'mtf'; warnings: string[] } {
  const { width, height, data, rect, domain } = input;
  const warnings: string[] = [];
  const channelValues = (channel: 0 | 1 | 2 | 3) => (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = toLinear(data[i], domain);
    const g = toLinear(data[i + 1], domain);
    const b = toLinear(data[i + 2], domain);
    if (channel === 0) return r;
    if (channel === 1) return g;
    if (channel === 2) return b;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const perChannel = [] as MtfResult['perChannel'];
  let angle = 0;
  let contrast = 0;
  const labels = ['R', 'G', 'B', 'Y'] as const;
  for (let c = 0; c < 4; c++) {
    const vals = channelValues(c as 0 | 1 | 2 | 3);
    const edge = fitEdge(vals, rect);
    if (!edge) {
      warnings.push(`${labels[c]} 通道未检测到可用斜边。`);
      perChannel.push({ channel: labels[c], mtf50: 0, mtf10: 0, curve: [] });
      continue;
    }
    angle = edge.angleDeg;
    contrast = edge.contrast;
    if (Math.abs(edge.angleDeg) < 1.5) warnings.push('边缘角度过小（<1.5°），MTF 对角度误差敏感。');
    if (Math.abs(edge.angleDeg) > 45) warnings.push('边缘角度过大（>45°），建议重新框选。');
    if (edge.contrast < 0.1) warnings.push('边缘对比度偏低，MTF 可能不可靠。');
    const mtf = mtfFromRoi(vals, rect, edge);
    if (!mtf) {
      warnings.push(`${labels[c]} 通道 MTF 计算失败。`);
      perChannel.push({ channel: labels[c], mtf50: 0, mtf10: 0, curve: [] });
    } else {
      perChannel.push({ channel: labels[c], mtf50: mtf.mtf50, mtf10: mtf.mtf10, curve: mtf.curve });
    }
  }
  if (rect.w < 16 || rect.h < 16) warnings.push('ROI 太小，建议至少 32×32。');
  return {
    kind: 'mtf',
    perChannel,
    edge: { angleDeg: angle, contrast, oversampling: 4 },
    warnings,
  };
}
