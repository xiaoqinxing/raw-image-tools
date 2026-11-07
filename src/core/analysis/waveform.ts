import type { CfaLayout, WaveformResult } from '../types';
import { cfaChannelAt } from '../raw/cfa';

export interface WaveformInput {
  width: number;
  height: number;
  data: Float32Array;
  domain: 'raw-cfa' | 'camera-rgb' | 'linear-srgb' | 'display-srgb';
  cfa?: CfaLayout;
  mode: 'luma' | 'parade';
  scale: 'linear' | 'gamma';
}

function display(v: number, scale: 'linear' | 'gamma', domain: string): number {
  if (scale === 'linear' && domain === 'display-srgb') {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  if (scale === 'gamma' || domain !== 'display-srgb') {
    const x = Math.max(0, v);
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }
  return v;
}

export function computeWaveform(input: WaveformInput): Omit<WaveformResult, keyof import('../types').AnalysisMeta> & { kind: 'waveform' } {
  const { width, height, data, domain, cfa } = input;
  const bins = 256;
  const wfWidth = input.mode === 'parade' ? width * 3 : width;
  const counts = new Uint32Array(wfWidth * bins);
  const add = (x: number, v: number, channelOffset: number) => {
    const d = display(v, input.scale, domain);
    const bin = Math.max(0, Math.min(bins - 1, Math.round(d * (bins - 1))));
    counts[(bins - 1 - bin) * wfWidth + x + channelOffset]++;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (domain === 'raw-cfa' && cfa) {
        const ch = cfaChannelAt(cfa, x, y);
        const v = data[i];
        if (input.mode === 'parade') {
          const off = ch === 0 ? 0 : ch === 3 ? width * 2 : width;
          add(x, v, off);
        } else {
          add(x, v, 0);
        }
      } else {
        if (input.mode === 'parade') {
          add(x, data[i], 0);
          add(x, data[i + 1], width);
          add(x, data[i + 2], width * 2);
        } else {
          add(x, 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2], 0);
        }
      }
    }
  }
  let maxCount = 1;
  for (let i = 0; i < counts.length; i++) if (counts[i] > maxCount) maxCount = counts[i];
  const rgba = new Uint8ClampedArray(wfWidth * bins * 4);
  for (let y = 0; y < bins; y++) {
    for (let x = 0; x < wfWidth; x++) {
      const c = counts[y * wfWidth + x];
      const intensity = Math.min(1, Math.pow(c / maxCount, 0.45));
      const o = (y * wfWidth + x) * 4;
      if (input.mode === 'parade') {
        const channel = x < width ? 0 : x < width * 2 ? 1 : 2;
        const tint = channel === 0 ? [1, 0.25, 0.25] : channel === 1 ? [0.25, 1, 0.35] : [0.3, 0.45, 1];
        rgba[o] = tint[0] * intensity * 255;
        rgba[o + 1] = tint[1] * intensity * 255;
        rgba[o + 2] = tint[2] * intensity * 255;
      } else {
        rgba[o] = 0.55 * intensity * 255;
        rgba[o + 1] = 0.9 * intensity * 255;
        rgba[o + 2] = 0.75 * intensity * 255;
      }
      rgba[o + 3] = 255;
    }
  }
  return {
    kind: 'waveform',
    width: wfWidth,
    height: bins,
    rgba,
    mode: input.mode,
    scale: input.scale,
  };
}
