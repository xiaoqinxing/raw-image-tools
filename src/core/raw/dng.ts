import type { CfaPattern, DngColorMeta, Mat3, Rect, Vec4 } from '../types';

export interface DngTags {
  width?: number;
  height?: number;
  bitsPerSample?: number;
  compression?: number;
  photometric?: number;
  samplesPerPixel?: number;
  cfaPattern?: CfaPattern;
  cfaRepeat?: [number, number];
  black?: Vec4;
  white?: Vec4;
  active?: Rect;
  defaultCrop?: Rect;
  orientation?: 1 | 3 | 6 | 8;
  colorMatrix1?: Mat3;
  colorMatrix2?: Mat3;
  forwardMatrix1?: Mat3;
  forwardMatrix2?: Mat3;
  calibrationIlluminant1?: number;
  calibrationIlluminant2?: number;
  asShotNeutral?: [number, number, number];
  asShotWhiteXY?: [number, number];
  baselineExposure?: number;
  make?: string;
  model?: string;
  uniqueCameraModel?: string;
  dngVersion?: number[];
  linearizationTable?: number[];
  opcodeLists: number[];
  warnings: string[];
  meta: DngColorMeta;
}

type TagValue = number[] | string | Uint8Array | number[][];

const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};

class Reader {
  readonly view: DataView;
  readonly little: boolean;
  constructor(readonly buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    const b0 = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
    if (b0[0] === 0x49 && b0[1] === 0x49) this.little = true;
    else if (b0[0] === 0x4d && b0[1] === 0x4d) this.little = false;
    else throw new Error('不是 TIFF/DNG 文件（字节序标记无效）');
  }
  u16(o: number) { return this.view.getUint16(o, this.little); }
  u32(o: number) { return this.view.getUint32(o, this.little); }
  i32(o: number) { return this.view.getInt32(o, this.little); }
  f32(o: number) { return this.view.getFloat32(o, this.little); }
  f64(o: number) { return this.view.getFloat64(o, this.little); }
}

function readValue(r: Reader, type: number, count: number, valueOffset: number): TagValue | undefined {
  const size = TYPE_SIZE[type];
  if (!size) return undefined;
  const total = size * count;
  const start = total <= 4 ? valueOffset : r.u32(valueOffset);
  if (start < 0 || start + total > r.buffer.byteLength) return undefined;
  if (type === 2) {
    const bytes = new Uint8Array(r.buffer, start, count);
    let end = bytes.indexOf(0);
    if (end < 0) end = bytes.length;
    return new TextDecoder().decode(bytes.subarray(0, end)).trim();
  }
  if (type === 7) return new Uint8Array(r.buffer.slice(start, start + total));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = start + i * size;
    switch (type) {
      case 1: out.push(r.view.getUint8(o)); break;
      case 3: out.push(r.u16(o)); break;
      case 4: out.push(r.u32(o)); break;
      case 5: {
        const n = r.u32(o);
        const d = r.u32(o + 4);
        out.push(d ? n / d : 0);
        break;
      }
      case 6: out.push(r.view.getInt8(o)); break;
      case 8: out.push(r.view.getInt16(o, r.little)); break;
      case 9: out.push(r.i32(o)); break;
      case 10: {
        const n = r.i32(o);
        const d = r.i32(o + 4);
        out.push(d ? n / d : 0);
        break;
      }
      case 11: out.push(r.f32(o)); break;
      case 12: out.push(r.f64(o)); break;
      default: break;
    }
  }
  return out;
}

function readIfd(r: Reader, offset: number): Map<number, TagValue> {
  const tags = new Map<number, TagValue>();
  if (offset <= 0 || offset + 2 > r.buffer.byteLength) return tags;
  const n = r.u16(offset);
  for (let i = 0; i < n; i++) {
    const o = offset + 2 + i * 12;
    if (o + 12 > r.buffer.byteLength) break;
    const tag = r.u16(o);
    const type = r.u16(o + 2);
    const count = r.u32(o + 4);
    const value = readValue(r, type, count, o + 8);
    if (value !== undefined) tags.set(tag, value);
  }
  return tags;
}

function asNumbers(v: TagValue | undefined): number[] | undefined {
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return v as number[];
  if (v instanceof Uint8Array) return Array.from(v);
  return undefined;
}

function asString(v: TagValue | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asMat3(v: TagValue | undefined): Mat3 | undefined {
  const n = asNumbers(v);
  if (!n || n.length < 9) return undefined;
  return [n[0], n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8]];
}

