export type CfaPattern = 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG';
export type ChannelId = 'R' | 'G1' | 'G2' | 'B';
export type BitDepth = 8 | 10 | 12 | 14 | 16;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type Vec4 = [number, number, number, number];

export type StageId =
  | 'levels'
  | 'flat'
  | 'wb'
  | 'demosaic'
  | 'denoise'
  | 'ccm'
  | 'csc'
  | 'gamma'
  | 'sharpen';

export type Domain = 'raw-cfa' | 'camera-rgb' | 'linear-srgb' | 'display-srgb';

export type AnalysisKind =
  | 'histogram'
  | 'snr'
  | 'mtf'
  | 'colorchecker'
  | 'waveform'
  | 'noise'
  | 'diff';

export interface PackingSpec {
  kind: 'unpacked' | 'packed';
  container?: 'u8' | 'u16';
  endian?: 'le' | 'be';
  alignment?: 'right' | 'left';
  bitOrder?: 'lsb' | 'msb';
  group?: 'continuous' | 'mipi10' | 'mipi12' | 'mipi14';
}

export interface RawGeometry {
  storedWidth: number;
  storedHeight: number;
  rowStrideBytes: number;
  active: Rect;
  bitDepth: BitDepth;
  packing: PackingSpec;
}

export interface RawLevels {
  black: Vec4;
  white: Vec4;
  source: 'dng' | 'libraw' | 'user';
}

export interface CfaLayout {
  pattern: CfaPattern;
  sites: [ChannelId, ChannelId, ChannelId, ChannelId];
  phaseOrigin: Point;
  /** Canonical channel index per 2x2 site: 0=R, 1=G1, 2=G2, 3=B */
  siteChannels: [number, number, number, number];
}

export interface DngColorMeta {
  colorMatrix1?: Mat3;
  colorMatrix2?: Mat3;
  forwardMatrix1?: Mat3;
  forwardMatrix2?: Mat3;
  calibrationIlluminant1?: number;
  calibrationIlluminant2?: number;
  asShotNeutral?: [number, number, number];
  asShotWhiteXY?: [number, number];
  analogBalance?: [number, number, number];
  cameraCalibration1?: Mat3;
  cameraCalibration2?: Mat3;
  baselineExposure?: number;
  activeArea?: Rect;
  defaultCrop?: Rect;
  orientation?: number;
  cfaPattern?: string;
  uniqueCameraModel?: string;
  make?: string;
  model?: string;
  tagSource: 'dng' | 'libraw' | 'none';
  warnings: string[];
}

export interface RawDiagnostics {
  requiredBytes: number;
  actualBytes: number;
  bytesDelta: number;
  perChannel: Array<{
    channel: ChannelId;
    min: number;
    p1: number;
    p50: number;
    p99: number;
    max: number;
    belowBlack: number;
    aboveWhite: number;
  }>;
  cfaConsistency: number;
  warnings: DiagnosticItem[];
  suggestions: DiagnosticSuggestion[];
}

