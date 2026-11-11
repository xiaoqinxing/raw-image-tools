import type {
  AnalysisKind,
  BareRawConfig,
  FlatField,
  PipelineParams,
  PipelineSnapshot,
  Point,
  Preset,
  ProbeSample,
  ProjectFile,
  ProjectImage,
  FlatFileRef,
  RawImage,
  Rect,
  StageId,
} from '../core/types';
import { createDefaultParams, bypassStage, toPresetParams, fromPresetParams, paramsHash, linearPreviewFor, migrateParams } from '../core/pipeline/params';
import { getReference } from '../core/color/colorchecker-data';
import { defaultColorCheckerSettings, normalizeColorCheckerSettings } from '../core/colorchecker/settings';
import { decodeService, DecodeError } from './decode';
import { ImageSession, stripFlat, stripRaw } from './session';
import { useStore, type ImageDoc, type Viewport } from '../state/store';
import { idbGet, idbGetAll, idbPut, idbDelete } from '../lib/idb';

const sessions = new Map<string, ImageSession>();
/** Last posted preview request per document; identical requests are coalesced. */
const lastRenderSig = new Map<string, string>();
/** Monotonic request id per document+analysis, so stale results cannot win. */
const analysisSeq = new Map<string, number>();

/** Older projects stored one ROI per analysis; collapse them to the shared ROI. */
function legacyRoi(rois?: Partial<Record<AnalysisKind, Rect>>): Rect | null {
  if (!rois) return null;
  return rois.snr ?? rois.mtf ?? rois.noise ?? null;
}

function clearRenderSig(id: string): void {
  lastRenderSig.delete(id);
}

function toast(message: string) {
  useStore.getState().setToast(message);
  window.setTimeout(() => {
    if (useStore.getState().toast === message) useStore.getState().setToast(null);
  }, 5000);
}

export function getSession(id: string): ImageSession | null {
  return sessions.get(id) ?? null;
}

function computeView(doc: ImageDoc, viewport: Viewport): {
  canvasWidth: number;
  canvasHeight: number;
  panX: number;
  panY: number;
  scale: number;
} {
  const imgW = doc.meta.geometry.active.w;
  const imgH = doc.meta.geometry.active.h;
  const dpr = viewport.dpr || 1;
  const cssW = Math.max(2, viewport.width);
  const cssH = Math.max(2, viewport.height);
  const fit = Math.min(cssW / imgW, cssH / imgH) * 0.96;
  const scaleCss = Math.max(1e-6, fit * doc.view.zoom);
  return {
    canvasWidth: Math.round(cssW * dpr),
    canvasHeight: Math.round(cssH * dpr),
    panX: doc.view.panX,
    panY: doc.view.panY,
    scale: scaleCss * dpr,
  };
}

export function viewState(doc: ImageDoc, viewport: Viewport, source: 'preview' | 'full' = doc.source): import('../workers/protocol').ViewStateMessage {
  const v = computeView(doc, viewport);
  return {
    ...v,
    split: useStore.getState().split,
    flicker: 0,
    mode: useStore.getState().diffMode ? 2 : 0,
    diffGain: 6,
    diffSigned: false,
    falseColor: useStore.getState().falseColor,
    showClipping: useStore.getState().showClipping,
    linearDisplay: linearPreviewFor(doc.params, useStore.getState().selectedStage),
    source,
  };
}

function handleRendered(id: string, event: Extract<import('../workers/protocol').RenderWorkerEvent, { type: 'rendered' }>) {
  const store = useStore.getState();
  const doc = store.docs[id];
  if (!doc) return;
  if (event.generation < doc.generation) return;
  store.updateDoc(id, {
    generation: event.generation,
    stage: event.stage,
    domain: event.domain,
    stats: {
      timings: event.timings,
      cacheBytes: event.preview.cacheBytes,
      vramBytes: event.preview.cacheBytes,
      previewLongEdge: Math.max(event.preview.width, event.preview.height),
      fullRes: { width: event.preview.fullWidth, height: event.preview.fullHeight },
    },
  });
  if (store.selectedStage !== 'sharpen' && event.stage !== store.selectedStage) {
    // The renderer reports the last active stage when the selected one was
    // bypassed. Keep the UI honest but don't overwrite the user's selection.
  }
}

async function createSessionForRaw(raw: RawImage, flat: FlatField | null): Promise<ImageSession> {
  const canvas = document.createElement('canvas');
  const session = new ImageSession(raw.id, canvas, {
    onRendered: (event) => handleRendered(raw.id, event),
    onError: (message) => toast(message),
  });
  sessions.set(raw.id, session);
  await session.loadRaw(raw, flat);
  clearRenderSig(raw.id);
  return session;
}