function asRectActive(v: TagValue | undefined): Rect | undefined {
  const n = asNumbers(v);
  if (!n || n.length < 4) return undefined;
  // DNG ActiveArea is [top, left, bottom, right]
  const [top, left, bottom, right] = n;
  if (!(right > left && bottom > top)) return undefined;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function asRectCrop(origin: TagValue | undefined, size: TagValue | undefined): Rect | undefined {
  const o = asNumbers(origin);
  const s = asNumbers(size);
  if (!o || !s || o.length < 2 || s.length < 2) return undefined;
  if (!(s[0] > 0 && s[1] > 0)) return undefined;
  return { x: o[0], y: o[1], w: s[0], h: s[1] };
}

function firstNum(v: TagValue | undefined): number | undefined {
  const n = asNumbers(v);
  return n?.[0];
}

function patternFromCfa(values: number[] | undefined, planeColors: number[] | undefined): CfaPattern | undefined {
  if (!values || values.length < 4) return undefined;
  const names = values.slice(0, 4).map((v) => {
    const color = planeColors && planeColors.length > v ? planeColors[v] : v;
    return color === 0 ? 'R' : color === 1 ? 'G' : color === 2 ? 'B' : 'G';
  });
  const s = names.join('');
  if (s === 'RGGB' || s === 'BGGR' || s === 'GRBG' || s === 'GBRG') return s;
  return undefined;
}

function canonicalSiteChannels(pattern: CfaPattern): [number, number, number, number] {
  switch (pattern) {
    case 'RGGB': return [0, 1, 2, 3];
    case 'BGGR': return [3, 2, 1, 0];
    case 'GRBG': return [1, 0, 3, 2];
    case 'GBRG': return [2, 3, 0, 1];
  }
}

function levelsFromTags(
  pattern: CfaPattern,
  blackRaw: number[] | undefined,
  repeat: number[] | undefined,
  whiteRaw: number[] | undefined,
): { black: Vec4; white: Vec4 } {
  const sites = canonicalSiteChannels(pattern);
  const black = [0, 0, 0, 0];
  const white = [65535, 65535, 65535, 65535];
  if (blackRaw && blackRaw.length) {
    if (blackRaw.length === 1) {
      black.fill(blackRaw[0]);
    } else if (repeat && repeat.length >= 2 && blackRaw.length >= repeat[0] * repeat[1]) {
      const rw = repeat[0], rh = repeat[1];
      // Average repeat pattern into the 2x2 CFA sites.
      const sums = [0, 0, 0, 0];
      const counts = [0, 0, 0, 0];
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const site = ((y & 1) * 2 + (x & 1));
          const ch = sites[site];
          sums[ch] += blackRaw[y * rw + x];
          counts[ch]++;
        }
      }
      for (let i = 0; i < 4; i++) black[i] = counts[i] ? sums[i] / counts[i] : blackRaw[0];
    } else if (blackRaw.length >= 4) {
      for (let i = 0; i < 4; i++) black[i] = blackRaw[i];
    } else if (blackRaw.length >= 3) {
      black[0] = blackRaw[0];
      black[1] = blackRaw[1];
      black[2] = blackRaw[1];
      black[3] = blackRaw[2];
    }
  }
  if (whiteRaw && whiteRaw.length) {
    if (whiteRaw.length === 1) {
      white.fill(whiteRaw[0]);
    } else if (whiteRaw.length >= 4) {
      for (let i = 0; i < 4; i++) white[i] = whiteRaw[i];
    } else if (whiteRaw.length >= 3) {
      white[0] = whiteRaw[0];
      white[1] = whiteRaw[1];
      white[2] = whiteRaw[1];
      white[3] = whiteRaw[2];
    }
  }
  return { black: black as Vec4, white: white as Vec4 };
}

/**
 * Parse DNG/TIFF metadata. This intentionally does not decode pixels; LibRaw
 * does that. It fills the DNG-specific color/level tags that LibRaw's public
 * WebAssembly surface does not expose consistently.
 */
