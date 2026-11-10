import type {
  Domain,
  FlatField,
  Mat3,
  PipelineParams,
  RawImage,
  StageId,
  Vec4,
} from '../core/types';
import { STAGE_DOMAIN, STAGE_ORDER, effectiveCcm, effectiveCscTransform, hashString, stableStringify } from '../core/pipeline/params';
import { ccmFromTotal } from '../core/color/matrices';
import { demosaicAHD } from '../core/demosaic/ahd';
import { defaultLevelsForBitDepth } from '../core/raw/levels';
import { previewFactor, resourceFactor, scaleRaw } from '../core/raw/scale';
import {
  BILATERAL_FRAG,
  BOX_FRAG,
  COMMON_HEADER,
  CSC_FRAG,
  DEMOSAIC_FRAG,
  DENOISE_COMBINE_FRAG,
  DIGITAL_GAIN_FRAG,
  DISPLAY_FRAG,
  FLAT_FRAG,
  FULLSCREEN_VERT,
  GAMMA_FRAG,
  GAUSSIAN_FRAG,
  LEVELS_FRAG,
  LUMA_FRAG,
  MATRIX_FRAG,
  MOMENTS_FRAG,
  USM_COMBINE_FRAG,
  WB_FRAG,
} from './shaders';

type TextureKind = 'r16f' | 'rgba16f' | 'r16ui';

interface RenderTexture {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  kind: TextureKind;
  bytes: number;
}

interface StageCache {
  stages: Partial<Record<StageId, RenderTexture>>;
  keys: Partial<Record<StageId, string>>;
  temps: Map<string, RenderTexture>;
}

export interface StageResult {
  texture: RenderTexture;
  stage: StageId;
  domain: Domain;
  width: number;
  height: number;
}

export interface Viewport {
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
  linearDisplay: boolean;
  source: 'preview' | 'full';
}

export interface RenderTimings {
  stages: Partial<Record<StageId, number>>;
  totalMs: number;
  width: number;
  height: number;
  scale: number;
}

export interface ReadPixels {
  width: number;
  height: number;
  data: Float32Array; // RGBA, 4 components
}

export interface ReadRed {
  width: number;
  height: number;
  data: Float32Array;
}

function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) {
    if (frac === 0) return sign < 0 ? -0 : 0;
    return sign * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

const f32buf = new Float32Array(1);
const u32buf = new Uint32Array(f32buf.buffer);

function floatToHalf(value: number): number {
  f32buf[0] = value;
  const x = u32buf[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    const m = mant | 0x800000;
    const shift = 14 - e;
    let half = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && (half & 1))) half++;
    return sign | half;
  }
  let half = sign | (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half++;
  return half;
}