function makeDoc(raw: RawImage, decodeMs: number, flat: FlatField | null = null): ImageDoc {
  const meta = stripRaw(raw);
  const params = createDefaultParams(raw);
  const fit = raw.color;
  if (flat) {
    params.flat.bypass = false;
    params.flat.flatId = flat.id;
  }
  return {
    id: raw.id,
    fileName: raw.fileName,
    fileSize: raw.fileSize,
    sha256: raw.sha256,
    kind: raw.kind,
    meta,
    params,
    snapshots: [],
    flat: flat ? stripFlat(flat) : null,
    colorChecker: {
      corners: null,
      referenceId: 'classic24-pre2014-d65',
    },
    colorCheckerSettings: defaultColorCheckerSettings(),
    decodeMs,
    status: 'ready',
    generation: 0,
    stage: 'sharpen',
    domain: 'display-srgb',
    stats: null,
    analysis: {},
    probes: [],
    roi: null,
    view: {
      zoom: 1,
      panX: meta.geometry.active.w / 2,
      panY: meta.geometry.active.h / 2,
    },
    source: 'preview',
  };
}

export async function importDng(file: File): Promise<string | null> {
  const store = useStore.getState();
  store.setBusy(true, '正在解码 DNG…');
  try {
    const { raw, decodeMs } = await decodeService.decodeDng(file);
    await createSessionForRaw(raw, null);
    store.addDoc(makeDoc(raw, decodeMs));
    store.setBusy(false);
    toast(`DNG 解码完成：${raw.geometry.active.w}×${raw.geometry.active.h}，${decodeMs.toFixed(0)} ms`);
    renderActive();
    return null;
  } catch (e) {
    store.setBusy(false);
    const err = e as DecodeError;
    const msg = `${err.message}${err.code ? ` [${err.code}]` : ''}`;
    toast(msg);
    return msg;
  }
}

export async function importBare(file: File, config: BareRawConfig): Promise<string | null> {
  const store = useStore.getState();
  store.setBusy(true, '正在解包裸 RAW…');
  try {
    const { raw, decodeMs } = await decodeService.decodeBare(file, config);
    await createSessionForRaw(raw, null);
    const doc = makeDoc(raw, decodeMs);
    doc.bareConfig = config;
    store.addDoc(doc);
    store.setBusy(false);
    toast(`裸 RAW 解码完成：${raw.geometry.active.w}×${raw.geometry.active.h}，${decodeMs.toFixed(0)} ms`);
    renderActive();
    return null;
  } catch (e) {
    store.setBusy(false);
    const err = e as DecodeError;
    const msg = `${err.message}${err.code ? ` [${err.code}]` : ''}`;
    toast(msg);
    return msg;
  }
}

function flatCompatible(doc: ImageDoc, flat: FlatField): string | null {
  const a = doc.meta.geometry;
  const b = flat.raw.geometry;
  if (a.active.w !== b.active.w || a.active.h !== b.active.h) return '平场与主图的有效尺寸不一致';
  if (doc.meta.cfa.sites.join(',') !== flat.raw.cfa.sites.join(',')) return '平场与主图的 CFA 排列不一致';
  if (doc.meta.geometry.bitDepth !== flat.raw.geometry.bitDepth) return '平场与主图的位宽不一致';
  return null;
}

export async function attachFlat(file: File, isDng: boolean, config?: BareRawConfig): Promise<void> {
  const store = useStore.getState();
  const doc = store.activeId ? store.docs[store.activeId] : null;
  if (!doc) {
    toast('请先导入主图');
    return;
  }
  const session = sessions.get(doc.id);
  if (!session) {
    toast('当前图像尚未建立渲染会话');
    return;
  }
  store.setBusy(true, '正在解码平场…');
  try {
    const { flat } = isDng
      ? await decodeService.decodeFlatDng(file)
      : await decodeService.decodeFlatBare(file, config!);
    const mismatch = flatCompatible(doc, flat);
    if (mismatch) throw new Error(mismatch);
    await session.setFlat(flat);
    clearRenderSig(doc.id);
    store.updateDoc(doc.id, {
      flat: stripFlat(flat),
      params: {
        ...doc.params,
        flat: { ...doc.params.flat, bypass: false, flatId: flat.id },
      },
    });
    store.setBusy(false);
    toast(`平场已加载：${flat.stats.means.map((v) => v.toFixed(3)).join(' / ')}`);
    renderActive();
  } catch (e) {
    store.setBusy(false);
    toast(e instanceof Error ? e.message : String(e));
  }
}