export function parseDngMetadata(buffer: ArrayBuffer): DngTags {
  const r = new Reader(buffer);
  if (r.u16(2) !== 42) throw new Error('不是 TIFF/DNG 文件（magic 无效）');
  const ifd0Offset = r.u32(4);
  const ifd0 = readIfd(r, ifd0Offset);
  if (!ifd0.size) throw new Error('DNG 没有可读的 IFD0');

  const subIfds = asNumbers(ifd0.get(330)) ?? [];
  const candidates = [ifd0, ...subIfds.map((offset) => readIfd(r, offset))];
  const rawIfd = candidates.find((t) => {
    const photo = firstNum(t.get(262));
    return t.has(33421) || t.has(33422) || photo === 32803 || photo === 34892;
  }) ?? ifd0;

  const merged = new Map<number, TagValue>();
  for (const t of candidates) for (const [k, v] of t) if (!merged.has(k)) merged.set(k, v);
  for (const [k, v] of rawIfd) merged.set(k, v);

  const warnings: string[] = [];
  const dngVersion = asNumbers(merged.get(50706));
  const cfaPattern = patternFromCfa(
    asNumbers(merged.get(33422)),
    asNumbers(merged.get(50710)),
  );
  if (!cfaPattern) warnings.push('未能从 DNG 解析 CFA 排列，将回退到 LibRaw 的 CFA 信息。');

  const active = asRectActive(merged.get(50829));
  const defaultCrop = asRectCrop(merged.get(50719), merged.get(50720));
  const levels = cfaPattern
    ? levelsFromTags(cfaPattern, asNumbers(merged.get(50714)), asNumbers(merged.get(50713)), asNumbers(merged.get(50717)))
    : { black: [0, 0, 0, 0] as Vec4, white: [65535, 65535, 65535, 65535] as Vec4 };

  const orientationRaw = firstNum(merged.get(274)) ?? 1;
  const orientation: 1 | 3 | 6 | 8 =
    orientationRaw === 3 ? 3 : orientationRaw === 6 ? 6 : orientationRaw === 8 ? 8 : 1;
  if (![1, 3, 6, 8].includes(orientationRaw)) {
    warnings.push(`DNG Orientation=${orientationRaw} 包含镜像或未支持方向，首版按不旋转显示。`);
  }

  const color: DngColorMeta = {
    colorMatrix1: asMat3(merged.get(50721)),
    colorMatrix2: asMat3(merged.get(50722)),
    forwardMatrix1: asMat3(merged.get(50964)),
    forwardMatrix2: asMat3(merged.get(50965)),
    calibrationIlluminant1: firstNum(merged.get(50778)),
    calibrationIlluminant2: firstNum(merged.get(50779)),
    asShotNeutral: (() => {
      const n = asNumbers(merged.get(50728));
      return n && n.length >= 3 ? [n[0], n[1], n[2]] as [number, number, number] : undefined;
    })(),
    asShotWhiteXY: (() => {
      const n = asNumbers(merged.get(50729));
      return n && n.length >= 2 ? [n[0], n[1]] as [number, number] : undefined;
    })(),
    baselineExposure: firstNum(merged.get(50730)),
    activeArea: active,
    defaultCrop,
    orientation: orientationRaw,
    cfaPattern,
    uniqueCameraModel: asString(merged.get(50708)),
    make: asString(merged.get(271)),
    model: asString(merged.get(272)),
    tagSource: dngVersion ? 'dng' : 'none',
    warnings,
  };

  if (merged.has(50712) || (asNumbers(merged.get(50712))?.length ?? 0) > 0) {
    warnings.push('DNG 含 LinearizationTable；需确认 LibRaw 已应用，否则黑/白电平与像素值可能不一致。');
  }
  if (merged.has(51008) || merged.has(51009) || merged.has(51022)) {
    warnings.push('DNG 含 OpcodeList（暗角/坏点等）；首版不执行 opcode，只使用原始像素。');
  }
  if (merged.has(50715) || merged.has(50716)) {
    warnings.push('DNG 含 BlackLevelDeltaH/V；首版按逐 CFA 常数黑电平处理。');
  }
  if (asNumbers(merged.get(50717)) === undefined) {
    warnings.push('DNG 未提供 WhiteLevel，将使用 LibRaw 的 ColorMaximum 作为白电平。');
  }

  return {
    width: firstNum(merged.get(256)),
    height: firstNum(merged.get(257)),
    bitsPerSample: firstNum(merged.get(258)),
    compression: firstNum(merged.get(259)),
    photometric: firstNum(merged.get(262)),
    samplesPerPixel: firstNum(merged.get(277)),
    cfaPattern,
    cfaRepeat: (() => {
      const n = asNumbers(merged.get(33421));
      return n && n.length >= 2 ? [n[0], n[1]] as [number, number] : undefined;
    })(),
    black: levels.black,
    white: levels.white,
    active,
    defaultCrop,
    orientation,
    colorMatrix1: color.colorMatrix1,
    colorMatrix2: color.colorMatrix2,
    forwardMatrix1: color.forwardMatrix1,
    forwardMatrix2: color.forwardMatrix2,
    calibrationIlluminant1: color.calibrationIlluminant1,
    calibrationIlluminant2: color.calibrationIlluminant2,
    asShotNeutral: color.asShotNeutral,
    asShotWhiteXY: color.asShotWhiteXY,
    baselineExposure: color.baselineExposure,
    make: color.make,
    model: color.model,
    uniqueCameraModel: color.uniqueCameraModel,
    dngVersion,
    linearizationTable: asNumbers(merged.get(50712)),
    opcodeLists: [51008, 51009, 51022].filter((t) => merged.has(t)),
    warnings,
    meta: color,
  };
}
