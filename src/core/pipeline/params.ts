import type {
  CscStandard,
  Domain,
  Mat3,
  PipelineParams,
  PresetPipelineParams,
  RawImage,
  StageId,
  Vec4,
} from '../types';
import { deriveCscFromDng, IDENTITY3, matrixNearIdentity, mul3, sanitizeMat3 } from '../color/matrices';
import { cscTransform, type CscTransform } from '../color/yuv';
import { defaultLevelsForBitDepth } from '../raw/levels';

export const STAGE_ORDER: StageId[] = [
  'levels',
  'flat',
  'wb',
  'digitalGain',
  'demosaic',
  'denoise',
  'ccm',
  'gamma',
  'csc',
  'sharpen',
];

export const STAGE_LABELS: Record<StageId, string> = {
  levels: '黑电平 / 白电平',
  flat: '平场 / 镜头暗影',
  wb: '白平衡',
  digitalGain: '数字增益',
  demosaic: '去马赛克',
  denoise: '降噪',
  ccm: 'CCM 相机 → 工作 RGB',
  gamma: 'Gamma',
  csc: 'CSC RGB → YUV 调整',
  sharpen: 'USM 锐化',
};

/** Compact labels for the canvas / compare stage pickers. */
export const STAGE_SHORT_LABELS: Record<StageId, string> = {
  levels: 'RAW 归一化',
  flat: '平场后',
  wb: '白平衡后',
  digitalGain: '数字增益后',
  demosaic: '去马赛克',
  denoise: '降噪后',
  ccm: 'CCM 后',
  gamma: 'Gamma 后',
  csc: 'CSC 后',
  sharpen: '最终',
};

export const STAGE_DOMAIN: Record<StageId, Domain> = {
  levels: 'raw-cfa',
  flat: 'raw-cfa',
  wb: 'raw-cfa',
  digitalGain: 'raw-cfa',
  demosaic: 'camera-rgb',
  denoise: 'camera-rgb',
  ccm: 'linear-srgb',
  gamma: 'display-srgb',
  csc: 'display-srgb',
  sharpen: 'display-srgb',
};

