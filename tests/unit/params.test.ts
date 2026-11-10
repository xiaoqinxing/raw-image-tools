import { describe, expect, it } from 'vitest';
import { bypassStage, createDefaultParams, digitalGainFor, effectiveCcm, effectiveCscTransform, fromPresetParams, migrateParams, paramsHash, stageIsActive, toPresetParams } from '../../src/core/pipeline/params';
import { IDENTITY3 } from '../../src/core/color/matrices';

describe('pipeline params', () => {
  it('creates sane defaults without RAW metadata', () => {
    const p = createDefaultParams();
    expect(p.schemaVersion).toBe(2);
    expect(p.levels.black).toEqual([0, 0, 0, 0]);
    expect(p.levels.white).toEqual([65535, 65535, 65535, 65535]);
    expect(p.wb.multipliers).toEqual([1, 1, 1, 1]);
    expect(p.digitalGain.bypass).toBe(true);
    expect(p.digitalGain.global).toBe(1);
    expect(p.demosaic.algorithm).toBe('mhc');
    expect(p.ccm.source).toBe('identity');
    expect(p.csc.standard).toBe('bt709');
    expect(p.csc.saturation).toBe(100);
    expect(p.csc.contrast).toBe(100);
    expect(p.csc.hue).toBe(0);
    expect(p.csc.brightness).toBe(0);
  });

  it('applies global digital gain only when the stage is enabled', () => {
    const p = createDefaultParams();
    expect(digitalGainFor(p)).toBe(1);
    p.digitalGain.bypass = false;
    p.digitalGain.global = 2.5;
    expect(digitalGainFor(p)).toBe(2.5);
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
    expect(stageIsActive(p, 'csc', false)).toBe(true);
    expect(stageIsActive(p, 'digitalGain', false)).toBe(false); // bypassed by default
    expect(stageIsActive(p, 'sharpen', false)).toBe(false); // sharpen is bypassed by default
    p.sharpen.bypass = false;
    expect(stageIsActive(p, 'sharpen', false)).toBe(true);
    p.digitalGain.bypass = false;
    expect(stageIsActive(p, 'digitalGain', false)).toBe(true);
    p.gamma.bypass = true;
    expect(stageIsActive(p, 'sharpen', false)).toBe(false);
    expect(stageIsActive(p, 'csc', false)).toBe(false);
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
    const neutral = effectiveCscTransform(a);
    expect(neutral.matrix).toEqual(IDENTITY3);
    expect(neutral.offset).toEqual([0, 0, 0]);
  });

  it('migrates v1 CSC + CCM into the v2 camera profile and keeps the total color transform', () => {
    const old = {
      ...createDefaultParams(),
      schemaVersion: 1,
      ccm: { bypass: false, source: 'manual', matrix: [0.9, 0.05, 0.02, 0.03, 0.95, 0.02, 0.01, 0.04, 0.95] },
      csc: { bypass: false, source: 'dng', matrix: [1.1, -0.1, 0.02, -0.05, 1.08, -0.03, 0.02, -0.06, 1.04], adaptation: 'bradford' },
    };
    const migrated = migrateParams(old);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.ccm.source).toBe('manual');
    expect(migrated.digitalGain.bypass).toBe(true);
    expect(migrated.csc.standard).toBe('bt709');
    const expected = [
      1.1 * 0.9 + -0.1 * 0.03 + 0.02 * 0.01,
      1.1 * 0.05 + -0.1 * 0.95 + 0.02 * 0.04,
      1.1 * 0.02 + -0.1 * 0.02 + 0.02 * 0.95,
      -0.05 * 0.9 + 1.08 * 0.03 + -0.03 * 0.01,
      -0.05 * 0.05 + 1.08 * 0.95 + -0.03 * 0.04,
      -0.05 * 0.02 + 1.08 * 0.02 + -0.03 * 0.95,
      0.02 * 0.9 + -0.06 * 0.03 + 1.04 * 0.01,
      0.02 * 0.05 + -0.06 * 0.95 + 1.04 * 0.04,
      0.02 * 0.02 + -0.06 * 0.02 + 1.04 * 0.95,
    ];
    for (let i = 0; i < 9; i++) expect(migrated.ccm.matrix[i]).toBeCloseTo(expected[i], 9);
  });
});
