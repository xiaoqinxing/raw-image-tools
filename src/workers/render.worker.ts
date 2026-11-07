/// <reference lib="webworker" />

import type { AnalysisKind, AnalysisMeta, AnalysisResult, PipelineParams, RawImage, Rect, StageId } from '../core/types';
import { Renderer, type Viewport } from '../gpu/renderer';
import { computeHistogram } from '../core/analysis/histogram';
import { computeWaveform } from '../core/analysis/waveform';
import { computeSnr } from '../core/analysis/snr';
import { computeMtf } from '../core/analysis/mtf';
import { computeNoiseSpectrum } from '../core/analysis/noise';
import { computeDiff } from '../core/analysis/diff';
import { fitColorChecker } from '../core/colorchecker/fit';
import { effectiveCsc, paramsHash, STAGE_DOMAIN } from '../core/pipeline/params';
import { rawSampleAt } from '../core/pipeline/cpu';
import type { RenderWorkerEvent, RenderWorkerRequest, ViewStateMessage } from './protocol';

let renderer: Renderer | null = null;
let raw: RawImage | null = null;
let flat: import('../core/types').FlatField | null = null;
let lastView: ViewStateMessage = {
  canvasWidth: 1,
  canvasHeight: 1,
  panX: 0,
  panY: 0,
  scale: 1,
  split: 0.5,
  flicker: 0,
  mode: 0,
  diffGain: 4,
  diffSigned: false,
  falseColor: false,
  showClipping: false,
  source: 'preview',
};

function post(event: RenderWorkerEvent, transfer: Transferable[] = []): void {
  self.postMessage(event, transfer);
}

function toViewport(view: ViewStateMessage): Viewport {
  return {
    canvasWidth: view.canvasWidth,
    canvasHeight: view.canvasHeight,
    panX: view.panX,
    panY: view.panY,
    scale: view.scale,
    split: view.split,
    flicker: view.flicker,
    mode: view.mode,
    diffGain: view.diffGain,
    diffSigned: view.diffSigned,
    falseColor: view.falseColor,
    showClipping: view.showClipping,
    source: view.source,
  };
}

function stats() {
  if (!renderer) return null;
  return { ...renderer.previewInfo, cacheBytes: renderer.cacheBytes };
}

