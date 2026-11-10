import { describe, expect, it } from 'vitest';
import {
  defaultColorCheckerSettings,
  normalizeColorCheckerSettings,
  normalizeColorCheckerWeights,
  COLOR_CHECKER_WB_PATCH_INDICES,
} from '../../src/core/colorchecker/settings';
import { computeChartWb } from '../../src/core/colorchecker/wb';

describe('ColorChecker fit settings', () => {
  it('defaults to 24 unit weights, neutral target and auto WB', () => {
    const settings = defaultColorCheckerSettings();
    expect(settings.weights).toHaveLength(24);
    expect(settings.weights.every((w) => w === 1)).toBe(true);
    expect(settings.target).toEqual({ saturation: 100, hue: 0 });
    expect(settings.objective).toBe('de00');
    expect(settings.autoWb).toBe(true);
  });

  it('clamps weights, target and inset', () => {
    const settings = normalizeColorCheckerSettings({
      weights: [-2, 99, 2.5],
      target: { saturation: 999, hue: -999 },
      objective: 'chroma',
      inset: 0.99,
    });
    expect(settings.weights[0]).toBe(0);
    expect(settings.weights[1]).toBe(4);
    expect(settings.weights[2]).toBe(2.5);
    expect(settings.weights[23]).toBe(1);
    expect(settings.target).toEqual({ saturation: 200, hue: -60 });
    expect(settings.objective).toBe('chroma');
    expect(settings.inset).toBe(0.7);
  });

  it('normalizes malformed weights to 24 entries', () => {
    const weights = normalizeColorCheckerWeights([2, Number.NaN, 'x']);
    expect(weights).toHaveLength(24);
    expect(weights[0]).toBe(2);
    expect(weights[1]).toBe(1);
    expect(weights[2]).toBe(1);
  });
});

describe('Chart white balance from neutral patches', () => {
  it('uses the four middle bottom-row patches and normalizes G=1', () => {
    const samples = Array.from({ length: 24 }, () => [0.3, 0.3, 0.3] as [number, number, number]);
    samples[19] = [0.4, 0.2, 0.1];
    samples[20] = [0.4, 0.2, 0.1];
    samples[21] = [0.4, 0.2, 0.1];
    samples[22] = [0.4, 0.2, 0.1];
    const result = computeChartWb(samples, Array.from({ length: 24 }, () => true));
    expect(result.patchIndices).toEqual(COLOR_CHECKER_WB_PATCH_INDICES);
    expect(result.validCount).toBe(4);
    expect(result.multipliers[1]).toBe(1);
    expect(result.multipliers[0]).toBeCloseTo(0.5, 6);
    expect(result.multipliers[3]).toBeCloseTo(2, 6);
    expect(result.means[0]).toBeCloseTo(0.4, 6);
    expect(result.means[3]).toBeCloseTo(0.1, 6);
  });

  it('does not treat the four different-density neutral patches as uneven lighting', () => {
    const samples = Array.from({ length: 24 }, () => [0.3, 0.3, 0.3] as [number, number, number]);
    samples[19] = [0.8, 0.4, 0.2];
    samples[20] = [0.4, 0.2, 0.1];
    samples[21] = [0.2, 0.1, 0.05];
    samples[22] = [0.1, 0.05, 0.025];
    const result = computeChartWb(samples, Array.from({ length: 24 }, () => true));
    expect(result.multipliers[0]).toBeCloseTo(0.5, 6);
    expect(result.multipliers[3]).toBeCloseTo(2, 6);
    expect(result.spread).toBeLessThan(1e-9);
    expect(result.warnings).toHaveLength(0);
  });

  it('falls back to the valid subset and warns on uneven lighting', () => {
    const samples = Array.from({ length: 24 }, () => [0.3, 0.3, 0.3] as [number, number, number]);
    samples[19] = [0.4, 0.2, 0.1];
    samples[20] = [0.4, 0.2, 0.1];
    samples[21] = [0.4, 0.2, 0.1];
    samples[22] = [0.8, 0.4, 0.2];
    const valid = Array.from({ length: 24 }, () => true);
    valid[22] = false;
    const result = computeChartWb(samples, valid);
    expect(result.validCount).toBe(3);
    expect(result.multipliers[0]).toBeCloseTo(0.5, 6);
  });

  it('rejects a chart without enough valid neutral patches', () => {
    const samples = Array.from({ length: 24 }, () => [0.3, 0.3, 0.3] as [number, number, number]);
    const valid = Array.from({ length: 24 }, () => false);
    expect(() => computeChartWb(samples, valid)).toThrow();
  });
});
