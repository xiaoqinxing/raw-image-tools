import type { CfaLayout, Rect, SnrResult } from '../types';
import { cfaChannelAt } from '../raw/cfa';

export interface SnrInput {
  width: number;
  height: number;
  data: Float32Array;
  rect: Rect;
  domain: 'raw-cfa' | 'camera-rgb' | 'linear-srgb' | 'display-srgb';
  cfa?: CfaLayout;
}

function toLinear(v: number, domain: string): number {
  if (domain === 'display-srgb') {
    const x = Math.max(0, v);
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }
  return v;
}

export function computeSnr(input: SnrInput): Omit<SnrResult, keyof import('../types').AnalysisMeta> & { kind: 'snr' } {
  const { width, height, data, rect, domain, cfa } = input;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  const sums = [0, 0, 0, 0];
  const sums2 = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if (domain === 'raw-cfa' && cfa) {
        const ch = cfaChannelAt(cfa, x, y);
        const v = toLinear(data[i], domain);
        sums[ch] += v;
        sums2[ch] += v * v;
        counts[ch]++;
      } else {
        const r = toLinear(data[i], domain);
        const g = toLinear(data[i + 1], domain);
        const b = toLinear(data[i + 2], domain);
        const yv = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        for (const [ch, v] of [[0, r], [1, g], [2, b], [3, yv]] as const) {
          sums[ch] += v;
          sums2[ch] += v * v;
          counts[ch]++;
        }
      }
    }
  }
  const labels = ['R', 'G', 'B', 'Y'];
  const perChannel = labels.map((label, ch) => {
    const n = counts[ch];
    const mean = n ? sums[ch] / n : 0;
    const variance = n > 1 ? Math.max(0, (sums2[ch] - sums[ch] * sums[ch] / n) / (n - 1)) : 0;
    const std = Math.sqrt(variance);
    return {
      channel: label as 'R' | 'G' | 'B' | 'Y',
      mean,
      std,
      snrDb: std > 1e-12 && mean > 0 ? 20 * Math.log10(mean / std) : 0,
      samples: n,
    };
  });
  return { kind: 'snr', perChannel, domain: 'linear' };
}
