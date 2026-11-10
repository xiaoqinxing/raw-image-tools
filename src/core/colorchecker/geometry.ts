import type { ColorCheckerSampleReason, Point } from '../types';

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

export interface ColorCheckerGridCell {
  index: number;
  center: Point;
  cellQuad: [Point, Point, Point, Point];
  /** The actual area that is averaged, inset inside the cell. */
  sampleQuad: [Point, Point, Point, Point];
}

/**
 * Build the 6×4 patch grid. `inset` is the sample side length as a fraction of
 * the cell (0.5 = centre 50%×50%).
 */
export function buildColorCheckerGrid(
  corners: [Point, Point, Point, Point],
  inset = 0.5,
  cols = 6,
  rows = 4,
): ColorCheckerGridCell[] | null {
  const h = homographyFromCorners(corners);
  if (!h) return null;
  const side = Math.max(0.1, Math.min(0.95, inset));
  const margin = (1 - side) / 2;
  const cells: ColorCheckerGridCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u0 = c / cols, u1 = (c + 1) / cols;
      const v0 = r / rows, v1 = (r + 1) / rows;
      const su0 = u0 + (u1 - u0) * margin;
      const su1 = u1 - (u1 - u0) * margin;
      const sv0 = v0 + (v1 - v0) * margin;
      const sv1 = v1 - (v1 - v0) * margin;
      cells.push({
        index: r * cols + c,
        center: applyHomography(h, (u0 + u1) / 2, (v0 + v1) / 2),
        cellQuad: [
          applyHomography(h, u0, v0),
          applyHomography(h, u1, v0),
          applyHomography(h, u1, v1),
          applyHomography(h, u0, v1),
        ],
        sampleQuad: [
          applyHomography(h, su0, sv0),
          applyHomography(h, su1, sv0),
          applyHomography(h, su1, sv1),
          applyHomography(h, su0, sv1),
        ],
      });
    }
  }
  return cells;
}

function pointInQuad(x: number, y: number, q: [Point, Point, Point, Point]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign !== 0 && s !== sign) return false;
    sign = s;
  }
  return true;
}

function trimmedMean(values: number[], trim = 0.1): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.min(Math.floor(sorted.length * trim), Math.floor((sorted.length - 1) / 2));
  let sum = 0;
  let n = 0;
  for (let i = cut; i < sorted.length - cut; i++) {
    sum += sorted[i];
    n++;
  }
  return n ? sum / n : sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export interface ColorCheckerSampling {
  samples: Array<[number, number, number]>;
  centers: Point[];
  sampleQuads: Array<[Point, Point, Point, Point]>;
  patchRects: Array<{ x: number; y: number; w: number; h: number }>;
  clipped: boolean[];
  clippedFractions: number[];
  pixelCounts: number[];
  reasons: Array<ColorCheckerSampleReason | undefined>;
  valid: boolean[];
  /** Minimum cell edge length in pixels. */
  cellSize: number;
}

export function sampleColorCheckerGrid(
  pixels: Float32Array,
  width: number,
  height: number,
  corners: [Point, Point, Point, Point],
  inset = 0.5,
): ColorCheckerSampling | null {
  const cells = buildColorCheckerGrid(corners, inset);
  if (!cells) return null;
  const samples: Array<[number, number, number]> = [];
  const centers: Point[] = [];
  const sampleQuads: Array<[Point, Point, Point, Point]> = [];
  const patchRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  const clipped: boolean[] = [];
  const clippedFractions: number[] = [];
  const pixelCounts: number[] = [];
  const reasons: Array<ColorCheckerSampleReason | undefined> = [];
  const valid: boolean[] = [];
  let cellSize = Infinity;

  for (const cell of cells) {
    centers.push(cell.center);
    sampleQuads.push(cell.sampleQuad);
    const xs = cell.sampleQuad.map((p) => p.x);
    const ys = cell.sampleQuad.map((p) => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(width, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(height, Math.ceil(Math.max(...ys)));
    patchRects.push({ x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) });

    const cellEdges = [
      Math.hypot(cell.cellQuad[1].x - cell.cellQuad[0].x, cell.cellQuad[1].y - cell.cellQuad[0].y),
      Math.hypot(cell.cellQuad[2].x - cell.cellQuad[1].x, cell.cellQuad[2].y - cell.cellQuad[1].y),
    ];
    cellSize = Math.min(cellSize, Math.min(...cellEdges));

    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    let clippedPixels = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!pointInQuad(x + 0.5, y + 0.5, cell.sampleQuad)) continue;
        const i = (y * width + x) * 4;
        const rr = pixels[i], gg = pixels[i + 1], bb = pixels[i + 2];
        if (!Number.isFinite(rr) || !Number.isFinite(gg) || !Number.isFinite(bb)) continue;
        // Post-WB values can legitimately exceed 1 after channel gains. Only
        // call a pixel clipped when every channel is at the sensor ceiling;
        // the pre-WB WB pass catches channel-specific clipping separately.
        if (rr >= 0.995 && gg >= 0.995 && bb >= 0.995) clippedPixels++;
        rs.push(rr); gs.push(gg); bs.push(bb);
      }
    }
    const n = rs.length;
    pixelCounts.push(n);
    clippedFractions.push(n ? clippedPixels / n : 0);
    if (!n) {
      samples.push([0, 0, 0]);
      clipped.push(false);
      reasons.push('outside');
      valid.push(false);
      continue;
    }
    const mean: [number, number, number] = [trimmedMean(rs), trimmedMean(gs), trimmedMean(bs)];
    const isClipped = clippedPixels / n > 0.01;
    let reason: ColorCheckerSampleReason | undefined;
    if (isClipped) reason = 'clipped';
    else if (!mean.every((v) => Number.isFinite(v))) reason = 'nan';
    else if (Math.max(...mean) <= 0.002) reason = 'dark';
    samples.push(mean);
    clipped.push(isClipped);
    reasons.push(reason);
    valid.push(!reason);
  }
  return {
    samples,
    centers,
    sampleQuads,
    patchRects,
    clipped,
    clippedFractions,
    pixelCounts,
    reasons,
    valid,
    cellSize: Number.isFinite(cellSize) ? cellSize : 0,
  };
}
