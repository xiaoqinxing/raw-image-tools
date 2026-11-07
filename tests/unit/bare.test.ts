import { describe, expect, it } from 'vitest';
import { decodeBareRaw, RawDecodeError } from '../../src/core/raw/bare';
import type { BareRawConfig, BitDepth, CfaPattern, PackingSpec } from '../../src/core/types';

function packContinuous(values: number[], bits: number, order: 'lsb' | 'msb', rowBytes: number): Uint8Array {
  const out = new Uint8Array(rowBytes);
  if (order === 'lsb') {
    let bit = 0;
    for (const v of values) {
      for (let b = 0; b < bits; b++) {
        if ((v >>> b) & 1) out[bit >> 3] |= 1 << (bit & 7);
        bit++;
      }
    }
  } else {
    let bit = 0;
    for (const v of values) {
      for (let b = bits - 1; b >= 0; b--) {
        if ((v >>> b) & 1) out[bit >> 3] |= 1 << (7 - (bit & 7));
        bit++;
      }
    }
  }
  return out;
}

function packMipi(values: number[], bits: 10 | 12 | 14, width: number): Uint8Array {
  if (bits === 10) {
    const out = new Uint8Array(Math.ceil(width / 4) * 5);
    for (let i = 0; i < width; i += 4) {
      const o = (i / 4) * 5;
      for (let k = 0; k < 4; k++) {
        const v = values[i + k] ?? 0;
        out[o + k] = (v >> 2) & 0xff;
        out[o + 4] |= (v & 3) << (k * 2);
      }
    }
    return out;
  }
  if (bits === 12) {
    const out = new Uint8Array(Math.ceil(width / 2) * 3);
    for (let i = 0; i < width; i += 2) {
      const o = (i / 2) * 3;
      const a = values[i] ?? 0, b = values[i + 1] ?? 0;
      out[o] = (a >> 4) & 0xff;
      out[o + 1] = (b >> 4) & 0xff;
      out[o + 2] = (a & 0xf) | ((b & 0xf) << 4);
    }
    return out;
  }
  const out = new Uint8Array(Math.ceil(width / 4) * 7);
  for (let i = 0; i < width; i += 4) {
    const o = (i / 4) * 7;
    const vs = [0, 1, 2, 3].map((k) => values[i + k] ?? 0);
    for (let k = 0; k < 4; k++) out[o + k] = (vs[k] >> 6) & 0xff;
    out[o + 4] = (vs[0] & 0x3f) | ((vs[1] & 0x3f) << 6);
    out[o + 5] = ((vs[1] >> 2) & 0xf) | ((vs[2] & 0x3f) << 4);
    out[o + 6] = ((vs[2] >> 4) & 0x3) | ((vs[3] & 0x3f) << 2);
  }
  return out;
}

function makeConfig(width: number, height: number, cfa: CfaPattern, bitDepth: BitDepth, packing: PackingSpec, values: number[], extras: Partial<BareRawConfig> = {}): { buffer: ArrayBuffer; cfg: BareRawConfig } {
  let rowBytes: number;
  if (packing.kind === 'unpacked') rowBytes = width * (packing.container === 'u8' ? 1 : 2);
  else if (packing.group === 'mipi10') rowBytes = Math.ceil(width / 4) * 5;
  else if (packing.group === 'mipi12') rowBytes = Math.ceil(width / 2) * 3;
  else if (packing.group === 'mipi14') rowBytes = Math.ceil(width / 4) * 7;
  else rowBytes = Math.ceil((width * bitDepth) / 8);
  const stride = extras.rowStride || rowBytes;
  const header = extras.headerOffset ?? 0;
  const buf = new Uint8Array(header + stride * height + 32);
  const view = new DataView(buf.buffer);
  for (let y = 0; y < height; y++) {
    const row = values.slice(y * width, (y + 1) * width);
    const off = header + y * stride;
    if (packing.kind === 'unpacked') {
      if (packing.container === 'u8') {
        row.forEach((v, i) => { buf[off + i] = v; });
      } else {
        const shift = packing.alignment === 'left' ? (extras.sampleShift ?? (16 - bitDepth)) : 0;
        row.forEach((v, i) => view.setUint16(off + i * 2, (v << shift) & 0xffff, packing.endian !== 'be'));
      }
    } else if (packing.group === 'continuous' || !packing.group) {
      buf.set(packContinuous(row, bitDepth, packing.bitOrder ?? 'lsb', rowBytes), off);
    } else {
      buf.set(packMipi(row, bitDepth as 10 | 12 | 14, width), off);
    }
  }
  return { buffer: buf.buffer, cfg: { width, height, cfa, bitDepth, packing, headerOffset: header, rowStride: stride, black: 0, white: (1 << bitDepth) - 1, endian: packing.endian, sampleShift: extras.sampleShift, active: extras.active } };
}