self.onmessage = async (event: MessageEvent<RenderWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      renderer = new Renderer(msg.canvas);
      post({ type: 'ready', capabilities: renderer.capabilities });
      return;
    }
    if (!renderer) throw new Error('Render Worker 尚未初始化');
    if (msg.type === 'loadRaw') {
      raw = msg.raw;
      flat = msg.flat ?? null;
      renderer.setRaw(raw, flat);
      return;
    }
    if (msg.type === 'setFlat') {
      flat = msg.flat;
      if (raw) renderer.setRaw(raw, flat);
      return;
    }
    if (msg.type === 'renderPreview') {
      lastView = msg.view;
      const a = renderer.renderPreview(msg.params, msg.target);
      let bTimings: typeof a.timings | undefined;
      if (msg.compare) {
        const b = renderer.renderPreviewB(msg.compare.paramsB, msg.compare.targetB);
        bTimings = b.timings;
        lastView.mode = msg.compare.mode;
      } else {
        lastView.mode = msg.view.mode;
      }
      lastView.source = 'preview';
      renderer.present(toViewport(lastView));
      post({
        type: 'rendered',
        generation: msg.generation,
        timings: a.timings,
        bTimings,
        stage: a.result.stage,
        domain: a.result.domain,
        preview: stats()!,
        width: a.result.width,
        height: a.result.height,
      });
      return;
    }
    if (msg.type === 'renderFull') {
      lastView = msg.view;
      const r = renderer.renderFull(msg.params, msg.target);
      lastView.source = 'full';
      renderer.present(toViewport(lastView));
      post({
        type: 'rendered',
        generation: msg.generation,
        timings: r.timings,
        stage: r.result.stage,
        domain: r.result.domain,
        preview: stats()!,
        width: r.result.width,
        height: r.result.height,
      });
      return;
    }
    if (msg.type === 'present') {
      lastView = msg.view;
      renderer.present(toViewport(lastView));
      return;
    }
    if (msg.type === 'readStage') {
      const pixels = renderer.readStage(msg.source, msg.stage, msg.rect);
      post({ type: 'pixels', requestId: msg.requestId, width: pixels.width, height: pixels.height, data: pixels.data, stage: msg.stage }, [pixels.data.buffer]);
      return;
    }
    if (msg.type === 'exportPng') {
      const out = await renderer.exportPng(msg.params, msg.bitDepth, msg.crop, msg.target);
      post({ type: 'exported', requestId: msg.requestId, data: out.data, width: out.width, height: out.height, scaled: out.scaled }, [out.data.buffer]);
      return;
    }
    if (msg.type === 'pickGray') {
      if (!raw) throw new Error('没有 RAW');
      const r = renderer.renderPreview(msg.params, 'flat');
      const pixels = renderer.readStage('preview', r.result.stage);
      const sx = pixels.width / raw.geometry.active.w;
      const sy = pixels.height / raw.geometry.active.h;
      const cx = msg.point.x * sx;
      const cy = msg.point.y * sy;
      const rad = Math.max(2, Math.round((msg.radius ?? 8) * Math.min(sx, sy)));
      const sums = [0, 1e-12, 1e-12, 0];
      const counts = [0, 0, 0, 0];
      for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(pixels.height, Math.ceil(cy + rad)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(pixels.width, Math.ceil(cx + rad)); x++) {
          const ch = raw.cfa.siteChannels[(y & 1) * 2 + (x & 1)];
          sums[ch] += pixels.data[(y * pixels.width + x) * 4];
          counts[ch]++;
        }
      }
      const means = sums.map((s, i) => (counts[i] ? s / counts[i] : 0)) as import('../core/types').Vec4;
      const g = (means[1] + means[2]) / 2;
      if (!(g > 0)) throw new Error('灰点区域没有有效信号');
      const mult: import('../core/types').Vec4 = [
        means[0] > 0 ? g / means[0] : 1,
        1,
        1,
        means[3] > 0 ? g / means[3] : 1,
      ];
      post({ type: 'grayPicked', requestId: msg.requestId, multipliers: mult, means, stage: r.result.stage });
      return;
    }
    if (msg.type === 'analyze') {
      if (!raw) throw new Error('没有 RAW');
      const started = performance.now();
      const target = msg.stage;
      const r = renderer.renderPreview(msg.params, target);
      const stage = r.result.stage;
      const domain = r.result.domain;
      const pixels = renderer.readStage('preview', stage);
      const fullW = raw.geometry.active.w;
      const fullH = raw.geometry.active.h;
      const sx = pixels.width / fullW;
      const sy = pixels.height / fullH;
      const metaFor = (warnings: string[] = [], roi: Rect | null = msg.roi ?? null): AnalysisMeta => ({
        imageId: raw!.id,
        stage,
        stageDomain: domain,
        roi,
        paramsHash: paramsHash(msg.params),
        createdAt: Date.now(),
        durationMs: performance.now() - started,
        warnings,
      });
      let result: AnalysisResult;
      if (msg.kind === 'histogram') {
        const h = computeHistogram({
          width: pixels.width,
          height: pixels.height,
          data: pixels.data,
          bins: (msg.options?.bins === 1024 ? 1024 : 256) as 256 | 1024,
          domain,
          cfa: domain === 'raw-cfa' ? raw!.cfa : undefined,
        });
        result = { ...h, ...metaFor() } as AnalysisResult;
      } else if (msg.kind === 'waveform') {
        const w = computeWaveform({
          width: pixels.width,
          height: pixels.height,
          data: pixels.data,
          domain,
          cfa: domain === 'raw-cfa' ? raw!.cfa : undefined,
          mode: msg.options?.mode === 'parade' ? 'parade' : 'luma',
          scale: msg.options?.scale === 'linear' ? 'linear' : 'gamma',
        });
        result = { ...w, ...metaFor() } as AnalysisResult;
      } else if (msg.kind === 'snr') {
        const roi = msg.roi ?? { x: Math.floor(fullW * 0.4), y: Math.floor(fullH * 0.4), w: Math.floor(fullW * 0.2), h: Math.floor(fullH * 0.2) };
        const s = computeSnr({
          width: pixels.width,
          height: pixels.height,
          data: pixels.data,
          rect: { x: roi.x * sx, y: roi.y * sy, w: roi.w * sx, h: roi.h * sy },
          domain,
          cfa: domain === 'raw-cfa' ? raw!.cfa : undefined,
        });
        result = { ...s, ...metaFor([], roi) } as AnalysisResult;
      } else if (msg.kind === 'mtf') {
        const roi = msg.roi ?? { x: Math.floor(fullW * 0.35), y: Math.floor(fullH * 0.35), w: Math.floor(fullW * 0.3), h: Math.floor(fullH * 0.3) };
        if (domain === 'raw-cfa') throw new Error('MTF 需要去马赛克后的 RGB 阶段');
        const m = computeMtf({
          width: pixels.width,
          height: pixels.height,
          data: pixels.data,
          rect: { x: roi.x * sx, y: roi.y * sy, w: roi.w * sx, h: roi.h * sy },
          domain: domain as 'camera-rgb' | 'linear-srgb' | 'display-srgb',
        });
        const { warnings, ...rest } = m;
        result = { ...rest, ...metaFor(warnings, roi) } as AnalysisResult;
      } else if (msg.kind === 'noise') {
        const roi = msg.roi ?? { x: Math.floor(fullW * 0.35), y: Math.floor(fullH * 0.35), w: Math.min(512, Math.floor(fullW * 0.3)), h: Math.min(512, Math.floor(fullH * 0.3)) };
        if (domain === 'raw-cfa') throw new Error('噪声频谱需要去马赛克后的 RGB 阶段');
        const n = computeNoiseSpectrum({
          width: pixels.width,
          height: pixels.height,
          data: pixels.data,
          rect: { x: roi.x * sx, y: roi.y * sy, w: roi.w * sx, h: roi.h * sy },
          domain: domain as 'camera-rgb' | 'linear-srgb' | 'display-srgb',
          channel: (msg.options?.channel === 0 || msg.options?.channel === 1 || msg.options?.channel === 2 || msg.options?.channel === 3 ? msg.options.channel : 3) as 0 | 1 | 2 | 3,
        });
        result = { ...n, ...metaFor([], roi) } as AnalysisResult;
      } else if (msg.kind === 'probe') {
        const pts = Array.isArray(msg.options?.points) ? msg.options.points as Array<{ id: string; x: number; y: number }> : [];
        const points = pts.map((pt) => {
          const px = Math.max(0, Math.min(pixels.width - 1, Math.round(pt.x * sx)));
          const py = Math.max(0, Math.min(pixels.height - 1, Math.round(pt.y * sy)));
          const i = (py * pixels.width + px) * 4;
          const rs = rawSampleAt(raw!, pt.x, pt.y);
          return {
            id: pt.id,
            x: pt.x,
            y: pt.y,
            rawCfa: { channel: raw!.cfa.sites[(pt.y & 1) * 2 + (pt.x & 1)], dn: rs.dn, normalized: rs.normalized },
            stageRgb: [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]] as [number, number, number],
            wbMultipliers: msg.params.wb.multipliers,
          };
        });
        result = { kind: 'probe', points, ...metaFor([], msg.roi ?? null) } as AnalysisResult;
      } else if (msg.kind === 'diff') {
        const paramsB = msg.options?.paramsB as PipelineParams | undefined;
        if (!paramsB) throw new Error('差异分析缺少 B 参数');
        const targetB = (msg.options?.targetB as StageId | undefined) ?? stage;
        const aPixels = pixels;
        const bR = renderer.renderPreviewB(paramsB, targetB);
        const bPixels = renderer.readPreviewB(bR.result.stage);
        if (aPixels.width !== bPixels.width || aPixels.height !== bPixels.height) throw new Error('差异图尺寸不一致');
        const diff = computeDiff({
          width: aPixels.width,
          height: aPixels.height,
          a: aPixels.data,
          b: bPixels.data,
          domain,
          domainB: bR.result.domain,
          gain: Number(msg.options?.gain ?? 6),
          signed: !!msg.options?.signed,
        });
        diff.a = { imageId: raw!.id, stage };
        diff.b = { imageId: raw!.id, stage: bR.result.stage };
        result = { ...diff, ...metaFor([], msg.roi ?? null) } as AnalysisResult;
        renderer.present({ ...lastView, source: 'preview', mode: 0 });
      } else if (msg.kind === 'colorchecker') {
        const cornersNorm = msg.options?.corners as Array<{ x: number; y: number }> | undefined;
        if (!cornersNorm || cornersNorm.length !== 4) throw new Error('ColorChecker 需要四个角点');
        const corners = cornersNorm.map((p) => ({ x: p.x * pixels.width, y: p.y * pixels.height })) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
        const fit = fitColorChecker({
          pixels: pixels.data,
          width: pixels.width,
          height: pixels.height,
          corners,
          csc: effectiveCsc(msg.params),
          referenceId: msg.options?.referenceId as string | undefined,
          inset: msg.options?.inset as number | undefined,
        });
        const { warnings, ...rest } = fit;
        result = { ...rest, ...metaFor(warnings, null) } as AnalysisResult;
      } else {
        throw new Error(`未实现的分析类型：${msg.kind}`);
      }
      post({ type: 'analysis', requestId: msg.requestId, result });
      return;
    }
    if (msg.type === 'dispose') {
      renderer.dispose();
      renderer = null;
      raw = null;
      return;
    }
  } catch (e) {
    const err = e as Error;
    post({ type: 'error', requestId: 'requestId' in msg ? (msg as { requestId?: string }).requestId : undefined, message: err.message, stack: err.stack });
  }
};

export {};
