import type {
  BareRawConfig,
  CfaLayout,
  RawDiagnostics,
  RawGeometry,
  RawImage,
  RawLevels,
  Vec4,
} from '../types';
import { makeCfaLayout } from './cfa';
import { uid } from '../util/id';
import { analyzeRaw } from './validate';

export class RawDecodeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RawDecodeError';
  }
}

function asVec4(v: number | Vec4): Vec4 {
  return Array.isArray(v) ? v : [v, v, v, v];
}

function requiredBytesForRow(row: number, cfg: BareRawConfig, rowStride: number): number {
  if (cfg.packing.kind === 'unpacked') {
    const containerBytes = cfg.packing.container === 'u8' ? 1 : 2;
    return row * rowStride + cfg.width * containerBytes;
  }
  const bits = cfg.bitDepth;
  const group = cfg.packing.group ?? 'continuous';
  if (group === 'mipi10') return row * rowStride + Math.ceil(cfg.width / 4) * 5;
  if (group === 'mipi12') return row * rowStride + Math.ceil(cfg.width / 2) * 3;
  if (group === 'mipi14') return row * rowStride + Math.ceil(cfg.width / 4) * 7;
  return row * rowStride + Math.ceil((cfg.width * bits) / 8);
}

export function bareRowBytes(cfg: BareRawConfig): number {
  if (cfg.packing.kind === 'unpacked') {
    return cfg.width * (cfg.packing.container === 'u8' ? 1 : 2);
  }
  const group = cfg.packing.group ?? 'continuous';
  if (group === 'mipi10') return Math.ceil(cfg.width / 4) * 5;
  if (group === 'mipi12') return Math.ceil(cfg.width / 2) * 3;
  if (group === 'mipi14') return Math.ceil(cfg.width / 4) * 7;
  return Math.ceil((cfg.width * cfg.bitDepth) / 8);
}

