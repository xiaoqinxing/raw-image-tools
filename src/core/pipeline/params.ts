import type {
  Domain,
  Mat3,
  PipelineParams,
  PresetPipelineParams,
  RawImage,
  StageId,
  Vec4,
} from '../types';
import { deriveCscFromDng, IDENTITY3, matrixNearIdentity } from '../color/matrices';

export const STAGE_ORDER: StageId[] = [
  'levels',
  'flat',
  'wb',
  'demosaic',
  'denoise',
  'ccm',
  'csc',
  'gamma',
  'sharpen',
];

export const STAGE_LABELS: Record<StageId, string> = {
  levels: '黑电平 / 白电平',
  flat: '平场 / 镜头暗影',
  wb: '白平衡',
  demosaic: '去马赛克',
  denoise: '降噪',
  ccm: 'CCM 相机 RGB 校正',
  csc: 'CSC → 线性 sRGB',
  gamma: 'Gamma',
  sharpen: 'USM 锐化',
};

export const STAGE_DOMAIN: Record<StageId, Domain> = {
  levels: 'raw-cfa',
  flat: 'raw-cfa',
  wb: 'raw-cfa',
  demosaic: 'camera-rgb',
  denoise: 'camera-rgb',
  ccm: 'camera-rgb',
  csc: 'linear-srgb',
  gamma: 'display-srgb',
  sharpen: 'display-srgb',
};

export const STAGE_HALO: Record<StageId, number> = {
  levels: 0,
  flat: 0,
  wb: 0,
  demosaic: 3,
  denoise: 5,
  ccm: 0,
  csc: 0,
  gamma: 0,
  sharpen: 9,
};

export function nextStage(stage: StageId): StageId | null {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null;
}

