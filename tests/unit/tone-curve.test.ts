import { describe, expect, it } from 'vitest';
import {
  TONE_CURVE_LUT_SIZE,
  MAX_TONE_CURVE_POINTS,
  buildToneCurveLut,
  createIdentityToneCurvePoints,
  evaluateToneCurve,
  sanitizeToneCurvePoints,
  sanitizeToneCurvePointsSet,
  toneCurveIsIdentity,
  toneCurveSetIsIdentity,
} from '../../src/core/color/tone-curve';
import type { Point } from '../../src/core/types';

const identity: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const sCurve: Point[] = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.12 },
  { x: 0.5, y: 0.5 },
  { x: 0.75, y: 0.88 },
  { x: 1, y: 1 },
];

describe('tone curve', () => {
  it('keeps the identity curve exact', () => {
    for (const x of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
      expect(evaluateToneCurve(identity, x)).toBeCloseTo(x, 12);
    }
    expect(toneCurveIsIdentity(identity)).toBe(true);
    expect(toneCurveIsIdentity([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }])).toBe(true);
    expect(toneCurveSetIsIdentity(createIdentityToneCurvePoints())).toBe(true);
    expect(toneCurveIsIdentity([{ x: 0, y: 0 }, { x: 0.5, y: 0.51 }, { x: 1, y: 1 }])).toBe(false);
  });

  it('passes through its control points', () => {
    for (const p of sCurve) expect(evaluateToneCurve(sCurve, p.x)).toBeCloseTo(p.y, 6);
  });

  it('is monotone and bounded for an S curve', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 1000; i++) {
      const y = evaluateToneCurve(sCurve, i / 1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = y;
    }
  });

  it('supports lifted blacks and compressed whites', () => {
    const lifted: Point[] = [
      { x: 0, y: 0.2 },
      { x: 1, y: 0.9 },
    ];
    expect(evaluateToneCurve(lifted, 0)).toBeCloseTo(0.2, 6);
    expect(evaluateToneCurve(lifted, 0.5)).toBeCloseTo(0.55, 6);
    expect(evaluateToneCurve(lifted, 1)).toBeCloseTo(0.9, 6);
    expect(toneCurveIsIdentity(lifted)).toBe(false);
  });

  it('passes values outside the display domain through unchanged', () => {
    expect(evaluateToneCurve(sCurve, -0.25)).toBe(-0.25);
    expect(evaluateToneCurve(sCurve, 1.25)).toBe(1.25);
  });

  it('sanitizes, sorts, clamps and anchors endpoints', () => {
    const points = sanitizeToneCurvePoints([
      { x: 0.8, y: 1.2 },
      { x: 0.2, y: -0.1 },
      { x: 0.2, y: 0.3 },
      { x: 1.4, y: 0.7 },
      { x: Number.NaN, y: 0.5 },
    ]);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.8, y: 1 },
      { x: 1, y: 0.7 },
    ]);
  });

  it('falls back to identity for invalid input and caps the point count', () => {
    expect(sanitizeToneCurvePoints(null)).toEqual(identity);
    expect(sanitizeToneCurvePoints([])).toEqual(identity);
    const many = Array.from({ length: 40 }, (_, i) => ({ x: i / 39, y: i / 39 }));
    const capped = sanitizeToneCurvePoints(many);
    expect(capped.length).toBeLessThanOrEqual(MAX_TONE_CURVE_POINTS);
    expect(capped[0]).toEqual({ x: 0, y: 0 });
    expect(capped[capped.length - 1]).toEqual({ x: 1, y: 1 });
  });

  it('sanitizes a full channel set and fills missing channels', () => {
    const set = sanitizeToneCurvePointsSet({ rgb: sCurve });
    expect(set.rgb).toHaveLength(sCurve.length);
    expect(set.r).toEqual(identity);
    expect(set.g).toEqual(identity);
    expect(set.b).toEqual(identity);
  });

  it('builds a LUT that matches point evaluation', () => {
    const lut = buildToneCurveLut(sCurve);
    expect(lut).toHaveLength(TONE_CURVE_LUT_SIZE);
    for (const i of [0, 1, 127, 1024, 2048, 4095]) {
      expect(lut[i]).toBeCloseTo(evaluateToneCurve(sCurve, i / (TONE_CURVE_LUT_SIZE - 1)), 6);
    }
  });
});
