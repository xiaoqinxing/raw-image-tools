import type {
  ColorCheckerObjective,
  ColorCheckerPatchResult,
  ColorCheckerSampleReason,
  Mat3,
} from '../types';
import { det3, inverse3, isMat3, mul3Vec, transpose3 } from './matrices';
import { deltaE00Parts, linearSrgbToLab, type Lab } from './lab';
import type { ColorCheckerPatch } from './colorchecker-data';

export interface CcmFitInput {
  camera: Array<[number, number, number]>;
  /** Linear sRGB targets after the optional saturation/hue adjustment. */
  referenceSrgb: Array<[number, number, number]>;
  /** Lab targets after the optional saturation/hue adjustment. */
  referenceLab?: Lab[];
  /** Original D65 reference Lab, used for the honest "standard" metrics. */
  standardReferenceLab?: Lab[];
  valid?: boolean[];
  /** Per-patch weights; 0 excludes a patch from the fit. */
  weights?: number[];
  objective?: ColorCheckerObjective;
  patchReasons?: Array<ColorCheckerSampleReason | undefined>;
  patches?: ColorCheckerPatch[];
  warnings?: string[];
}

export interface CcmFitResult {
  matrixTotal: Mat3;
  matrixCcm: Mat3;
  patches: ColorCheckerPatchResult[];
  meanDE00: number;
  maxDE00: number;
  meanAbsDC: number;
  meanAbsDH: number;
  weightedMeanDE00: number;
  meanDE00Standard: number;
  maxDE00Standard: number;
  meanChromaError: number;
  validCount: number;
  usedCount: number;
  method: 'ls' | 'de00-optimized' | 'chroma-optimized';
  objective: ColorCheckerObjective;
  iterations: number;
  warnings: string[];
}

function normalizeWeights(weights: number[] | undefined, length: number): number[] {
  return Array.from({ length }, (_, i) => {
    const w = weights?.[i];
    return typeof w === 'number' && Number.isFinite(w) ? Math.max(0, Math.min(4, w)) : 1;
  });
}

function normalEquations(A: number[][], B: number[][], weights: number[]): Mat3 {
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atb = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < A.length; i++) {
    const w = weights[i] ?? 1;
    if (w <= 0) continue;
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) ata[j][k] += w * A[i][j] * A[i][k];
    }
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) atb[j][k] += w * A[i][j] * B[i][k];
    }
  }
  // Tikhonov regularization scaled to the data, so underexposed charts do not
  // get a relatively huge lambda. This is only for rank-deficient cards.
  const trace = ata[0][0] + ata[1][1] + ata[2][2];
  if (!(trace > 1e-12)) throw new Error('CCM 最小二乘矩阵奇异：相机样本信号过低');
  const lambda = Math.max(1e-12, trace * 1e-8);
  ata[0][0] += lambda;
  ata[1][1] += lambda;
  ata[2][2] += lambda;
  const a: Mat3 = [
    ata[0][0], ata[0][1], ata[0][2],
    ata[1][0], ata[1][1], ata[1][2],
    ata[2][0], ata[2][1], ata[2][2],
  ];
  const inv = inverse3(a);
  if (!inv) throw new Error('CCM 最小二乘矩阵奇异');
  // inv * atb -> 3x3, row r output channel; convert to row-major M_total.
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = inv[r * 3] * atb[0][c] + inv[r * 3 + 1] * atb[1][c] + inv[r * 3 + 2] * atb[2][c];
    }
  }
  return out as Mat3;
}

function paramsToMatrix(p: number[]): Mat3 {
  return [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]];
}

function matrixToParams(m: Mat3): number[] {
  return [...m];
}

const CHROMA_L_WEIGHT = 0.1;

function objectiveValue(
  parts: ReturnType<typeof deltaE00Parts>,
  objective: ColorCheckerObjective,
): number {
  return objective === 'chroma'
    ? parts.dEChroma + CHROMA_L_WEIGHT * Math.abs(parts.dL)
    : parts.dE00;
}

