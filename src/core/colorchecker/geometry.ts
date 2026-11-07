import type { Point } from '../types';

export type Homography = [number, number, number, number, number, number, number, number, number];

/** Solve an n x n linear system with partial pivoting. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [m[pivot], m[col]] = [m[col], m[pivot]];
    const pv = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

/**
 * Build a homography mapping the unit square (0,0)..(1,1) to four image
 * corners in TL, TR, BR, BL order.
 */
export function homographyFromCorners(corners: [Point, Point, Point, Point]): Homography | null {
  const src: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const { x, y } = corners[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(h: Homography, u: number, v: number): Point {
  const d = h[6] * u + h[7] * v + h[8];
  return {
    x: (h[0] * u + h[1] * v + h[2]) / d,
    y: (h[3] * u + h[4] * v + h[5]) / d,
  };
}

export interface ColorCheckerSampling {
  samples: Array<[number, number, number]>;
  centers: Point[];
  patchRects: Array<{ x: number; y: number; w: number; h: number }>;
  clipped: boolean[];
  valid: boolean[];
  cellSize: number;
}

export function sampleColorCheckerGrid(
  pixels: Float32Array,
  width: number,
  height: number,
  corners: [Point, Point, Point, Point],
  inset = 0.5,
): ColorCheckerSampling | null {
  const h = homographyFromCorners(corners);
  if (!h) return null;
  const samples: Array<[number, number, number]> = [];
  const centers: Point[] = [];
  const patchRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  const clipped: boolean[] = [];
  const valid: boolean[] = [];
  const cols = 6, rows = 4;
  let cellMin = Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u0 = c / cols, u1 = (c + 1) / cols;
      const v0 = r / rows, v1 = (r + 1) / rows;
      const p00 = applyHomography(h, u0, v0);
      const p10 = applyHomography(h, u1, v0);
      const p01 = applyHomography(h, u0, v1);
      const p11 = applyHomography(h, u1, v1);
      const center = applyHomography(h, (u0 + u1) / 2, (v0 + v1) / 2);
      centers.push(center);
      const cellW = Math.min(
        Math.hypot(p10.x - p00.x, p10.y - p00.y),
        Math.hypot(p11.x - p01.x, p11.y - p01.y),
      );
      const cellH = Math.min(
        Math.hypot(p01.x - p00.x, p01.y - p00.y),
        Math.hypot(p11.x - p10.x, p11.y - p10.y),
      );
      const s = Math.max(2, Math.floor(Math.min(cellW, cellH) * inset * 0.5));
      cellMin = Math.min(cellMin, s);
      const x0 = Math.max(0, Math.floor(center.x - s));
      const y0 = Math.max(0, Math.floor(center.y - s));
      const x1 = Math.min(width, Math.ceil(center.x + s));
      const y1 = Math.min(height, Math.ceil(center.y + s));
      patchRects.push({ x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) });
      let sr = 0, sg = 0, sb = 0, n = 0;
      let isClipped = false;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const rr = pixels[i], gg = pixels[i + 1], bb = pixels[i + 2];
          if (!Number.isFinite(rr) || !Number.isFinite(gg) || !Number.isFinite(bb)) continue;
          if (rr >= 0.995 || gg >= 0.995 || bb >= 0.995) isClipped = true;
          sr += rr; sg += gg; sb += bb; n++;
        }
      }
      if (!n) {
        samples.push([0, 0, 0]);
        clipped.push(true);
        valid.push(false);
        continue;
      }
      const mean: [number, number, number] = [sr / n, sg / n, sb / n];
      samples.push(mean);
      clipped.push(isClipped);
      valid.push(!isClipped && Math.max(...mean) > 0.002 && Math.max(...mean) < 0.995);
    }
  }
  return { samples, centers, patchRects, clipped, valid, cellSize: cellMin };
}
