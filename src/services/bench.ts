import type { PipelineParams, RawImage, Vec4 } from '../core/types';
import { makeCfaLayout } from '../core/raw/cfa';
import { createDefaultParams } from '../core/pipeline/params';
import { Renderer } from '../gpu/renderer';

export interface BenchOptions {
  width: number;
  height: number;
  algorithms?: Array<'mhc' | 'bilinear' | 'ahd'>;
  includeExport?: boolean;
}

export interface BenchRun {
  algorithm: string;
  previewMs: number;
  previewPipelineMs: number;
  fullMs: number;
  fullPipelineMs: number;
  width: number;
  height: number;
  fullScale: number;
  timings: Record<string, number>;
  vramMB: number;
}

export interface BenchResult {
  ok: boolean;
  width: number;
  height: number;
  megapixels: number;
  maxTextureSize: number;
  initMs: number;
  setRawMs: number;
  runs: BenchRun[];
  exportMs?: number;
  exported?: { width: number; height: number; scaled: boolean };
  heapMB?: number;
  limitations: string[];
}

function syntheticRaw(width: number, height: number): RawImage {
  const data = new Uint16Array(width * height);
  const cfa = makeCfaLayout('RGGB');
  const gains: Vec4 = [0.9, 1, 1, 1.15];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = cfa.siteChannels[(y & 1) * 2 + (x & 1)];
      const ramp = 0.04 + 0.9 * (x / Math.max(1, width - 1));
      const edge = x > width * 0.62 ? 0.16 : 0;
      const checker = ((x >> 5) + (y >> 5)) & 1 ? 0.04 : 0;
      const noise = ((x * 1103515245 + y * 12345) >>> 16) % 17 / 4096;
      const v = Math.min(1, Math.max(0, ramp * gains[ch] + edge + checker + noise));
      data[y * width + x] = 64 + Math.round(v * (4095 - 64));
    }
  }
  const levels = {
    black: [64, 64, 64, 64] as Vec4,
    white: [4095, 4095, 4095, 4095] as Vec4,
    source: 'user' as const,
  };
  const diagnostics = {
    requiredBytes: data.byteLength,
    actualBytes: data.byteLength,
    bytesDelta: 0,
    perChannel: [],
    cfaConsistency: 1,
    warnings: [],
    suggestions: [],
  };
  return {
    id: 'bench-raw',
    fileName: 'bench.raw',
    fileSize: data.byteLength,
    sha256: 'bench',
    kind: 'bare',
    geometry: {
      storedWidth: width,
      storedHeight: height,
      rowStrideBytes: width * 2,
      active: { x: 0, y: 0, w: width, h: height },
      bitDepth: 16,
      packing: { kind: 'unpacked', container: 'u16', endian: 'le', alignment: 'right' },
    },
    cfa,
    data,
    levels,
    wb: { asShot: [1, 1, 1, 1], source: 'none' },
    color: null,
    orientation: 1,
    decoder: { name: 'rawlab-bench', version: '0.1.0' },
    diagnostics,
    createdAt: Date.now(),
  };
}

function bump(params: PipelineParams): void {
  params.levels.black = params.levels.black.map((v: number) => v + 1) as Vec4;
}

export async function runPipelineBenchmark(options: BenchOptions): Promise<BenchResult> {
  const width = Math.max(16, Math.round(options.width));
  const height = Math.max(16, Math.round(options.height));
  const algorithms: Array<'mhc' | 'bilinear' | 'ahd'> = options.algorithms?.length ? options.algorithms : ['mhc'];
  const limitations: string[] = [
    '结果依赖 GPU/CPU 与浏览器；无头 SwiftShader 明显慢于硬件 WebGL2。',
    'AHD 为净室方向性近似实现，非 GPL 参考实现逐行移植。',
    '全分辨率导出超过 48MP 时会降采样；100MP 分块导出尚未实现。',
    '24MP 以上的全分辨率纹理与缓存可能受浏览器内存上限影响。',
  ];

  const tInit = performance.now();
  const canvas = new OffscreenCanvas(64, 64);
  const renderer = new Renderer(canvas);
  const initMs = performance.now() - tInit;

  const raw = syntheticRaw(width, height);
  const tSet = performance.now();
  renderer.setRaw(raw, null);
  const setRawMs = performance.now() - tSet;

  const params = createDefaultParams(raw);
  params.flat.bypass = true;
  params.denoise.bypass = false;
  params.denoise.method = 'guided';
  params.denoise.radius = 3;
  params.sharpen.bypass = false;
  params.sharpen.amount = 60;
  params.csc.bypass = false;

  const scale = Math.min(1600 / width, 1000 / height);
  const view = {
    canvasWidth: 1600,
    canvasHeight: 1000,
    panX: width / 2,
    panY: height / 2,
    scale: Math.max(0.01, scale),
    split: 0.5,
    flicker: 0,
    mode: 0 as const,
    diffGain: 6,
    diffSigned: false,
    falseColor: false,
    showClipping: false,
    linearDisplay: false,
    source: 'preview' as const,
  };

  const runs: BenchRun[] = [];
  for (const algorithm of algorithms) {
    params.demosaic.algorithm = algorithm;
    const measure = (kind: 'preview' | 'full'): { ms: number; pipelineMs: number; timings: Record<string, number>; width: number; height: number; scale: number } => {
      bump(params);
      const t0 = performance.now();
      const r = kind === 'preview'
        ? renderer.renderPreview(params, 'sharpen')
        : renderer.renderFull(params, 'sharpen');
      renderer.present({ ...view, source: kind });
      // Force a synchronous readback so GPU work is included in the wall time.
      if (kind === 'preview') renderer.readStage('preview', 'sharpen', { x: 0, y: 0, w: 1, h: 1 });
      else renderer.readStage('full', 'sharpen', { x: 0, y: 0, w: 1, h: 1 });
      return {
        ms: performance.now() - t0,
        pipelineMs: r.timings.totalMs,
        timings: r.timings.stages as Record<string, number>,
        width: r.result.width,
        height: r.result.height,
        scale: r.timings.scale,
      };
    };
    // Warm-up compiles shaders and allocates stage textures.
    measure('preview');
    const prev = measure('preview');
    const full = measure('full');
    runs.push({
      algorithm,
      previewMs: prev.ms,
      previewPipelineMs: prev.pipelineMs,
      fullMs: full.ms,
      fullPipelineMs: full.pipelineMs,
      width: full.width,
      height: full.height,
      fullScale: full.scale,
      timings: full.timings,
      vramMB: renderer.cacheBytes / 1048576,
    });
  }

  let exportMs: number | undefined;
  let exported: BenchResult['exported'];
  if (options.includeExport !== false) {
    const t0 = performance.now();
    const png = await renderer.exportPng(params, 8, null);
    exportMs = performance.now() - t0;
    exported = { width: png.width, height: png.height, scaled: png.scaled };
  }

  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const result: BenchResult = {
    ok: true,
    width,
    height,
    megapixels: (width * height) / 1e6,
    maxTextureSize: renderer.capabilities.maxTextureSize,
    initMs,
    setRawMs,
    runs,
    exportMs,
    exported,
    heapMB: memory ? memory.usedJSHeapSize / 1048576 : undefined,
    limitations,
  };
  renderer.dispose();
  return result;
}