export const STAGE_HALO: Record<StageId, number> = {
  levels: 0,
  flat: 0,
  wb: 0,
  digitalGain: 0,
  demosaic: 3,
  denoise: 5,
  ccm: 0,
  gamma: 0,
  csc: 0,
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
  const profile = raw
    ? deriveCscFromDng(raw.color)
    : { matrix: IDENTITY3, source: 'identity' as const, warnings: ['没有 RAW 色彩元数据。'] };
  const hasProfile = !matrixNearIdentity(profile.matrix);
  const wb = raw?.wb.asShot ?? [1, 1, 1, 1];
  const levels = raw
    ? defaultLevelsForBitDepth(raw.geometry.bitDepth)
    : { black: [0, 0, 0, 0] as Vec4, white: [65535, 65535, 65535, 65535] as Vec4 };
  return {
    schemaVersion: 2,
    levels: {
      bypass: false,
      black: raw?.levels.black ?? levels.black,
      white: raw?.levels.white ?? levels.white,
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
    digitalGain: {
      bypass: true,
      global: 1,
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
      source: hasProfile ? 'dng' : 'identity',
      matrix: hasProfile ? ([...profile.matrix] as Mat3) : ([...IDENTITY3] as Mat3),
    },
    gamma: {
      bypass: false,
      mode: 'srgb',
    },
    csc: {
      bypass: false,
      standard: 'bt709',
      saturation: 100,
      contrast: 100,
      hue: 0,
      brightness: 0,
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
  out[stage].bypass = true;
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
  if (stage === 'wb' || stage === 'digitalGain' || stage === 'demosaic') return true;
  if (stage === 'denoise' || stage === 'ccm' || stage === 'gamma') {
    return !p.demosaic.bypass;
  }
  if (stage === 'csc') return !p.demosaic.bypass && !p.gamma.bypass;
  if (stage === 'sharpen') return !p.demosaic.bypass && !p.gamma.bypass;
  return false;
}

export function digitalGainFor(p: PipelineParams): number {
  return p.digitalGain.bypass ? 1 : p.digitalGain.global;
}

export function effectiveCcm(p: PipelineParams): Mat3 {
  return p.ccm.source === 'identity' ? IDENTITY3 : p.ccm.matrix;
}

/** Single affine RGB -> YUV -> RGB color adjustment for the CSC stage. */
export function effectiveCscTransform(p: PipelineParams): CscTransform {
  return cscTransform({
    standard: p.csc.standard,
    saturation: p.csc.saturation,
    contrast: p.csc.contrast,
    hue: p.csc.hue,
    brightness: p.csc.brightness,
  });
}

export function wbForPixel(mult: Vec4, channel: number): number {
  return mult[channel] ?? 1;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function stageValue<T extends object>(base: T, input: unknown): T {
  return isRecord(input) ? ({ ...base, ...input } as T) : base;
}

/**
 * Migrate v1 pipeline params to v2.
 *
 * v1 split the camera -> linear sRGB matrix between CCM and CSC. v2 keeps that
 * transform in CCM (the camera profile) and turns CSC into a neutral YUV
 * adjustment stage. The migration composes the old active `CSC x CCM` so the
 * rendered colors stay identical.
 */
export function migrateParams(input: unknown): PipelineParams {
  const base = createDefaultParams();
  if (!isRecord(input)) return base;

  const legacy = input as Record<string, unknown>;
  const isV1 = legacy.schemaVersion !== 2;

  const merged: PipelineParams = {
    ...base,
    ...(legacy as unknown as PipelineParams),
    schemaVersion: 2,
    levels: stageValue(base.levels, legacy.levels),
    flat: stageValue(base.flat, legacy.flat),
    wb: stageValue(base.wb, legacy.wb),
    digitalGain: stageValue(base.digitalGain, legacy.digitalGain),
    demosaic: stageValue(base.demosaic, legacy.demosaic),
    denoise: stageValue(base.denoise, legacy.denoise),
    ccm: stageValue(base.ccm, legacy.ccm),
    gamma: stageValue(base.gamma, legacy.gamma),
    csc: isV1 ? { ...base.csc } : stageValue(base.csc, legacy.csc),
    sharpen: stageValue(base.sharpen, legacy.sharpen),
    output: stageValue(base.output, legacy.output),
  };

  if (!isV1) {
    merged.digitalGain = {
      bypass: merged.digitalGain.bypass === true,
      global: clampNumber(merged.digitalGain.global, 0, 8, 1),
    };
    merged.wb.multipliers = sanitizeVec4(merged.wb.multipliers, [1, 1, 1, 1]);
    merged.levels.black = sanitizeVec4(merged.levels.black, [0, 0, 0, 0]);
    merged.levels.white = sanitizeVec4(merged.levels.white, [65535, 65535, 65535, 65535]);
    merged.ccm.matrix = sanitizeMat3(merged.ccm.matrix);
    const standard: CscStandard = merged.csc.standard === 'bt601' || merged.csc.standard === 'bt2020' ? merged.csc.standard : 'bt709';
    merged.csc.standard = standard;
    merged.csc.saturation = clampNumber(merged.csc.saturation, 0, 200, 100);
    merged.csc.contrast = clampNumber(merged.csc.contrast, 0, 200, 100);
    merged.csc.hue = clampNumber(merged.csc.hue, -180, 180, 0);
    merged.csc.brightness = clampNumber(merged.csc.brightness, -100, 100, 0);
    return merged;
  }

  const oldCcm = isRecord(legacy.ccm) ? legacy.ccm : {};
  const oldCsc = isRecord(legacy.csc) ? legacy.csc : {};
  const ccmActive = oldCcm.bypass !== true;
  const cscActive = oldCsc.bypass !== true;
  const ccmMatrix = oldCcm.source === 'identity' ? IDENTITY3 : sanitizeMat3(oldCcm.matrix as Mat3);
  const cscMatrix = oldCsc.source === 'identity' ? IDENTITY3 : sanitizeMat3(oldCsc.matrix as Mat3);
  const total = mul3(cscActive ? cscMatrix : IDENTITY3, ccmActive ? ccmMatrix : IDENTITY3);
  const active = ccmActive || cscActive;
  const nearIdentity = matrixNearIdentity(total);
  const source: PipelineParams['ccm']['source'] = !active || nearIdentity
    ? 'identity'
    : oldCcm.source === 'identity' && oldCsc.source === 'dng'
      ? 'dng'
      : oldCcm.source === 'fit'
        ? 'fit'
        : 'manual';

  merged.ccm = {
    bypass: !active,
    source,
    matrix: nearIdentity ? ([...IDENTITY3] as Mat3) : total,
    fitId: typeof oldCcm.fitId === 'string' ? oldCcm.fitId : undefined,
  };
  merged.csc = { ...base.csc, bypass: false };
  merged.digitalGain = { ...base.digitalGain };
  return merged;
}

function sanitizeVec4(value: unknown, fallback: Vec4): Vec4 {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return [...fallback] as Vec4;
  }
  return [...value] as Vec4;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/** Remove file-bound fields before writing a preset. */
export function toPresetParams(p: PipelineParams): PresetPipelineParams {
  const copy = structuredClone(p);
  const { flatId: _flatId, ...flat } = copy.flat;
  const { crop: _crop, ...output } = copy.output;
  return { ...copy, flat: flat as PresetPipelineParams['flat'], output } as PresetPipelineParams;
}

export function fromPresetParams(p: PresetPipelineParams, current: PipelineParams): PipelineParams {
  const migrated = migrateParams(p);
  return {
    ...structuredClone(current),
    ...migrated,
    flat: { ...structuredClone(migrated.flat), flatId: current.flat.flatId },
    output: { ...structuredClone(migrated.output), crop: current.output.crop },
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
