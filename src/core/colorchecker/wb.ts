import type { ColorCheckerWbResult, Vec4 } from '../types';
import { COLOR_CHECKER_WB_PATCH_INDICES } from './settings';

/**
 * Estimate white balance from the four middle neutral patches of the bottom
 * row (Neutral 8 / 6.5 / 5 / 3.5). Samples must come from a pre-WB render.
 *
 * The four patches have different reflectance by design, so the gains are
 * averaged per patch (G/R and G/B) instead of averaging raw pixel levels.
 */
export function computeChartWb(
  samples: Array<[number, number, number]>,
  valid: boolean[],
  patchIndices: number[] = COLOR_CHECKER_WB_PATCH_INDICES,
): ColorCheckerWbResult {
  const used: Array<[number, number, number]> = [];
  const warnings: string[] = [];
  for (const index of patchIndices) {
    if (!valid[index]) continue;
    const sample = samples[index];
    if (!sample || !sample.every((v) => Number.isFinite(v) && v > 1e-6)) continue;
    used.push(sample);
  }
  if (used.length < 2) {
    throw new Error('色卡底部中性块有效数量不足（至少需要 2 块）');
  }

  const rGains = used.map(([r, g]) => g / r);
  const bGains = used.map(([, g, b]) => g / b);
  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const rGain = mean(rGains);
  const bGain = mean(bGains);
  if (!(rGain > 1e-6) || !(bGain > 1e-6)) {
    throw new Error('色卡中性块信号过低，无法计算 WB');
  }
  const clampGain = (v: number) => Math.max(0.1, Math.min(8, v));
  const multipliers: Vec4 = [clampGain(rGain), 1, 1, clampGain(bGain)];

  // Spread of the per-patch gains, not of the patch luminance: the four
  // neutral patches are different densities and are expected to be darker.
  const spread = Math.max(
    ...rGains.map((v) => Math.abs(v - rGain) / rGain),
    ...bGains.map((v) => Math.abs(v - bGain) / bGain),
  );
  if (spread > 0.05) warnings.push(`四个中性块的 R/G、B/G 比例差 ${(spread * 100).toFixed(1)}%，可能有光照不均或反光。`);

  const channelMean = (channel: number) => used.reduce((sum, sample) => sum + sample[channel], 0) / used.length;

  return {
    multipliers,
    means: [channelMean(0), channelMean(1), channelMean(1), channelMean(2)],
    validCount: used.length,
    spread,
    patchIndices: [...patchIndices],
    warnings,
  };
}
