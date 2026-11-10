import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_DOCK_MIN_CANVAS_HEIGHT,
  ANALYSIS_DOCK_MIN_HEIGHT,
  analysisDockMaxHeight,
  clampAnalysisDockHeight,
} from '../../src/ui/analysis-dock-resize';

describe('analysis dock resize', () => {
  it('keeps the dock at its minimum height on tiny viewports', () => {
    expect(analysisDockMaxHeight(0)).toBe(ANALYSIS_DOCK_MIN_HEIGHT);
    expect(analysisDockMaxHeight(200)).toBe(ANALYSIS_DOCK_MIN_HEIGHT);
    expect(clampAnalysisDockHeight(80, 200)).toBe(ANALYSIS_DOCK_MIN_HEIGHT);
  });

  it('reserves space for the canvas above the dock', () => {
    expect(analysisDockMaxHeight(800)).toBe(800 - ANALYSIS_DOCK_MIN_CANVAS_HEIGHT);
    expect(clampAnalysisDockHeight(680, 800)).toBe(640);
    expect(clampAnalysisDockHeight(400, 800)).toBe(400);
  });

  it('rounds drag coordinates and never exceeds the current bounds', () => {
    expect(clampAnalysisDockHeight(333.4, 800)).toBe(333);
    expect(clampAnalysisDockHeight(333.6, 800)).toBe(334);
    expect(clampAnalysisDockHeight(Number.MAX_SAFE_INTEGER, 600)).toBe(analysisDockMaxHeight(600));
    expect(clampAnalysisDockHeight(Number.NEGATIVE_INFINITY, 600)).toBe(ANALYSIS_DOCK_MIN_HEIGHT);
  });
});