export function stageIndex(stage: StageId): number {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * True when the viewer is inspecting the final display stages while the gamma
 * stage is bypassed. The preview then shows the actual linear output instead of
 * re-applying the sRGB display transform, so toggling gamma is visible.
 */
export function linearPreviewFor(p: PipelineParams, stage: StageId): boolean {
  return p.gamma.bypass && stageIndex(stage) >= stageIndex('gamma');
}

export function stageDomain(stage: StageId): Domain {
  return STAGE_DOMAIN[stage];
}

export function isLinearDomain(domain: Domain): boolean {
  return domain === 'raw-cfa' || domain === 'camera-rgb' || domain === 'linear-srgb';
}

export function createDefaultParams(raw?: RawImage): PipelineParams {
  const csc = raw ? deriveCscFromDng(raw.color) : { matrix: IDENTITY3, source: 'identity' as const, warnings: ['没有 RAW 色彩元数据。'] };
  const hasCsc = !matrixNearIdentity(csc.matrix);
  const wb = raw?.wb.asShot ?? [1, 1, 1, 1];
  return {
    schemaVersion: 1,
    levels: {
      bypass: false,
      black: raw?.levels.black ?? [0, 0, 0, 0],
      white: raw?.levels.white ?? [65535, 65535, 65535, 65535],
      clampNegative: true,
      source: raw ? 'metadata' : 'custom',
    },
    flat: {
      bypass: true,
      flatId: null,
      strength: 100,
      epsilon: 1e-4,
      maxGain: 8,
    },
    wb: {
      bypass: false,
      mode: raw?.wb.source === 'dng' || raw?.wb.source === 'libraw' ? 'as-shot' : 'custom',
      multipliers: [...wb] as Vec4,
      pick: null,
    },
    demosaic: {
      bypass: false,
      algorithm: 'mhc',
    },
    denoise: {
      bypass: true,
      method: 'guided',
      radius: 3,
      luma: 25,
      chroma: 35,
      detail: 50,
    },
    ccm: {
      bypass: false,
      source: 'identity',
      matrix: [...IDENTITY3] as Mat3,
    },
    csc: {
      bypass: false,
      source: hasCsc ? 'dng' : 'identity',
      matrix: hasCsc ? csc.matrix : ([...IDENTITY3] as Mat3),
      adaptation: 'bradford',
    },
    gamma: {
      bypass: false,
      mode: 'srgb',
    },
    sharpen: {
      bypass: true,
      amount: 100,
      radius: 1.2,
      threshold: 0.01,
    },
    output: {
      crop: null,
      bitDepth: 8,
      format: 'png',
    },
  };
}

export function cloneParams(p: PipelineParams): PipelineParams {
  return structuredClone(p);
}

export function bypassStage<T extends PipelineParams>(p: T, stage: StageId): T {
  const out = structuredClone(p);
  if (stage === 'levels' || stage === 'flat' || stage === 'wb' || stage === 'demosaic' || stage === 'denoise' || stage === 'ccm' || stage === 'csc' || stage === 'gamma' || stage === 'sharpen') {
    out[stage].bypass = true;
  }
  return out;
}

export function setStageBypass(p: PipelineParams, stage: StageId, bypass: boolean): PipelineParams {
  const out = structuredClone(p);
  out[stage].bypass = bypass;
  return out;
}

export function stageIsActive(p: PipelineParams, stage: StageId, hasFlat: boolean): boolean {
  if (stage === 'levels') return true;
  if (stage === 'flat') return !p.flat.bypass && hasFlat;
  if (p[stage].bypass) return false;
  if (stage === 'wb' || stage === 'demosaic') return true;
  if (stage === 'denoise' || stage === 'ccm' || stage === 'csc' || stage === 'gamma') {
    return !p.demosaic.bypass;
  }
  if (stage === 'sharpen') return !p.demosaic.bypass && !p.gamma.bypass;
  return false;
}

export function effectiveCsc(p: PipelineParams): Mat3 {
  return p.csc.source === 'identity' ? IDENTITY3 : p.csc.matrix;
}

export function effectiveCcm(p: PipelineParams): Mat3 {
  return p.ccm.source === 'identity' ? IDENTITY3 : p.ccm.matrix;
}

export function fusedCcmCsc(p: PipelineParams): Mat3 {
  const ccm = effectiveCcm(p);
  const csc = effectiveCsc(p);
  return [
    csc[0] * ccm[0] + csc[1] * ccm[3] + csc[2] * ccm[6],
    csc[0] * ccm[1] + csc[1] * ccm[4] + csc[2] * ccm[7],
    csc[0] * ccm[2] + csc[1] * ccm[5] + csc[2] * ccm[8],
    csc[3] * ccm[0] + csc[4] * ccm[3] + csc[5] * ccm[6],
    csc[3] * ccm[1] + csc[4] * ccm[4] + csc[5] * ccm[7],
    csc[3] * ccm[2] + csc[4] * ccm[5] + csc[5] * ccm[8],
    csc[6] * ccm[0] + csc[7] * ccm[3] + csc[8] * ccm[6],
    csc[6] * ccm[1] + csc[7] * ccm[4] + csc[8] * ccm[7],
    csc[6] * ccm[2] + csc[7] * ccm[5] + csc[8] * ccm[8],
  ];
}

export function wbForPixel(mult: Vec4, channel: number): number {
  return mult[channel] ?? 1;
}

/** Remove file-bound fields before writing a preset. */
export function toPresetParams(p: PipelineParams): PresetPipelineParams {
  const copy = structuredClone(p);
  const { flatId: _flatId, ...flat } = copy.flat;
  const { crop: _crop, ...output } = copy.output;
  return { ...copy, flat: flat as PresetPipelineParams['flat'], output } as PresetPipelineParams;
}

export function fromPresetParams(p: PresetPipelineParams, current: PipelineParams): PipelineParams {
  return {
    ...structuredClone(current),
    ...structuredClone(p),
    flat: { ...structuredClone(p.flat), flatId: current.flat.flatId },
    output: { ...structuredClone(p.output), crop: current.output.crop },
  } as PipelineParams;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

export function paramsHash(p: PipelineParams): string {
  return hashString(stableStringify(p));
}
