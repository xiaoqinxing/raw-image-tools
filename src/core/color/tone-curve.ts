import type { Point, ToneCurveChannel, ToneCurvePoints } from '../types';

export const TONE_CURVE_CHANNELS: ToneCurveChannel[] = ['rgb', 'r', 'g', 'b'];

export const TONE_CURVE_LUT_SIZE = 4096;
export const MIN_TONE_CURVE_POINTS = 2;
export const MAX_TONE_CURVE_POINTS = 16;

const EPS = 1e-6;
const MERGE_X = 1e-4;

function identityPoints(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
}

export function createIdentityToneCurvePoints(): ToneCurvePoints {
  return {
    rgb: identityPoints(),
    r: identityPoints(),
    g: identityPoints(),
    b: identityPoints(),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Normalize an arbitrary point list into a stable, monotone-x curve.
 *
 * Endpoints are anchored at x=0 and x=1; their y values stay editable so a
 * curve can lift blacks or pull down whites. Interior points are sorted,
 * clamped to the display domain, and deduplicated. Invalid input falls back
 * to the identity curve.
 */
export function sanitizeToneCurvePoints(input: unknown): Point[] {
  if (!Array.isArray(input)) return identityPoints();
  let points: Point[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const x = Number((raw as Point).x);
    const y = Number((raw as Point).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x: clamp01(x), y: clamp01(y) });
  }
  points.sort((a, b) => a.x - b.x);
  const deduped: Point[] = [];
  for (const p of points) {
    if (deduped.length && p.x - deduped[deduped.length - 1].x < MERGE_X) continue;
    deduped.push(p);
  }
  if (deduped.length < MIN_TONE_CURVE_POINTS) return identityPoints();
  if (deduped.length > MAX_TONE_CURVE_POINTS) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    const interior = deduped.slice(1, -1);
    const keep = MAX_TONE_CURVE_POINTS - 2;
    const sampled: Point[] = [];
    if (interior.length) {
      for (let i = 0; i < keep; i++) {
        const idx = interior.length === 1 ? 0 : Math.round((i * (interior.length - 1)) / (keep - 1));
        const p = interior[idx];
        if (!sampled.length || p.x - sampled[sampled.length - 1].x >= MERGE_X) sampled.push(p);
      }
    }
    points = [first, ...sampled, last];
  } else {
    points = deduped;
  }
  if (points[0].x > MERGE_X) points.unshift({ x: 0, y: points[0].y });
  else points[0] = { x: 0, y: points[0].y };
  const last = points[points.length - 1];
  if (last.x < 1 - MERGE_X) points.push({ x: 1, y: last.y });
  else points[points.length - 1] = { x: 1, y: last.y };
  return points;
}

export function sanitizeToneCurvePointsSet(input: unknown): ToneCurvePoints {
  const identity = createIdentityToneCurvePoints();
  if (!input || typeof input !== 'object') return identity;
  const record = input as Record<string, unknown>;
  return {
    rgb: sanitizeToneCurvePoints(record.rgb ?? identity.rgb),
    r: sanitizeToneCurvePoints(record.r ?? identity.r),
    g: sanitizeToneCurvePoints(record.g ?? identity.g),
    b: sanitizeToneCurvePoints(record.b ?? identity.b),
  };
}

/** Fritsch–Carlson monotone cubic slopes. */
function curveSlopes(points: Point[]): number[] {
  const n = points.length;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(Math.max(EPS, points[i + 1].x - points[i].x));
    delta.push((points[i + 1].y - points[i].y) / h[i]);
  }
  const m = new Array<number>(n).fill(0);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0;
      continue;
    }
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
  }
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(delta[i]) < EPS) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * delta[i];
      m[i + 1] = tau * b * delta[i];
    }
  }
  return m;
}

/**
 * Evaluate a monotone cubic tone curve at x. Values outside the display domain
 * are returned unchanged so >1 highlight data and clipping warnings survive.
 */
export function evaluateToneCurve(points: Point[], x: number): number {
  if (!Number.isFinite(x) || x < 0 || x > 1) return x;
  const pts = points.length >= MIN_TONE_CURVE_POINTS ? points : identityPoints();
  if (pts.length === 2 && Math.abs(pts[0].x) < EPS && Math.abs(pts[0].y) < EPS
    && Math.abs(pts[1].x - 1) < EPS && Math.abs(pts[1].y - 1) < EPS) {
    return x;
  }
  const m = curveSlopes(pts);
  let i = 0;
  while (i < pts.length - 2 && x > pts[i + 1].x) i++;
  if (x <= pts[0].x) return clamp01(pts[0].y);
  if (x >= pts[pts.length - 1].x) return clamp01(pts[pts.length - 1].y);
  const x0 = pts[i].x;
  const x1 = pts[i + 1].x;
  const h = Math.max(EPS, x1 - x0);
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const y = h00 * pts[i].y + h10 * h * m[i] + h01 * pts[i + 1].y + h11 * h * m[i + 1];
  return clamp01(y);
}

export function toneCurveIsIdentity(points: Point[]): boolean {
  if (points.length < 2) return false;
  if (Math.abs(points[0].x) >= EPS || Math.abs(points[points.length - 1].x - 1) >= EPS) return false;
  return points.every((p) => Math.abs(p.y - p.x) < EPS);
}

export function toneCurveSetIsIdentity(points: ToneCurvePoints): boolean {
  return TONE_CURVE_CHANNELS.every((channel) => toneCurveIsIdentity(points[channel]));
}

/** Sample one channel into a float LUT suitable for a GPU texture row. */
export function buildToneCurveLut(points: Point[], size = TONE_CURVE_LUT_SIZE): Float32Array {
  const n = Math.max(2, Math.floor(size));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = evaluateToneCurve(points, i / (n - 1));
  return out;
}
