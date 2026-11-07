import type { ColorCheckerPatchResult, Mat3 } from '../types';
import { ccmFromTotal, inverse3, isMat3, mul3Vec } from './matrices';
import { deltaE00Parts, linearSrgbToLab, type Lab } from './lab';
import type { ColorCheckerPatch } from './colorchecker-data';

export interface CcmFitInput {
  camera: Array<[number, number, number]>;
  referenceSrgb: Array<[number, number, number]>;
  valid?: boolean[];
  patches?: ColorCheckerPatch[];
  csc: Mat3;
}

export interface CcmFitResult {
  matrixTotal: Mat3;
  matrixCcm: Mat3;
  patches: ColorCheckerPatchResult[];
  meanDE00: number;
  maxDE00: number;
  meanAbsDC: number;
  validCount: number;
  method: 'ls' | 'de00-optimized';
  iterations: number;
  warnings: string[];
}

function normalEquations(A: number[][], B: number[][]): Mat3 {
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atb = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) ata[j][k] += A[i][j] * A[i][k];
    }
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) atb[j][k] += A[i][j] * B[i][k];
    }
  }
  // Tikhonov regularization for rank-deficient cards / duplicated patches.
  const lambda = 1e-8;
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

function normalizeRowsStrict(m: Mat3): Mat3 {
  const out = [...m] as Mat3;
  for (let r = 0; r < 3; r++) {
    const s = m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2];
    if (Math.abs(s) > 1e-9) {
      out[r * 3] /= s;
      out[r * 3 + 1] /= s;
      out[r * 3 + 2] /= s;
    }
  }
  return out;
}

function paramsToMatrix(p: number[]): Mat3 {
  return [
    p[0], p[1], 1 - p[0] - p[1],
    p[2], p[3], 1 - p[2] - p[3],
    p[4], p[5], 1 - p[4] - p[5],
  ];
}

function matrixToParams(m: Mat3): number[] {
  return [m[0], m[1], m[3], m[4], m[6], m[7]];
}

function evaluate(
  p: number[],
  camera: Array<[number, number, number]>,
  refLab: Lab[],
  valid: boolean[],
  initial: Mat3,
): number {
  const m = paramsToMatrix(p);
  if (!isMat3(m) || m.some((v) => Math.abs(v) > 6)) return 1e9;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < camera.length; i++) {
    if (!valid[i]) continue;
    const lin = mul3Vec(m, camera[i]);
    const lab = linearSrgbToLab([
      Math.max(0, Math.min(1, lin[0])),
      Math.max(0, Math.min(1, lin[1])),
      Math.max(0, Math.min(1, lin[2])),
    ]);
    sum += deltaE00Parts(lab, refLab[i]).dE00;
    n++;
  }
  if (!n) return 1e9;
  // Keep the optimizer close to the LS solution unless ΔE improves enough.
  let reg = 0;
  for (let i = 0; i < 9; i++) reg += (m[i] - initial[i]) ** 2;
  return sum / n + 0.002 * reg;
}

/** Nelder-Mead on the 6 free entries (each row sums to 1). */
function optimizeDE00(
  initial: Mat3,
  camera: Array<[number, number, number]>,
  refLab: Lab[],
  valid: boolean[],
): { matrix: Mat3; iterations: number } {
  const dim = 6;
  const start = matrixToParams(initial);
  const simplex: number[][] = [start];
  const step = 0.05;
  for (let i = 0; i < dim; i++) {
    const p = [...start];
    p[i] += step;
    simplex.push(p);
  }
  const values = simplex.map((p) => evaluate(p, camera, refLab, valid, initial));
  const alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;
  let iter = 0;
  for (; iter < 400; iter++) {
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
    const fr = evaluate(reflected, camera, refLab, valid, initial);
    if (fr < values[0]) {
      const expanded = centroid.map((c, i) => c + gamma * (c - simplex[dim][i]));
      const fe = evaluate(expanded, camera, refLab, valid, initial);
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
      const fc = evaluate(contracted, camera, refLab, valid, initial);
      if (fc < values[dim]) {
        simplex[dim] = contracted;
        values[dim] = fc;
      } else {
        for (let i = 1; i <= dim; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + sigma * (v - simplex[0][j]));
          values[i] = evaluate(simplex[i], camera, refLab, valid, initial);
        }
      }
    }
  }
  let bestIdx = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[bestIdx]) bestIdx = i;
  return { matrix: paramsToMatrix(simplex[bestIdx]), iterations: iter };
}

