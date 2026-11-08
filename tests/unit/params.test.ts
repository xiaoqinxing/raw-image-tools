import { describe, expect, it } from 'vitest';
import { bypassStage, createDefaultParams, effectiveCcm, effectiveCsc, fromPresetParams, paramsHash, stageIsActive, toPresetParams } from '../../src/core/pipeline/params';
import { IDENTITY3 } from '../../src/core/color/matrices';

describe('pipeline params', () => {
  it('creates sane defaults without RAW metadata', () => {
    const p = createDefaultParams();
    expect(p.schemaVersion).toBe(1);
    expect(p.levels.black).toEqual([0, 0, 0, 0]);
    expect(p.levels.white).toEqual([65535, 65535, 65535, 65535]);
    expect(p.wb.multipliers).toEqual([1, 1, 1, 1]);
    expect(p.demosaic.algorithm).toBe('mhc');
    expect(p.csc.source).toBe('identity');
  });

  it('bypasses a stage immutably', () => {
    const p = createDefaultParams();
    const q = bypassStage(p, 'gamma');
    expect(q.gamma.bypass).toBe(true);
    expect(p.gamma.bypass).toBe(false);
  });

  it('marks downstream stages inactive when an upstream stage is bypassed', () => {
    const p = createDefaultParams();
    expect(stageIsActive(p, 'gamma', false)).toBe(true);
    expect(stageIsActive(p, 'sharpen', false)).toBe(false); // sharpen is bypassed by default
    p.sharpen.bypass = false;
    expect(stageIsActive(p, 'sharpen', false)).toBe(true);
    p.gamma.bypass = true;
    expect(stageIsActive(p, 'sharpen', false)).toBe(false);
    expect(stageIsActive(p, 'csc', false)).toBe(true);
    p.demosaic.bypass = true;
    expect(stageIsActive(p, 'csc', false)).toBe(false);
    expect(stageIsActive(p, 'levels', false)).toBe(true);
    expect(stageIsActive(p, 'flat', false)).toBe(false);
  });

  it('uses a visible sharpen default and keeps gamma selected for display', () => {
    const p = createDefaultParams();
    expect(p.gamma.mode).toBe('srgb');
    expect(p.sharpen.amount).toBe(100);
    expect(p.sharpen.radius).toBeCloseTo(1.2, 5);
    expect(p.sharpen.bypass).toBe(true);
  });

  it('round-trips preset params while preserving file-bound fields', () => {
    const p = createDefaultParams();
    p.flat.flatId = 'flat-1';
    p.flat.bypass = false;
    p.output.crop = { x: 10, y: 20, w: 30, h: 40 };
    p.wb.multipliers = [1.2, 1, 1, 0.8];
    const preset = toPresetParams(p);
    expect(preset.flat).not.toHaveProperty('flatId');
    expect(preset.output).not.toHaveProperty('crop');
    expect(preset.wb.multipliers).toEqual([1.2, 1, 1, 0.8]);

    const current = createDefaultParams();
    current.flat.flatId = 'flat-current';
    current.output.crop = { x: 1, y: 2, w: 3, h: 4 };
    const merged = fromPresetParams(preset, current);
    expect(merged.flat.flatId).toBe('flat-current');
    expect(merged.output.crop).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(merged.wb.multipliers).toEqual([1.2, 1, 1, 0.8]);
  });

  it('hashes params deterministically and effectively returns identity matrices', () => {
    const a = createDefaultParams();
    const b = createDefaultParams();
    expect(paramsHash(a)).toBe(paramsHash(b));
    b.wb.multipliers = [1.1, 1, 1, 0.9];
    expect(paramsHash(a)).not.toBe(paramsHash(b));
    expect(effectiveCcm(a)).toEqual(IDENTITY3);
    expect(effectiveCsc(a)).toEqual(IDENTITY3);
  });
});