export interface DiagnosticItem {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface DiagnosticSuggestion {
  kind: 'offset' | 'stride' | 'cfa' | 'bitDepth' | 'packing';
  value: number | string;
  score: number;
  label: string;
}

export interface RawImage {
  id: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  kind: 'dng' | 'bare';
  geometry: RawGeometry;
  cfa: CfaLayout;
  data: Uint16Array;
  levels: RawLevels;
  wb: {
    asShot: Vec4 | null;
    source: 'dng' | 'libraw' | 'none';
  };
  color: DngColorMeta | null;
  orientation: 1 | 3 | 6 | 8;
  decoder: { name: string; version: string; libraw?: string };
  diagnostics: RawDiagnostics;
  createdAt: number;
}

export interface BareRawConfig {
  width: number;
  height: number;
  cfa: CfaPattern;
  bitDepth: BitDepth;
  packing: PackingSpec;
  headerOffset: number;
  rowStride: number;
  active?: Rect;
  black: number | Vec4;
  white: number | Vec4;
  endian?: 'le' | 'be';
  sampleShift?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  byteLength?: number;
}

export interface FlatField {
  id: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  raw: RawImage;
  compatibility: {
    sameGeometry: boolean;
    sameCfa: boolean;
    sameBitDepth: boolean;
    sameActiveArea: boolean;
  };
  stats: {
    means: Vec4;
    validFraction: Vec4;
    clippedFraction: Vec4;
    maxGain: Vec4;
  };
  gainPreview?: ImageBitmap;
}

export interface PipelineParams {
  schemaVersion: 1;
  levels: {
    bypass: boolean;
    black: Vec4;
    white: Vec4;
    clampNegative: boolean;
    source: 'metadata' | 'custom';
  };
  flat: {
    bypass: boolean;
    flatId: string | null;
    strength: number;
    epsilon: number;
    maxGain: number;
  };
  wb: {
    bypass: boolean;
    mode: 'as-shot' | 'custom' | 'picked';
    multipliers: Vec4;
    pick: { x: number; y: number; radius: number } | null;
  };
  demosaic: {
    bypass: boolean;
    algorithm: 'bilinear' | 'mhc' | 'ahd' | 'rcd';
  };
  denoise: {
    bypass: boolean;
    method: 'guided' | 'bilateral';
    radius: 3 | 5;
    luma: number;
    chroma: number;
    detail: number;
  };
  ccm: {
    bypass: boolean;
    source: 'identity' | 'manual' | 'fit';
    matrix: Mat3;
    fitId?: string;
  };
  csc: {
    bypass: boolean;
    source: 'dng' | 'manual' | 'identity';
    matrix: Mat3;
    adaptation: 'bradford' | 'none';
  };
  gamma: {
    bypass: boolean;
    mode: 'srgb' | 'gamma22' | 'linear';
  };
  sharpen: {
    bypass: boolean;
    amount: number;
    radius: number;
    threshold: number;
  };
  output: {
    crop: Rect | null;
    bitDepth: 8 | 16;
    format: 'png';
  };
}

export interface PipelineSnapshot {
  id: string;
  name: string;
  createdAt: string;
  params: PipelineParams;
}

export interface ProbePoint {
  id: string;
  x: number;
  y: number;
  label?: string;
}

/** Live hover sample for the canvas readout (not persisted). */
export interface ProbeSample {
  x: number;
  y: number;
  raw: {
    /** RAW CFA site channel at this pixel (R, G1, G2 or B). */
    channel: ChannelId;
    dn: number;
  };
  wb: {
    multipliers: Vec4;
  };
  stage: {
    id: StageId;
    rgb: [number, number, number];
    rgb8: [number, number, number];
  };
}

export interface ColorCheckerSession {
  corners: [Point, Point, Point, Point] | null;
  referenceId: string;
  fit?: ColorCheckerResult;
}

export interface ProjectImage {
  id: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  kind: 'dng' | 'bare';
  bareConfig?: BareRawConfig;
  decodedMeta: {
    width: number;
    height: number;
    cfa: CfaPattern;
    bitDepth: BitDepth;
    levels: RawLevels;
    orientation: number;
  };
  params: PipelineParams;
  snapshots: PipelineSnapshot[];
  colorChecker?: ColorCheckerSession;
  /** Shared analysis ROI; null/undefined means the full image. */
  roi?: Rect | null;
  /** @deprecated legacy per-analysis ROIs, read for older projects. */
  rois?: Partial<Record<AnalysisKind, Rect>>;
  probes?: ProbePoint[];
  flat?: FlatFileRef;
}

export interface FlatFileRef {
  id: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  bareConfig?: BareRawConfig;
}

export interface ProjectFile {
  schema: 'rawlab.project';
  version: 1;
  appVersion: string;
  createdAt: string;
  modifiedAt: string;
  images: ProjectImage[];
  flatFields: FlatFileRef[];
  layout: {
    mode: 'single' | 'two-h' | 'two-v' | 'quad';
    imageIds: string[];
    linkedView: boolean;
  };
  view: {
    activeImageId: string;
    zoom: number;
    pan: Point;
    split: number;
    flickerHz: number;
  };
  analysis: {
    stage: StageId;
    /** Shared analysis ROI; null means the full image. */
    roi?: Rect | null;
    /** @deprecated legacy per-analysis ROIs. */
    rois?: Partial<Record<AnalysisKind, Rect>>;
    probes: ProbePoint[];
  };
  ui: {
    previewLongEdge: 2048;
    showClipping: boolean;
    theme: 'dark';
  };
}

export interface Preset {
  schema: 'rawlab.preset';
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  params: PresetPipelineParams;
}

export type PresetPipelineParams = Omit<PipelineParams, 'flat' | 'output'> & {
  flat: Omit<PipelineParams['flat'], 'flatId'>;
  output: Omit<PipelineParams['output'], 'crop'>;
};

export interface AnalysisMeta {
  imageId: string;
  stage: StageId;
  stageDomain: Domain;
  roi: Rect | null;
  paramsHash: string;
  createdAt: number;
  durationMs: number;
  warnings: string[];
}

export interface HistogramResult extends AnalysisMeta {
  kind: 'histogram';
  bins: 256 | 1024;
  channels: {
    r: Uint32Array;
    g: Uint32Array;
    b: Uint32Array;
    y: Uint32Array;
  };
  clipped: { low: Vec4; high: Vec4 };
  total: number;
  min: number;
  max: number;
  mean: number;
  /** ROI means in the same domain as the histogram bins (R/G/B). */
  channelMeans: [number, number, number];
  /** R:G:B ratio with green normalized to 1. */
  channelRatios: [number, number, number];
  scale: 'linear' | 'log';
}

export interface SnrResult extends AnalysisMeta {
  kind: 'snr';
  perChannel: Array<{
    channel: 'R' | 'G' | 'B' | 'Y';
    mean: number;
    std: number;
    snrDb: number;
    samples: number;
  }>;
  domain: 'linear';
}

export interface MtfResult extends AnalysisMeta {
  kind: 'mtf';
  perChannel: Array<{
    channel: 'R' | 'G' | 'B' | 'Y';
    mtf50: number;
    mtf10: number;
    curve: Array<{ f: number; mtf: number }>;
  }>;
  edge: { angleDeg: number; contrast: number; oversampling: 4 };
}

export interface ColorCheckerPatchResult {
  index: number;
  name: string;
  refLab: [number, number, number];
  measuredLab: [number, number, number];
  dE00: number;
  dC: number;
  clipped: boolean;
  used: boolean;
}

export interface ColorCheckerResult extends AnalysisMeta {
  kind: 'colorchecker';
  patches: ColorCheckerPatchResult[];
  meanDE00: number;
  maxDE00: number;
  meanAbsDC: number;
  matrixTotal: Mat3;
  matrixCcm: Mat3;
  validCount: number;
  method: 'ls' | 'de00-optimized';
}

export interface WaveformResult extends AnalysisMeta {
  kind: 'waveform';
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  mode: 'luma' | 'parade';
  scale: 'linear' | 'gamma';
}

export interface NoiseSpectrumResult extends AnalysisMeta {
  kind: 'noise';
  width: number;
  height: number;
  spectrum: Float32Array;
  radial: Array<{ r: number; power: number }>;
  psdH: Float32Array;
  psdV: Float32Array;
  detrend: 'plane' | 'mean';
  window: 'hann';
}

export interface DiffResult extends AnalysisMeta {
  kind: 'diff';
  a: { imageId: string; stage: StageId };
  b: { imageId: string; stage: StageId };
  metrics: { mae: number; psnrDb: number; maxDiff: number };
  width: number;
  height: number;
  gain: number;
  mode: 'abs' | 'signed';
  rgba?: Uint8ClampedArray;
}

export type AnalysisResult =
  | HistogramResult
  | SnrResult
  | MtfResult
  | ColorCheckerResult
  | WaveformResult
  | NoiseSpectrumResult
  | DiffResult;

export interface RenderTimings {
  stages: Partial<Record<StageId, number>>;
  totalMs: number;
  width: number;
  height: number;
  scale: number;
}

export interface RenderStats {
  timings: RenderTimings;
  cacheBytes: number;
  vramBytes: number;
  previewLongEdge: number;
  fullRes: { width: number; height: number } | null;
}
