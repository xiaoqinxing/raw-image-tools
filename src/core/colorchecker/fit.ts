import type {
  ColorCheckerObjective,
  ColorCheckerResult,
  ColorCheckerSample,
  ColorCheckerTarget,
  Point,
} from '../types';
import { fitCcm } from '../color/ccm';
import { getReference } from '../color/colorchecker-data';
import { srgbDecode } from '../color/lab';
import { adjustReferenceTargets } from '../color/target';
import { sampleColorCheckerGrid } from './geometry';
import { normalizeColorCheckerTarget, normalizeColorCheckerWeights } from './settings';

export interface ColorCheckerFitInput {
  pixels: Float32Array;
  width: number;
  height: number;
  corners: [Point, Point, Point, Point];
  referenceId?: string;
  inset?: number;
  weights?: number[];
  target?: ColorCheckerTarget;
  objective?: ColorCheckerObjective;
}

export function fitColorChecker(input: ColorCheckerFitInput): Omit<ColorCheckerResult, keyof import('../types').AnalysisMeta> & { kind: 'colorchecker'; warnings: string[] } {
  const sampling = sampleColorCheckerGrid(input.pixels, input.width, input.height, input.corners, input.inset ?? 0.5);
  if (!sampling) throw new Error('色卡四角无效，无法建立透视网格');
  const patches = getReference(input.referenceId ?? 'classic24-pre2014-d65');
  const referenceLinear = patches.map((p) => [
    srgbDecode(p.srgb[0] / 255),
    srgbDecode(p.srgb[1] / 255),
    srgbDecode(p.srgb[2] / 255),
  ] as [number, number, number]);
  const referenceLab = patches.map((p) => p.lab);
  const target = normalizeColorCheckerTarget(input.target);
  const adjusted = adjustReferenceTargets(referenceLinear, referenceLab, target);
  const weights = normalizeColorCheckerWeights(input.weights);
  const valid = sampling.valid.map((v, i) => v && i < patches.length);
  const warnings: string[] = [];
  if (adjusted.gamutClippedCount > 0) {
    warnings.push(`目标色超出 sRGB 色域：${adjusted.gamutClippedCount} 块已降低彩度。`);
  }
  if (Math.abs(target.saturation - 100) > 1e-9 || Math.abs(target.hue) > 1e-9) {
    warnings.push(`目标已调整：饱和度 ${target.saturation}% / 色调 ${target.hue}°；标准 ΔE00 另行显示。`);
  }
  const chromaticUsed = valid.filter((v, i) => v && i < 18 && weights[i] > 0).length;
  if (chromaticUsed < 3) {
    warnings.push(`参与拟合的彩色块只有 ${chromaticUsed} 块，矩阵色度约束可能不足。`);
  }

  const fit = fitCcm({
    camera: sampling.samples,
    referenceSrgb: adjusted.linear,
    referenceLab: adjusted.lab,
    standardReferenceLab: referenceLab,
    patches,
    valid,
    weights,
    objective: input.objective,
    patchReasons: sampling.reasons,
    warnings,
  });

  const samples: ColorCheckerSample[] = sampling.samples.map((mean, i) => ({
    index: i,
    center: {
      x: sampling.centers[i].x / input.width,
      y: sampling.centers[i].y / input.height,
    },
    quad: sampling.sampleQuads[i].map((p) => ({
      x: p.x / input.width,
      y: p.y / input.height,
    })) as [Point, Point, Point, Point],
    weight: weights[i],
    valid: valid[i],
    reason: sampling.reasons[i],
    meanRgb: mean,
    pixelCount: sampling.pixelCounts[i],
  }));

  return {
    kind: 'colorchecker',
    patches: fit.patches,
    samples,
    meanDE00: fit.meanDE00,
    maxDE00: fit.maxDE00,
    meanAbsDC: fit.meanAbsDC,
    meanAbsDH: fit.meanAbsDH,
    weightedMeanDE00: fit.weightedMeanDE00,
    meanDE00Standard: fit.meanDE00Standard,
    maxDE00Standard: fit.maxDE00Standard,
    meanChromaError: fit.meanChromaError,
    saturationGain: fit.saturationGain,
    saturationGainTarget: fit.saturationGainTarget,
    saturationCount: fit.saturationCount,
    matrixTotal: fit.matrixTotal,
    matrixCcm: fit.matrixCcm,
    validCount: fit.validCount,
    usedCount: fit.usedCount,
    method: fit.method,
    objective: fit.objective,
    targetSaturation: target.saturation,
    targetHue: target.hue,
    weights,
    gamutClippedCount: adjusted.gamutClippedCount,
    warnings: fit.warnings,
  };
}
