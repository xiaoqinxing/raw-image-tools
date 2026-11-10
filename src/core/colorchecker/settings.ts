import type {
  ColorCheckerFitSettings,
  ColorCheckerObjective,
  ColorCheckerTarget,
} from '../types';

export const COLOR_CHECKER_PATCH_COUNT = 24;

/** Bottom-row middle four neutral patches (1-based 20..23). */
export const COLOR_CHECKER_WB_PATCH_INDICES = [19, 20, 21, 22];

export const DEFAULT_COLOR_CHECKER_TARGET: ColorCheckerTarget = {
  saturation: 100,
  hue: 0,
};

export function defaultColorCheckerWeights(): number[] {
  return Array.from({ length: COLOR_CHECKER_PATCH_COUNT }, () => 1);
}

export function defaultColorCheckerSettings(): ColorCheckerFitSettings {
  return {
    weights: defaultColorCheckerWeights(),
    target: { ...DEFAULT_COLOR_CHECKER_TARGET },
    objective: 'de00',
    autoWb: true,
    inset: 0.5,
  };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeColorCheckerWeights(input: unknown): number[] {
  const source = Array.isArray(input) ? input : [];
  return Array.from({ length: COLOR_CHECKER_PATCH_COUNT }, (_, i) => {
    const raw = finite(source[i], 1);
    return Math.max(0, Math.min(4, raw));
  });
}

export function normalizeColorCheckerTarget(input: unknown): ColorCheckerTarget {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    saturation: Math.max(0, Math.min(200, finite(source.saturation, 100))),
    hue: Math.max(-60, Math.min(60, finite(source.hue, 0))),
  };
}

export function normalizeColorCheckerObjective(input: unknown): ColorCheckerObjective {
  return input === 'chroma' ? 'chroma' : 'de00';
}

export function normalizeColorCheckerSettings(input?: unknown): ColorCheckerFitSettings {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    weights: normalizeColorCheckerWeights(source.weights),
    target: normalizeColorCheckerTarget(source.target),
    objective: normalizeColorCheckerObjective(source.objective),
    autoWb: source.autoWb !== false,
    inset: Math.max(0.3, Math.min(0.7, finite(source.inset, 0.5))),
  };
}