function evaluate(
  p: number[],
  camera: Array<[number, number, number]>,
  refLab: Lab[],
  weights: number[],
  objective: ColorCheckerObjective,
  initial: Mat3,
): number {
  const m = paramsToMatrix(p);
  if (!isMat3(m) || m.some((v) => Math.abs(v) > 6) || Math.abs(det3(m)) < 1e-9) return 1e9;
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < camera.length; i++) {
    const w = weights[i] ?? 0;
    if (w <= 0) continue;
    const lin = mul3Vec(m, camera[i]);
    const lab = linearSrgbToLab([
      Math.max(0, Math.min(1, lin[0])),
      Math.max(0, Math.min(1, lin[1])),
      Math.max(0, Math.min(1, lin[2])),
    ]);
    sum += w * objectiveValue(deltaE00Parts(lab, refLab[i]), objective);
    weightSum += w;
  }
  if (!weightSum) return 1e9;
  // Keep the optimizer close to the LS solution unless the metric improves.
  let reg = 0;
  for (let i = 0; i < 9; i++) reg += (m[i] - initial[i]) ** 2;
  return sum / weightSum + 0.002 * reg;
}

/** Nelder-Mead on all nine matrix entries. */
function optimizeMatrix(
  initial: Mat3,
  camera: Array<[number, number, number]>,
  refLab: Lab[],
  weights: number[],
  objective: ColorCheckerObjective,
): { matrix: Mat3; iterations: number } {
  const dim = 9;
  const start = matrixToParams(initial);
  const simplex: number[][] = [start];
  const step = 0.05;
  for (let i = 0; i < dim; i++) {
    const p = [...start];
    p[i] += step;
    simplex.push(p);
  }
  const values = simplex.map((p) => evaluate(p, camera, refLab, weights, objective, initial));
  const alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;
  let iter = 0;
  for (; iter < 600; iter++) {
    const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
    for (let i = 0; i < simplex.length; i++) {
      const src = simplex[order[i]];
      simplex[i] = src;
      values[i] = values[order[i]];
    }
    const best = values[0];
    const worst = values[values.length - 1];
    if (Math.abs(worst - best) < 1e-8) break;
    const centroid = new Array(dim).fill(0);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) centroid[j] += simplex[i][j] / dim;
    }
    const reflected = centroid.map((c, i) => c + alpha * (c - simplex[dim][i]));
    const fr = evaluate(reflected, camera, refLab, weights, objective, initial);
    if (fr < values[0]) {
      const expanded = centroid.map((c, i) => c + gamma * (c - simplex[dim][i]));
      const fe = evaluate(expanded, camera, refLab, weights, objective, initial);
      if (fe < fr) {
        simplex[dim] = expanded;
        values[dim] = fe;
      } else {
        simplex[dim] = reflected;
        values[dim] = fr;
      }
    } else if (fr < values[dim - 1]) {
      simplex[dim] = reflected;
      values[dim] = fr;
    } else {
      const contracted = centroid.map((c, i) => c + rho * (simplex[dim][i] - c));
      const fc = evaluate(contracted, camera, refLab, weights, objective, initial);
      if (fc < values[dim]) {
        simplex[dim] = contracted;
        values[dim] = fc;
      } else {
        for (let i = 1; i <= dim; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + sigma * (v - simplex[0][j]));
          values[i] = evaluate(simplex[i], camera, refLab, weights, objective, initial);
        }
      }
    }
  }
  let bestIdx = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[bestIdx]) bestIdx = i;
  return { matrix: paramsToMatrix(simplex[bestIdx]), iterations: iter };
}