describe('bare RAW decoder', () => {
  const w = 8, h = 6;
  const values = Array.from({ length: w * h }, (_, i) => (i * 37) & 0xfff);

  it('decodes unpacked u16 LE/BE bit-exactly', () => {
    for (const endian of ['le', 'be'] as const) {
      const { buffer, cfg } = makeConfig(w, h, 'RGGB', 12, { kind: 'unpacked', container: 'u16', endian, alignment: 'right' }, values);
      const raw = decodeBareRaw(buffer, cfg);
      expect(Array.from(raw.data)).toEqual(values);
    }
  });

  it('decodes left-aligned u16', () => {
    const { buffer, cfg } = makeConfig(w, h, 'RGGB', 12, { kind: 'unpacked', container: 'u16', endian: 'le', alignment: 'left' }, values);
    const raw = decodeBareRaw(buffer, cfg);
    expect(Array.from(raw.data)).toEqual(values);
  });

  for (const bits of [10, 12, 14] as const) {
    for (const order of ['lsb', 'msb'] as const) {
      it(`decodes packed ${bits}-bit ${order}`, () => {
        const vals = values.map((v) => v & ((1 << bits) - 1));
        const { buffer, cfg } = makeConfig(w, h, 'GBRG', bits, { kind: 'packed', bitOrder: order, group: 'continuous' }, vals);
        const raw = decodeBareRaw(buffer, cfg);
        expect(Array.from(raw.data)).toEqual(vals);
      });
    }
    it(`decodes MIPI RAW${bits}`, () => {
      const vals = values.map((v) => v & ((1 << bits) - 1));
      const { buffer, cfg } = makeConfig(w, h, 'BGGR', bits, { kind: 'packed', group: `mipi${bits}` as 'mipi10' }, vals);
      const raw = decodeBareRaw(buffer, cfg);
      expect(Array.from(raw.data)).toEqual(vals);
    });
  }

  it('handles header offset, stride, and active crop with CFA phase', () => {
    const { buffer, cfg } = makeConfig(w, h, 'RGGB', 12, { kind: 'unpacked', container: 'u16', endian: 'le', alignment: 'right' }, values, { headerOffset: 17, rowStride: w * 2 + 8, active: { x: 1, y: 1, w: 5, h: 4 } });
    const raw = decodeBareRaw(buffer, cfg);
    expect(raw.geometry.active).toEqual({ x: 1, y: 1, w: 5, h: 4 });
    expect(raw.cfa.sites[0]).toBe('B');
  });

  it('reports truncated files', () => {
    const { buffer, cfg } = makeConfig(w, h, 'RGGB', 12, { kind: 'unpacked', container: 'u16', endian: 'le', alignment: 'right' }, values);
    expect(() => decodeBareRaw(buffer.slice(0, 20), cfg)).toThrow(RawDecodeError);
  });

  it('reports invalid white/black levels', () => {
    const { buffer, cfg } = makeConfig(w, h, 'RGGB', 12, { kind: 'unpacked', container: 'u16', endian: 'le', alignment: 'right' }, values);
    expect(() => decodeBareRaw(buffer, { ...cfg, black: 4095, white: 4095 })).toThrow(RawDecodeError);
  });
});
