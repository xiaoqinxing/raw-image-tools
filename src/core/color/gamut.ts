import { linearSrgbToLab } from './lab';

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