export function fitCcm(input: CcmFitInput): CcmFitResult {
  const warnings: string[] = [];
  const valid = input.valid ?? input.camera.map(() => true);
  const idx = valid.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 8) {
    throw new Error(`有效色块太少（${idx.length}/24），至少需要 8 块。`);
  }
  const A = idx.map((i) => input.camera[i]);
  const B = idx.map((i) => input.referenceSrgb[i].map((v) => (v > 1 ? v / 255 : v)) as [number, number, number]);
  // referenceSrgb is expected in 0..1 *linear* sRGB. If callers pass 0..255,
  // convert only values > 1 above; srgb decode is the caller's responsibility.
  const lsRaw = normalEquations(A, B);
  const ls = normalizeRowsStrict(lsRaw);
  const refLab = idx.map((_, j) => {
    const [r, g, b] = B[j];
    // B is already linear sRGB.
    return linearSrgbToLab([r, g, b]);
  });

  let chosen = ls;
  let method: 'ls' | 'de00-optimized' = 'ls';
  let iterations = 0;
  try {
    const opt = optimizeDE00(ls, A, refLab, idx.map(() => true));
    const before = evaluate(matrixToParams(ls), A, refLab, idx.map(() => true), ls);
    const after = evaluate(matrixToParams(opt.matrix), A, refLab, idx.map(() => true), ls);
    if (after < before - 1e-6) {
      chosen = opt.matrix;
      method = 'de00-optimized';
    }
    iterations = opt.iterations;
  } catch (e) {
    warnings.push(`ΔE00 优化失败，保留最小二乘解：${e instanceof Error ? e.message : String(e)}`);
  }

  const inv = inverse3(input.csc);
  if (!inv) throw new Error('CSC 矩阵不可逆，无法推导 CCM');
  const ccm = ccmFromTotal(chosen, input.csc);
  if (!ccm) throw new Error('CCM 推导失败');

  const patches: ColorCheckerPatchResult[] = [];
  let sum = 0;
  let max = 0;
  let sumAbsDC = 0;
  let count = 0;
  for (let i = 0; i < input.camera.length; i++) {
    const lin = mul3Vec(chosen, input.camera[i]);
    const measuredLab = linearSrgbToLab([
      Math.max(0, Math.min(1, lin[0])),
      Math.max(0, Math.min(1, lin[1])),
      Math.max(0, Math.min(1, lin[2])),
    ]);
    const ref = input.patches?.[i]?.lab ?? linearSrgbToLab(input.referenceSrgb[i] as [number, number, number]);
    const parts = deltaE00Parts(measuredLab, ref);
    const used = valid[i];
    if (used) {
      sum += parts.dE00;
      max = Math.max(max, parts.dE00);
      sumAbsDC += Math.abs(parts.dC);
      count++;
    }
    patches.push({
      index: i,
      name: input.patches?.[i]?.nameZh ?? input.patches?.[i]?.name ?? `Patch ${i + 1}`,
      refLab: ref,
      measuredLab,
      dE00: parts.dE00,
      dC: parts.dC,
      clipped: false,
      used,
    });
  }

  return {
    matrixTotal: chosen,
    matrixCcm: ccm,
    patches,
    meanDE00: count ? sum / count : 0,
    maxDE00: max,
    meanAbsDC: count ? sumAbsDC / count : 0,
    validCount: count,
    method,
    iterations,
    warnings,
  };
}
