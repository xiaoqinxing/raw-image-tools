import { create } from 'zustand';
import type {
  AnalysisKind,
  AnalysisResult,
  FlatField,
  PipelineParams,
  PipelineSnapshot,
  Preset,
  ProbePoint,
  RawImage,
  Rect,
  StageId,
  ColorCheckerSession,
  RenderStats,
  BareRawConfig,
  ProjectFile,
  Domain,
} from '../core/types';

export type ToolMode = 'pan' | 'probe' | 'roi' | 'colorchecker' | 'crop' | 'gray';

export interface ImageDoc {
  id: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  kind: 'dng' | 'bare';
  bareConfig?: BareRawConfig;
  flatConfig?: BareRawConfig;
  meta: RawImage;
  params: PipelineParams;
  snapshots: PipelineSnapshot[];
  flat: FlatField | null;
  colorChecker: ColorCheckerSession;
  decodeMs: number;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  generation: number;
  stage: StageId;
  domain: Domain;
  stats: RenderStats | null;
  analysis: Partial<Record<AnalysisKind, AnalysisResult>>;
  probes: ProbePoint[];
  rois: Partial<Record<AnalysisKind, Rect>>;
  view: { zoom: number; panX: number; panY: number };
  source: 'preview' | 'full';
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

interface State {
  docs: Record<string, ImageDoc>;
  order: string[];
  activeId: string | null;
  selectedStage: StageId;
  analysisStage: StageId;
  tool: ToolMode;
  roiKind: AnalysisKind;
  viewport: Viewport;
  falseColor: boolean;
  showClipping: boolean;
  busy: boolean;
  busyLabel: string;
  toast: string | null;
  projectName: string;
  dirty: boolean;
  showImport: boolean;
  showExport: boolean;
  presets: Preset[];
  selectedPresetId: string | null;
  split: number;
  flicker: boolean;
  abMode: 'off' | 'stage' | 'snapshot';
  abSnapshotId: string | null;
  diffMode: boolean;
  pendingProject: ProjectFile | null;
  compareMode: boolean;
  compareId: string | null;
  compareLayout: 'two-h' | 'two-v' | 'quad';

