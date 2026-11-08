import type { FlatField, PipelineParams, RawImage, StageId } from '../core/types';
import type { CompareRequest, RenderWorkerEvent, RenderWorkerRequest, ViewStateMessage } from '../workers/protocol';

export interface SessionCallbacks {
  onRendered: (event: Extract<RenderWorkerEvent, { type: 'rendered' }>) => void;
  onError: (message: string) => void;
}

export function stripRaw(raw: RawImage): RawImage {
  return { ...raw, data: new Uint16Array(0) };
}

export function stripFlat(flat: FlatField): FlatField {
  return { ...flat, raw: stripRaw(flat.raw), gainPreview: undefined };
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class ImageSession {
  readonly id: string;
  readonly canvas: HTMLCanvasElement;
  rawMeta: RawImage | null = null;
  flatMeta: FlatField | null = null;
  private worker: Worker;
  private ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;
  private generation = 0;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private callbacks: SessionCallbacks;

  constructor(id: string, canvas: HTMLCanvasElement, callbacks: SessionCallbacks) {
    this.id = id;
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<RenderWorkerEvent>) => this.onMessage(e.data);
    this.worker.onerror = (e) => {
      this.callbacks.onError(`渲染 Worker 错误：${e.message}`);
      this.rejectReady(new Error(e.message));
    };
    const offscreen = canvas.transferControlToOffscreen();
    this.worker.postMessage({ type: 'init', canvas: offscreen } satisfies RenderWorkerRequest, [offscreen]);
  }

  private onMessage(msg: RenderWorkerEvent): void {
    if (msg.type === 'ready') {
      this.resolveReady();
      return;
    }
    if (msg.type === 'rendered') {
      this.callbacks.onRendered(msg);
      return;
    }
    if (msg.type === 'error') {
      if (msg.requestId) {
        const p = this.pending.get(msg.requestId);
        if (p) {
          this.pending.delete(msg.requestId);
          p.reject(new Error(msg.message));
          return;
        }
      }
      this.callbacks.onError(msg.message);
      return;
    }
    if (msg.type === 'pixels' || msg.type === 'exported' || msg.type === 'analysis' || msg.type === 'grayPicked' || msg.type === 'probePixel') {
      const p = this.pending.get(msg.requestId);
      if (p) {
        this.pending.delete(msg.requestId);
        p.resolve(msg.type === 'analysis' ? msg.result : msg.type === 'probePixel' ? msg.sample : msg);
      }
    }
  }

  private async post(msg: RenderWorkerRequest, transfer: Transferable[] = []): Promise<void> {
    await this.ready;
    this.worker.postMessage(msg, transfer);
  }

  async loadRaw(raw: RawImage, flat: FlatField | null): Promise<void> {
    this.rawMeta = stripRaw(raw);
    this.flatMeta = flat ? stripFlat(flat) : null;
    const transfer: Transferable[] = [];
    if (raw.data?.buffer) transfer.push(raw.data.buffer);
    if (flat?.raw.data?.buffer) transfer.push(flat.raw.data.buffer);
    await this.post({ type: 'loadRaw', raw, flat }, transfer);
  }

  async setFlat(flat: FlatField | null): Promise<void> {
    this.flatMeta = flat ? stripFlat(flat) : null;
    const transfer: Transferable[] = [];
    if (flat?.raw.data?.buffer) transfer.push(flat.raw.data.buffer);
    await this.post({ type: 'setFlat', flat }, transfer);
  }

  async renderPreview(
    params: PipelineParams,
    target: StageId,
    view: ViewStateMessage,
    compare?: CompareRequest | null,
  ): Promise<number> {
    const generation = ++this.generation;
    await this.post({ type: 'renderPreview', generation, params, target, view, compare });
    return generation;
  }

  async renderFull(params: PipelineParams, target: StageId, view: ViewStateMessage): Promise<number> {
    const generation = ++this.generation;
    await this.post({ type: 'renderFull', generation, params, target, view });
    return generation;
  }

  async present(view: ViewStateMessage): Promise<void> {
    await this.post({ type: 'present', view });
  }

  async readStage(
    source: 'preview' | 'full',
    stage: StageId,
    rect?: { x: number; y: number; w: number; h: number },
  ): Promise<{ width: number; height: number; data: Float32Array; stage: StageId }> {
    const requestId = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ type: 'readStage', requestId, source, stage, rect }).catch(reject);
    }) as Promise<{ width: number; height: number; data: Float32Array; stage: StageId }>;
  }

  async exportPng(
    params: PipelineParams,
    bitDepth: 8 | 16,
    crop: { x: number; y: number; w: number; h: number } | null,
    target: StageId,
  ): Promise<{ data: Uint8Array; width: number; height: number; scaled: boolean }> {
    const requestId = `e${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ type: 'exportPng', requestId, params, bitDepth, crop, target }).catch(reject);
    }) as Promise<{ data: Uint8Array; width: number; height: number; scaled: boolean }>;
  }

  async pickGray(params: PipelineParams, point: { x: number; y: number }, radius = 8): Promise<{ multipliers: import('../core/types').Vec4; means: import('../core/types').Vec4; stage: StageId }> {
    const requestId = `g${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ type: 'pickGray', requestId, params, point, radius }).catch(reject);
    }) as Promise<{ multipliers: import('../core/types').Vec4; means: import('../core/types').Vec4; stage: StageId }>;
  }

  async probePixel(params: PipelineParams, point: { x: number; y: number }, linearView = false): Promise<import('../core/types').ProbeSample | null> {
    const requestId = `s${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ type: 'probePixel', requestId, x: point.x, y: point.y, params, linearView }).catch(reject);
    }) as Promise<import('../core/types').ProbeSample | null>;
  }

  async analyze(
    params: PipelineParams,
    stage: StageId,
    kind: import('../core/types').AnalysisKind,
    roi?: import('../core/types').Rect | null,
    options?: Record<string, unknown>,
  ): Promise<import('../core/types').AnalysisResult> {
    const requestId = `a${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ type: 'analyze', requestId, params, stage, kind, roi, options }).catch(reject);
    }) as Promise<import('../core/types').AnalysisResult>;
  }

  async destroy(): Promise<void> {
    try {
      await this.post({ type: 'dispose' });
    } catch {
      // ignore
    }
    this.worker.terminate();
    this.pending.clear();
  }
}
