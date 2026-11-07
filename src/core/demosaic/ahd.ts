import type { CfaLayout } from '../types';
import { cfaAt } from '../raw/cfa';
import type { CfaPlane, RgbPlane } from './cpu';

/**
 * Clean-room, AHD-inspired directional demosaic.
 *
 * Green is estimated in horizontal and vertical directions with the classic
 * 4-neighbour + laplacian correction. A local 5x5 activity map picks the
 * smoother direction per pixel. R/B are then reconstructed from green using
 * color-difference interpolation. This is an AHD approximation, not a port of
 * the GPL reference implementation.
 *
 * The image is processed in horizontal strips so peak working memory stays
 * proportional to the tile height instead of the full frame.
 */
const TILE_ROWS = 192;
const HALO = 2;

export function demosaicAHD(src: CfaPlane): RgbPlane {
  const { width: w, height: h, data, cfa } = src;
  const out = new Float32Array(w * h * 3);

  const sample = (x: number, y: number): number => {
    const xx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return data[yy * w + xx];
  };
  const greenAt = (x: number, y: number): boolean => {
    const c = cfaAt(cfa, x, y);
    return c === 'G1' || c === 'G2';
  };

  for (let ty0 = 0; ty0 < h; ty0 += TILE_ROWS) {
    const ty1 = Math.min(h, ty0 + TILE_ROWS);
    const ly0 = Math.max(0, ty0 - HALO);
    const ly1 = Math.min(h, ty1 + HALO);
    const lh = ly1 - ly0;
    const n = w * lh;
    const gH = new Float32Array(n);
    const gV = new Float32Array(n);

    // 1. Directional green estimates for the tile (with halo).
    for (let ly = 0; ly < lh; ly++) {
      const y = ly0 + ly;
      for (let x = 0; x < w; x++) {
        const i = ly * w + x;
        const c = sample(x, y);
        if (greenAt(x, y)) {
          gH[i] = c;
          gV[i] = c;
        } else {
          gH[i] = 0.5 * (sample(x - 1, y) + sample(x + 1, y)) +
            0.25 * (2 * c - sample(x - 2, y) - sample(x + 2, y));
          gV[i] = 0.5 * (sample(x, y - 1) + sample(x, y + 1)) +
            0.25 * (2 * c - sample(x, y - 2) - sample(x, y + 2));
        }
      }
    }

    const activity = (g: Float32Array): Float32Array => {
      const local = new Float32Array(n);
      for (let ly = 0; ly < lh; ly++) {
        const x1row = ly * w;
        const y1 = Math.min(lh - 1, ly + 1);
        const y1row = y1 * w;
        for (let x = 0; x < w; x++) {
          const i = x1row + x;
          const xn = x + 1 < w ? x + 1 : x;
          const gx = Math.abs(g[i] - g[x1row + xn]);
          const gy = Math.abs(g[i] - g[y1row + x]);
          local[i] = gx + gy;
        }
      }
      // 5x5 box average via an integral image.
      const iw = w + 1;
      const integral = new Float64Array(iw * (lh + 1));
      for (let ly = 0; ly < lh; ly++) {
        let row = 0;
        const irow = (ly + 1) * iw;
        const prow = ly * iw;
        for (let x = 0; x < w; x++) {
          row += local[ly * w + x];
          integral[irow + x + 1] = integral[prow + x + 1] + row;
        }
      }
      const box = new Float32Array(n);
      for (let ly = 0; ly < lh; ly++) {
        const y0 = Math.max(0, ly - 2);
        const y2 = Math.min(lh - 1, ly + 2);
        for (let x = 0; x < w; x++) {
          const x0 = Math.max(0, x - 2);
          const x2 = Math.min(w - 1, x + 2);
          const sum = integral[(y2 + 1) * iw + x2 + 1] - integral[y0 * iw + x2 + 1] -
            integral[(y2 + 1) * iw + x0] + integral[y0 * iw + x0];
          box[ly * w + x] = sum / ((x2 - x0 + 1) * (y2 - y0 + 1));
        }
      }
      return box;
    };

    const ah = activity(gH);
    const av = activity(gV);
    for (let i = 0; i < n; i++) {
      if (av[i] < ah[i]) gH[i] = gV[i];
    }

    const DIAG: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const CROSS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const avgDiff = (x: number, ly: number, color: 'R' | 'B', offsets: ReadonlyArray<readonly [number, number]>): number => {
      let sum = 0;
      let count = 0;
      for (const [dx, dy] of offsets) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const yy = ly + dy;
        if (yy < 0 || yy >= lh) continue;
        if (cfaAt(cfa, xx, ly0 + yy) !== color) continue;
        const gi = yy * w + xx;
        sum += data[(ly0 + yy) * w + xx] - gH[gi];
        count++;
      }
      return count ? sum / count : 0;
    };

    // 2. Reconstruct R/B only for rows owned by this tile.
    for (let y = ty0; y < ty1; y++) {
      const ly = y - ly0;
      for (let x = 0; x < w; x++) {
        const i = ly * w + x;
        const g = gH[i];
        const c = cfaAt(cfa, x, y);
        let r: number;
        let b: number;
        if (c === 'R') {
          r = data[y * w + x];
          b = g + avgDiff(x, ly, 'B', DIAG);
        } else if (c === 'B') {
          b = data[y * w + x];
          r = g + avgDiff(x, ly, 'R', DIAG);
        } else {
          r = g + avgDiff(x, ly, 'R', CROSS);
          b = g + avgDiff(x, ly, 'B', CROSS);
        }
        const o = (y * w + x) * 3;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
      }
    }
  }

  return { width: w, height: h, data: out };
}

/** CFA-only helper used by tests and diagnostics. */
export function cfaChannelPlane(src: CfaPlane): Float32Array {
  return src.data;
}