  addDoc: (doc: ImageDoc) => void;
  updateDoc: (id: string, patch: Partial<ImageDoc>) => void;
  updateDocFn: (id: string, fn: (doc: ImageDoc) => Partial<ImageDoc>) => void;
  removeDoc: (id: string) => void;
  setActive: (id: string) => void;
  setParams: (id: string, params: PipelineParams) => void;
  updateStage: <K extends keyof PipelineParams>(id: string, stage: K, patch: Partial<PipelineParams[K]>) => void;
  setSnapshots: (id: string, snapshots: PipelineSnapshot[]) => void;
  setFlat: (id: string, flat: FlatField | null) => void;
  setColorChecker: (id: string, cc: ColorCheckerSession) => void;
  setAnalysis: (id: string, result: AnalysisResult) => void;
  clearAnalysis: (id: string, kind?: AnalysisKind) => void;
  addProbe: (id: string, probe: ProbePoint) => void;
  removeProbe: (id: string, probeId: string) => void;
  setRoi: (id: string, kind: AnalysisKind, roi: Rect | null) => void;
  setView: (id: string, view: Partial<ImageDoc['view']>) => void;
  setViewport: (viewport: Viewport) => void;
  setSelectedStage: (stage: StageId) => void;
  setAnalysisStage: (stage: StageId) => void;
  setSource: (id: string, source: 'preview' | 'full') => void;
  setStats: (id: string, stats: RenderStats | null) => void;
  setBusy: (busy: boolean, label?: string) => void;
  setToast: (toast: string | null) => void;
  setProjectName: (name: string) => void;
  setDirty: (dirty: boolean) => void;
  setShowImport: (show: boolean) => void;
  setShowExport: (show: boolean) => void;
  setPresets: (presets: Preset[]) => void;
  setSelectedPresetId: (id: string | null) => void;
  setTool: (tool: ToolMode) => void;
  setRoiKind: (kind: AnalysisKind) => void;
  setFalseColor: (v: boolean) => void;
  setShowClipping: (v: boolean) => void;
  setSplit: (v: number) => void;
  setFlicker: (v: boolean) => void;
  setAbMode: (v: 'off' | 'stage' | 'snapshot') => void;
  setAbSnapshotId: (id: string | null) => void;
  setDiffMode: (v: boolean) => void;
  setPendingProject: (p: ProjectFile | null) => void;
  setCompareMode: (v: boolean) => void;
  setCompareId: (id: string | null) => void;
  setCompareLayout: (v: 'two-h' | 'two-v' | 'quad') => void;
  reset: () => void;
}

const initialState = {
  docs: {} as Record<string, ImageDoc>,
  order: [] as string[],
  activeId: null as string | null,
  selectedStage: 'sharpen' as StageId,
  analysisStage: 'sharpen' as StageId,
  tool: 'pan' as ToolMode,
  roiKind: 'snr' as AnalysisKind,
  viewport: { width: 1, height: 1, dpr: 1 },
  falseColor: false,
  showClipping: false,
  busy: false,
  busyLabel: '',
  toast: null as string | null,
  projectName: '未命名工程',
  dirty: false,
  showImport: false,
  showExport: false,
  presets: [] as Preset[],
  selectedPresetId: null as string | null,
  split: 0.5,
  flicker: false,
  abMode: 'off' as const,
  abSnapshotId: null as string | null,
  diffMode: false,
  pendingProject: null as ProjectFile | null,
  compareMode: false,
  compareId: null as string | null,
  compareLayout: 'two-h' as const,
};

export const useStore = create<State>((set, get) => ({
  ...initialState,

  addDoc: (doc) =>
    set((s) => ({
      docs: { ...s.docs, [doc.id]: doc },
      order: s.order.includes(doc.id) ? s.order : [...s.order, doc.id],
      activeId: doc.id,
      dirty: true,
    })),
  updateDoc: (id, patch) =>
    set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], ...patch } }, dirty: true } : s)),
  updateDocFn: (id, fn) =>
    set((s) => {
      const doc = s.docs[id];
      if (!doc) return s;
      return { docs: { ...s.docs, [id]: { ...doc, ...fn(doc) } }, dirty: true };
    }),
  removeDoc: (id) =>
    set((s) => {
      const docs = { ...s.docs };
      delete docs[id];
      const order = s.order.filter((x) => x !== id);
      const activeId = s.activeId === id ? order[0] ?? null : s.activeId;
      const compareId = s.compareId === id
        ? order.find((x) => x !== activeId) ?? null
        : s.compareId;
      return {
        docs,
        order,
        activeId,
        compareId,
        compareMode: s.compareMode && order.length > 1 && !!compareId,
        dirty: true,
      };
    }),
  setActive: (id) => set({ activeId: id }),
  setParams: (id, params) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], params } }, dirty: true } : s)),
  updateStage: (id, stage, patch) =>
    set((s) => {
      const doc = s.docs[id];
      if (!doc) return s;
      const params = structuredClone(doc.params);
      (params[stage] as unknown as Record<string, unknown>) = {
        ...(params[stage] as unknown as Record<string, unknown>),
        ...(patch as unknown as Record<string, unknown>),
      };
      return { docs: { ...s.docs, [id]: { ...doc, params } }, dirty: true };
    }),
  setSnapshots: (id, snapshots) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], snapshots } }, dirty: true } : s)),
  setFlat: (id, flat) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], flat } }, dirty: true } : s)),
  setColorChecker: (id, colorChecker) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], colorChecker } }, dirty: true } : s)),
  setAnalysis: (id, result) =>
    set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], analysis: { ...s.docs[id].analysis, [result.kind]: result } } }, dirty: true } : s)),
  clearAnalysis: (id, kind) =>
    set((s) => {
      const doc = s.docs[id];
      if (!doc) return s;
      if (!kind) return { docs: { ...s.docs, [id]: { ...doc, analysis: {} } } };
      const analysis = { ...doc.analysis };
      delete analysis[kind];
      return { docs: { ...s.docs, [id]: { ...doc, analysis } } };
    }),
  addProbe: (id, probe) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], probes: [...s.docs[id].probes, probe] } } } : s)),
  removeProbe: (id, probeId) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], probes: s.docs[id].probes.filter((p) => p.id !== probeId) } } } : s)),
  setRoi: (id, kind, roi) =>
    set((s) => {
      const doc = s.docs[id];
      if (!doc) return s;
      const rois = { ...doc.rois };
      if (roi) rois[kind] = roi;
      else delete rois[kind];
      return { docs: { ...s.docs, [id]: { ...doc, rois } }, dirty: true };
    }),
  setView: (id, view) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], view: { ...s.docs[id].view, ...view } } } } : s)),
  setViewport: (viewport) => set({ viewport }),
  setSelectedStage: (selectedStage) => set({ selectedStage }),
  setAnalysisStage: (analysisStage) => set({ analysisStage }),
  setSource: (id, source) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], source } } } : s)),
  setStats: (id, stats) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], stats } } } : s)),
  setBusy: (busy, label = '') => set({ busy, busyLabel: label }),
  setToast: (toast) => set({ toast }),
  setProjectName: (projectName) => set({ projectName }),
  setDirty: (dirty) => set({ dirty }),
  setShowImport: (showImport) => set({ showImport }),
  setShowExport: (showExport) => set({ showExport }),
  setPresets: (presets) => set({ presets }),
  setSelectedPresetId: (selectedPresetId) => set({ selectedPresetId }),
  setTool: (tool) => set({ tool }),
  setRoiKind: (roiKind) => set({ roiKind }),
  setFalseColor: (falseColor) => set({ falseColor }),
  setShowClipping: (showClipping) => set({ showClipping }),
  setSplit: (split) => set({ split }),
  setFlicker: (flicker) => set({ flicker }),
  setAbMode: (abMode) => set({ abMode }),
  setAbSnapshotId: (abSnapshotId) => set({ abSnapshotId }),
  setDiffMode: (diffMode) => set({ diffMode }),
  setPendingProject: (pendingProject) => set({ pendingProject }),
  setCompareMode: (compareMode) => set({ compareMode }),
  setCompareId: (compareId) => set({ compareId }),
  setCompareLayout: (compareLayout) => set({ compareLayout }),
  reset: () => set({ ...initialState, docs: {}, order: [], activeId: null }),
}));

export function activeDoc(state: State): ImageDoc | null {
  return state.activeId ? state.docs[state.activeId] ?? null : null;
}

export function useActiveDoc(): ImageDoc | null {
  return useStore((s) => activeDoc(s));
}

export function useDoc(id: string): ImageDoc | null {
  return useStore((s) => s.docs[id] ?? null);
}

export function useActiveId(): string | null {
  return useStore((s) => s.activeId);
}

export function useViewport(): Viewport {
  return useStore((s) => s.viewport);
}
