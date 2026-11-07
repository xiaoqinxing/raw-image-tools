import { LibRaw } from '@colorhythm/libraw-wasm';
import type { CfaLayout, CfaPattern, DngColorMeta, RawImage, RawLevels, Vec4 } from '../types';
import { makeCfaLayout, patternFromCdesc, patternFromFilters } from './cfa';
import { parseDngMetadata } from './dng';
import { analyzeRaw } from './validate';
import { uid } from '../util/id';

export interface DngDecodeOptions {
  fileName: string;
  fileSize: number;
  sha256: string;
  wasm?: ArrayBuffer | Response;
}

let initPromise: Promise<unknown> | null = null;

export async function initializeLibRaw(wasm?: ArrayBuffer | Response): Promise<void> {
  if (!initPromise) initPromise = LibRaw.initialize(wasm);
  await initPromise;
}

function normalizeWb(v: [number, number, number] | Vec4 | null): Vec4 | null {
  if (!v) return null;
  const r = v[0] > 0 ? 1 / v[0] : 1;
  const g = v[1] > 0 ? 1 / v[1] : 1;
  const b = v[2] > 0 ? 1 / v[2] : 1;
  const gRef = g || 1;
  return [r / gRef, 1, 1, b / gRef];
}

function mapLibRawBlack(lr: LibRaw, pattern: CfaPattern | null): Vec4 {
  const raw = [0, 1, 2, 3].map((i) => {
    try {
      return lr.getBlackLevel(i);
    } catch {
      return 0;
    }
  });
  if (!pattern) return raw as Vec4;
  // LibRaw indexes channels in its internal order (usually R,G1,G2,B for Bayer).
  return raw as Vec4;
}

function mapLibRawWhite(lr: LibRaw, pattern: CfaPattern | null): Vec4 {
  const linear = [0, 1, 2, 3].map((i) => {
    try {
      return lr.getLinearMax(i);
    } catch {
      return 0;
    }
  });
  const max = (() => {
    try {
      return lr.getColorMaximum();
    } catch {
      return 0;
    }
  })();
  const fallback = max > 0 ? max : 65535;
  const out = linear.map((v) => (v > 0 ? v : fallback)) as Vec4;
  return out;
}

function mapOrientation(meta: ReturnType<typeof parseDngMetadata> | null, flip: number): 1 | 3 | 6 | 8 {
  if (meta?.orientation) return meta.orientation;
  // LibRaw flip: 0 none, 3 180, 5 90 CW, 6 90 CCW (LibRaw conventions vary)
  if (flip === 3) return 3;
  if (flip === 5) return 6;
  if (flip === 6) return 8;
  return 1;
}

/**
 * Decode DNG with LibRaw and add DNG-specific metadata from our TIFF parser.
 * The raw buffer is normalized so that `data` always covers the active image
 * (or stored image with margins if LibRaw exposes them).
 */
