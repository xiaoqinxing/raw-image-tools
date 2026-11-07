import type { CfaLayout } from '../types';
import { cfaAt } from '../raw/cfa';

export interface CfaPlane {
  width: number;
  height: number;
  data: Float32Array;
  cfa: CfaLayout;
}

export interface RgbPlane {
  width: number;
  height: number;
  data: Float32Array; // RGB interleaved
}

function idx(x: number, y: number, w: number, h: number): number {
  return Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x));
}

export function demosaicBilinear(src: CfaPlane): RgbPlane {
  const { width: w, height: h, data, cfa } = src;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cfaAt(cfa, x, y);
      const center = data[y * w + x];
      const gAvg = (
        data[idx(x - 1, y, w, h)] + data[idx(x + 1, y, w, h)] +
        data[idx(x, y - 1, w, h)] + data[idx(x, y + 1, w, h)]
      ) / 4;
      const diag = (
        data[idx(x - 1, y - 1, w, h)] + data[idx(x + 1, y - 1, w, h)] +
        data[idx(x - 1, y + 1, w, h)] + data[idx(x + 1, y + 1, w, h)]
      ) / 4;
      let r: number, g: number, b: number;
      if (c === 'R') {
        r = center; g = gAvg; b = diag;
      } else if (c === 'B') {
        r = diag; g = gAvg; b = center;
      } else {
        g = center;
        const horizR = cfaAt(cfa, x - 1, y) === 'R' || cfaAt(cfa, x + 1, y) === 'R';
        const two = (x1: number, y1: number, x2: number, y2: number) =>
          (data[idx(x1, y1, w, h)] + data[idx(x2, y2, w, h)]) / 2;
        if (horizR) {
          r = two(x - 1, y, x + 1, y);
          b = two(x, y - 1, x, y + 1);
        } else {
          r = two(x, y - 1, x, y + 1);
          b = two(x - 1, y, x + 1, y);
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
    }
  }
  return { width: w, height: h, data: out };
}

const G_RB = [
  0, 0, -1, 0, 0,
  0, 0, 2, 0, 0,
  -1, 2, 4, 2, -1,
  0, 0, 2, 0, 0,
  0, 0, -1, 0, 0,
].map((v) => v / 8);

const C_SAME_ROW = [
  0, 0, 0.5, 0, 0,
  0, -1, 0, -1, 0,
  -1, 4, 5, 4, -1,
  0, -1, 0, -1, 0,
  0, 0, 0.5, 0, 0,
].map((v) => v / 8);

const C_DIAG = [
  0, 0, -1.5, 0, 0,
  0, 2, 0, 2, 0,
  -1.5, 0, 6, 0, -1.5,
  0, 2, 0, 2, 0,
  0, 0, -1.5, 0, 0,
].map((v) => v / 8);

function convolve5(data: Float32Array, w: number, h: number, x: number, y: number, kernel: number[]): number {
  let sum = 0;
  let k = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      sum += data[idx(x + dx, y + dy, w, h)] * kernel[k++];
    }
  }
  return sum;
}

function transposeKernel(k: number[]): number[] {
  const out = new Array(25);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) out[x * 5 + y] = k[y * 5 + x];
  return out;
}

const C_SAME_COL = transposeKernel(C_SAME_ROW);

/**
 * Malvar-He-Cutler 2004. Border handling uses clamped coordinates (the IPOL
 * reference normalizes by valid neighbors; differences are confined to 2px
 * borders). This is the CPU reference for the GPU implementation.
 */
export function demosaicMHC(src: CfaPlane): RgbPlane {
  const { width: w, height: h, data, cfa } = src;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cfaAt(cfa, x, y);
      const center = data[y * w + x];
      let r = center, g = center, b = center;
      if (c === 'R') {
        r = center;
        g = convolve5(data, w, h, x, y, G_RB);
        b = convolve5(data, w, h, x, y, C_DIAG);
      } else if (c === 'B') {
        b = center;
        g = convolve5(data, w, h, x, y, G_RB);
        r = convolve5(data, w, h, x, y, C_DIAG);
      } else {
        g = center;
        const left = cfaAt(cfa, x - 1, y);
        const right = cfaAt(cfa, x + 1, y);
        const up = cfaAt(cfa, x, y - 1);
        const down = cfaAt(cfa, x, y + 1);
        const rHorizontal = left === 'R' || right === 'R';
        const bHorizontal = left === 'B' || right === 'B';
        const rKernel = rHorizontal ? C_SAME_ROW : (up === 'R' || down === 'R' ? C_SAME_COL : C_SAME_ROW);
        const bKernel = bHorizontal ? C_SAME_ROW : (up === 'B' || down === 'B' ? C_SAME_COL : C_SAME_ROW);
        r = convolve5(data, w, h, x, y, rKernel);
        b = convolve5(data, w, h, x, y, bKernel);
      }
      const o = (y * w + x) * 3;
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
    }
  }
  return { width: w, height: h, data: out };
}

export function clampRgbPlane(src: RgbPlane): RgbPlane {
  const out = new Float32Array(src.data.length);
  for (let i = 0; i < src.data.length; i++) out[i] = Math.max(0, Math.min(1, src.data[i]));
  return { width: src.width, height: src.height, data: out };
}
