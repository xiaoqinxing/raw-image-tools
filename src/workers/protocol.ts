export interface ViewStateMessage {
  canvasWidth: number;
  canvasHeight: number;
  panX: number;
  panY: number;
  scale: number;
  split: number;
  flicker: number;
  mode: 0 | 1 | 2 | 3;
  diffGain: number;
  diffSigned: boolean;
  falseColor: boolean;
  showClipping: boolean;
  source: 'preview' | 'full';
}

export interface CompareRequest {
  paramsB: import('../core/types').PipelineParams;
  targetB: import('../core/types').StageId;
  mode: 1 | 2 | 3;
}

export type RenderWorkerRequest =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'loadRaw'; raw: import('../core/types').RawImage; flat?: import('../core/types').FlatField | null }
  | { type: 'setFlat'; flat: import('../core/types').FlatField | null }
  | {
      type: 'renderPreview';
      generation: number;
      params: import('../core/types').PipelineParams;
      target: import('../core/types').StageId;
      view: ViewStateMessage;
      compare?: CompareRequest | null;
    }
  | { type: 'renderFull'; generation: number; params: import('../core/types').PipelineParams; target: import('../core/types').StageId; view: ViewStateMessage }
  | { type: 'present'; view: ViewStateMessage }
  | { type: 'readStage'; requestId: string; source: 'preview' | 'full'; stage: import('../core/types').StageId; rect?: { x: number; y: number; w: number; h: number } }
  | { type: 'exportPng'; requestId: string; params: import('../core/types').PipelineParams; bitDepth: 8 | 16; crop: { x: number; y: number; w: number; h: number } | null; target: import('../core/types').StageId }
  | { type: 'pickGray'; requestId: string; params: import('../core/types').PipelineParams; point: { x: number; y: number }; radius?: number }
  | {
      type: 'analyze';
      requestId: string;
      params: import('../core/types').PipelineParams;
      stage: import('../core/types').StageId;
      kind: import('../core/types').AnalysisKind;
      roi?: import('../core/types').Rect | null;
      options?: Record<string, unknown>;
    }
  | { type: 'dispose' };

export type RenderWorkerEvent =
  | { type: 'ready'; capabilities: { maxTextureSize: number } }
  | {
      type: 'rendered';
      generation: number;
      timings: import('../gpu/renderer').RenderTimings;
      bTimings?: import('../gpu/renderer').RenderTimings;
      stage: import('../core/types').StageId;
      domain: import('../core/types').Domain;
      preview: { factor: number; width: number; height: number; fullFactor: number; fullWidth: number; fullHeight: number; cacheBytes: number };
      width: number;
      height: number;
    }
  | { type: 'pixels'; requestId: string; width: number; height: number; data: Float32Array; stage: import('../core/types').StageId }
  | { type: 'exported'; requestId: string; data: Uint8Array; width: number; height: number; scaled: boolean }
  | { type: 'analysis'; requestId: string; result: import('../core/types').AnalysisResult }
  | { type: 'grayPicked'; requestId: string; multipliers: import('../core/types').Vec4; means: import('../core/types').Vec4; stage: import('../core/types').StageId }
  | { type: 'error'; requestId?: string; message: string; stack?: string };