export function fitCcm(input: CcmFitInput): CcmFitResult {
  const warnings = [...(input.warnings ?? [])];
  const valid = input.valid ?? input.camera.map(() => true);
  const weights = normalizeWeights(input.weights, input.camera.length);
  const idx = valid.map((v, i) => (v && weights[i] > 0 ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 8) {
    throw new Error(`有效且权重大于 0 的色块太少（${idx.length}/24），至少需要 8 块。`);
  }
  const A = idx.map((i) => input.camera[i]);
  const B = idx.map((i) => input.referenceSrgb[i].map((v) => (v > 1 ? v / 255 : v)) as [number, number, number]);
  const W = idx.map((i) => weights[i]);
  // Samples are stored as rows (camera_i, reference_i), so the normal
  // equations solve A * X = B and produce X^T. Transpose back to a matrix that
  // can be applied as mul3Vec(chosen, camera).
  const ls = transpose3(normalEquations(A, B, W));
  const refLab = idx.map((i, j) => input.referenceLab?.[i] ?? linearSrgbToLab(B[j]));

  const objective: ColorCheckerObjective = input.objective === 'chroma' ? 'chroma' : 'de00';
  let chosen = ls;
  let method: CcmFitResult['method'] = 'ls';
  let iterations = 0;
  try {
    const opt = optimizeMatrix(ls, A, refLab, W, objective);
    const before = evaluate(matrixToParams(ls), A, refLab, W, objective, ls);
    const after = evaluate(matrixToParams(opt.matrix), A, refLab, W, objective, ls);
    if (after < before - 1e-6) {
      chosen = opt.matrix;
      method = objective === 'chroma' ? 'chroma-optimized' : 'de00-optimized';
    }
    iterations = opt.iterations;
  } catch (e) {
    warnings.push(`ΔE00 优化失败，保留最小二乘解：${e instanceof Error ? e.message : String(e)}`);
  }

  const patches: ColorCheckerPatchResult[] = [];
  let sum = 0;
  let max = 0;
  let sumAbsDC = 0;
  let sumAbsDH = 0;
  let sumChroma = 0;
  let count = 0;
  let weightedSum = 0;
  let weightSum = 0;
  let sumStandard = 0;
  let maxStandard = 0;
  let standardCount = 0;
  let usedCount = 0;
  const stdLabs = input.standardReferenceLab;

  for (let i = 0; i < input.camera.length; i++) {
    const lin = mul3Vec(chosen, input.camera[i]);
    const measuredLab = linearSrgbToLab([
      Math.max(0, Math.min(1, lin[0])),
      Math.max(0, Math.min(1, lin[1])),
      Math.max(0, Math.min(1, lin[2])),
    ]);
    const ref = input.referenceLab?.[i] ?? linearSrgbToLab(input.referenceSrgb[i] as [number, number, number]);
    const standardRef = stdLabs?.[i] ?? ref;
    const parts = deltaE00Parts(measuredLab, ref);
    const standardParts = deltaE00Parts(measuredLab, standardRef);
    const used = valid[i] && weights[i] > 0;
    if (valid[i]) {
      sum += parts.dE00;
      max = Math.max(max, parts.dE00);
      sumAbsDC += Math.abs(parts.dC);
      sumAbsDH += Math.abs(parts.dH);
      sumChroma += parts.dEChroma;
      sumStandard += standardParts.dE00;
      maxStandard = Math.max(maxStandard, standardParts.dE00);
      count++;
      standardCount++;
    }
    if (used) {
      weightedSum += weights[i] * parts.dE00;
      weightSum += weights[i];
      usedCount++;
    }
    patches.push({
      index: i,
      name: input.patches?.[i]?.nameZh ?? input.patches?.[i]?.name ?? `Patch ${i + 1}`,
      refLab: ref,
      measuredLab,
      standardRefLab: standardRef,
      dE00: parts.dE00,
      dC: parts.dC,
      dH: parts.dH,
      dEChroma: parts.dEChroma,
      dE00Standard: standardParts.dE00,
      clipped: input.patchReasons?.[i] === 'clipped',
      used,
      weight: weights[i],
      invalidReason: input.patchReasons?.[i],
    });
  }

  return {
    matrixTotal: chosen,
    matrixCcm: chosen,
    patches,
    meanDE00: count ? sum / count : 0,
    maxDE00: max,
    meanAbsDC: count ? sumAbsDC / count : 0,
    meanAbsDH: count ? sumAbsDH / count : 0,
    weightedMeanDE00: weightSum ? weightedSum / weightSum : 0,
    meanDE00Standard: standardCount ? sumStandard / standardCount : 0,
    maxDE00Standard: maxStandard,
    meanChromaError: count ? sumChroma / count : 0,
    validCount: count,
    usedCount,
    method,
    objective,
    iterations,
    warnings,
  };
}
