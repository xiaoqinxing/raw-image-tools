import { Buffer } from 'node:buffer';

export interface TestDngOptions {
  width: number;
  height: number;
  cfa?: 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG';
  black?: number;
  white?: number;
  colorMatrix?: number[];
  asShotNeutral?: [number, number, number];
  value?: (x: number, y: number, channel: number) => number;
}

function ascii(s: string): { type: number; count: number; data: Buffer } {
  const b = Buffer.from(s + '\0', 'ascii');
  return { type: 2, count: b.length, data: b };
}
function short(arr: number | number[]): { type: number; count: number; data: Buffer } {
  const a = Array.isArray(arr) ? arr : [arr];
  const b = Buffer.alloc(a.length * 2);
  a.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return { type: 3, count: a.length, data: b };
}
function long(arr: number | number[]): { type: number; count: number; data: Buffer } {
  const a = Array.isArray(arr) ? arr : [arr];
  const b = Buffer.alloc(a.length * 4);
  a.forEach((v, i) => b.writeUInt32LE(v, i * 4));
  return { type: 4, count: a.length, data: b };
}
function byte(arr: number[]): { type: number; count: number; data: Buffer } {
  const b = Buffer.from(arr);
  return { type: 1, count: b.length, data: b };
}
function srational(arr: number[]): { type: number; count: number; data: Buffer } {
  const b = Buffer.alloc(arr.length * 8);
  arr.forEach((v, i) => {
    b.writeInt32LE(Math.round(v * 1_000_000), i * 8);
    b.writeInt32LE(1_000_000, i * 8 + 4);
  });
  return { type: 10, count: arr.length, data: b };
}
function urational(arr: number[]): { type: number; count: number; data: Buffer } {
  const b = Buffer.alloc(arr.length * 8);
  arr.forEach((v, i) => {
    b.writeUInt32LE(Math.round(v * 1_000_000), i * 8);
    b.writeUInt32LE(1_000_000, i * 8 + 4);
  });
  return { type: 5, count: arr.length, data: b };
}

const CFA_MAP = {
  RGGB: [0, 1, 1, 2],
  BGGR: [2, 1, 1, 0],
  GRBG: [1, 0, 2, 1],
  GBRG: [1, 2, 0, 1],
} as const;

/** Minimal uncompressed DNG writer for tests only. */
export function makeTestDng(opts: TestDngOptions): Buffer {
  const W = opts.width, H = opts.height;
  const cfa = opts.cfa ?? 'RGGB';
  const channels = (() => {
    switch (cfa) {
      case 'RGGB': return [0, 1, 1, 3];
      case 'BGGR': return [3, 2, 2, 0];
      case 'GRBG': return [1, 0, 3, 2];
      case 'GBRG': return [2, 3, 0, 1];
    }
  })();
  const black = opts.black ?? 0;
  const white = opts.white ?? 4095;
  const data = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const site = (y & 1) * 2 + (x & 1);
      const ch = channels[site];
      data[y * W + x] = opts.value ? opts.value(x, y, ch) : (ch === 0 ? 1000 + x : ch === 2 ? 1500 + y : ch === 3 ? 500 + x + y : 1200);
    }
  }
  const pix = Buffer.alloc(data.length * 2);
  data.forEach((v, i) => pix.writeUInt16LE(v, i * 2));

  const entries: Array<{ tag: number; type: number; count: number; data: Buffer; offset?: number }> = [];
  const add = (tag: number, v: { type: number; count: number; data: Buffer }) => entries.push({ tag, ...v });
  add(254, long(0));
  add(256, long(W));
  add(257, long(H));
  add(258, short(16));
  add(259, short(1));
  add(262, short(32803));
  add(271, ascii('RawLab'));
  add(272, ascii('Synthetic DNG'));
  add(273, long(0)); // strip offset patched later
  add(274, short(1));
  add(277, short(1));
  add(278, long(H));
  add(279, long(pix.length));
  add(284, short(1));
  add(33421, short([2, 2]));
  add(33422, byte([...CFA_MAP[cfa]]));
  add(50706, byte([1, 4, 0, 0]));
  add(50707, byte([1, 1, 0, 0]));
  add(50708, ascii('RawLab Synthetic'));
  add(50710, byte([0, 1, 2]));
  add(50711, short(1));
  add(50713, short([1, 1]));
  add(50714, short(black));
  add(50717, short(white));
  add(50719, long([0, 0]));
  add(50720, long([W, H]));
  add(50721, srational(opts.colorMatrix ?? [0.6722, 0.1707, 0.0942, 0.253, 0.6947, 0.0523, 0.0208, 0.099, 1.0202]));
  add(50728, urational(opts.asShotNeutral ?? [1, 1, 1]));
  add(50730, srational([0]));
  add(50778, short(21));
  add(50829, long([0, 0, H, W]));

  entries.sort((a, b) => a.tag - b.tag);
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let cursor = ifdOffset + ifdSize;
  for (const e of entries) {
    if (e.data.length <= 4) continue;
    if (cursor & 1) cursor++;
    e.offset = cursor;
    cursor += e.data.length;
  }
  if (cursor & 1) cursor++;
  const stripOffset = cursor;

  const header = Buffer.alloc(8);
  header.write('II', 0, 'ascii');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(ifdOffset, 4);
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(entries.length, 0);
  entries.forEach((e, i) => {
    const o = 2 + i * 12;
    ifd.writeUInt16LE(e.tag, o);
    ifd.writeUInt16LE(e.type, o + 2);
    ifd.writeUInt32LE(e.count, o + 4);
    if (e.tag === 273) {
      ifd.writeUInt32LE(stripOffset, o + 8);
    } else if (e.data.length <= 4) {
      const pad = Buffer.alloc(4);
      e.data.copy(pad);
      pad.copy(ifd, o + 8);
    } else {
      ifd.writeUInt32LE(e.offset ?? 0, o + 8);
    }
  });
  ifd.writeUInt32LE(0, 2 + entries.length * 12);

  const parts: Buffer[] = [header, ifd];
  let pos = ifdOffset + ifdSize;
  for (const e of entries) {
    if (e.data.length <= 4) continue;
    if (pos & 1) { parts.push(Buffer.alloc(1)); pos++; }
    parts.push(e.data);
    pos += e.data.length;
  }
  if (pos & 1) parts.push(Buffer.alloc(1));
  parts.push(pix);
  return Buffer.concat(parts);
}
