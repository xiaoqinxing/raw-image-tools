import type { ColorCheckerResult, Mat3, Point } from '../types';
import { fitCcm } from '../color/ccm';
import { getReference } from '../color/colorchecker-data';
import { srgbDecode } from '../color/lab';
import { sampleColorCheckerGrid } from './geometry';

export interface ColorCheckerFitInput {
  pixels: Float32Array;
  width: number;
  height: number;
  corners: [Point, Point, Point, Point];
  csc: Mat3;
  referenceId?: string;
  inset?: number;
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
  const valid = sampling.valid.map((v, i) => v && i < patches.length);
  const fit = fitCcm({
    camera: sampling.samples,
    referenceSrgb: referenceLinear,
    patches,
    valid,
    csc: input.csc,
  });
  return {
    kind: 'colorchecker',
    patches: fit.patches,
    meanDE00: fit.meanDE00,
    maxDE00: fit.maxDE00,
    meanAbsDC: fit.meanAbsDC,
    matrixTotal: fit.matrixTotal,
    matrixCcm: fit.matrixCcm,
    validCount: fit.validCount,
    method: fit.method,
    warnings: fit.warnings,
  };
}