export async function decodeDng(buffer: ArrayBuffer, opts: DngDecodeOptions): Promise<RawImage> {
  let meta: ReturnType<typeof parseDngMetadata> | null = null;
  let metaError: string | null = null;
  try {
    meta = parseDngMetadata(buffer);
  } catch (e) {
    metaError = e instanceof Error ? e.message : String(e);
  }

  await initializeLibRaw(opts.wasm);
  const lr = new LibRaw();
  await lr.waitUntilReady();
  try {
    lr.open(buffer);
    lr.unpack();
    const raw = lr.getRawImage();
    if (!raw || raw.length === 0) {
      throw new Error('LibRaw 未返回 RAW 像素（可能是压缩/格式不受支持）。');
    }
    const rawW = lr.getRawWidth();
    const rawH = lr.getRawHeight();
    const activeW = lr.getActiveWidth();
    const activeH = lr.getActiveHeight();
    const left = lr.getLeftMargin();
    const top = lr.getTopMargin();
    const pitch = lr.getRawPitch();
    const cdesc = lr.getIParams().cdesc;
    const filters = lr.getFilters();
    const librawPattern = patternFromCdesc(cdesc) ?? patternFromFilters(filters);
    const cfaPattern = meta?.cfaPattern ?? librawPattern ?? 'RGGB';

    const activeOnly = raw.length === activeW * activeH && rawW * rawH !== activeW * activeH;
    let storedWidth: number;
    let storedHeight: number;
    let active: { x: number; y: number; w: number; h: number };
    if (activeOnly) {
      storedWidth = activeW;
      storedHeight = activeH;
      active = { x: 0, y: 0, w: activeW, h: activeH };
    } else {
      storedWidth = rawW;
      storedHeight = rawH;
      active = {
        x: Math.max(0, Math.min(left, rawW - activeW)),
        y: Math.max(0, Math.min(top, rawH - activeH)),
        w: activeW,
        h: activeH,
      };
    }
    if (raw.length < storedWidth * storedHeight) {
      // Some LibRaw builds return active-only buffers with a zero pitch.
      storedWidth = activeW;
      storedHeight = activeH;
      active = { x: 0, y: 0, w: activeW, h: activeH };
    }
    // DNG CFAPattern is relative to ActiveArea; our active buffer may be stored-
    // relative. Use active-relative layout when parsing DNG metadata.
    const cfa: CfaLayout = meta?.cfaPattern
      ? makeCfaLayout(meta.cfaPattern, { x: 0, y: 0 })
      : makeCfaLayout(cfaPattern, { x: active.x, y: active.y });

    const dngBlack = meta?.black;
    const dngWhite = meta?.white;
    let black = dngBlack ?? mapLibRawBlack(lr, cfaPattern);
    let white = dngWhite ?? mapLibRawWhite(lr, cfaPattern);
    if (!(white[0] > black[0])) {
      const fallback = (() => {
        try { return lr.getColorMaximum(); } catch { return 0; }
      })();
      white = [fallback || 65535, fallback || 65535, fallback || 65535, fallback || 65535];
    }
    const levels: RawLevels = {
      black,
      white,
      source: dngBlack ? 'dng' : 'libraw',
    };

    let asShot: Vec4 | null = normalizeWb(meta?.asShotNeutral ?? null);
    if (!asShot) {
      const mul = [0, 1, 2, 3].map((i) => {
        try { return lr.getCamMul(i); } catch { return 0; }
      });
      if (mul.some((v) => v > 0)) {
        const g = mul[1] || 1;
        asShot = [mul[0] / g || 1, 1, 1, mul[2] / g || 1];
      }
    }

    const color: DngColorMeta | null = meta?.meta ?? null;
    if (metaError) {
      if (color) color.warnings.push(`DNG 元数据解析失败：${metaError}`);
      else {
        // Keep a minimal meta object so the UI can show the warning.
      }
    }
    if (meta?.warnings.length) {
      if (color) color.warnings.push(...meta.warnings);
    }
    if (!meta?.colorMatrix1 && !meta?.forwardMatrix1) {
      if (color) color.warnings.push('DNG 未解析到 ColorMatrix/ForwardMatrix，CSC 将回退为单位矩阵。');
    }

    const rowStride = activeOnly ? storedWidth * 2 : (pitch > 0 ? pitch : storedWidth * 2);
    const geometry = {
      storedWidth,
      storedHeight,
      rowStrideBytes: rowStride,
      active,
      bitDepth: (meta?.bitsPerSample === 8 ? 8 : meta?.bitsPerSample === 10 ? 10 : meta?.bitsPerSample === 12 ? 12 : meta?.bitsPerSample === 14 ? 14 : 16) as 8 | 10 | 12 | 14 | 16,
      packing: { kind: 'unpacked' as const, container: 'u16' as const, endian: 'le' as const, alignment: 'right' as const },
    };
    const diagnostics = analyzeRaw(raw, geometry, cfa, levels, buffer.byteLength, {
      rowBytes: rowStride,
      headerOffset: 0,
      rowStride,
    });
    if (metaError) {
      diagnostics.warnings.push({ level: 'warn', message: `DNG 元数据解析失败，使用 LibRaw 回退：${metaError}` });
    }
    if (meta?.warnings.length) {
      for (const w of meta.warnings) diagnostics.warnings.push({ level: 'warn', message: w });
    }
    const orientation = mapOrientation(meta, (() => { try { return lr.getFlip(); } catch { return 0; } })());

    return {
      id: uid(),
      fileName: opts.fileName,
      fileSize: opts.fileSize,
      sha256: opts.sha256,
      kind: 'dng',
      geometry,
      cfa,
      data: new Uint16Array(raw),
      levels,
      wb: { asShot, source: asShot ? (meta?.asShotNeutral ? 'dng' : 'libraw') : 'none' },
      color,
      orientation,
      decoder: {
        name: 'LibRaw WASM',
        version: LibRaw.version(),
        libraw: LibRaw.version(),
      },
      diagnostics,
      createdAt: Date.now(),
    };
  } finally {
    try { lr.recycle(); } catch { /* ignore */ }
    try { lr.dispose(); } catch { /* ignore */ }
  }
}

export function librawVersion(): string {
  try {
    return LibRaw.version();
  } catch {
    return 'unavailable';
  }
}