function newCache(): StageCache {
  return { stages: {}, keys: {}, temps: new Map() };
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<string, WebGLProgram>();
  private vao: WebGLVertexArrayObject;
  private raw: RawImage | null = null;
  private flat: FlatField | null = null;
  private previewRaw: RawImage | null = null;
  private fullRaw: RawImage | null = null;
  private previewFlat: FlatField | null = null;
  private fullFlat: FlatField | null = null;
  private rawPreviewTex: WebGLTexture | null = null;
  private rawFullTex: WebGLTexture | null = null;
  private flatPreviewTex: WebGLTexture | null = null;
  private flatFullTex: WebGLTexture | null = null;
  private previewCache = newCache();
  private previewBCache = newCache();
  private fullCache = newCache();
  private lastPreview: StageResult | null = null;
  private lastPreviewB: StageResult | null = null;
  private lastFull: StageResult | null = null;
  private lastShown: StageResult | null = null;
  private fullFactor = 1;
  private previewFactor = 1;
  private maxTextureSize: number;
  private canvas: OffscreenCanvas;

  constructor(canvas: OffscreenCanvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
    const cbf = gl.getExtension('EXT_color_buffer_float');
    if (!cbf) throw new Error('缺少 EXT_color_buffer_float，无法渲染 RGBA16F');
    gl.getExtension('OES_texture_float_linear');
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('无法创建 VAO');
    this.vao = vao;
    gl.bindVertexArray(vao);
  }

  get capabilities() {
    return { maxTextureSize: this.maxTextureSize };
  }

  get previewInfo() {
    return {
      factor: this.previewFactor,
      width: this.previewRaw?.geometry.active.w ?? 0,
      height: this.previewRaw?.geometry.active.h ?? 0,
      fullFactor: this.fullFactor,
      fullWidth: this.fullRaw?.geometry.active.w ?? 0,
      fullHeight: this.fullRaw?.geometry.active.h ?? 0,
    };
  }

  setRaw(raw: RawImage, flat: FlatField | null): void {
    this.raw = raw;
    this.flat = flat;
    this.previewFactor = previewFactor(raw.geometry.active.w, raw.geometry.active.h, 2048);
    const pixels = raw.geometry.active.w * raw.geometry.active.h;
    const maxFullPixels = pixels > 48_000_000 ? 12_000_000 : 32_000_000;
    this.fullFactor = resourceFactor(raw.geometry.active.w, raw.geometry.active.h, maxFullPixels, this.maxTextureSize);
    this.previewRaw = raw.geometry.active.w === 0 ? raw : scaleRaw(raw, this.previewFactor);
    this.fullRaw = scaleRaw(raw, this.fullFactor);
    this.previewFlat = flat ? this.scaleFlat(flat, this.previewFactor) : null;
    this.fullFlat = flat ? this.scaleFlat(flat, this.fullFactor) : null;
    this.disposeTextures();
    this.rawPreviewTex = this.uploadRaw(this.previewRaw);
    this.rawFullTex = this.uploadRaw(this.fullRaw);
    this.flatPreviewTex = this.previewFlat ? this.uploadRaw(this.previewFlat.raw) : null;
    this.flatFullTex = this.fullFlat ? this.uploadRaw(this.fullFlat.raw) : null;
    this.previewCache = newCache();
    this.previewBCache = newCache();
    this.fullCache = newCache();
    this.lastPreview = null;
    this.lastPreviewB = null;
    this.lastFull = null;
    this.lastShown = null;
  }

  private scaleFlat(flat: FlatField, factor: number): FlatField {
    const raw = scaleRaw(flat.raw, factor);
    return {
      ...flat,
      raw,
      stats: flat.stats,
    };
  }

  private uploadRaw(raw: RawImage): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('无法创建 RAW 纹理');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16UI,
      raw.geometry.storedWidth,
      raw.geometry.storedHeight,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      raw.data,
    );
    return tex;
  }

  private createTexture(width: number, height: number, kind: 'r16f' | 'rgba16f'): RenderTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) throw new Error('无法创建 FBO/纹理');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (kind === 'r16f') {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, width, height, 0, gl.RED, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`FBO 不完整：0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const bytes = width * height * (kind === 'r16f' ? 2 : 8);
    return { texture, fbo, width, height, kind, bytes };
  }

  private disposeTex(t: RenderTexture | undefined | null): void {
    if (!t) return;
    if (this.lastShown?.texture === t) this.lastShown = null;
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.texture);
  }

  private disposeTextures(): void {
    const gl = this.gl;
    if (this.rawPreviewTex) gl.deleteTexture(this.rawPreviewTex);
    if (this.rawFullTex) gl.deleteTexture(this.rawFullTex);
    if (this.flatPreviewTex) gl.deleteTexture(this.flatPreviewTex);
    if (this.flatFullTex) gl.deleteTexture(this.flatFullTex);
    this.rawPreviewTex = null;
    this.rawFullTex = null;
    this.flatPreviewTex = null;
    this.flatFullTex = null;
    for (const cache of [this.previewCache, this.previewBCache, this.fullCache]) {
      for (const t of Object.values(cache.stages)) this.disposeTex(t);
      for (const t of cache.temps.values()) this.disposeTex(t);
    }
  }

  dispose(): void {
    this.disposeTextures();
  }

  private compile(frag: string, key: string): WebGLProgram {
    const cached = this.programs.get(key);
    if (cached) return cached;
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vs || !fs) throw new Error('无法创建 shader');
    gl.shaderSource(vs, FULLSCREEN_VERT);
    gl.compileShader(vs);
    gl.shaderSource(fs, frag);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error(`顶点 shader 编译失败: ${gl.getShaderInfoLog(vs)}`);
    }
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error(`${key} shader 编译失败: ${gl.getShaderInfoLog(fs)}`);
    }
    const p = gl.createProgram();
    if (!p) throw new Error('无法创建 program');
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`${key} program 链接失败: ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.programs.set(key, p);
    return p;
  }

  private use(key: string, frag: string): WebGLProgram {
    const p = this.compile(frag, key);
    this.gl.useProgram(p);
    return p;
  }

  private bindTex(p: WebGLProgram, name: string, tex: WebGLTexture | null, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(p, name), unit);
  }

  private target(t: RenderTexture): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.width, t.height);
  }

  private draw(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(p, name);
  }

  private getStageTexture(cache: StageCache, stage: StageId): RenderTexture | null {
    return cache.stages[stage] ?? null;
  }

  private clearDownstream(cache: StageCache, fromIndex: number): void {
    for (let i = fromIndex; i < STAGE_ORDER.length; i++) {
      const st = STAGE_ORDER[i];
      const t = cache.stages[st];
      if (t) {
        this.disposeTex(t);
        delete cache.stages[st];
        delete cache.keys[st];
      }
    }
  }

  private createRgbTextureFromData(width: number, height: number, rgb: Float32Array): RenderTexture {
    const gl = this.gl;
    const t = this.createTexture(width, height, 'rgba16f');
    const half = new Uint16Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      half[i * 4] = floatToHalf(rgb[i * 3]);
      half[i * 4 + 1] = floatToHalf(rgb[i * 3 + 1]);
      half[i * 4 + 2] = floatToHalf(rgb[i * 3 + 2]);
      half[i * 4 + 3] = 0x3c00;
    }
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.HALF_FLOAT, half);
    return t;
  }

  private injectStage(
    preview: boolean,
    params: PipelineParams,
    stage: StageId,
    width: number,
    height: number,
    rgb: Float32Array,
  ): void {
    const cache = preview ? this.previewCache : this.fullCache;
    const i = STAGE_ORDER.indexOf(stage);
    this.clearDownstream(cache, i);
    const old = cache.stages[stage];
    if (old) this.disposeTex(old);
    const t = this.createRgbTextureFromData(width, height, rgb);
    cache.stages[stage] = t;
    cache.keys[stage] = this.stageKey(params, stage, width, height, preview);
  }

  private runQualityDemosaic(preview: boolean, params: PipelineParams, display = true): void {
    if (!this.raw) throw new Error('没有 RAW');
    const raw = preview ? this.previewRaw : this.fullRaw;
    const tex = preview ? this.rawPreviewTex : this.rawFullTex;
    if (!raw || !tex) throw new Error('RAW 纹理未初始化');
    const cache = preview ? this.previewCache : this.fullCache;
    const wantKey = this.stageKey(params, 'demosaic', raw.geometry.active.w, raw.geometry.active.h, preview);
    if (cache.stages.demosaic && cache.keys.demosaic === wantKey) return;
    // Render through digital gain (or WB when bypassed) before the CPU demosaic.
    const wb = this.renderChain(params, 'digitalGain', raw, tex, preview ? this.previewFlat : this.fullFlat, preview ? this.flatPreviewTex : this.flatFullTex, cache, preview);
    if (display) {
      if (preview) this.lastPreview = wb.result; else this.lastFull = wb.result;
    }
    const pixels = this.readTextureRed(wb.result.texture);
    const rgb = demosaicAHD({ width: pixels.width, height: pixels.height, data: pixels.data, cfa: raw.cfa });
    this.injectStage(preview, params, 'demosaic', pixels.width, pixels.height, rgb.data);
  }

  private getTemp(cache: StageCache, name: string, width: number, height: number, kind: 'r16f' | 'rgba16f'): RenderTexture {
    const existing = cache.temps.get(name);
    if (existing && existing.width === width && existing.height === height && existing.kind === kind) return existing;
    if (existing) this.disposeTex(existing);
    const t = this.createTexture(width, height, kind);
    cache.temps.set(name, t);
    return t;
  }

  private stageActive(params: PipelineParams, stage: StageId): boolean {
    if (stage === 'levels') return true;
    if (stage === 'flat') return !params.flat.bypass && !!this.flat;
    if (stage === 'wb') return !params.wb.bypass;
    if (stage === 'digitalGain') return !params.digitalGain.bypass;
    if (stage === 'demosaic') return !params.demosaic.bypass;
    if (stage === 'denoise') return !params.denoise.bypass && !params.demosaic.bypass;
    if (stage === 'ccm') return !params.ccm.bypass && !params.demosaic.bypass;
    if (stage === 'gamma') return !params.gamma.bypass && !params.demosaic.bypass;
    if (stage === 'csc') return !params.csc.bypass && !params.gamma.bypass && !params.demosaic.bypass;
    if (stage === 'sharpen') return !params.sharpen.bypass && !params.gamma.bypass && !params.demosaic.bypass;
    return false;
  }

  private stageKey(params: PipelineParams, stage: StageId, width: number, height: number, preview: boolean): string {
    const idx = STAGE_ORDER.indexOf(stage);
    const active = STAGE_ORDER.slice(0, idx + 1).map((s) => this.stageActive(params, s));
    return hashString(stableStringify({
      raw: this.raw?.id,
      flat: this.flat?.id,
      preview,
      width,
      height,
      active,
      stage,
      params: {
        levels: params.levels,
        flat: params.flat,
        wb: params.wb,
        digitalGain: params.digitalGain,
        demosaic: params.demosaic,
        denoise: params.denoise,
        ccm: params.ccm,
        csc: params.csc,
        gamma: params.gamma,
        sharpen: params.sharpen,
      },
    }));
  }

  private renderChain(
    params: PipelineParams,
    target: StageId,
    raw: RawImage,
    rawTex: WebGLTexture,
    flat: FlatField | null,
    flatTex: WebGLTexture | null,
    cache: StageCache,
    preview: boolean,
  ): { result: StageResult; timings: RenderTimings } {
    const gl = this.gl;
    const width = raw.geometry.active.w;
    const height = raw.geometry.active.h;
    const targetIndex = STAGE_ORDER.indexOf(target);
    const timings: Partial<Record<StageId, number>> = {};
    const t0 = performance.now();
    let prev: RenderTexture | null = null;
    let actualStage: StageId = 'levels';
    for (let i = 0; i < STAGE_ORDER.length; i++) {
      const stage = STAGE_ORDER[i];
      if (i > targetIndex) break;
      const active = this.stageActive(params, stage);
      if (!active) {
        const old = cache.stages[stage];
        if (old) {
          this.disposeTex(old);
          delete cache.stages[stage];
          delete cache.keys[stage];
          this.clearDownstream(cache, i + 1);
        }
        continue;
      }
      const key = this.stageKey(params, stage, width, height, preview);
      const cached = cache.stages[stage];
      if (!cached || cache.keys[stage] !== key) {
        if (cached) {
          this.disposeTex(cached);
          delete cache.stages[stage];
          delete cache.keys[stage];
        }
        this.clearDownstream(cache, i + 1);
        const started = performance.now();
        const out = this.renderStage(params, stage, prev, raw, rawTex, flat, flatTex, width, height, cache);
        timings[stage] = performance.now() - started;
        cache.stages[stage] = out;
        cache.keys[stage] = key;
        prev = out;
      } else {
        prev = cached;
      }
      actualStage = stage;
    }
    if (!prev) {
      // Should only happen if a non-levels target was bypassed before any
      // active stage; levels is always active, so this is a safety net.
      throw new Error('没有可显示的 stage 输出');
    }
    const result: StageResult = {
      texture: prev,
      stage: actualStage,
      domain: STAGE_DOMAIN[actualStage],
      width,
      height,
    };
    const totalMs = performance.now() - t0;
    return { result, timings: { stages: timings, totalMs, width, height, scale: preview ? this.previewFactor : this.fullFactor } };
  }

  private renderStage(
    params: PipelineParams,
    stage: StageId,
    input: RenderTexture | null,
    raw: RawImage,
    rawTex: WebGLTexture,
    flat: FlatField | null,
    flatTex: WebGLTexture | null,
    width: number,
    height: number,
    cache: StageCache,
  ): RenderTexture {
    const gl = this.gl;
    const size = [width, height] as const;
    const outKind = stage === 'levels' || stage === 'flat' || stage === 'wb' || stage === 'digitalGain' ? 'r16f' : 'rgba16f';
    const out = this.createTexture(width, height, outKind);
    if (stage === 'levels') {
      const p = this.use('levels', LEVELS_FRAG);
      this.target(out);
      this.bindTex(p, 'uRaw', rawTex, 0);
      gl.uniform2i(this.u(p, 'uSize'), width, height);
      gl.uniform2i(this.u(p, 'uOrigin'), raw.geometry.active.x, raw.geometry.active.y);
      gl.uniform4iv(this.u(p, 'uSites'), raw.cfa.siteChannels);
      const black = params.levels.bypass ? [0, 0, 0, 0] : params.levels.black;
      const white = params.levels.bypass ? defaultLevelsForBitDepth(raw.geometry.bitDepth).white : params.levels.white;
      gl.uniform4fv(this.u(p, 'uBlack'), black);
      gl.uniform4fv(this.u(p, 'uWhite'), white);
      gl.uniform1i(this.u(p, 'uClampNegative'), params.levels.clampNegative && !params.levels.bypass ? 1 : 0);
      this.draw();
      return out;
    }
    if (!input) {
      this.disposeTex(out);
      throw new Error(`stage ${stage} 缺少输入`);
    }
    if (stage === 'flat') {
      if (!flat || !flatTex) {
        this.disposeTex(out);
        return input;
      }
      const p = this.use('flat', FLAT_FRAG);
      this.target(out);
      this.bindTex(p, 'uIn', input.texture, 0);
      this.bindTex(p, 'uFlat', flatTex, 1);
      gl.uniform2i(this.u(p, 'uSize'), width, height);
      gl.uniform2i(this.u(p, 'uFlatOrigin'), flat.raw.geometry.active.x, flat.raw.geometry.active.y);
      gl.uniform4iv(this.u(p, 'uSites'), raw.cfa.siteChannels);
      gl.uniform4fv(this.u(p, 'uFlatBlack'), flat.raw.levels.black);
      gl.uniform4fv(this.u(p, 'uFlatWhite'), flat.raw.levels.white);
      gl.uniform4fv(this.u(p, 'uFlatMeans'), flat.stats.means);
      gl.uniform1f(this.u(p, 'uStrength'), Math.max(0, Math.min(1, params.flat.strength / 100)));
      gl.uniform1f(this.u(p, 'uEpsilon'), params.flat.epsilon);
      gl.uniform1f(this.u(p, 'uMaxGain'), params.flat.maxGain);
      this.draw();
      return out;
    }
    if (stage === 'wb') {
      if (params.wb.bypass) {
        this.disposeTex(out);
        return input;
      }
      const p = this.use('wb', WB_FRAG);
      this.target(out);
      this.bindTex(p, 'uIn', input.texture, 0);
      gl.uniform2i(this.u(p, 'uSize'), width, height);
      gl.uniform4iv(this.u(p, 'uSites'), raw.cfa.siteChannels);
      gl.uniform4fv(this.u(p, 'uWb'), params.wb.multipliers);
      this.draw();
      return out;
    }
    if (stage === 'digitalGain') {
      if (params.digitalGain.bypass) {
        this.disposeTex(out);
        return input;
      }
      const p = this.use('digitalGain', DIGITAL_GAIN_FRAG);
      this.target(out);
      this.bindTex(p, 'uIn', input.texture, 0);
      gl.uniform2i(this.u(p, 'uSize'), width, height);
      gl.uniform1f(this.u(p, 'uGain'), params.digitalGain.global);
      this.draw();
      return out;
    }
    if (stage === 'demosaic') {
      const p = this.use('demosaic', DEMOSAIC_FRAG);
      this.target(out);
      this.bindTex(p, 'uIn', input.texture, 0);
      gl.uniform2i(this.u(p, 'uSize'), width, height);
      gl.uniform4iv(this.u(p, 'uSites'), raw.cfa.siteChannels);
      gl.uniform1i(this.u(p, 'uAlgorithm'), params.demosaic.algorithm === 'bilinear' ? 0 : 1);
      this.draw();
      return out;
    }
    if (stage === 'denoise') {
      const result = this.renderDenoise(params, input, out, width, height, cache);
      return result;
    }
    if (stage === 'ccm') {
      const p = this.use('matrix', MATRIX_FRAG);
      this.target(out);
      this.bindTex(p, 'uIn', input.texture, 0);
      gl.uniform2i(this.u(p, 'uSize'), width, height);
      gl.uniformMatrix3fv(this.u(p, 'uMatrix'), true, effectiveCcm(params));
      this.draw();
      return out;
    }
    if (stage === 'csc') {
      if (params.csc.bypass) {
        this.disposeTex(out);
        return input;
      }
      const p = this.use('csc', CSC_FRAG);
      const transform = effectiveCscTransform(params);
      this.target(out);
      this.bindTex(p, 'uIn', input.texture, 0);
      gl.uniform2i(this.u(p, 'uSize'), width, height);
      gl.uniformMatrix3fv(this.u(p, 'uMatrix'), true, transform.matrix);
      gl.uniform3fv(this.u(p, 'uOffset'), transform.offset);
      this.draw();
      return out;
    }
    if (stage === 'gamma') {
      const p = this.use('gamma', GAMMA_FRAG);
      this.target(out);
      this.bindTex(p, 'uIn', input.texture, 0);
      gl.uniform2i(this.u(p, 'uSize'), width, height);
      gl.uniform1i(this.u(p, 'uMode'), params.gamma.mode === 'srgb' ? 0 : params.gamma.mode === 'gamma22' ? 1 : 2);
      this.draw();
      return out;
    }
    if (stage === 'sharpen') {
      return this.renderSharpen(params, input, out, width, height, cache);
    }
    this.disposeTex(out);
    return input;
  }

  private renderDenoise(
    params: PipelineParams,
    input: RenderTexture,
    out: RenderTexture,
    width: number,
    height: number,
    cache: StageCache,
  ): RenderTexture {
    const gl = this.gl;
    if (params.denoise.method === 'bilateral') {
      const filtered = this.getTemp(cache, 'denoise:bilateral', width, height, 'rgba16f');
      const p = this.use('bilateral', BILATERAL_FRAG);
      const detail = Math.max(0, Math.min(100, params.denoise.detail)) / 100;
      const sigmaS = params.denoise.radius / 2 + 0.5;
      const sigmaR = 0.006 + (1 - detail) * 0.05;
      const strength = Math.max(0, Math.min(1, Math.max(params.denoise.luma, params.denoise.chroma * 0.5) / 100));
      const pass = (src: RenderTexture, dst: RenderTexture, dir: [number, number]) => {
        this.target(dst);
        this.bindTex(p, 'uIn', src.texture, 0);
        this.bindTex(p, 'uGuide', input.texture, 1);
        gl.uniform2i(this.u(p, 'uSize'), width, height);
        gl.uniform2i(this.u(p, 'uDir'), dir[0], dir[1]);
        gl.uniform1i(this.u(p, 'uRadius'), params.denoise.radius);
        gl.uniform1f(this.u(p, 'uSigmaS'), sigmaS);
        gl.uniform1f(this.u(p, 'uSigmaR'), sigmaR);
        gl.uniform1f(this.u(p, 'uStrength'), strength);
        this.draw();
      };
      pass(input, filtered, [1, 0]);
      pass(filtered, out, [0, 1]);
      return out;
    }
    const t0 = this.getTemp(cache, 'denoise:t0', width, height, 'rgba16f');
    const t1 = this.getTemp(cache, 'denoise:t1', width, height, 'rgba16f');
    const h0 = this.getTemp(cache, 'denoise:h0', width, height, 'rgba16f');
    const h1 = this.getTemp(cache, 'denoise:h1', width, height, 'rgba16f');
    const moments = this.use('moments', MOMENTS_FRAG);
    for (let target = 0; target < 2; target++) {
      this.target(target === 0 ? t0 : t1);
      moments; // keep program bound
      this.bindTex(moments, 'uIn', input.texture, 0);
      gl.uniform2i(this.u(moments, 'uSize'), width, height);
      gl.uniform1i(this.u(moments, 'uTarget'), target);
      this.draw();
    }
    const box = this.use('box', BOX_FRAG);
    const radius = params.denoise.radius;
    // Horizontal then vertical, writing back into t0/t1.
    for (const [src, temp] of [[t0, h0], [t1, h1]] as const) {
      this.target(temp);
      this.bindTex(box, 'uIn', src.texture, 0);
      gl.uniform2i(this.u(box, 'uSize'), width, height);
      gl.uniform1i(this.u(box, 'uRadius'), radius);
      gl.uniform2i(this.u(box, 'uDir'), 1, 0);
      this.draw();
    }
    for (const [src, temp] of [[h0, t0], [h1, t1]] as const) {
      this.target(temp);
      this.bindTex(box, 'uIn', src.texture, 0);
      gl.uniform2i(this.u(box, 'uSize'), width, height);
      gl.uniform1i(this.u(box, 'uRadius'), radius);
      gl.uniform2i(this.u(box, 'uDir'), 0, 1);
      this.draw();
    }
    const combine = this.use('denoiseCombine', DENOISE_COMBINE_FRAG);
    this.target(out);
    this.bindTex(combine, 'uOriginal', input.texture, 0);
    this.bindTex(combine, 'uMean0', t0.texture, 1);
    this.bindTex(combine, 'uMean1', t1.texture, 2);
    gl.uniform2i(this.u(combine, 'uSize'), width, height);
    const detail = Math.max(0, Math.min(100, params.denoise.detail)) / 100;
    gl.uniform1f(this.u(combine, 'uLuma'), Math.max(0, Math.min(1, params.denoise.luma / 100)));
    gl.uniform1f(this.u(combine, 'uChroma'), Math.max(0, Math.min(1, params.denoise.chroma / 100)));
    gl.uniform1f(this.u(combine, 'uEpsY'), 1e-4 + (1 - detail) * 2e-2);
    gl.uniform1f(this.u(combine, 'uEpsC'), 1e-3 + (1 - detail) * 5e-2);
    this.draw();
    return out;
  }

  private renderSharpen(
    params: PipelineParams,
    input: RenderTexture,
    out: RenderTexture,
    width: number,
    height: number,
    cache: StageCache,
  ): RenderTexture {
    const gl = this.gl;
    const luma = this.getTemp(cache, 'usm:luma', width, height, 'r16f');
    const h = this.getTemp(cache, 'usm:h', width, height, 'r16f');
    const v = this.getTemp(cache, 'usm:v', width, height, 'r16f');
    const lumaP = this.use('luma', LUMA_FRAG);
    this.target(luma);
    this.bindTex(lumaP, 'uIn', input.texture, 0);
    gl.uniform2i(this.u(lumaP, 'uSize'), width, height);
    this.draw();
    const gauss = this.use('gaussian', GAUSSIAN_FRAG);
    this.target(h);
    this.bindTex(gauss, 'uIn', luma.texture, 0);
    gl.uniform2i(this.u(gauss, 'uSize'), width, height);
    gl.uniform2i(this.u(gauss, 'uDir'), 1, 0);
    gl.uniform1f(this.u(gauss, 'uSigma'), params.sharpen.radius);
    this.draw();
    this.target(v);
    this.bindTex(gauss, 'uIn', h.texture, 0);
    gl.uniform2i(this.u(gauss, 'uSize'), width, height);
    gl.uniform2i(this.u(gauss, 'uDir'), 0, 1);
    gl.uniform1f(this.u(gauss, 'uSigma'), params.sharpen.radius);
    this.draw();
    const combine = this.use('usmCombine', USM_COMBINE_FRAG);
    this.target(out);
    this.bindTex(combine, 'uOriginal', input.texture, 0);
    this.bindTex(combine, 'uBlur', v.texture, 1);
    gl.uniform2i(this.u(combine, 'uSize'), width, height);
    gl.uniform1f(this.u(combine, 'uAmount'), Math.max(0, params.sharpen.amount) / 100);
    gl.uniform1f(this.u(combine, 'uThreshold'), Math.max(0, params.sharpen.threshold));
    this.draw();
    return out;
  }

  renderPreview(params: PipelineParams, target: StageId, options: { display?: boolean } = {}): { result: StageResult; timings: RenderTimings } {
    if (!this.raw || !this.previewRaw || !this.rawPreviewTex) throw new Error('没有 RAW');
    const display = options.display !== false;
    let qualityMs = 0;
    const qualityNeeded = !params.demosaic.bypass &&
      STAGE_ORDER.indexOf(target) >= STAGE_ORDER.indexOf('demosaic') &&
      (params.demosaic.algorithm === 'ahd' || params.demosaic.algorithm === 'rcd');
    if (qualityNeeded) {
      const t0 = performance.now();
      this.runQualityDemosaic(true, params, display);
      qualityMs = performance.now() - t0;
    }
    const r = this.renderChain(params, target, this.previewRaw, this.rawPreviewTex, this.previewFlat, this.flatPreviewTex, this.previewCache, true);
    if (qualityMs > 0) {
      r.timings.stages.demosaic = (r.timings.stages.demosaic ?? 0) + qualityMs;
      r.timings.totalMs += qualityMs;
    }
    if (display) this.lastPreview = r.result;
    return r;
  }

  renderPreviewB(params: PipelineParams, target: StageId): { result: StageResult; timings: RenderTimings } {
    if (!this.raw || !this.previewRaw || !this.rawPreviewTex) throw new Error('没有 RAW');
    const r = this.renderChain(params, target, this.previewRaw, this.rawPreviewTex, this.previewFlat, this.flatPreviewTex, this.previewBCache, true);
    this.lastPreviewB = r.result;
    return r;
  }

  renderFull(params: PipelineParams, target: StageId): { result: StageResult; timings: RenderTimings } {
    if (!this.raw || !this.fullRaw || !this.rawFullTex) throw new Error('没有 RAW');
    let qualityMs = 0;
    const qualityNeeded = !params.demosaic.bypass &&
      STAGE_ORDER.indexOf(target) >= STAGE_ORDER.indexOf('demosaic') &&
      (params.demosaic.algorithm === 'ahd' || params.demosaic.algorithm === 'rcd');
    if (qualityNeeded) {
      const t0 = performance.now();
      this.runQualityDemosaic(false, params);
      qualityMs = performance.now() - t0;
    }
    const r = this.renderChain(params, target, this.fullRaw, this.rawFullTex, this.fullFlat, this.fullFlat ? this.flatFullTex : null, this.fullCache, false);
    if (qualityMs > 0) {
      r.timings.stages.demosaic = (r.timings.stages.demosaic ?? 0) + qualityMs;
      r.timings.totalMs += qualityMs;
    }
    this.lastFull = r.result;
    // Full-res caches are memory-heavy: keep only the target texture.
    for (const [stage, tex] of Object.entries(this.fullCache.stages)) {
      if (stage !== r.result.stage && tex) {
        this.disposeTex(tex);
        delete this.fullCache.stages[stage as StageId];
        delete this.fullCache.keys[stage as StageId];
      }
    }
    for (const [name, tex] of this.fullCache.temps) {
      this.disposeTex(tex);
      this.fullCache.temps.delete(name);
    }
    return r;
  }

  present(view: Viewport): void {
    const gl = this.gl;
    if (this.canvas.width !== view.canvasWidth || this.canvas.height !== view.canvasHeight) {
      this.canvas.width = view.canvasWidth;
      this.canvas.height = view.canvasHeight;
    }
    const result = view.source === 'full' ? this.lastFull : this.lastPreview;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.04, 0.05, 0.06, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!result) return;
    this.lastShown = result;
    const p = this.use('display', DISPLAY_FRAG);
    const bResult = view.mode !== 0 && this.lastPreviewB ? this.lastPreviewB : result;
    this.bindTex(p, 'uA', result.texture.texture, 0);
    this.bindTex(p, 'uB', bResult.texture.texture, 1);
    const imageW = this.raw?.geometry.active.w ?? result.width;
    const imageH = this.raw?.geometry.active.h ?? result.height;
    gl.uniform2i(this.u(p, 'uImageSize'), imageW, imageH);
    gl.uniform2i(this.u(p, 'uTexSize'), result.width, result.height);
    gl.uniform2f(this.u(p, 'uCanvasSize'), this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u(p, 'uPan'), view.panX, view.panY);
    gl.uniform1f(this.u(p, 'uScale'), view.scale);
    gl.uniform1i(this.u(p, 'uMode'), view.mode);
    const domainInt = (d: Domain): number => d === 'raw-cfa' ? 0 : d === 'camera-rgb' ? 1 : d === 'linear-srgb' ? 2 : 3;
    gl.uniform1i(this.u(p, 'uDomain'), domainInt(result.domain));
    gl.uniform1i(this.u(p, 'uDomainB'), domainInt(bResult.domain));
    gl.uniform1i(this.u(p, 'uFalseColor'), view.falseColor ? 1 : 0);
    gl.uniform1i(this.u(p, 'uShowClipping'), view.showClipping ? 1 : 0);
    gl.uniform1i(this.u(p, 'uLinearDisplay'), view.linearDisplay ? 1 : 0);
    gl.uniform1i(this.u(p, 'uInterp'), result.domain === 'raw-cfa' ? 0 : 1);
    gl.uniform4iv(this.u(p, 'uCfaSites'), this.raw?.cfa.siteChannels ?? [0, 1, 2, 3]);
    gl.uniform1f(this.u(p, 'uSplit'), view.split);
    gl.uniform1f(this.u(p, 'uFlicker'), view.flicker);
    gl.uniform1f(this.u(p, 'uDiffGain'), view.diffGain);
    gl.uniform1i(this.u(p, 'uDiffSigned'), view.diffSigned ? 1 : 0);
    gl.uniform3f(this.u(p, 'uBackground'), 0.045, 0.055, 0.065);
    this.draw();
  }

  private readTexture(tex: RenderTexture, rect?: { x: number; y: number; w: number; h: number }): ReadPixels {
    const x = Math.max(0, Math.floor(rect?.x ?? 0));
    const y = Math.max(0, Math.floor(rect?.y ?? 0));
    const w = Math.max(1, Math.min(tex.width - x, Math.floor(rect?.w ?? tex.width)));
    const h = Math.max(1, Math.min(tex.height - y, Math.floor(rect?.h ?? tex.height)));
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fbo);
    const out = new Float32Array(w * h * 4);
    if (tex.kind === 'r16f') {
      const buf = new Uint16Array(w * h);
      gl.readPixels(x, y, w, h, gl.RED, gl.HALF_FLOAT, buf);
      for (let i = 0; i < w * h; i++) {
        const v = halfToFloat(buf[i]);
        out[i * 4] = v;
        out[i * 4 + 1] = v;
        out[i * 4 + 2] = v;
        out[i * 4 + 3] = 1;
      }
    } else {
      const buf = new Uint16Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.HALF_FLOAT, buf);
      for (let i = 0; i < out.length; i++) out[i] = halfToFloat(buf[i]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width: w, height: h, data: out };
  }

  private readTextureRed(tex: RenderTexture, rect?: { x: number; y: number; w: number; h: number }): ReadRed {
    const x = Math.max(0, Math.floor(rect?.x ?? 0));
    const y = Math.max(0, Math.floor(rect?.y ?? 0));
    const w = Math.max(1, Math.min(tex.width - x, Math.floor(rect?.w ?? tex.width)));
    const h = Math.max(1, Math.min(tex.height - y, Math.floor(rect?.h ?? tex.height)));
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fbo);
    const out = new Float32Array(w * h);
    if (tex.kind === 'r16f') {
      const buf = new Uint16Array(w * h);
      gl.readPixels(x, y, w, h, gl.RED, gl.HALF_FLOAT, buf);
      for (let i = 0; i < out.length; i++) out[i] = halfToFloat(buf[i]);
    } else {
      const buf = new Uint16Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.HALF_FLOAT, buf);
      for (let i = 0; i < out.length; i++) out[i] = halfToFloat(buf[i * 4]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width: w, height: h, data: out };
  }

  readStage(source: 'preview' | 'full', stage: StageId, rect?: { x: number; y: number; w: number; h: number }): ReadPixels {
    const result = source === 'preview' ? this.lastPreview : this.lastFull;
    if (!result) throw new Error('stage 尚未渲染');
    return this.readTexture(result.texture, rect);
  }

  /** Read a specific render result without relying on the last displayed stage. */
  readResult(result: StageResult, rect?: { x: number; y: number; w: number; h: number }): ReadPixels {
    return this.readTexture(result.texture, rect);
  }

  /** Read the pixel currently shown on the canvas at an image-space position. */
  sampleDisplayed(x: number, y: number): { rgb: [number, number, number]; stage: StageId; domain: Domain; width: number; height: number } | null {
    const result = this.lastShown;
    const raw = this.raw;
    if (!result || !raw) return null;
    const imgW = raw.geometry.active.w;
    const imgH = raw.geometry.active.h;
    const px = Math.max(0, Math.min(result.width - 1, Math.round((x / Math.max(1, imgW)) * result.width)));
    const py = Math.max(0, Math.min(result.height - 1, Math.round((y / Math.max(1, imgH)) * result.height)));
    const read = this.readTexture(result.texture, { x: px, y: py, w: 1, h: 1 });
    return {
      rgb: [read.data[0], read.data[1], read.data[2]],
      stage: result.stage,
      domain: result.domain,
      width: result.width,
      height: result.height,
    };
  }

  readPreviewB(stage: StageId, rect?: { x: number; y: number; w: number; h: number }): ReadPixels {
    if (!this.lastPreviewB) throw new Error('B 预览尚未渲染');
    return this.readTexture(this.lastPreviewB.texture, rect);
  }

  async exportPng(params: PipelineParams, bitDepth: 8 | 16, crop?: { x: number; y: number; w: number; h: number } | null, target: StageId = 'sharpen'): Promise<{ data: Uint8Array; width: number; height: number; scaled: boolean }> {
    if (!this.raw) throw new Error('没有 RAW');
    const r = this.renderFull(params, target);
    const active = this.fullRaw!.geometry.active;
    const tex = r.result.texture;
    const read = this.readStage('full', target);
    const sx = active.w / tex.width;
    const sy = active.h / tex.height;
    const cropX = crop ? Math.max(0, Math.floor(crop.x / sx)) : 0;
    const cropY = crop ? Math.max(0, Math.floor(crop.y / sy)) : 0;
    const cropW = crop ? Math.max(1, Math.min(tex.width - cropX, Math.floor(crop.w / sx))) : tex.width;
    const cropH = crop ? Math.max(1, Math.min(tex.height - cropY, Math.floor(crop.h / sy))) : tex.height;
    const rgba = read.data;
    const n = cropW * cropH;
    if (bitDepth === 8) {
      const out = new Uint8Array(n * 3);
      for (let y = 0; y < cropH; y++) {
        for (let x = 0; x < cropW; x++) {
          const si = ((y + cropY) * read.width + x + cropX) * 4;
          const di = (y * cropW + x) * 3;
          out[di] = Math.round(Math.max(0, Math.min(1, rgba[si])) * 255);
          out[di + 1] = Math.round(Math.max(0, Math.min(1, rgba[si + 1])) * 255);
          out[di + 2] = Math.round(Math.max(0, Math.min(1, rgba[si + 2])) * 255);
        }
      }
      const { encode } = await import('fast-png');
      return { data: encode({ width: cropW, height: cropH, data: out, channels: 3, depth: 8 }), width: cropW, height: cropH, scaled: this.fullFactor > 1 };
    }
    const out = new Uint16Array(n * 3);
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const si = ((y + cropY) * read.width + x + cropX) * 4;
        const di = (y * cropW + x) * 3;
        out[di] = Math.round(Math.max(0, Math.min(1, rgba[si])) * 65535);
        out[di + 1] = Math.round(Math.max(0, Math.min(1, rgba[si + 1])) * 65535);
        out[di + 2] = Math.round(Math.max(0, Math.min(1, rgba[si + 2])) * 65535);
      }
    }
    const { encode } = await import('fast-png');
    return { data: encode({ width: cropW, height: cropH, data: out, channels: 3, depth: 16 }), width: cropW, height: cropH, scaled: this.fullFactor > 1 };
  }

  /**
   * Render a full-res stage and return normalized RGBA floats for the ROI.
   * This is used by analysis; the full-res target texture is retained until
   * the next full render.
   */
  readFullStage(stage: StageId, params: PipelineParams, rect: { x: number; y: number; w: number; h: number }): ReadPixels {
    this.renderFull(params, stage);
    const scale = this.fullFactor;
    const r = {
      x: rect.x / scale,
      y: rect.y / scale,
      w: rect.w / scale,
      h: rect.h / scale,
    };
    return this.readStage('full', stage, r);
  }

  get cacheBytes(): number {
    let n = 0;
    for (const cache of [this.previewCache, this.previewBCache, this.fullCache]) {
      for (const t of Object.values(cache.stages)) n += t?.bytes ?? 0;
      for (const t of cache.temps.values()) n += t.bytes;
    }
    if (this.rawPreviewTex) n += (this.previewRaw?.data.byteLength ?? 0);
    if (this.rawFullTex) n += (this.fullRaw?.data.byteLength ?? 0);
    return n;
  }
}

export function makeCcmFromTotal(total: Mat3, csc: Mat3): Mat3 | null {
  return ccmFromTotal(total, csc);
}