export function comparePaneIds(state: {
  activeId: string | null;
  compareId: string | null;
  compareLayout: 'two-h' | 'two-v' | 'quad';
  order: string[];
}): string[] {
  if (!state.activeId) return [];
  const count = state.compareLayout === 'quad' ? 4 : 2;
  const ids = [state.activeId];
  if (state.compareId && state.compareId !== state.activeId) ids.push(state.compareId);
  for (const id of state.order) {
    if (ids.length >= count) break;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, count);
}

export function renderCompare(viewports: Record<string, Viewport>): void {
  const state = useStore.getState();
  const active = state.activeId ? state.docs[state.activeId] : null;
  if (!active) return;
  const ids = comparePaneIds(state);
  for (const id of ids) {
    const d = state.docs[id];
    const vp = viewports[id];
    if (!d || !vp || vp.width < 2 || vp.height < 2) continue;
    const view = { zoom: active.view.zoom, panX: active.view.panX, panY: active.view.panY };
    if (d.view.zoom !== view.zoom || d.view.panX !== view.panX || d.view.panY !== view.panY) {
      state.setView(id, view);
    }
    const session = sessions.get(id);
    if (!session) continue;
    const synced = { ...d, view: { ...d.view, ...view } };
    session
      .renderPreview(d.params, state.selectedStage, viewState(synced, vp, 'preview'))
      .catch((e) => toast(e instanceof Error ? e.message : String(e)));
  }
}

export function renderActive(): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const session = sessions.get(doc.id);
  if (!session) return;
  const viewport = state.viewport;
  if (viewport.width < 2 || viewport.height < 2) return;
  const view = viewState(doc, viewport, 'preview');
  let compare: import('../workers/protocol').CompareRequest | null = null;
  if (state.abMode === 'stage') {
    const b = bypassStage(doc.params, state.selectedStage);
    const mode = state.flicker ? 3 : state.diffMode ? 2 : 1;
    compare = { paramsB: b, targetB: state.selectedStage, mode };
  } else if (state.abMode === 'snapshot') {
    const snap = state.abSnapshotId ? doc.snapshots.find((s) => s.id === state.abSnapshotId) : null;
    if (snap) {
      const mode = state.flicker ? 3 : state.diffMode ? 2 : 1;
      compare = { paramsB: migrateParams(snap.params), targetB: state.selectedStage, mode };
    }
  }
  if (state.diffMode && !compare) {
    // Diff against bypassed current stage by default.
    const b = bypassStage(doc.params, state.selectedStage);
    compare = { paramsB: b, targetB: state.selectedStage, mode: 2 };
  }
  const signature = JSON.stringify({
    params: paramsHash(doc.params),
    target: state.selectedStage,
    source: doc.source,
    view,
    compare: compare ? [paramsHash(compare.paramsB), compare.targetB, compare.mode] : null,
  });
  if (lastRenderSig.get(doc.id) === signature) return;
  lastRenderSig.set(doc.id, signature);
  const generationPromise = session.renderPreview(doc.params, state.selectedStage, view, compare);
  state.updateDoc(doc.id, { source: 'preview' });
  generationPromise.then((generation) => {
    const current = useStore.getState().docs[doc.id];
    if (current) useStore.getState().updateDoc(doc.id, { generation });
  }).catch((e) => {
    lastRenderSig.delete(doc.id);
    toast(e instanceof Error ? e.message : String(e));
  });
}

export async function renderFull(): Promise<void> {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const session = sessions.get(doc.id);
  if (!session) return;
  const view = viewState(doc, state.viewport, 'full');
  state.setBusy(true, '正在渲染全分辨率…');
  try {
    const generation = await session.renderFull(doc.params, state.selectedStage, view);
    state.updateDoc(doc.id, { source: 'full', generation });
    clearRenderSig(doc.id);
    state.setBusy(false);
    const current = useStore.getState().docs[doc.id];
    if (current?.stats) {
      state.updateDoc(doc.id, { source: 'full' });
    }
  } catch (e) {
    state.setBusy(false);
    toast(e instanceof Error ? e.message : String(e));
  }
}

export function presentActive(): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const session = sessions.get(doc.id);
  if (!session) return;
  const view = viewState(doc, state.viewport, doc.source);
  if (state.flicker && (state.abMode !== 'off' || state.diffMode)) {
    const t = performance.now();
    view.mode = 3;
    view.flicker = Math.floor(t / 200) % 2;
    session.present(view);
    window.setTimeout(() => presentActive(), 200);
  } else {
    session.present(view);
  }
}

