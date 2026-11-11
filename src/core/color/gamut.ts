import { labToLinearSrgb, linearSrgbToLab, srgbEncode } from './lab';

/**
 * Approximate the sRGB gamut as the maximum Lab chroma per hue direction.
 * The result is a closed polygon in the a*b* plane, useful as a faint outline
 * behind ColorChecker error plots. It is an envelope across all L*, not a
 * single-L* slice, so points of any lightness can sit inside it.
 */
export function srgbABEnvelope(bins = 180, steps = 18): Array<[number, number]> {
  const maxC = new Float64Array(bins);
  const sample = (r: number, g: number, b: number) => {
    const [, a, bb] = linearSrgbToLab([r, g, b]);
    const C = Math.hypot(a, bb);
    if (!(C > 0)) return;
    let h = (Math.atan2(bb, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    const idx = Math.min(bins - 1, Math.floor((h / 360) * bins));
    if (C > maxC[idx]) maxC[idx] = C;
  };
  const n = Math.max(2, Math.floor(steps));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    for (let j = 0; j <= n; j++) {
      const u = j / n;
      // Six RGB cube faces.
      sample(t, u, 0);
      sample(t, u, 1);
      sample(t, 0, u);
      sample(1, t, u);
      sample(0, u, t);
      sample(u, 1, t);
    }
  }
  const points: Array<[number, number]> = [];
  for (let i = 0; i < bins; i++) {
    const C = maxC[i];
    if (!(C > 0)) continue;
    const h = ((i + 0.5) / bins) * 2 * Math.PI;
    points.push([C * Math.cos(h), C * Math.sin(h)]);
  }
  return points;
}

function inGamut(rgb: [number, number, number], eps = 1e-6): boolean {
  return rgb.every((v) => Number.isFinite(v) && v >= -eps && v <= 1 + eps);
}

function toSrgb8(linear: [number, number, number]): [number, number, number] {
  return linear.map((v) => Math.round(Math.max(0, Math.min(1, srgbEncode(v))) * 255)) as [
    number,
    number,
    number,
  ];
}

const LIMIT_CACHE = new Map<string, Float64Array>();

/**
 * Maximum in-gamut sRGB chroma for every hue bin at a single L*.
 *
 * Chroma is reduced with L* and hue held constant, matching `gamutMapLab`.
 * The result is cached because a*b* background fields reuse the same L*
 * for every pixel.
 */
export function srgbChromaLimitAtL(L: number, bins = 180): Float64Array {
  const l = Math.max(0, Math.min(100, L));
  const count = Math.max(4, Math.floor(bins));
  const key = `${l.toFixed(3)}|${count}`;
  const cached = LIMIT_CACHE.get(key);
  if (cached) return cached;

  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const h = ((i + 0.5) / count) * 2 * Math.PI;
    const ca = Math.cos(h);
    const sa = Math.sin(h);
    let lo = 0;
    let hi = 180;
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      if (inGamut(labToLinearSrgb([l, mid * ca, mid * sa]))) lo = mid;
      else hi = mid;
    }
    out[i] = lo;
  }
  LIMIT_CACHE.set(key, out);
  return out;
}

/** Closed sRGB gamut outline in the a*b* plane at a single L*. */
export function srgbABSlice(L: number, bins = 180): Array<[number, number]> {
  const limit = srgbChromaLimitAtL(L, bins);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < limit.length; i++) {
    const C = limit[i];
    if (!(C > 0)) continue;
    const h = ((i + 0.5) / limit.length) * 2 * Math.PI;
    points.push([C * Math.cos(h), C * Math.sin(h)]);
  }
  return points;
}

/**
 * sRGB colour (0..255) for an a*b* position at a fixed L*.
 *
 * In-gamut positions map directly. Out-of-gamut positions keep L* and hue and
 * clamp chroma to the sRGB boundary, so the whole plane still shows which
 * direction a patch leans instead of turning into a misleading flat patch.
 */
export function abSliceColor(
  a: number,
  b: number,
  L: number,
  limit: Float64Array = srgbChromaLimitAtL(L),
): [number, number, number] {
  const l = Math.max(0, Math.min(100, L));
  const direct = labToLinearSrgb([l, a, b]);
  if (inGamut(direct)) return toSrgb8(direct);

  const C = Math.hypot(a, b);
  if (!(C > 1e-9) || limit.length === 0) {
    return toSrgb8([
      Math.max(0, Math.min(1, direct[0])),
      Math.max(0, Math.min(1, direct[1])),
      Math.max(0, Math.min(1, direct[2])),
    ]);
  }

  const bins = limit.length;
  let hue = Math.atan2(b, a);
  if (hue < 0) hue += Math.PI * 2;
  const pos = (hue / (Math.PI * 2)) * bins - 0.5;
  const i0 = Math.floor(pos);
  const t = pos - i0;
  const idx0 = ((i0 % bins) + bins) % bins;
  const idx1 = (idx0 + 1) % bins;
  const maxC = limit[idx0] + (limit[idx1] - limit[idx0]) * t;
  if (!(maxC > 0)) {
    return toSrgb8([l / 100, l / 100, l / 100]);
  }
  const scale = Math.min(C, maxC) / C;
  const mapped = labToLinearSrgb([l, a * scale, b * scale]);
  return toSrgb8([
    Math.max(0, Math.min(1, mapped[0])),
    Math.max(0, Math.min(1, mapped[1])),
    Math.max(0, Math.min(1, mapped[2])),
  ]);
}
