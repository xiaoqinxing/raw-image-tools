import type { CfaLayout, HistogramResult, Vec4 } from '../types';
import { cfaChannelAt } from '../raw/cfa';

export interface HistogramInput {
  width: number;
  height: number;
  data: Float32Array; // RGBA
  bins: 256 | 1024;
  domain: 'raw-cfa' | 'camera-rgb' | 'linear-srgb' | 'display-srgb';
  cfa?: CfaLayout;
}

export function computeHistogram(input: HistogramInput): Omit<HistogramResult, keyof import('../types').AnalysisMeta> & { kind: 'histogram' } {
  const { width, height, data, bins, domain, cfa } = input;
  const r = new Uint32Array(bins);
  const g = new Uint32Array(bins);
  const b = new Uint32Array(bins);
  const y = new Uint32Array(bins);
  const low: Vec4 = [0, 0, 0, 0];
  const high: Vec4 = [0, 0, 0, 0];
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let total = 0;
  const scale = bins - 1;
  const toDisplay = (v: number) => {
    if (domain === 'display-srgb') return v;
    const x = Math.max(0, v);
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      if (domain === 'raw-cfa' && cfa) {
        const ch = cfaChannelAt(cfa, px, py);
        const v = data[i];
        const dv = toDisplay(v);
        const bin = Math.max(0, Math.min(bins - 1, Math.round(dv * scale)));
        if (ch === 0) r[bin]++;
        else if (ch === 3) b[bin]++;
        else g[bin]++;
        y[bin]++;
        if (dv < 0) low[ch]++;
        if (dv > 1) high[ch]++;
        min = Math.min(min, v);
        max = Math.max(max, v);
        sum += v;
        total++;
      } else {
        const rr = data[i], gg = data[i + 1], bb = data[i + 2];
        const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
        const dr = toDisplay(rr), dg = toDisplay(gg), db = toDisplay(bb), dy = toDisplay(lum);
        const ir = Math.max(0, Math.min(bins - 1, Math.round(dr * scale)));
        const ig = Math.max(0, Math.min(bins - 1, Math.round(dg * scale)));
        const ib = Math.max(0, Math.min(bins - 1, Math.round(db * scale)));
        const iy = Math.max(0, Math.min(bins - 1, Math.round(dy * scale)));
        r[ir]++; g[ig]++; b[ib]++; y[iy]++;
        if (dr < 0) low[0]++;
        if (dg < 0) low[1]++;
        if (db < 0) low[2]++;
        if (dr > 1) high[0]++;
        if (dg > 1) high[1]++;
        if (db > 1) high[2]++;
        min = Math.min(min, rr, gg, bb);
        max = Math.max(max, rr, gg, bb);
        sum += lum;
        total++;
      }
    }
  }
  return {
    kind: 'histogram',
    bins,
    channels: { r, g, b, y },
    clipped: { low, high },
    total,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    mean: total ? sum / total : 0,
    scale: 'linear',
  };
}