export function setViewport(viewport: Viewport): void {
  const state = useStore.getState();
  const prev = state.viewport;
  if (prev.width === viewport.width && prev.height === viewport.height && prev.dpr === viewport.dpr) return;
  state.setViewport(viewport);
  renderActive();
}

export function fitView(): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  state.setView(doc.id, {
    zoom: 1,
    panX: doc.meta.geometry.active.w / 2,
    panY: doc.meta.geometry.active.h / 2,
  });
  renderActive();
}

export function zoomAt(cssX: number, cssY: number, deltaY: number): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const vp = state.viewport;
  const imgW = doc.meta.geometry.active.w;
  const imgH = doc.meta.geometry.active.h;
  const fit = Math.min(vp.width / imgW, vp.height / imgH) * 0.96;
  const oldScale = fit * doc.view.zoom;
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const ix = doc.view.panX + (cssX - cx) / oldScale;
  const iy = doc.view.panY + (cssY - cy) / oldScale;
  const factor = Math.exp(-deltaY * 0.0015);
  const zoom = Math.max(0.1, Math.min(32, doc.view.zoom * factor));
  const newScale = fit * zoom;
  const panX = ix - (cssX - cx) / newScale;
  const panY = iy - (cssY - cy) / newScale;
  state.setView(doc.id, { zoom, panX, panY });
  presentActive();
}

export function panBy(dxCss: number, dyCss: number): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const vp = state.viewport;
  const fit = Math.min(vp.width / doc.meta.geometry.active.w, vp.height / doc.meta.geometry.active.h) * 0.96;
  const scale = fit * doc.view.zoom;
  state.setView(doc.id, {
    panX: doc.view.panX - dxCss / scale,
    panY: doc.view.panY - dyCss / scale,
  });
  presentActive();
}

export function cssToImage(doc: ImageDoc, viewport: Viewport, cssX: number, cssY: number): Point {
  const imgW = doc.meta.geometry.active.w;
  const imgH = doc.meta.geometry.active.h;
  const fit = Math.min(viewport.width / imgW, viewport.height / imgH) * 0.96;
  const scale = fit * doc.view.zoom;
  return {
    x: doc.view.panX + (cssX - viewport.width / 2) / scale,
    y: doc.view.panY + (cssY - viewport.height / 2) / scale,
  };
}

export function imageToCss(doc: ImageDoc, viewport: Viewport, x: number, y: number): Point {
  const imgW = doc.meta.geometry.active.w;
  const imgH = doc.meta.geometry.active.h;
  const fit = Math.min(viewport.width / imgW, viewport.height / imgH) * 0.96;
  const scale = fit * doc.view.zoom;
  return {
    x: viewport.width / 2 + (x - doc.view.panX) * scale,
    y: viewport.height / 2 + (y - doc.view.panY) * scale,
  };
}

export async function analyze(kind: AnalysisKind, options?: Record<string, unknown>): Promise<void> {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const session = sessions.get(doc.id);
  if (!session) return;
  const stage = state.analysisStage;
  const roi = kind === 'colorchecker' ? null : doc.roi ?? null;
  const seqKey = `${doc.id}:${kind}`;
  const seq = (analysisSeq.get(seqKey) ?? 0) + 1;
  analysisSeq.set(seqKey, seq);
  state.setAnalysisBusy(true);
  try {
    let extra = options ?? {};
    if (kind === 'diff') {
      let paramsB = bypassStage(doc.params, stage);
      let targetB: StageId = stage;
      if (state.abMode === 'snapshot' && state.abSnapshotId) {
        const snap = doc.snapshots.find((s) => s.id === state.abSnapshotId);
        if (snap) paramsB = migrateParams(snap.params);
      }
      extra = { ...extra, paramsB, targetB, gain: 6, signed: false };
    }
    const result = await session.analyze(doc.params, stage, kind, roi, {
      ...extra,
      bins: 1024,
    });
    if (analysisSeq.get(seqKey) !== seq) return;
    state.setAnalysis(doc.id, result);
    state.setAnalysisBusy(false);
  } catch (e) {
    if (analysisSeq.get(seqKey) !== seq) return;
    state.setAnalysisBusy(false);
    toast(e instanceof Error ? e.message : String(e));
  }
}

/** Read the pixel currently displayed under the cursor. */
export async function probeAt(docId: string, point: Point): Promise<ProbeSample | null> {
  const state = useStore.getState();
  const doc = state.docs[docId];
  const session = sessions.get(docId);
  if (!doc || !session) return null;
  return session.probePixel(doc.params, point, linearPreviewFor(doc.params, state.selectedStage));
}

