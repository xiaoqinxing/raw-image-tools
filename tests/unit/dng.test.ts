import { describe, expect, it } from 'vitest';
import { makeTestDng } from '../fixtures/dng';
import { parseDngMetadata } from '../../src/core/raw/dng';
import { decodeDng } from '../../src/core/raw/libraw';

describe('DNG import', () => {
  it('parses DNG tags', () => {
    const dng = makeTestDng({ width: 32, height: 24, black: 128, white: 4095, asShotNeutral: [0.5, 1, 0.5] });
    const ab = dng.buffer.slice(dng.byteOffset, dng.byteOffset + dng.byteLength);
    const meta = parseDngMetadata(ab);
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(24);
    expect(meta.cfaPattern).toBe('RGGB');
    expect(meta.black?.[0]).toBe(128);
    expect(meta.white?.[0]).toBe(4095);
    expect(meta.asShotNeutral?.[0]).toBeCloseTo(0.5, 5);
    expect(meta.active).toEqual({ x: 0, y: 0, w: 32, h: 24 });
  });

  it('decodes pixels and metadata through LibRaw', async () => {
    const dng = makeTestDng({ width: 32, height: 24, black: 128, white: 4095 });
    const ab = dng.buffer.slice(dng.byteOffset, dng.byteOffset + dng.byteLength);
    const raw = await decodeDng(ab, { fileName: 'synthetic.dng', fileSize: dng.length, sha256: 'test' });
    expect(raw.geometry.storedWidth).toBe(32);
    expect(raw.geometry.storedHeight).toBe(24);
    expect(raw.data.length).toBe(32 * 24);
    expect(raw.levels.black[0]).toBe(128);
    expect(raw.levels.white[0]).toBe(4095);
    expect(raw.cfa.sites).toEqual(['R', 'G1', 'G2', 'B']);
    expect(raw.data[0]).toBeGreaterThan(0);
  });
});