/** Decode a headerless CFA buffer into uint16 samples (right-aligned). */
export function decodeBareRaw(buffer: ArrayBuffer, cfg: BareRawConfig): RawImage {
  const bytes = new Uint8Array(buffer);
  const width = cfg.width;
  const height = cfg.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RawDecodeError('BAD_DIMENSIONS', '宽高必须是正整数', { width, height });
  }
  if (width > 65535 || height > 65535 || width * height > 200_000_000) {
    throw new RawDecodeError('TOO_LARGE', '图像尺寸超出安全上限（200MP / 65535px）', { width, height });
  }
  const bitDepth = cfg.bitDepth;
  if (![8, 10, 12, 14, 16].includes(bitDepth)) {
    throw new RawDecodeError('BAD_BITDEPTH', '位宽必须是 8/10/12/14/16', { bitDepth });
  }
  const rowBytes = bareRowBytes(cfg);
  const rowStride = cfg.rowStride || rowBytes;
  if (rowStride < rowBytes) {
    throw new RawDecodeError('BAD_STRIDE', `row stride 太小：需要至少 ${rowBytes} bytes，实际 ${rowStride}`, {
      rowBytes,
      rowStride,
    });
  }
  const header = cfg.headerOffset ?? 0;
  if (header < 0) throw new RawDecodeError('BAD_OFFSET', 'header offset 不能为负', { header });
  const required = header + requiredBytesForRow(height - 1, cfg, rowStride);
  if (required > bytes.length) {
    const delta = required - bytes.length;
    throw new RawDecodeError(
      'TRUNCATED',
      `文件长度不足：至少需要 ${required} bytes，实际 ${bytes.length} bytes（差 ${delta}）`,
      { required, actual: bytes.length, delta, rowBytes, rowStride, header },
    );
  }
  const mask = bitDepth === 16 ? 0xffff : (1 << bitDepth) - 1;
  const shift = cfg.packing.kind === 'unpacked'
    ? cfg.packing.alignment === 'left'
      ? (cfg.sampleShift ?? Math.max(0, 16 - bitDepth))
      : 0
    : 0;
  const out = new Uint16Array(width * height);
  const view = new DataView(buffer);
  const packedKind = cfg.packing.kind;
  const group = cfg.packing.group ?? 'continuous';
  const bitOrder = cfg.packing.bitOrder ?? 'lsb';

  for (let y = 0; y < height; y++) {
    const rowStart = header + y * rowStride;
    const dst = y * width;
    if (packedKind === 'unpacked') {
      if (cfg.packing.container === 'u8') {
        for (let x = 0; x < width; x++) {
          out[dst + x] = bytes[rowStart + x] & mask;
        }
      } else {
        const little = (cfg.packing.endian ?? cfg.endian ?? 'le') === 'le';
        for (let x = 0; x < width; x++) {
          const p = rowStart + x * 2;
          const v = little ? view.getUint16(p, true) : view.getUint16(p, false);
          out[dst + x] = shift ? (v >>> shift) & mask : v & mask;
        }
      }
      continue;
    }

    if (group === 'mipi10') {
      for (let x = 0; x < width; x += 4) {
        const p = rowStart + (x >> 2) * 5;
        const b0 = bytes[p], b1 = bytes[p + 1], b2 = bytes[p + 2], b3 = bytes[p + 3], low = bytes[p + 4];
        for (let k = 0; k < 4 && x + k < width; k++) {
          const h = k === 0 ? b0 : k === 1 ? b1 : k === 2 ? b2 : b3;
          out[dst + x + k] = ((h << 2) | ((low >> (k * 2)) & 3)) & 0x3ff;
        }
      }
      continue;
    }
    if (group === 'mipi12') {
      for (let x = 0; x < width; x += 2) {
        const p = rowStart + (x >> 1) * 3;
        const b0 = bytes[p], b1 = bytes[p + 1], low = bytes[p + 2];
        out[dst + x] = ((b0 << 4) | (low & 0x0f)) & 0xfff;
        if (x + 1 < width) out[dst + x + 1] = ((b1 << 4) | ((low >> 4) & 0x0f)) & 0xfff;
      }
      continue;
    }
    if (group === 'mipi14') {
      for (let x = 0; x < width; x += 4) {
        const p = rowStart + (x >> 2) * 7;
        const h0 = bytes[p], h1 = bytes[p + 1], h2 = bytes[p + 2], h3 = bytes[p + 3];
        const l0 = bytes[p + 4], l1 = bytes[p + 5], l2 = bytes[p + 6];
        const lows = [
          l0 & 0x3f,
          ((l0 >> 6) | (l1 << 2)) & 0x3f,
          ((l1 >> 4) | (l2 << 4)) & 0x3f,
          (l2 >> 2) & 0x3f,
        ];
        const highs = [h0, h1, h2, h3];
        for (let k = 0; k < 4 && x + k < width; k++) {
          out[dst + x + k] = ((highs[k] << 6) | lows[k]) & 0x3fff;
        }
      }
      continue;
    }

    // Continuous bit stream, LSB-first or MSB-first within each row.
    for (let x = 0; x < width; x++) {
      const bit = x * bitDepth;
      const byte = rowStart + (bit >> 3);
      const off = bit & 7;
      if (bitOrder === 'lsb') {
        const b0 = bytes[byte] ?? 0;
        const b1 = bytes[byte + 1] ?? 0;
        const b2 = bytes[byte + 2] ?? 0;
        const b3 = bytes[byte + 3] ?? 0;
        const word = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
        out[dst + x] = (word >>> off) & mask;
      } else {
        const b0 = bytes[byte] ?? 0;
        const b1 = bytes[byte + 1] ?? 0;
        const b2 = bytes[byte + 2] ?? 0;
        const b3 = bytes[byte + 3] ?? 0;
        const word = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
        const shiftRight = 32 - off - bitDepth;
        out[dst + x] = (word >>> shiftRight) & mask;
      }
    }
  }

  const active = cfg.active ?? { x: 0, y: 0, w: width, h: height };
  if (active.x < 0 || active.y < 0 || active.w <= 0 || active.h <= 0 || active.x + active.w > width || active.y + active.h > height) {
    throw new RawDecodeError('BAD_ACTIVE', 'active area 超出图像范围', { active, width, height });
  }
  const levels: RawLevels = {
    black: asVec4(cfg.black),
    white: asVec4(cfg.white),
    source: 'user',
  };
  for (let i = 0; i < 4; i++) {
    if (!(levels.white[i] > levels.black[i])) {
      throw new RawDecodeError('BAD_LEVELS', `white level 必须大于 black level（通道 ${i}）`, {
        black: levels.black,
        white: levels.white,
      });
    }
  }
  const geometry: RawGeometry = {
    storedWidth: width,
    storedHeight: height,
    rowStrideBytes: rowStride,
    active,
    bitDepth,
    packing: cfg.packing,
  };
  const cfa: CfaLayout = makeCfaLayout(cfg.cfa, { x: active.x, y: active.y });
  const diagnostics = analyzeRaw(out, geometry, cfa, levels, bytes.length, {
    rowBytes,
    headerOffset: header,
    rowStride,
  });
  return {
    id: uid(),
    fileName: 'bare.raw',
    fileSize: bytes.length,
    sha256: '',
    kind: 'bare',
    geometry,
    cfa,
    data: out,
    levels,
    wb: { asShot: [1, 1, 1, 1], source: 'none' },
    color: null,
    orientation: 1,
    decoder: { name: 'rawlab-bare', version: '0.1.0' },
    diagnostics,
    createdAt: Date.now(),
  };
}

export function makeBareDiagnostics(
  data: Uint16Array,
  geometry: RawGeometry,
  cfa: CfaLayout,
  levels: RawLevels,
  actualBytes: number,
): RawDiagnostics {
  return analyzeRaw(data, geometry, cfa, levels, actualBytes, {
    rowBytes: bareRowBytes({
      width: geometry.storedWidth,
      height: geometry.storedHeight,
      cfa: cfa.pattern,
      bitDepth: geometry.bitDepth,
      packing: geometry.packing,
      headerOffset: 0,
      rowStride: geometry.rowStrideBytes,
      black: 0,
      white: 1,
    }),
    headerOffset: 0,
    rowStride: geometry.rowStrideBytes,
  });
}