export async function fitColorChecker(): Promise<void> {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const session = sessions.get(doc.id);
  if (!session) return;
  const corners = doc.colorChecker.corners;
  if (!corners) {
    toast('请先在图像上点选色卡四角');
    return;
  }
  const settings = normalizeColorCheckerSettings(doc.colorCheckerSettings);
  const normalized = corners.map((p) => ({
    x: p.x / doc.meta.geometry.active.w,
    y: p.y / doc.meta.geometry.active.h,
  }));
  state.setAnalysisBusy(true);
  let params = doc.params;
  let wb: import('../core/types').ColorCheckerWbResult | undefined;
  const extraWarnings: string[] = [];
  try {
    if (settings.autoWb) {
      try {
        wb = await session.computeChartWb(params, normalized, settings.inset);
        params = structuredClone(params);
        params.wb = {
          ...params.wb,
          bypass: false,
          mode: 'custom',
          multipliers: wb.multipliers,
          pick: null,
        };
        state.setParams(doc.id, params);
        renderActive();
        extraWarnings.push(...wb.warnings);
      } catch (e) {
        extraWarnings.push(`未按色卡中性块校正 WB：${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (params.wb.bypass) {
      extraWarnings.push('白平衡处于 Bypass；拟合结果只对当前未校正的相机 RGB 有效。');
    }
    const result = await session.analyze(params, 'denoise', 'colorchecker', null, {
      corners: normalized,
      referenceId: doc.colorChecker.referenceId,
      inset: settings.inset,
      weights: settings.weights,
      target: settings.target,
      objective: settings.objective,
    });
    if (result.kind !== 'colorchecker') throw new Error('拟合返回类型错误');
    result.wb = wb;
    if (extraWarnings.length) result.warnings = [...extraWarnings, ...result.warnings];
    state.setAnalysis(doc.id, result);
    state.setColorChecker(doc.id, { ...doc.colorChecker, fit: result });
    state.setAnalysisBusy(false);
    const targetAdjusted = Math.abs(settings.target.saturation - 100) > 1e-9 || Math.abs(settings.target.hue) > 1e-9;
    const decimals = (v: number | undefined) => (typeof v === 'number' ? v.toFixed(2) : '—');
    toast(targetAdjusted
      ? `CCM 拟合完成：目标 mean ΔE00 ${decimals(result.weightedMeanDE00)}，标准 mean ${decimals(result.meanDE00Standard)}`
      : `CCM 拟合完成：mean ΔE00 ${result.meanDE00.toFixed(2)}，max ${result.maxDE00.toFixed(2)}`);
  } catch (e) {
    state.setAnalysisBusy(false);
    toast(e instanceof Error ? e.message : String(e));
  }
}

/** Apply the four bottom-row neutral patches as the white balance for the document. */
export async function applyChartWb(): Promise<void> {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const session = sessions.get(doc.id);
  if (!session) return;
  const corners = doc.colorChecker.corners;
  if (!corners) {
    toast('请先在图像上点选色卡四角');
    return;
  }
  const normalized = corners.map((p) => ({
    x: p.x / doc.meta.geometry.active.w,
    y: p.y / doc.meta.geometry.active.h,
  }));
  try {
    const settings = normalizeColorCheckerSettings(doc.colorCheckerSettings);
    const wb = await session.computeChartWb(doc.params, normalized, settings.inset);
    const params = structuredClone(doc.params);
    params.wb = {
      ...params.wb,
      bypass: false,
      mode: 'custom',
      multipliers: wb.multipliers,
      pick: null,
    };
    state.setParams(doc.id, params);
    renderActive();
    toast(`WB 已按色卡中性块设置：R ${wb.multipliers[0].toFixed(3)} / G 1.000 / B ${wb.multipliers[3].toFixed(3)}`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

export function applyFittedCcm(): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc?.colorChecker.fit) return;
  const params = structuredClone(doc.params);
  params.ccm = {
    ...params.ccm,
    bypass: false,
    source: 'fit',
    matrix: doc.colorChecker.fit.matrixCcm,
    fitId: undefined,
  };
  state.setParams(doc.id, params);
  renderActive();
  toast('已应用拟合 CCM');
}

export async function pickGray(point: Point): Promise<void> {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const session = sessions.get(doc.id);
  if (!session) return;
  try {
    const r = await session.pickGray(doc.params, point, 8);
    const params = structuredClone(doc.params);
    params.wb = { ...params.wb, bypass: false, mode: 'picked', multipliers: r.multipliers, pick: { x: point.x, y: point.y, radius: 8 } };
    state.setParams(doc.id, params);
    renderActive();
    state.setToast(`灰点: R/G/B 均值 ${r.means[0].toFixed(4)} / ${((r.means[1] + r.means[2]) / 2).toFixed(4)} / ${r.means[3].toFixed(4)}，增益 ${r.multipliers.map((v) => v.toFixed(3)).join(' / ')}`);
  } catch (e) {
    state.setToast(e instanceof Error ? e.message : String(e));
  }
}

export function addSnapshot(): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const snap: PipelineSnapshot = {
    id: `s${Date.now().toString(36)}`,
    name: `快照 ${doc.snapshots.length + 1}`,
    createdAt: new Date().toISOString(),
    params: structuredClone(doc.params),
  };
  state.setSnapshots(doc.id, [...doc.snapshots, snap]);
  toast(`已创建 ${snap.name}`);
}

export function applySnapshot(id: string): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const snap = doc.snapshots.find((s) => s.id === id);
  if (!snap) return;
  state.setParams(doc.id, migrateParams(snap.params));
  renderActive();
}

export async function loadPresets(): Promise<void> {
  const presets = await idbGetAll<Preset>('presets');
  useStore.getState().setPresets(presets);
}

export function savePreset(): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const name = window.prompt('预设名称', `预设 ${state.presets.length + 1}`);
  if (!name) return;
  const preset: Preset = {
    schema: 'rawlab.preset',
    version: 2,
    id: `p${Date.now().toString(36)}`,
    name,
    createdAt: new Date().toISOString(),
    params: toPresetParams(doc.params),
  };
  state.setPresets([...state.presets, preset]);
  idbPut('presets', preset);
  toast(`已保存预设「${name}」`);
}

export async function deletePreset(id: string): Promise<void> {
  const state = useStore.getState();
  state.setPresets(state.presets.filter((p) => p.id !== id));
  await idbDelete('presets', id);
}

export function exportPresets(): void {
  const presets = useStore.getState().presets;
  const blob = new Blob([JSON.stringify({ schema: 'rawlab.presets', version: 2, presets }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'rawlab-presets.json'; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function importPresets(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as { presets?: Preset[]; schema?: string } | Preset[];
    const list = Array.isArray(parsed) ? parsed : parsed.presets ?? [];
    const valid = list.filter((p) => p && p.schema === 'rawlab.preset' && p.params && typeof p.name === 'string');
    if (!valid.length) throw new Error('没有可导入的预设');
    const state = useStore.getState();
    const map = new Map(state.presets.map((p) => [p.id, p]));
    for (const p of valid) map.set(p.id, p);
    const next = Array.from(map.values());
    state.setPresets(next);
    for (const p of valid) await idbPut('presets', p);
    toast(`已导入 ${valid.length} 个预设`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

export function applyPreset(id: string): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  const preset = state.presets.find((p) => p.id === id);
  if (!doc || !preset) return;
  state.setParams(doc.id, fromPresetParams(preset.params, doc.params));
  renderActive();
}

function flatRef(flat: FlatField): FlatFileRef {
  return { id: flat.id, fileName: flat.fileName, fileSize: flat.fileSize, sha256: flat.sha256 };
}

/** Fit settings are deliberately ephemeral; keep only result metrics in projects. */
function projectColorChecker(cc: import('../core/types').ColorCheckerSession): import('../core/types').ColorCheckerSession {
  if (!cc.fit) return cc;
  const fit = {
    ...cc.fit,
    weights: undefined,
    targetSaturation: undefined,
    targetHue: undefined,
    saturationGainTarget: undefined,
    objective: undefined,
    samples: cc.fit.samples?.map((sample) => ({ ...sample, weight: 1 })),
    patches: cc.fit.patches.map((patch) => ({ ...patch, weight: undefined })),
  };
  return { ...cc, fit };
}

export function buildProject(): ProjectFile {
  const state = useStore.getState();
  const images: ProjectImage[] = state.order.map((id) => {
    const d = state.docs[id];
    return {
      id: d.id,
      fileName: d.fileName,
      fileSize: d.fileSize,
      sha256: d.sha256,
      kind: d.kind,
      bareConfig: d.bareConfig,
      decodedMeta: {
        width: d.meta.geometry.active.w,
        height: d.meta.geometry.active.h,
        cfa: d.meta.cfa.pattern,
        bitDepth: d.meta.geometry.bitDepth,
        levels: d.meta.levels,
        orientation: d.meta.orientation,
      },
      params: d.params,
      snapshots: d.snapshots,
      colorChecker: projectColorChecker(d.colorChecker),
      roi: d.roi,
      probes: d.probes,
      flat: d.flat ? flatRef(d.flat) : undefined,
    };
  });
  const flatMap = new Map<string, FlatFileRef>();
  for (const id of state.order) {
    const d = state.docs[id];
    if (d.flat) flatMap.set(d.flat.id, flatRef(d.flat));
  }
  const active = state.activeId ? state.docs[state.activeId] : null;
  return {
    schema: 'rawlab.project',
    version: 2,
    appVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    images,
    flatFields: Array.from(flatMap.values()),
    layout: { mode: state.compareMode ? state.compareLayout : 'single', imageIds: state.order, linkedView: true },
    view: {
      activeImageId: state.activeId ?? '',
      zoom: active?.view.zoom ?? 1,
      pan: { x: active?.view.panX ?? 0, y: active?.view.panY ?? 0 },
      split: state.split,
      flickerHz: 4,
    },
    analysis: {
      stage: state.analysisStage,
      roi: active?.roi ?? null,
      probes: active?.probes ?? [],
    },
    ui: { previewLongEdge: 2048, showClipping: state.showClipping, theme: 'dark' },
  };
}

export function autosaveProject(): void {
  const project = buildProject();
  if (project.images.length) idbPut('kv', project, 'autosave');
}

export async function restoreAutosave(): Promise<void> {
  const project = await idbGet<ProjectFile>('kv', 'autosave');
  if (!project) { useStore.getState().setToast('没有自动保存工程'); return; }
  useStore.getState().setPendingProject(project);
  useStore.getState().setProjectName('自动保存工程');
}

export function saveProject(): void {
  const state = useStore.getState();
  const project = buildProject();
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.projectName.replace(/[\\/:*?"<>|]/g, '_') || 'rawlab'}.rawlab.json`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  state.setDirty(false);
  state.setToast('工程 JSON 已导出（不含 RAW 本体）');
}

export async function openProjectFile(file: File): Promise<void> {
  try {
    const project = JSON.parse(await file.text()) as ProjectFile;
    const version = (project as unknown as { version?: number }).version ?? 0;
    if (project.schema !== 'rawlab.project' || (version !== 1 && version !== 2)) throw new Error('不是 RAW Lab 工程文件（schema/version 不匹配）');
    if (!Array.isArray(project.images) || !project.images.length) throw new Error('工程不含图像');
    useStore.getState().setPendingProject(project);
    useStore.getState().setProjectName(file.name.replace(/\.rawlab\.json$/i, '') || '已加载工程');
    useStore.getState().setToast('工程已加载，请重新关联 RAW 文件');
  } catch (e) {
    useStore.getState().setToast(e instanceof Error ? e.message : String(e));
  }
}

export async function relinkProjectImage(projectImage: ProjectImage, file: File, flatFile?: File | null): Promise<string> {
  const rawResult = projectImage.kind === 'bare'
    ? await decodeService.decodeBare(file, projectImage.bareConfig!)
    : await decodeService.decodeDng(file);
  const { raw } = rawResult;
  raw.id = projectImage.id;
  let flat: FlatField | null = null;
  if (flatFile) {
    const isDng = /\.dng$/i.test(flatFile.name);
    flat = isDng ? (await decodeService.decodeFlatDng(flatFile)).flat : (await decodeService.decodeFlatBare(flatFile, projectImage.bareConfig!)).flat;
    const mismatch = flatCompatible({ ...makeDoc(raw, 0), id: raw.id } as ImageDoc, flat);
    if (mismatch) throw new Error(mismatch);
  }
  const existing = sessions.get(projectImage.id);
  if (existing) {
    await existing.destroy();
    sessions.delete(projectImage.id);
  }
  await createSessionForRaw(raw, flat);
  const doc = makeDoc(raw, 0, flat);
  doc.bareConfig = projectImage.bareConfig;
  doc.params = migrateParams(projectImage.params);
  doc.snapshots = (projectImage.snapshots ?? []).map((s) => ({ ...structuredClone(s), params: migrateParams(s.params) }));
  doc.colorChecker = structuredClone(projectImage.colorChecker ?? { corners: null, referenceId: 'classic24-pre2014-d65' });
  doc.colorCheckerSettings = defaultColorCheckerSettings();
  doc.roi = projectImage.roi ?? legacyRoi(projectImage.rois);
  doc.probes = structuredClone(projectImage.probes ?? []);
  if (projectImage.flat) doc.flat = flat ? stripFlat(flat) : null;
  if (flat) {
    doc.params.flat.flatId = flat.id;
    doc.params.flat.bypass = false;
  } else if (projectImage.flat) {
    doc.params.flat.flatId = null;
    doc.params.flat.bypass = true;
  }
  useStore.getState().addDoc(doc);
  if (projectImage.sha256 && raw.sha256 !== projectImage.sha256) {
    useStore.getState().setToast(`SHA-256 不匹配：${file.name}；参数已恢复，但文件可能不是原图`);
  }
  return doc.id;
}

export function finishProjectRelink(): void {
  const state = useStore.getState();
  const project = state.pendingProject;
  if (!project) return;
  if (project.view?.activeImageId && state.docs[project.view.activeImageId]) {
    state.setActive(project.view.activeImageId);
    state.setView(project.view.activeImageId, {
      zoom: project.view.zoom || 1,
      panX: project.view.pan?.x || state.docs[project.view.activeImageId].meta.geometry.active.w / 2,
      panY: project.view.pan?.y || state.docs[project.view.activeImageId].meta.geometry.active.h / 2,
    });
  }
  state.setAnalysisStage(project.analysis.stage ?? 'sharpen');
  state.setSelectedStage(project.analysis.stage ?? 'sharpen');
  const activeId = project.view?.activeImageId ?? state.activeId;
  if (activeId && state.docs[activeId]) {
    const savedRoi = project.analysis.roi ?? legacyRoi(project.analysis.rois);
    if (savedRoi && !state.docs[activeId].roi) state.setRoi(activeId, savedRoi);
  }
  state.setSplit(project.view?.split ?? 0.5);
  state.setShowClipping(project.ui?.showClipping ?? false);
  if (project.layout?.mode && project.layout.mode !== 'single') {
    state.setCompareLayout(project.layout.mode);
    const other = project.layout.imageIds?.find((id) => id !== project.view?.activeImageId);
    if (other && state.docs[other]) {
      state.setCompareId(other);
      state.setCompareMode(true);
    }
  }
  state.setPendingProject(null);
  state.setDirty(false);
  state.setToast('工程已恢复；RAW 文件已重新关联');
  renderActive();
}

export function downloadBytes(data: Uint8Array, filename: string): void {
  const blob = new Blob([data], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportActive(bitDepth: 8 | 16): Promise<void> {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const session = sessions.get(doc.id);
  if (!session) return;
  state.setBusy(true, '正在导出 PNG…');
  try {
    const crop = doc.params.output.crop;
    const out = await session.exportPng(doc.params, bitDepth, crop, state.selectedStage);
    const base = doc.fileName.replace(/\.[^.]+$/, '');
    downloadBytes(out.data, `${base}_${state.selectedStage}_${bitDepth}bit.png`);
    state.setBusy(false);
    if (out.scaled) toast('注意：全分辨率超过 32MP，已按缩放后的纹理导出（100MP 分块导出待完成）。');
    else toast(`PNG 导出完成：${out.width}×${out.height}，${bitDepth}-bit`);
  } catch (e) {
    state.setBusy(false);
    toast(e instanceof Error ? e.message : String(e));
  }
}

export async function removeDoc(id: string): Promise<void> {
  const session = sessions.get(id);
  if (session) {
    await session.destroy();
    sessions.delete(id);
  }
  clearRenderSig(id);
  for (const key of [...analysisSeq.keys()]) {
    if (key.startsWith(`${id}:`)) analysisSeq.delete(key);
  }
  useStore.getState().removeDoc(id);
}

export function updateStageAndRender<K extends keyof PipelineParams>(stage: K, patch: Partial<PipelineParams[K]>): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  state.updateStage(doc.id, stage, patch);
  if (doc.source === 'full') state.setSource(doc.id, 'preview');
  renderActive();
}

export function setStageBypassAndRender(stage: StageId, bypass: boolean): void {
  const state = useStore.getState();
  const doc = state.activeId ? state.docs[state.activeId] : null;
  if (!doc) return;
  const params = structuredClone(doc.params) as PipelineParams;
  (params[stage] as { bypass: boolean }).bypass = bypass;
  state.setParams(doc.id, params);
  if (doc.source === 'full') state.setSource(doc.id, 'preview');
  renderActive();
}

export function setCameraRgbStage(stage: StageId): void {
  const state = useStore.getState();
  state.setSelectedStage(stage);
  state.setAnalysisStage(stage);
  renderActive();
}

export function getSessionEntries(): Array<[string, ImageSession]> {
  return Array.from(sessions.entries());
}
