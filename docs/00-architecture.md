# RAW Lab — RAW 图像编辑与 ISP 分析 Web 工具

> 架构 / 数据模型 / 性能预算 / 风险 / 分阶段计划  
> 状态：**已按 P0–P7 实现；验收与实测见 [`02-acceptance.md`](02-acceptance.md)**  
> 目标运行环境：桌面 Chrome 最新稳定版；纯前端、无后端  
> 建议许可证：Apache-2.0（项目代码）+ 第三方 NOTICE

---

## 0. 决策摘要

| 项目 | 建议方案 | 理由 |
|---|---|---|
| 应用形态 | React + TypeScript + Vite 单页应用 | 纯静态部署；Worker/OffscreenCanvas 支持成熟 |
| 渲染 | 每张图一个 Render Worker，Worker 内持有 WebGL2 + OffscreenCanvas | UI 主线程不碰像素；预览/全分辨率/分析互不阻塞 |
| 解码 | LibRaw WASM + 自写 DNG 元数据解析器 + 自写裸 RAW 解包器 | LibRaw 负责压缩 DNG/像素解包；DNG 色彩标签由自己精确解析 |
| 内部精度 | RAW 归一化/管线中间图 RGBA16F；关键矩阵与 CPU 参考用 float64 | 兼顾显存与精度；分析用 CPU float64 复核 |
| CPU 重活 | Quality demosaic、FFT、MTF、CCM 优化、PNG 编码放 Worker 池 | 不阻塞 UI；可取消、可进度 |
| 状态 | Zustand + 不可变参数快照；Worker 只接收序列化参数 | 阶段缓存可按参数哈希失效；A/B/快照天然支持 |
| 预览 | 最长边 2048；拖动时 Fast proxy；1:1 时按可见 ROI 请求全分辨率 | 满足 150ms 响应，同时保留像素级检查 |
| 全分辨率 | 24MP 整帧；>32MP 分块；100MP 只保留降采样预览 + 按需 ROI/分块导出 | 避免 100MP 单纹理爆显存 |
| 色彩 | 线性 sRGB 内部；最终 sRGB；CCM 是相机 RGB → 线性 sRGB 的相机 Profile；CSC 在 Gamma 后做 RGB → YUV → RGB 调整 | 与 DNG/ColorChecker 定义一致；CSC 调整使用标准 YCbCr 矩阵 |
| 工程文件 | JSON `.rawlab.json`，不嵌入 RAW，保存 SHA-256/尺寸/裸 RAW 配置 | 可审阅、可版本管理；重开时重新关联 |
| 自动保存 | IndexedDB 保存工程 JSON + 缩略图 + 预设 | 刷新/崩溃恢复；RAW 仍需重新关联 |
| 测试 | Vitest（算法/参考实现）+ Playwright（E2E/截图）+ 独立性能页 | 算法正确性与浏览器行为分开验证 |

**需要用户确认的 4 个关键点见第 16 节。**

---

## 1. 目标与非目标

### 1.1 首版目标

- 导入 DNG 与可配置裸 RAW；裸 RAW 配置错误可定位、可自动探测建议。
- 固定 11 级 ISP 管线，顺序不可重排；每级可 bypass、调参、查看中间输出。
- 平场、灰点白平衡、数字增益、CCM 相机 Profile/ColorChecker 拟合、CSC YUV 调整、Fast/Quality demosaic、降噪、USM、sRGB 输出。
- 直方图、像素探针、SNR、MTF、ΔE00/ΔC、波形、噪声频谱、差异图。
- 2–4 图对比、同步缩放/平移、参数快照；工程文件/预设导入导出。
- 24MP Fast 全分辨率 <1s、预览 <150ms、Quality <3s、冷启动 <10s、内存 <2GB。
- 100MP 不崩溃：降采样预览、ROI/分块处理、分块导出。

### 1.2 非目标

PDF 报告、云/账号、视频 RAW、HDR/P3、DNG 写出、批量队列、图层/蒙版/液化。  
不承诺集显达到 1s；集显记录实测值并可降级。

---

## 2. 总体架构

### 2.1 线程与组件

```text
┌───────────────────────────── Main Thread (React) ─────────────────────────────┐
│  App Shell / 中文暗色 UI / Zustand Store / 命令调度 / 文件与工程管理           │
│                                                                              │
│  ImageSessionManager                                                         │
│   ├─ active session: 全分辨率 GPU 缓存 + 2048 预览                           │
│   ├─ inactive sessions: 预览/缩略图 LRU，不保留全分辨率                      │
│   └─ 2–4 pane compare: 每 pane 一个可见 canvas + 独立参数                    │
└───────┬───────────────────────┬────────────────────────┬─────────────────────┘
        │ postMessage/Transfer  │ ROI / analysis jobs    │ FSA / IndexedDB
        ▼                       ▼                        ▼
┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────────┐
│ Decode Worker    │   │ Analysis Workers     │   │ Persistence              │
│ - LibRaw WASM    │   │ - SNR / MTF / ΔE00   │   │ - IndexedDB autosave     │
│ - DNG tag parser │   │ - FFT / noise PSD    │   │ - File System Access     │
│ - bare unpacker  │   │ - ColorChecker fit   │   │ - SHA-256 / relink       │
│ - validation     │   │ - diff metrics       │   │ - project/preset JSON    │
│ - SHA-256        │   │ float64 CPU          │   │                          │
└────────┬─────────┘   └──────────▲───────────┘   └──────────────────────────┘
         │ RawImage (U16 + meta)  │ ROI float32/F16
         ▼                        │
┌────────────────────────────────┴─────────────────────────────────────────────┐
│ Render Worker (每图一个)                                                      │
│  OffscreenCanvas + WebGL2 (RGBA16F, EXT_color_buffer_float)                   │
│  Stage Graph → GPU passes → preview canvas / full-res texture / readback     │
│  Stage cache (preview all stages; full-res final only), tile scheduler       │
│  GPU histogram/reduction, timing, context-loss handling                      │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ CPU quality demosaic / tiled jobs
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CPU Pool (navigator.hardwareConcurrency - 1, cap 4–6)                        │
│  AHD/RCD (可选) / PNG encode / 2D FFT / ColorChecker optimizer               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键线程决策

1. **RAW 像素只存在 Render Worker 中。** Decode Worker 解码后把 `Uint16Array` 通过 Transferable 交给 Render Worker；主线程只拿元数据、直方图、缩略图。避免主线程持有 24–100MP 缓冲。
2. **每张图独立 Render Worker。** 2–4 图对比时各自拥有 OffscreenCanvas 和 GL 上下文；只有活动图保留全分辨率纹理，其他图只保留预览。
3. **Quality demosaic 在 CPU Worker 池。** Render Worker 负责 Fast/GPU 路径；Quality 任务拆 tile，带 halo，进度回传；完成后上传为纹理。若 JS 版 AHD 达不到 3s，热循环迁移到 Rust/WASM。
4. **分析不在主线程。** GPU 能做的（直方图、ROI 归约）在 Render Worker；FFT/MTF/ΔE/优化在 Analysis Worker；主线程只做展示。
5. **全链路 latest-wins。** 每个请求带 `generation`；参数变化立即递增 generation；过期结果丢弃。CPU 任务协作式检查取消；GPU 按 tile/行检查。
6. **不需要 SharedArrayBuffer / COOP-COEP。** 全部用 Transferable，便于 GitHub Pages 等静态托管。

### 2.3 一次预览请求的数据流

```text
UI slider
  → Zustand setParams (throttle to rAF)
  → ImageSessionManager.renderPreview(generation, params, targetStage)
  → Render Worker:
       stage cache lookup by upstream hash
       invalidate only affected stage onward
       GPU passes at 2048 longest edge
       present to OffscreenCanvas
  → { rendered, generation, timings, cacheBytes }
  → 主线程丢弃旧 generation，更新耗时/内存状态
```

### 2.4 一次全分辨率请求的数据流

```text
Commit (slider release / 导出 / 分析)
  → Render Worker:
       24MP: 整帧 F16 纹理链，关闭交互代理
       >32MP: TileScheduler 分块（halo 重叠），只保留最终输出纹理
       Quality: 先显示 Fast 结果，同时 CPU 池跑 AHD，完成替换
  → 全分辨率结果可显示 / 可读 ROI / 可编码 PNG
```

---

## 3. 模块划分

| 模块 | 路径（建议） | 职责 | 依赖 |
|---|---|---|---|
| UI Shell | `src/app`, `src/ui` | 布局、暗色主题、面板、对话框、快捷键 | React, Radix, Tailwind |
| State | `src/state` | Zustand store、选择器、命令、快照、撤销边界 | 纯 TS |
| Session | `src/state/session` | 每图 Worker 生命周期、请求代际、取消、LRU | Worker API |
| Raw Core | `src/core/raw` | 裸 RAW 解包、DNG 元数据、校验、诊断、CFA | 纯 TS |
| Decode | `src/workers/decode.worker.ts` | LibRaw WASM 封装、SHA-256、裸 RAW 解码 | LibRaw WASM |
| Color | `src/core/color` | 矩阵、DNG 色彩推导、Bradford、Lab、ΔE00、CCM 拟合 | 纯 TS |
| Pipeline | `src/core/pipeline` | Stage registry、参数 schema、哈希、参考实现、调度 | 纯 TS |
| Demosaic | `src/core/demosaic` | Bilinear、MHC、AHD（可选 RCD） | 纯 TS |
| Denoise | `src/core/denoise` | Guided filter / bilateral | 纯 TS |
| GPU | `src/gpu` | WebGL2 上下文、纹理、pass、shader、readback、timer | WebGL2 |
| Render Worker | `src/workers/render.worker.ts` | Stage graph 执行、缓存、tile、OffscreenCanvas | GPU + core |
| Analysis | `src/core/analysis`, `src/workers/analysis.worker.ts` | 直方图、SNR、MTF、波形、FFT、差异 | 纯 TS + Worker |
| ColorChecker | `src/core/colorchecker` | 透视网格、采样、LS、ΔE00 优化 | core/color |
| Project | `src/core/project` | JSON schema、迁移、序列化、relink | Zod/纯 TS |
| Presets | `src/core/presets` | CRUD、导入导出、校验 | 纯 TS |
| PNG | `src/lib/png` | 8/16-bit 编码、sRGB chunk、分块导出 | fast-png |
| Persistence | `src/lib/persistence` | IndexedDB、FSA、SHA-256 | 浏览器 API |
| Tests | `tests/unit`, `tests/e2e`, `tests/perf` | 参考实现/金标/E2E/基准 | Vitest, Playwright |

**分层规则：**

- `core/**` 不依赖 React、DOM、WebGL、Worker；只接收 TypedArray 和纯数据。
- `gpu/**` 只依赖 `core/color` 的矩阵数学和 stage 描述，不依赖 UI。
- `ui/**` 不直接 `postMessage`；统一走 SessionManager。
- 每个 stage 一个目录，包含 `params.ts`（schema/defaults）、`cpu.ts`（参考实现）、`shader.glsl`、`stage.ts`（契约）。
- 分析算法为纯函数：`(input: Float32Array, roi, params) => result`，方便 Vitest 与 Worker 复用。

---

## 4. 数据模型

以下为 TypeScript 结构草案，不是最终实现。矩阵一律 **row-major**，向量为列向量，`out = M * in`；坐标 0-based，矩形 `[x, x+w) × [y, y+h)`。

### 4.1 基础类型

```ts
type CfaPattern = 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG';
type ChannelId = 'R' | 'G1' | 'G2' | 'B';
type BitDepth = 8 | 10 | 12 | 14 | 16;
type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type Mat3 = [number, number, number, number, number, number, number, number, number];
type Vec4 = [number, number, number, number];

// G1 = 与 R 同一行的绿；G2 = 与 B 同一行的绿。
// 每个 CFA 位置的通道映射由 cfa.channelAt(row,col) 给出。
interface CfaLayout {
  pattern: CfaPattern;
  sites: [ChannelId, ChannelId, ChannelId, ChannelId]; // tl, tr, bl, br
  phaseOrigin: Point;                 // CFA 相位的参考原点（通常 active.x/y）
}

// 注意：active.x / active.y 为奇数时，裁剪后 2x2 CFA 相位会翻转。
// 解码器必须基于 active 原点重新计算 sites，不能直接把存储图案当作有效图案。
```

### 4.2 RawImage

```ts
interface PackingSpec {
  kind: 'unpacked' | 'packed';
  container?: 'u8' | 'u16';          // unpacked
  endian?: 'le' | 'be';              // u16 container
  alignment?: 'right' | 'left';      // 数据在容器中的对齐；left 需右移
  bitOrder?: 'lsb' | 'msb';          // packed 连续位流
  group?: 'continuous' | 'mipi10' | 'mipi12' | 'mipi14';
}

interface RawGeometry {
  storedWidth: number;               // 含 dummy/margin 的存储宽
  storedHeight: number;
  rowStrideBytes: number;            // 0 = 自动
  active: Rect;                      // 有效成像区域（存储坐标）
  bitDepth: BitDepth;
  packing: PackingSpec;
}

interface RawLevels {
  black: Vec4;                       // DN, [R,G1,G2,B]
  white: Vec4;                       // DN
  source: 'dng' | 'libraw' | 'user';
}

interface RawImage {
  id: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  kind: 'dng' | 'bare';
  geometry: RawGeometry;
  cfa: CfaLayout;
  data: Uint16Array;                 // 存储缓冲；按 rowStride 访问
  levels: RawLevels;
  wb: {
    asShot: Vec4 | null;             // 已归一化 G=1
    source: 'dng' | 'libraw' | 'none';
  };
  color: DngColorMeta | null;
  orientation: 1 | 3 | 6 | 8;        // EXIF 方向，显示/导出用
  decoder: { name: string; version: string; libraw?: string };
  diagnostics: RawDiagnostics;
  createdAt: number;
}

interface RawDiagnostics {
  requiredBytes: number;
  actualBytes: number;
  bytesDelta: number;
  perChannel: Array<{
    min: number; p1: number; p50: number; p99: number; max: number;
    belowBlack: number; aboveWhite: number;
  }>;
  cfaConsistency: number;            // 0..1，G1/G2 与通道比例一致性评分
  warnings: DiagnosticItem[];
  suggestions: DiagnosticSuggestion[];// 例如 offset/stride/CFA 候选
}
```

**裸 RAW 配置（用户输入）：**

```ts
interface BareRawConfig {
  width: number;                     // 存储宽
  height: number;                    // 存储高
  cfa: CfaPattern;
  bitDepth: BitDepth;
  packing: PackingSpec;
  headerOffset: number;              // bytes
  rowStride: number;                 // bytes, 0=auto
  active?: Rect;                     // 默认全图
  black: number | Vec4;              // 标量或逐 CFA
  white: number | Vec4;
  endian?: 'le' | 'be';              // 若未在 packing 中指定
  sampleShift?: 0 | 2 | 4 | 6 | 8;   // 左对齐时的右移位数
  byteLength?: number;               // 期望文件长度，用于校验
}
```

**支持范围（首版明确列出，避免“万能解析器”承诺）：**

- 8-bit unpacked。
- 10/12/14/16-bit unpacked，u16 LE/BE，右对齐或左对齐。
- 10/12/14-bit 连续位流 packed，LSB-first / MSB-first。
- 有样本时增加 MIPI RAW10/12/14（4/2/2 像素分组）。
- 不支持：厂商私有压缩裸流、YUV、Foveon、X-Trans（首版）。

### 4.3 FlatField

```ts
interface FlatField {
  id: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  raw: RawImage;                     // 已按主图同配置解码
  compatibility: {
    sameGeometry: boolean;
    sameCfa: boolean;
    sameBitDepth: boolean;
    sameActiveArea: boolean;
  };
  stats: {
    means: Vec4;                     // 平场归一化后逐通道均值
    validFraction: Vec4;             // 非零/非饱和比例
    clippedFraction: Vec4;
    maxGain: Vec4;
  };
  gainPreview?: ImageBitmap;         // 降采样 gain 可视化，仅 UI
}
```

平场必须是 DNG 或裸 RAW，且与主图同分辨率、同 CFA、同位宽；active area 需一致。平场自己的黑/白电平用于归一化。缺失/不匹配时拒绝并给出具体字段差异。

### 4.4 PipelineStage 与参数

```ts
type StageId =
  | 'levels' | 'flat' | 'wb' | 'demosaic' | 'denoise'
  | 'ccm' | 'csc' | 'gamma' | 'sharpen' | 'output';

type Domain =
  | 'raw-cfa'        // 归一化 CFA 线性值
  | 'camera-rgb'     // 去马赛克后的相机 RGB（已 WB）
  | 'linear-srgb'
  | 'display-srgb';

interface StageContract<P> {
  id: StageId;
  label: string;
  order: number;
  input: Domain;
  output: Domain;
  schema: Schema<P>;                 // Zod schema（运行时校验 + 默认值）
  defaults: P;
  bypassable: boolean;
  gpu: boolean;
  cpuReference?: boolean;
  halo: number;                      // 分块所需重叠像素
  cache: 'preview' | 'full' | 'none';
  analysisStages: boolean;           // 是否出现在分析阶段下拉
}

interface PipelineParams {
  schemaVersion: 1;

  levels: {
    bypass: boolean;
    black: Vec4;
    white: Vec4;
    clampNegative: boolean;          // 默认 true；分析可关闭
    source: 'metadata' | 'custom';
  };

  flat: {
    bypass: boolean;
    flatId: string | null;           // 工程内引用；预设不保存
    strength: number;                // 0..100
    epsilon: number;                 // 默认 1e-4
    maxGain: number;                 // 默认 8
  };

  wb: {
    bypass: boolean;
    mode: 'as-shot' | 'custom' | 'picked';
    multipliers: Vec4;               // 归一化 G=1
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
    luma: number;                    // 0..100
    chroma: number;                  // 0..100
    detail: number;                  // 保边/细节，0..100
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
    amount: number;                  // 0..200 (%)
    radius: number;                  // 0.5..3 px
    threshold: number;               // 0..0.2 (gamma 域)
  };

  output: {
    crop: Rect | null;               // 传感器坐标；导出时应用
    bitDepth: 8 | 16;
    format: 'png';
  };
}
```

**阶段契约表：**

| # | stage | 输入 → 输出 | GPU | halo | 说明 |
|---|---|---|---|---|---|
| 1 | levels | raw DN → raw-cfa | 是 | 0 | 黑电平扣除、白电平归一化；可 fuse 到 2/3 |
| 2 | flat | raw-cfa → raw-cfa | 是 | 0 | 采样平场，逐像素 gain；零值保护 |
| 3 | wb | raw-cfa → raw-cfa | 是 | 0 | 逐 CFA 乘增益，G=1 |
| 4 | digitalGain | raw-cfa → raw-cfa | 是 | 0 | 全局增益，乘在 WB 后的 RAW CFA 上；默认 BYP |
| 5 | demosaic | raw-cfa → camera-rgb | Fast GPU / Quality CPU | 2–3 | Bilinear/MHC；AHD/RCD |
| 6 | denoise | camera-rgb → camera-rgb | 是 | radius | 亮度/色度分离，guided/bilateral |
| 7 | ccm | camera-rgb → linear-srgb | 是 | 0 | 相机 Profile：DNG ForwardMatrix/ColorMatrix，默认非单位阵 |
| 8 | gamma | linear-srgb → display-srgb | 是 | 0 | sRGB EOTF 或 gamma 2.2 |
| 9 | csc | display-srgb → display-srgb | 是 | 0 | RGB→YUV→调整→RGB；标准矩阵 + 4 项调整 |
| 10 | sharpen | display-srgb → display-srgb | 是 | radius | USM，gamma 域，亮度通道 |
| 11 | output | display-srgb → PNG | CPU | 0 | 裁剪、8/16-bit 量化、编码 |

**缓存键：**

```ts
key(stage) = hash(
  rawId, flatRevision, sizeClass,
  params.levels..params[stage]  // 到该 stage 的所有上游参数
)
```

某个参数变化只使该 stage 及其下游缓存失效。例如 WB 改变不会重算 levels/flat；CCM 改变不会重算 demosaic。

### 4.5 Project

```ts
interface ProjectFile {
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
    split: number;                   // A/B 分割位置 0..1
    flickerHz: number;
  };
  analysis: {
    stage: StageId;
    rois: Partial<Record<AnalysisKind, Rect[]>>;
    probes: ProbePoint[];
  };
  ui: {
    previewLongEdge: 2048;
    showClipping: boolean;
    theme: 'dark';
  };
}

interface ProjectImage {
  id: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  kind: 'dng' | 'bare';
  bareConfig?: BareRawConfig;        // 重关联用
  decodedMeta: {                     // 仅展示/校验，不代替重新解码
    width: number; height: number; cfa: CfaPattern; bitDepth: BitDepth;
    levels: RawLevels; orientation: number;
  };
  params: PipelineParams;
  snapshots: PipelineSnapshot[];
  colorChecker?: ColorCheckerSession;
}

interface FlatFileRef {
  id: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  bareConfig?: BareRawConfig;
}

interface PipelineSnapshot {
  id: string;
  name: string;
  createdAt: string;
  params: PipelineParams;
}
```

**不保存：** RAW 像素、平场像素、缩略图（缩略图进 IndexedDB）、绝对路径（浏览器也不应依赖）、预设本体。

### 4.6 Preset

```ts
interface Preset {
  schema: 'rawlab.preset';
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  params: PresetPipelineParams;      // 只含管线参数
}

// 去掉文件绑定字段：flat.flatId、output.crop；应用时保留当前图的值。
type PresetPipelineParams = Omit<PipelineParams, 'flat' | 'output'> & {
  flat: Omit<PipelineParams['flat'], 'flatId'>;
  output: Omit<PipelineParams['output'], 'crop'>;
};
```

预设导入需做 schema 校验、数值范围收敛、矩阵有限性检查；不包含任何 RAW 数据或路径。

### 4.7 AnalysisResult

```ts
type AnalysisKind =
  | 'histogram' | 'probe' | 'snr' | 'mtf'
  | 'colorchecker' | 'waveform' | 'noise' | 'diff';

interface AnalysisMeta {
  id: string;
  imageId: string;
  stage: StageId;
  stageDomain: Domain;
  roi: Rect | null;
  paramsHash: string;
  createdAt: number;
  durationMs: number;
  warnings: string[];
}

interface HistogramResult extends AnalysisMeta {
  bins: 256 | 1024;
  channels: { r: Uint32Array; g: Uint32Array; b: Uint32Array; y: Uint32Array };
  clipped: { low: Vec4; high: Vec4 };
  total: number;
  min: number; max: number; mean: number;
  scale: 'linear' | 'log';
}

interface ProbePoint {
  id: string;
  x: number; y: number;              // 传感器坐标
  label?: string;
}

interface ProbeResult extends AnalysisMeta {
  points: Array<{
    id: string; x: number; y: number;
    rawCfa: { channel: ChannelId; dn: number; normalized: number };
    stageRgb: [number, number, number];
    wbMultipliers: Vec4;
    cfaSite: [ChannelId, ChannelId, ChannelId, ChannelId];
  }>;
}

interface SnrResult extends AnalysisMeta {
  perChannel: Array<{
    channel: 'R' | 'G' | 'B' | 'Y';
    mean: number; std: number; snrDb: number; samples: number;
  }>;
  domain: 'linear';
}

interface MtfResult extends AnalysisMeta {
  perChannel: Array<{
    channel: 'R' | 'G' | 'B' | 'Y';
    mtf50: number; mtf10: number;    // cycles/pixel
    curve: Array<{ f: number; mtf: number }>;
  }>;
  edge: { angleDeg: number; contrast: number; oversampling: 4 };
}

interface ColorCheckerResult extends AnalysisMeta {
  patches: Array<{
    index: number; name: string;
    refLab: [number, number, number];
    measuredLab: [number, number, number];
    dE00: number;
    dC: number;                      // ΔC' = C'_measured - C'_ref
    clipped: boolean;
    used: boolean;
  }>;
  meanDE00: number; maxDE00: number;
  meanAbsDC: number;
  matrixTotal: Mat3;                 // camera RGB → linear sRGB
  matrixCcm: Mat3;
  validCount: number;
  method: 'ls' | 'de00-optimized';
}

interface WaveformResult extends AnalysisMeta {
  width: number; height: number;
  rgba: Uint8ClampedArray;           // 可直接 putImageData
  mode: 'luma' | 'parade';
  scale: 'linear' | 'gamma';
}

interface NoiseSpectrumResult extends AnalysisMeta {
  width: number; height: number;
  spectrum: Float32Array;            // log10 power, row-major
  radial: Array<{ r: number; power: number }>;
  psdH: Float32Array;
  psdV: Float32Array;
  detrend: 'plane' | 'mean';
  window: 'hann';
}

interface DiffResult extends AnalysisMeta {
  a: { imageId: string; stage: StageId };
  b: { imageId: string; stage: StageId };
  metrics: { mae: number; psnrDb: number; maxDiff: number };
  gain: number;
  mode: 'abs' | 'signed';
  rgba?: Uint8ClampedArray;          // 预览差异图
}
```

---

## 5. 固定管线细节

### 5.1 数据域与精度

- RAW 解码值：`Uint16` DN；黑/白电平为 DN。
- Stage 1 输出：`F16` 归一化 CFA；可选 clamp 负数。
- Stage 2/3：CFA F16。
- Stage 4 输出：camera RGB F16（3 通道存 RGBA16F，A 未用）。
- Stage 7/9：camera RGB → linear sRGB → display sRGB F16；矩阵用 float32 常量，CPU 参考用 float64。
- Stage 8/9：display sRGB F16。
- 量化：PNG 8-bit 用 `round(clamp(v,0,1)*255)`；16-bit 用 `round(v*65535)`。量化前不额外抖动（保持可复现），可选 dither 后续再加。

### 5.2 Stage 1：黑电平 + 白电平

对每个 CFA 位置 c：

\[
x(p) = \frac{d(p) - B_c}{W_c - B_c}
\]

- `B_c`、`W_c` 可为标量或逐 CFA；要求 `W_c > B_c`。
- 默认保留负值（噪声/黑电平误差分析），在 gamma 前 clamp；UI 可切换 `clampNegative`。
- 白电平可超过 1（高光余量），不在此处 clip；输出阶段/显示时 clamp。

### 5.3 Stage 2：平场/镜头暗影

平场归一化：

\[
f(p) = \frac{F(p) - B^F_c}{W^F_c - B^F_c}
\]

逐通道均值（排除零/饱和平场像素）：

\[
\mu_c = \operatorname{mean}_{p \in c,\; \epsilon < f(p) < 1-\epsilon} f(p)
\]

逐像素 gain：

\[
g_c(p) = \operatorname{clamp}\left(\frac{\mu_c}{\max(f(p), \epsilon)},\; \frac{1}{G_{max}},\; G_{max}\right)
\]

若 \(f(p)<\epsilon\)，则该像素 gain 置 1（不放大），并计入 mask 统计。  
归一化到 G=1：先计算有效绿像素的平均 gain

\[
\bar g_G = \operatorname{mean}\{g_{G1}(p), g_{G2}(p)\}
\]

再令 \(g_c(p) \leftarrow g_c(p)/\bar g_G\)。这样绿色通道平均 gain 为 1，但空间 gain 形态保留；后续 WB 仍独立执行。强度 s ∈ [0,1]：

\[
x'(p) = x(p)\cdot\left[1 + s\,(g_c(p)-1)\right]
\]

- `epsilon` 默认 1e-4；低于 epsilon 的平场像素不放大，gain 置 1，并计入 `validFraction` 警告。
- `maxGain` 默认 8×；超过时 clamp 并提示“平场过暗/遮光严重”。
- 平场噪声会直接进入 gain；v1 不做平场平滑/配准，UI 明确提示。若后续需要，可加 3×3/5×5 平滑或低通，但不改变默认行为。
- 平场与主图 active area 必须逐像素对齐；不做自动配准（超出首版范围）。

### 5.4 Stage 3：白平衡

- 输入：平场校正后的线性 CFA。
- 灰点拾取：在预览坐标上取半径 r 的方形/圆形区域，逐 CFA 通道稳健均值（中位数或 trimmed mean），避免高光/边缘。
- 增益：

\[
m_c = \frac{\mu_G}{\mu_c},\quad \mu_G=\frac{\mu_{G1}+\mu_{G2}}{2},\quad m_G=1
\]

- 支持 as-shot（DNG `AsShotNeutral` / LibRaw `cam_mul`）与手动输入；统一归一化 G=1。
- 灰点坐标保存在管线参数中，但实际采样在平场校正后的 RAW 上执行；若平场变化，重新计算。
- 拾取点显示采样框、每通道均值、增益、是否欠曝/过曝；不改变 CCM 拟合结果，但会标记 CCM“已过期”（因为拟合基于 WB 后的相机 RGB）。

### 5.5 Stage 4：Demosaic

#### Fast：Bilinear

标准 3×3 双线性：G 在 R/B 位置取四邻域；R/B 在 G 位置取同色两邻域；R 在 B 位置取对角四邻域。边界 clamp。

#### Fast：Malvar-He-Cutler（默认）

5×5 梯度校正插值，参考 Malvar, He, Cutler, “High-quality linear interpolation for demosaicing of Bayer-patterned color images”, ICASSP 2004。核心核（G at R/B）：

```text
       0   0  -1   0   0
       0   0   2   0   0
      -1   2   4   2  -1
       0   0   2   0   0
       0   0  -1   0   0
                 / 8
```

R/B 在 G、R 在 B 的核按论文方向旋转；实现中用 4 个方向变体 + 边界 clamp。输出 RGB F16。

#### Quality：AHD（默认）/ RCD（可选）

- AHD 按 Hirakawa & Parks, “Adaptive Homogeneity-Directed Demosaicing”, IEEE TIP 2005 的论文描述**净室实现**，不复制 dcraw/RawTherapee 的 GPL 代码。
- 步骤：
  1. 水平/垂直方向分别估计 G，得到两个全分辨率绿色平面。
  2. 对每个方向计算 R−G、B−G 色差平面，并做 3×3 中值/低通。
  3. 在 3×3 邻域比较两个方向插值的亮度/色差 homogeneity，逐像素选择方向。
  4. 用选定的 G 和色差插值 R/B；对 G 位置和相反色位置分别处理。
- 分块执行，halo ≥3 px；边界 tile 使用镜像/ clamp。
- 进度：按 tile 回报 `completed/total`；支持取消。
- RCD 作为后续增强；若实现，同样净室并单独金标。

**质量验证：**

- Fast MHC 与独立 CPU 参考实现（同一算法、double）比较，合成 Bayer 图 PSNR ≥40dB。
- AHD 与外部 oracle（dcraw/RawTherapee，仅测试时运行，不进入仓库/构建）比较视觉与 PSNR；不承诺与 GPL 实现逐像素一致。
- 边界、单像素、纯色、高频棋盘、斜边、噪声图测试。

### 5.6 Stage 5：降噪

默认 Guided Filter（He et al. 2010），实时、线性时间、保边；备选 bilateral（半径 3/5）。

- 在线性 camera RGB 上转换到近似 YCbCr：
  \[
  Y=0.2126R+0.7152G+0.0722B,\quad C_b=B-Y,\quad C_r=R-Y
  \]
- 亮度：以 Y 为引导，对 Y 做 self-guided filter。
- 色度：以 Y 为引导，对 Cb/Cr 做 guided filter（避免跨边缘串色）。
- Guided filter：
  \[
  a=\frac{\operatorname{cov}(I,p)}{\operatorname{var}(I)+\epsilon},\quad
  b=\bar p-a\bar I,\quad
  q=\bar a I+\bar b
  \]
  其中均值/方差用半径 r 的 box filter（可分离/积分图）。
- 强度映射：`luma/chroma 0..100` → `epsilon` 与最终 blend；`detail` 控制 epsilon 下限/边缘保护。
- 半径 3/5 对应 box window；GPU 用 separable box passes，CPU 参考用积分图。
- 输出 RGB F16；不做 BM3D；不对 RAW CFA 直接降噪。
- 注意：管线顺序固定在 CCM 之前，因此在线性相机 RGB 上处理；UI 明确标注“线性域降噪”，不假装是感知域。

### 5.7 Stage 7：CCM（相机 Profile）与 Stage 9：CSC（YUV 调整）

- CCM：相机 RGB → 线性 sRGB 的输入 Profile。优先 DNG `ForwardMatrix`，否则 `ColorMatrix` 求逆并按校准光源做 Bradford 适应；缺失时单位阵 + 警告。可手动覆盖或由 ColorChecker 拟合。
- CSC：在 Gamma 之后、display-sRGB 域执行 `RGB → YUV → 调整 → YUV → RGB`。标准矩阵由色域决定（BT.709 / BT.601 625-line / BT.2020），不可手改。
- 四个调整在 YUV 域合成一个仿射变换：
  \[
  Y' = c(Y-0.5)+0.5+b,\quad Cb'=s\cos\theta\,Cb-s\sin\theta\,Cr,\quad Cr'=s\sin\theta\,Cb+s\cos\theta\,Cr
  \]
  其中 `c/s` 来自对比度/饱和度百分比，`b` 来自亮度，`theta` 来自色调。
- 合成后仍是一个 pass：
  \[
  M = M_{YUV\to RGB}\,A\,M_{RGB\to YUV},\quad out = M\,rgb + offset
  \]
- 矩阵约定：CCM 的 `out = M * in` 是 camera RGB → linear sRGB；ColorChecker 拟合的 `M_total` 直接作为 CCM，不再反解 CSC。
- 不使用 CCM+CSC 矩阵融合（CSC 为非线性调整后的仿射矩阵）。
- 不允许静默产生 NaN；CSC 调整参数越界时 clamp。

### 5.8 Stage 8：Gamma

sRGB 传输函数（线性 → 显示）：

\[
V=\begin{cases}
12.92L, & L \le 0.0031308\\
1.055L^{1/2.4}-0.055, & L > 0.0031308
\end{cases}
\]

- 可选 gamma 2.2：`V = L^(1/2.2)`，用于对比，不作为默认输出。
- 分析 MTF/SNR 时若阶段是 display-srgb，先做逆 EOTF 回线性。
- 内部不做 ICC/P3/HDR；输出 PNG 带 sRGB chunk。

### 5.9 Stage 9：USM 锐化（gamma 域）

- 在 display-srgb 上计算亮度：
  \[
  Y=0.2126R+0.7152G+0.0722B
  \]
- 高斯模糊 \(G_\sigma * Y\)，sigma 由 radius 映射（默认 `sigma = radius`，UI 标为半径）。
- 高频：
  \[
  H=Y-G_\sigma * Y
  \]
- 阈值软/硬处理：
  \[
  H'=\operatorname{sign}(H)\max(|H|-t,0)
  \]
- 锐化：
  \[
  Y'=Y+aH'
  \]
- 保持色相：`RGB' = RGB * (Y'/max(Y, eps))`；或只对 Y 通道回写并限制比例，避免色边。
- 阈值默认 0；强度 0..200%；半径 0.5..3 px。
- 高斯可分离，halo = ceil(3σ)。

### 5.10 Stage 11：输出

- 裁剪：传感器坐标 `Rect`；显示时按 orientation 旋转，导出时先裁剪再旋转（或先旋转再映射裁剪，二者需测试一致）。
- 8-bit：`round(clamp(v,0,1)*255)`；16-bit：`round(clamp(v,0,1)*65535)`，big-endian PNG。
- `fast-png` 编码；写 `sRGB` chunk / `gAMA`；不写 ICC。
- 全分辨率导出在 CPU Worker，支持进度/取消；100MP 分块编码为行流，避免整幅 RGBA 常驻。
- 预览导出：当前视图（含缩放/裁剪）或全分辨率；分析图 8/16-bit 可选。

---

## 6. 关键公式与参考实现

### 6.1 CCM 加权最小二乘初值

样本矩阵 \(A\in\mathbb{R}^{24\times3}\)（已 WB 的相机 RGB），参考 \(B\in\mathbb{R}^{24\times3}\)（线性 sRGB），逐块权重 \(w_i\)：

\[
M_{total}^T=(A^T W A)^{-1}A^T W B
\]

代码中 row-major 存 `M_total`，即 `srgb ≈ M_total * cam`。若样本共线/秩不足，加与数据尺度相关的 Tikhonov 正则：

\[
M^T=(A^TWA+\lambda I)^{-1}A^TWB
\]

默认 `λ = 1e-8 · trace(A^TWA)`，避免低曝光样张被固定 λ 过度正则。**不强制每行和 = 1**：裸 RAW 的白块水平和参考白（约 0.894）不一定相同，硬行和约束会把整体增益锁死，使 mean ΔE00 随曝光漂移。拟合前可用底部四个中性块做 WB，再用完整 3×3 拟合。

### 6.2 ΔE00 / 色度优先优化

目标：

\[
\min_M \frac{\sum_i w_i\,e_i(M)}{\sum_i w_i}
+\lambda\|M-M_0\|_F^2
\]

- `e_i = ΔE00`（默认色准模式）；
- `e_i = ΔC00 + ΔH00` 为主、`0.1·|ΔL*|` 为弱约束（色度优先模式）；
- `w_i = 0` 的色块完全不参与 LS 和优化；要求至少 8 个正权重有效块，并检查秩/条件数。
- 优化器：Nelder–Mead，9 个矩阵元素全自由；初值为加权 LS 解；固定步长 0.05，最多 600 次迭代。
- 目标饱和度/色调只调整参考目标（CIELAB LCh，L* 不变；超出 sRGB 时保持 L/h 降低 C），并同时报告对原始参考的标准 ΔE00。
- 目标调整和权重是内存态拟合设置，不写入工程文件。

### 6.3 CIEDE2000

按 Sharma, Wu, Dalal (2005) 的标准实现，包含 34 组公开测试向量。  
`ΔC` 定义为 CIEDE2000 中的 chroma 差：

\[
\Delta C' = C'_2 - C'_1
\]

汇总显示 `mean |ΔC'|` 与逐块带符号值，避免“色度差”歧义。

### 6.4 DNG 色彩推导

- `ForwardMatrix`（camera → XYZ D50，已 WB）存在时：
  \[
  M_{cam\to sRGB} = M_{XYZ(D65)\to sRGB}\cdot A_{D50\to D65}\cdot F
  \]
- 否则 `ColorMatrix`（XYZ → camera）存在时：
  \[
  M_{cam\to XYZ}=C^{-1}
  \]
  再按 `CalibrationIlluminant1/2` / `AsShotWhiteXY` 做 Bradford 适应到 D65，最后乘 XYZ→sRGB。
- 双光源：按 `AsShotWhiteXY` / CCT 选择或插值 CM1/CM2；首版至少支持选择主矩阵，并在 UI 标注。
- `AsShotNeutral` → WB：`m_c = 1 / neutral_c`，归一化 G=1。
- 无矩阵：单位阵 + 明显警告；不假装有色彩管理。
- DNG 标签解析与 LibRaw 交叉校验；关键标签：`CFAPattern`, `CFARepeatPatternDim`, `BlackLevel`, `BlackLevelRepeatDim`, `WhiteLevel`, `ActiveArea`, `DefaultCropOrigin/Size`, `ColorMatrix1/2`, `ForwardMatrix1/2`, `CalibrationIlluminant1/2`, `AsShotNeutral`, `AsShotWhiteXY`, `Orientation`。

### 6.5 SNR

平坦 ROI，逐通道：

\[
\mu_c=\frac{1}{N}\sum x_i,\quad
\sigma_c=\sqrt{\frac{1}{N-1}\sum (x_i-\mu_c)^2}
\]

\[
\mathrm{SNR}_{dB}=20\log_{10}\left(\frac{\mu_c}{\sigma_c}\right)
\]

- 默认在线性域（若阶段是 display-srgb，先逆 gamma）。
- 排除黑/白 clip；报告排除数量。
- 合成测试：已知均值/噪声，误差 ≤0.2dB。

### 6.6 MTF（ISO 12233 斜边）

1. 在 ROI 内提取亮度（逐通道或 Y）。
2. 逐行/列找边缘 50% 交点，线性拟合边缘直线，得到角度 θ。
3. 将像素中心投影到边缘法线方向，按 4× 过采样分箱，得到 ESF。
4. ESF 差分 → LSF；加 Hann 窗；补零到 2 的幂。
5. FFT，取幅度，DC 归一化；频率单位 cycles/pixel。
6. 线性插值求 MTF50 / MTF10。
7. 可选像素孔径校正 \(1/\operatorname{sinc}(\pi f)\)；默认关闭并在 UI 标注，避免与参考实现口径不一致。
8. 质量门槛：角度 2°–45°，对比度 >0.2，无严重 clip；否则警告/拒绝。

**验证：** 合成斜边 + 已知高斯模糊，解析 MTF 为 \(\exp(-2\pi^2\sigma^2 f^2)\cdot\operatorname{sinc}(\pi f)\)；MTF50 误差 ≤5%。与 sfrmat3/Imatest 的差异在文档中说明。

### 6.7 波形

- 对降采样到 ≤2048 宽的 stage 数据，逐列统计 256 个数值 bin；亮度/ RGB parade。
- 默认 display-referred（线性阶段先做 sRGB OETF）；提供“线性”开关。
- CPU Worker 生成 RGBA，主线程 `putImageData`；全分辨率按需降采样，避免 24MP 逐像素散点。

### 6.8 噪声频谱

平坦 ROI，单通道（RAW 的某个 CFA 通道或去马赛克后的 Y）：

1. 去趋势：拟合平面 \(a x+b y+c\) 并减去（默认），或减均值。
2. 2D Hann 窗 \(w(x,y)=w_x w_y\)。
3. 2D FFT（补零到 2 的幂）。
4. 功率谱 \(P=|F|^2/(N_xN_y\sum w^2)\)，fftshift。
5. 径向平均：按空间频率半径分 bin；输出 log10 功率。
6. 可选水平/垂直 1D PSD（对行/列平均）。
7. ROI 默认上限 1024²（交互），最大 2048²（按需）；显示 log 功率 + 径向曲线。

**验证：** 白噪声应近似平坦；Parseval 能量守恒；与 NumPy 参考对比。

### 6.9 差异图

- 同一坐标系、同尺寸；跨图若尺寸不同，要求同宽高比并重采样到公共预览尺寸，否则拒绝。
- 差异：

\[
d = |a-b|\cdot g
\]

- 指标：
  \[
  \mathrm{MAE}=\frac{1}{N}\sum|a_i-b_i|,\quad
  \mathrm{PSNR}=10\log_{10}\frac{1}{\mathrm{MSE}},\quad
  \max|a_i-b_i|
  \]
- 默认在 display-srgb 归一化 [0,1] 上计算；可切换线性域（先逆 gamma）。
- 显示：绝对差/带符号差、放大增益、并排、闪烁；A/B 分割线可拖动。

### 6.10 参考实现与许可

| 用途 | 参考 | 使用方式 |
|---|---|---|
| RAW 解码 | LibRaw | 运行时 WASM；LGPL/CDDL，NOTICE + 源码提供 |
| DNG 规范 | Adobe DNG 1.6 | 按规范实现；不复制 SDK 代码 |
| MHC | Malvar et al. 2004 | 论文公式净室实现 |
| AHD | Hirakawa & Parks 2005 | 论文净室实现；dcraw 仅作外部 oracle |
| Guided filter | He et al. 2010 | 论文公式 |
| CIEDE2000 | Sharma et al. 2005 | 公开测试向量 |
| MTF | ISO 12233 / sfrmat3 | 方法参考；不复制代码 |
| ColorChecker | X-Rite / BabelColor | 数据引用 + NOTICE；支持自定义参考 |
| FFT | fft.js (MIT) 或 kissfft (BSD) | 依赖 + NOTICE |
| PNG | fast-png (MIT) | 依赖 + NOTICE |

> dcraw / RawTherapee 为 GPL；只在开发机上作为外部命令生成对比图，不把其代码、二进制或生成物放入仓库/发行包。

---

## 7. DNG 与裸 RAW 导入

### 7.1 DNG 流程

1. `File.arrayBuffer()` → SHA-256（Web Crypto）。
2. Decode Worker：LibRaw `open` / `unpack`，取得存储像素、CFA、black/white、WB、尺寸、margins。
3. 自写 `DngMetaParser` 解析 TIFF IFD：ActiveArea、DefaultCrop、CFA、BlackLevel/WhiteLevel、ColorMatrix/ForwardMatrix、CalibrationIlluminant、AsShotNeutral/WhiteXY、Orientation。
4. 交叉校验 LibRaw 与 DNG 标签；冲突时以 DNG 标签为主，LibRaw 作为 fallback，并在诊断中记录。
5. 归一化 `RawImage`，Transfer 到 Render Worker；主线程拿元数据 + 缩略图 + 直方图。

**DNG 兼容性风险：** 压缩 DNG（lossless JPEG）、线性 DNG、`LinearizationTable`、opcode 列表、双光源、PerRow black。首版优先支持常见相机 DNG；对不支持的字段给出明确警告，不静默忽略。`LinearizationTable`/opcode 是否已由 LibRaw 应用需在 Phase 1 用样本交叉校验；若没有，需在归一化前补做。

### 7.2 裸 RAW 流程

1. 用户在导入对话框配置 `BareRawConfig`；可先解码低分辨率/抽样预览。
2. 计算 `requiredBytes = headerOffset + rowStride*(height-1) + bytesPerRow`；与文件长度比较。
3. 解包到 `Uint16Array`；按 `active` 裁剪；计算诊断统计。
4. 显示 CFA 预览（灰度/伪彩）、RAW 直方图、逐通道统计、位模式检查。
5. 配置错误时：
   - 文件长度不足：给出差额与候选 stride/offset。
   - 样本最大值超过位宽：提示位宽/对齐/packing 错误。
   - 大量 0/饱和：提示 header/stride 错误。
   - CFA 通道比例异常：提示 CFA 排列候选，并显示 G1/G2 差异。
   - Offset 自动扫描：在候选范围内抽样评分（边界零比例、直方图合理性、Nyquist 能量、行连续性），列出 top 5 候选。
6. 平场导入复用同一配置对话框，强制校验兼容性。

### 7.3 诊断面板

- 文件大小、期望大小、差额；header/stride/bit depth/endian/packing。
- 前 64 字节 hex；解码后 8×8/16×16 样本网格。
- 逐 CFA min/p1/p50/p99/max、black/white、clip 比例。
- CFA 一致性评分与建议。
- 预览：灰度 CFA / 伪彩 CFA / 直方图。
- “应用建议”按钮：只改配置，不自动覆盖用户输入；所有变更可撤销。

### 7.4 资源限制

- 最大边长 65535，最大像素数 200MP（可配置），防止恶意文件导致超大分配。
- 解码前校验 `width*height*2` 与内存预算；超限则拒绝并提示。
- WASM 解码失败捕获 `LibRawError`，显示错误码；不把 WASM 崩溃拖垮 UI。

---

## 8. ColorChecker 拟合

### 8.1 流程

1. **手动四角**（必需）：用户在预览上点选 **24 色块区域的四角**（不是卡片外框）；透视变换生成 6×4 网格。
2. 自动检测（增强、可后置）：在预览上做边缘/四边形/色块网格检测；失败自动回退手动；绝不阻塞主流程。
3. 每个色块按透视网格内缩取四边形区域（默认取样侧长 50%，可调 30–70%），在线性相机 RGB（WB 后、CCM 前）上做 trimmed mean（每通道两端各去 10%）。
4. 有效块：无像素、非有限值、最大均值 ≤0.002 记为欠曝；全部通道均 ≥0.995 的像素占比 >1% 记为裁切。结果返回每块的归一化取样四边形、原因、像素数与均值；Canvas 在 ColorChecker 面板展开时绘制实际取样框、编号、权重和无效状态。
5. WB：拟合前默认用底部中间四个中性块（20–23：Neutral 8 / 6.5 / 5 / 3.5）在 **WB 前** 的 camera RGB 上估计增益，按每块 `G/R`、`G/B` 比例平均，G 归一化为 1；有效块不足时用有效子集并警告。也可手动关闭自动 WB，使用当前管线 WB。
6. 参考：ColorChecker Classic 24，D65 参考 Lab；默认假设色卡与场景同光源。
7. 初值：**加权** 3×3 线性最小二乘（第 6.1 节），不再强制行和 = 1。
8. 优化：ΔE00 或色度优先目标 + 正则；逐块权重 `0–4` 同时进入 LS 和优化器；目标饱和度/色调在 CIELAB LCh 中全局调整，超出 sRGB 色域时保持 L/h 降低 C。
9. 将拟合得到的 `M_total`（camera RGB → linear sRGB）直接作为 CCM；应用到管线；显示逐块目标/标准 ΔE00、ΔC'、ΔH'、加权/全块 mean、max、有效/参与块数，以及 a*b* 偏差图。汇总另显示**拟合后饱和度**：前 18 个彩色块中参与拟合块的加权平均 C\* 比（Imatest Chroma% 口径，100% = 与标准 D65 参考一致），同时给出相对调整后目标的值；偏离目标超过 5 个百分点时提示可下调目标饱和度。a*b* 图背景为固定 L\*=50 的 sRGB 色度切片（色域外保持 L/h、钳制 C 到边界），可切换为纯深色底。
10. 权重、目标和色度优先模式是内存态设置，不写入工程；重新打开工程恢复默认。WB/平场/曝光/权重/目标改变后应重新拟合；当前 UI 对权重/目标变化显示“旧设置”提示。

### 8.2 采样阶段

- 使用 **denoise 后、CCM 前** 的 camera RGB（stage 5），保证低噪声且与 CCM 域一致。
- 取样在预览 2048 上完成；需要更高精度时可对全分辨率 ROI 重采样（慢，按需；当前版本未启用）。
- 取样框由四角透视变换 + 内缩比例得到；只在 ColorChecker 面板展开时显示，拟合前用当前四角计算，拟合后用实际采样结果标注状态。
- 底部四中性块 WB 单独渲染一次 **WB 前 demosaic** 阶段，避免当前 WB 倍率影响估计。

### 8.3 参考数据

- 内置 ColorChecker Classic 24 的 sRGB 8-bit 参考值（X-Rite 2009 / BabelColor），转换为线性 sRGB → XYZ D65 → Lab D65。
- 色卡有 pre-2014 / post-2014 版本差异；内置 pre-2014 经典表；post-2014 与自定义 CSV 尚未实现，UI 明确当前参考版本。
- 参考数据来源与商标声明写入 `THIRD_PARTY_NOTICES.md`；ColorChecker 是 X-Rite 商标，项目仅作兼容性说明。

### 8.4 验收

- 合成测试：已知相机矩阵 + 已知光源 + 噪声，拟合后 mean ΔE00 <0.5、max <1.5（理想条件）；曝光 ×0.6/×1.6、WB 偏 R1.3/B0.8 时仍需 mean ΔE00 <0.1。
- 权重测试：全 1 与基线一致；某块权重 0 时该块不参与拟合但仍显示误差；正权重块 <8 时报错。
- 目标调整测试：100%/0° 时目标指标等于标准指标；色调旋转保持 L*；近中性块不被染色；超出 sRGB 的目标被降低彩度并给出计数。
- WB 测试：底部 20–23 四块不同灰度不应被误判为光照不均；有效块 <2 时报错。
- 实际样张：曝光良好、无剪切，mean ≤2.5、max ≤5；记录色卡版本、光源、WB 方式。
- 若 3×3 物理上无法达到（强色偏/色卡版本不符），UI 显示限制与建议，不伪造结果。

---

## 9. 分析功能

### 9.1 阶段选择

- 固定入口：RAW（stage 1 输出，归一化 CFA）、去马赛克后（4）、降噪后（5）、最终（9）。
- 高级：任意 stage（用于直方图/探针/差异/导出）。
- 每个分析结果显示 `stage` 与 `domain`；跨域比较时明确“已转换到 display-srgb/linear-srgb”。

### 9.2 直方图

- 256 或 1024 bins；RGB + 亮度 Y。
- 线性/对数显示；clip 计数（≤0、≥1，RAW 域按 black/white）。
- 预览用 GPU 归约；全分辨率按需；缓存按 stage+params。
- 亮度权重 Rec.709；display 域直接统计，线性域可选 gamma 后显示。

### 9.3 像素探针

- 多探针（增删、命名、颜色标记）；坐标显示传感器坐标 + 显示坐标。
- 显示：RAW CFA 通道/DN/归一化值、各阶段 RGB（至少 RAW/去马赛克/降噪/最终）、WB 乘数。
- 探针取值从当前 stage 纹理读取；F16 精度在 UI 标注；需要高精度时用 CPU 参考对单像素重算（可选）。
- 探针随缩放/平移保持锚定；导出分析图时叠加。

### 9.4 SNR

- 矩形平坦 ROI；逐通道 mean/std；SNR dB = 20log10(mean/std)。
- 线性域；display 阶段先逆 gamma；排除 clip；报告样本数。
- 可选 RAW CFA 逐通道（R/G1/G2/B）或 RGB/Y。

### 9.5 MTF

- 斜边 ROI；逐通道 + 亮度；输出 MTF50/MTF10、曲线、角度、对比度。
- 方法见 6.6；4× 过采样；Hann 窗；FFT；线性插值。
- 失败条件明确：边缘太软/太硬、角度不合规、对比度不足、clip。
- 与参考误差 ≤5%；合成测试为门禁。

### 9.6 ΔE / ΔC

- 复用 ColorChecker 网格/采样；可在最终或线性 sRGB 阶段计算。
- 若阶段是 camera RGB/RAW，先应用当前 CCM（相机 Profile）到线性 sRGB，再转 Lab；UI 标注“色彩解释：应用 CCM”。
- 逐块 ΔE00、ΔC'、clip/used 标记；mean/max；参考版本可切换。
- 结果可导出 CSV/PNG（分析图）；PDF 非目标。

### 9.7 波形

- 亮度波形 + RGB parade；逐列 256 bins；线性/gamma 切换。
- 降采样到 ≤2048 宽；全分辨率按需；Worker 生成 RGBA。
- 显示可叠加网格、IRE 刻度（0/25/50/75/100）。

### 9.8 噪声频谱

- 平坦 ROI；去趋势 + Hann + 2D FFT；log 功率谱 + 径向平均；可选 H/V 1D PSD。
- 单通道选择（RAW CFA 通道或 Y）；ROI 上限；Worker 执行。
- 显示频谱图（colormap）+ 径向曲线 + 1D PSD；报告 ROI、窗、去趋势、频率单位。

### 9.9 中间图导出

- 任意 stage，当前视图或全分辨率；PNG 8/16-bit。
- 当前视图：包含缩放/平移/方向；全分辨率：无 UI 叠加，纯 stage 输出。
- 16-bit 需要明确量化与色彩域；不写 ICC，写 sRGB chunk。

### 9.10 差异图

- 任意两个 stage（同一图）或两张图（同尺寸/同比例）。
- 绝对差/带符号差、增益、并排/闪烁/分割；MAE/PSNR/max。
- 跨域时统一到 display-srgb 或 linear-srgb，并在结果中标注。
- A/B 与差异共用渲染管线；阶段级 A/B = 当前 vs 该 stage bypass。

---

## 10. 性能预算与调度

### 10.1 目标（基准机：Apple M1 / 近五年 i7 + 中端独显）

| 指标 | 目标 | 口径/说明 |
|---|---|---|
| 冷启动到可交互 | <10s | 应用壳 + WASM 可用；不含用户选文件/解码 |
| 首次 RAW 解码 | 单独计时，目标 DNG 24MP <1.5s | 不纳入 1s 管线指标；显示进度 |
| 预览参数响应 | <150ms p95 | 2048 最长边；拖动时 Fast proxy + rAF 合并 |
| 24MP Fast 全分辨率 | <1s p95 | 参数提交 → 全分辨率结果可显示；不含 PNG 编码、Quality demosaic |
| 24MP Quality | <3s | AHD/RCD CPU 池；显示进度/可取消 |
| 24MP 峰值内存 | <2GB | 含 RAW、GL 纹理、预览缓存、WASM |
| 100MP | 不崩溃 | 降采样预览 + ROI/分块；全分辨率导出分块 |
| UI 帧 | <16ms | 主线程不读像素、不做 FFT/优化 |
| 分析交互 | <300ms | 预览 ROI；全分辨率按需 |

**重要口径：** 1s 指标定义为“全分辨率像素可用于显示”，不含 PNG 序列化/下载。若产品要求包含导出，需要重新设定预算（24MP 16-bit PNG 编码可能 1–2s）。

### 10.2 24MP 预算拆解（M1 目标）

| 阶段 | 预算 | 备注 |
|---|---|---|
| levels + flat + wb（fused） | 10–20ms | 1–2 次全屏 pass |
| demosaic MHC | 60–120ms | 25 taps；纹理带宽主导 |
| denoise guided | 60–120ms | 4–8 个 box/组合 pass |
| CCM（相机 Profile） | 5–10ms | 1 个 3×3 pass |
| CSC（YUV 调整） | 5–10ms | 1 个 3×3 + offset pass |
| 数字增益（可选） | 2–5ms | 1 个 R16F pass，默认 BYP |
| gamma + USM | 40–70ms | gamma + 2 次高斯 + 合成 |
| 合成/显示 | 5–10ms | 缩放/方向 |
| 调度/同步/开销 | 20–50ms | 纹理分配、fence |
| **合计** | **200–400ms** | 留 2× 余量给驱动/集显 |

- 预览 2048（约 2.8MP）按面积约 1/9，理论 25–50ms；加 UI/合成 <150ms。
- Quality AHD 24MP 目标 <3s；若 JS 超标，迁移热循环到 Rust/WASM 或优化 tile/并行。
- PNG 8-bit 24MP 目标 <1s；16-bit <2s；导出独立进度，不阻塞编辑。

### 10.3 内存预算（24MP）

| 项 | 估算 |
|---|---|
| RAW U16（24MP） | 48MB |
| 平场 U16 | 48MB（仅加载时） |
| CFA F16 纹理 ×2 | 96MB |
| RGB F16 纹理 ×2 | 384MB |
| 降噪临时纹理 | 192–384MB |
| 预览 stage 缓存（9 × ~22MB） | ~200MB |
| 全分辨率最终纹理 | 192MB |
| Canvas / 杂项 / WASM | 100–200MB |
| **峰值** | **~1.1–1.5GB** |

控制策略：

- 全分辨率只保留最终输出纹理；中间结果按需重算，不缓存所有 stage。
- 预览缓存全 stage（便于 A/B/分析），但按字节 LRU；非活动图只保留最终预览。
- 降噪/锐化使用 ping-pong + 临时纹理，pass 后立即释放。
- 100MP：不分配整幅 RGB F16；tile 2048×256（含 halo），流式处理/编码。
- 状态栏显示估算显存/内存；超预算时提示并降级（关闭全分辨率缓存/降采样）。

### 10.4 调度与取消

- 每个请求 `generation`；参数变化立即递增；Worker 返回时丢弃旧 generation。
- UI slider 用 rAF 合并；最多 1 个在途预览，新的覆盖旧的。
- GPU 长任务按 tile/行分片，片间检查取消；CPU 任务协作式 `shouldCancel()`。
- 全分辨率任务低优先级；预览/分析高优先级；导出最低。
- 预览期间 Quality demosaic 未完成时显示 Fast 结果 + 进度条；不阻塞参数调整。
- 超时/上下文丢失：捕获 `webglcontextlost`，释放纹理，提示“恢复渲染”；重建上下文后重放当前参数。

### 10.5 计时与可观测性

- 每 stage `performance.now()`；GPU 可选 `EXT_disjoint_timer_query_webgl2`，不可用则 wall time + `fenceSync`。
- 状态栏：decode ms、preview ms、full ms、quality ms、PNG ms、缓存 MB、估算 VRAM、缩放、阶段。
- `/bench` 页面：合成 24MP/100MP，批量跑 N 次，输出 JSON/CSV；记录机器/GPU/驱动；不进入 CI 硬门禁。
- 错误：结构化 `{ code, message, details, suggestion }`；UI 内联 + 可复制诊断包（不含 RAW）。

---

## 11. 工程与持久化

### 11.1 技术栈与版本策略

- React 18/19 + TypeScript 5.x + Vite 5/7（取决于 Node 版本）。
- Zustand 5、Tailwind CSS 3.4（稳定）、Radix UI primitives。
- WebGL2 + `EXT_color_buffer_float`；RGBA16F。
- LibRaw WASM（优先 `@colorhythm/libraw-wasm` 的 MIT bindings，LibRaw LGPL/CDDL；Phase 1 做 API/元数据 spike）。
- fast-png、fft.js（或 kissfft WASM）。
- Vitest + Playwright + pixelmatch。
- 运行时 schema：Zod（工程/预设/参数）；保证导入文件不执行任意代码。

**Node 版本：** 当前环境 Node 18.19。建议升级 Node 22 LTS 后用 Vite 7；若保持 Node 18，则固定 Vite 5 + 兼容的 Vitest/Playwright 版本。此决策影响阶段 0。

### 11.2 工程文件

- JSON `.rawlab.json`，Zod 校验 + `schemaVersion` + 迁移函数。
- 保存：图片文件名/大小/SHA-256、DNG 元数据快照、裸 RAW 配置、平场引用、管线参数、快照、ColorChecker ROI/参考/拟合、分析 ROI/探针、对比布局、视图。
- 不保存：RAW 像素、平场像素、绝对路径。
- 重开：列出缺失文件 → 用户重新选择 → 先比大小，再比 SHA-256；不匹配时警告并允许“仍然使用”（标注风险）。
- File System Access API：`showOpenFilePicker` / `showSaveFilePicker`；句柄存 IndexedDB，重开请求权限；不支持时 `<input type=file>` + 下载。
- IndexedDB 自动保存：工程 JSON + 缩略图 + 预设；debounce 1s；保留最近 N 个版本（如 5 个），防崩溃丢失。

### 11.3 预设

- 新建/重命名/删除/导入/导出；存 IndexedDB；导出单一 JSON 或数组。
- 仅管线参数；应用时保留当前图的 `flatId` 与 `crop`；若预设启用平场而当前无平场，警告并保持 bypass。
- 导入校验：schema、数值范围、矩阵有限、stage 顺序固定；拒绝未知字段（或迁移）。

### 11.4 文件与哈希

- SHA-256 用 Web Crypto；24–100MB 文件可接受；先比大小可避免不必要的哈希。
- 解码/哈希在 Worker；显示进度（不确定进度条）。
- 文件名仅用于显示/匹配；不以路径作为身份。

### 11.5 构建与部署

- 静态构建；WASM 放 `public/libraw/`，带 MIME `application/wasm`；无 COOP/COEP 要求。
- Worker 用 `new Worker(new URL(..., import.meta.url), { type: 'module' })`。
- GitHub Actions：Node 22、`npm ci`、lint、typecheck、unit、build、Playwright smoke（SwiftShader，不做性能门禁）。
- `THIRD_PARTY_NOTICES.md`、`LICENSE`；LibRaw LGPL/CDDL 源码提供说明；ColorChecker 数据来源/商标声明。
- 不提交 Lightroom 输出；公开 RAW 样本用下载脚本 + 校验和，或小尺寸 CC0 fixture。

---

## 12. UI / UX

### 12.1 布局

```text
┌ Header: 项目名 | 导入 | 保存/打开 | 导出 | 性能 | 帮助 ─────────────────────┐
├ Left rail ┬──────────────────────── Canvas ────────────────────┬ Right panel ┤
│ 图片列表  │ 工具栏: 适配 1:1 ROI A/B 闪烁 差异 阶段            │ 管线 stages │
│ 对比布局  │                                                    │ 每级 bypass │
│ 预设      │                图像 / 分割 / 差异                  │ 参数/耗时   │
│ 快照      │                                                    │ 色彩/WB/CCM │
│           │                                                    │ 输出/裁剪   │
├───────────┴────────────────────────────────────────────────────┴─────────────┤
│ Bottom dock: 直方图 | 波形 | 探针 | SNR | MTF | ColorChecker | 噪声 | 差异   │
├ Status: 分辨率 | 缩放 | decode/preview/full ms | 显存/内存 | 阶段 | 作业      ┤
└──────────────────────────────────────────────────────────────────────────────┘
```

### 12.2 视觉

- 暗色专业风：背景 `#101418`，面板 `#171d23`，边框 `#2e3942`，主文本 `#e7edf3`，次文本 `#a7b4c0`，强调蓝 `#5cb0ff`，警告琥珀 `#ffb85c`，错误红 `#ff7373`。调色板唯一来源是 `src/ui/palette.ts`，`src/styles.css` 的 CSS 变量与之镜像；所有文字色在其渲染表面上的对比度 ≥ 4.5:1（主文本 ≥ 12:1），由 `tests/unit/theme.test.ts` 守护。
- 12–13px 高密度，最小标签 10px；数字用等宽字体；滑杆 + 数值输入并排；单位清晰（DN、px、dB、cycles/px）。
- 不做社交修图风；不放大圆角/阴影；信息优先。
- Radix：Dialog、Tabs、Tooltip、Popover、Slider、Switch、DropdownMenu、ScrollArea。
- 关键操作有快捷键：F 适配、1 1:1、B bypass 当前 stage、A/B 切换、Space 拖拽、`[`/`]` 切换 stage、P 加探针。

### 12.3 管线面板

- 固定顺序，不可拖拽；每级：序号、名称、bypass 开关、状态（缓存/计算中/错误）、耗时、查看输出按钮。
- 参数变化即时预览；全分辨率按钮/自动 commit；重置单级；复制/粘贴参数。
- 阶段查看：点击“眼睛”把画布切到该 stage 输出；分析阶段下拉同步。
- A/B：当前 vs bypass 当前 stage / 当前 vs 快照；分割线可拖；闪烁频率可调。
- 错误内联：矩阵奇异、平场不匹配、RAW 配置错误、MTF ROI 不合规等，给出可操作建议。

### 12.4 导入/诊断

- 裸 RAW 表单：所有配置字段 + 实时字节校验 + 预览 + “自动探测”候选；错误字段高亮。
- DNG：显示相机/尺寸/CFA/black/white/矩阵来源/警告；可覆盖 black/white。
- 平场：显示兼容性检查、逐通道 gain 范围、遮光严重区域警告。
- ColorChecker：四角点选、网格 overlay、逐块 ΔE 表格、拟合按钮、参考版本选择。

### 12.5 多图对比

- 2–4 pane；布局 1×2、2×1、2×2、1×4；同步缩放/平移开关。
- 每个 pane 独立管线参数/快照；活动 pane 有全分辨率，其他预览。
- 拖动同步：以归一化图像坐标 + 缩放级别同步；不同尺寸图按 fit 比例对齐。
- 差异：选择 A/B pane 或 stage；显示 MAE/PSNR/max；并排/闪烁/分割。
- 快照：同一 RAW 多组参数；可命名、复制、删除、应用；参与 A/B/对比。

---

## 13. 测试与验收

### 13.1 单元测试（Vitest）

- 裸 RAW 解包：所有位宽/packing/端序/对齐/stride/offset/CFA，bit-exact 对拍生成器。
- 黑/白电平、WB、数字增益、CCM、CSC、gamma：CPU double 参考；GPU 小图 readback 误差 ≤1e-4 或 1 LSB。
- MHC：CPU 参考 + 合成 Bayer PSNR ≥40dB；边界/单色/棋盘/斜边。
- AHD：合成图 PSNR/视觉；外部 oracle 仅人工/脚本对比。
- 平场：gain、G=1、强度、零值保护、clip。
- Guided filter：常量图不变、边缘保持、已知方差。
- CIEDE2000：Sharma 34 组测试向量。
- CCM 拟合：合成已知矩阵恢复；ΔE mean/max；CSC 标准矩阵/YUV 调整的数值性质。
- SNR：合成噪声误差 ≤0.2dB。
- MTF：合成高斯斜边，MTF50 误差 ≤5%。
- FFT/噪声谱：Parseval、白噪声平坦、NumPy 参考。
- 工程/预设：schema roundtrip、迁移、非法输入拒绝。
- PNG：8/16-bit 读写、sRGB chunk、量化边界。

### 13.2 参考与金标

- 合成 RAW 生成器 + 已知场景/矩阵/噪声。
- 最小 DNG 写入器（仅测试 fixture，不是产品功能）：未压缩 DNG，覆盖 CFA/black/white/ActiveArea/ColorMatrix/ForwardMatrix/AsShotNeutral/Orientation。
- 公开 RAW 样本：下载脚本 + SHA-256；小尺寸 CC0 fixture 入库；大文件不入库。
- LibRaw/dcraw/RawTherapee 输出仅作外部对比；Lightroom 仅人工视觉参考，不入库。
- GPU/CPU 差异：小图逐像素；大图 PSNR/最大误差。

### 13.3 E2E（Playwright）

- 裸 RAW：错误 offset → 明确报错/建议 → 修正 → 预览/直方图 → 调参 → 导出 PNG → 校验尺寸/位深。
- DNG：导入 → 阶段查看 → A/B → 探针 → SNR/MTF → 导出 16-bit。
- 平场：导入不匹配 → 拒绝；匹配 → 强度 0/50/100 对比。
- WB 灰点：拾取 → 增益 → 预览变化。
- ColorChecker：四角 → 网格 → 拟合 → ΔE 表格 → 应用 CCM。
- 工程：保存 → 刷新 → 重开 → 重新关联 → 参数/ROI 恢复；SHA 不匹配警告。
- 预设：CRUD → 导出 → 导入 → 应用。
- 多图：2/4 pane → 同步缩放/平移 → 独立参数 → 差异指标。
- 取消：长任务中改参数/取消，UI 不冻结，旧结果不覆盖新结果。
- 截图：pixelmatch，容差按主题/字体设置；避免 GPU 驱动差异导致脆弱。

### 13.4 性能基准

- `/bench` 页面：24MP/100MP 合成图；decode/preview/full/quality/export；p50/p95；JSON/CSV。
- 基准机记录：M1、i7 + 中端独显；集显记录实际值。
- CI 不做硬性性能门禁（GPU 差异大）；发布前人工跑基准并更新报告。
- 内存：`performance.memory`（Chrome）+ 自算纹理/WASM 估算；峰值采样。

### 13.5 验收映射

| 验收项 | 阶段 | 验证 |
|---|---|---|
| DNG/裸 RAW 导入 | P1 | 单测 + E2E |
| 裸 RAW 错误定位 | P1 | 诊断快照 + E2E |
| 固定管线全部可用 | P2/P3 | 单测 + E2E |
| 平场/WB/CCM/Fast/Quality/降噪/USM | P2/P3 | 单测 + 视觉/金标 |
| 直方图/探针/SNR/MTF/ΔE/波形/噪声 | P4 | 数值门禁 |
| ColorChecker mean ≤2.5 / max ≤5 | P5 | 真实样张报告 |
| 1s/150ms/3s/10s | P7 | 基准报告 |
| 取消有效/UI 不卡 | P2/P7 | E2E |
| 裸 RAW bit-exact | P1 | 单测 |
| 黑/WB/CCM/gamma ≤1 LSB/1e-4 | P2/P3 | 单测 |
| MHC PSNR ≥40dB | P2 | 单测 |
| MTF50 ≤5% / SNR ≤0.2dB | P4 | 单测 |
| 工程重开/预设/PNG/多图 | P6 | E2E |
| 回归金标 | P7 | 脚本 + 报告 |

---

## 14. 风险清单

| # | 风险 | 概率/影响 | 缓解 | 阶段 |
|---|---|---|---|---|
| 1 | LibRaw WASM 未暴露 DNG ForwardMatrix/AsShotWhiteXY 等标签 | 高/高 | 自写 DNG TIFF 标签解析器；LibRaw 仅负责像素；Phase 1 spike 验证 | P1 |
| 2 | LibRaw LGPL/CDDL 合规 | 中/高 | NOTICE、源码提供、构建脚本、法务复核；WASM 动态加载 | P0/P7 |
| 3 | 裸 RAW packing 变体无限 | 高/高 | 明确支持矩阵；诊断/候选；不支持时拒绝；fixtures | P1 |
| 4 | AHD 净室实现难度/性能 | 高/中 | 论文实现；CPU 池；必要时 Rust/WASM；外部 oracle 仅测试 | P3 |
| 5 | DNG 色彩推导误差（双光源/适应） | 高/中 | 按规范；ForwardMatrix 优先；金标样本；UI 显示矩阵/警告 | P2/P7 |
| 6 | 3×3 CCM 达不到 ΔE 目标 | 中/中 | 排除坏块；行和约束；参考版本；验收样张条件写清 | P5 |
| 7 | MTF 与参考口径差异 | 中/中 | ISO 12233；合成解析验证；文档标注孔径校正；与 sfrmat3 对比 | P4 |
| 8 | 24MP 1s 在集显/低端机不达标 | 高/中 | 基准记录；预览/分块降级；不承诺集显 | P7 |
| 9 | 100MP 显存/纹理上限 | 中/中 | 降采样预览；tile；ROI；分块导出；拒绝超限 | P3/P7 |
| 10 | 内存 >2GB | 中/中 | 全分辨率只留最终；预览 LRU；及时释放；监控 | P7 |
| 11 | WebGL 上下文丢失/驱动差异 | 中/中 | 监听 lost/restored；重建；CPU 参考测试；SwiftShader smoke | P7 |
| 12 | 16-bit PNG/色彩管理错误 | 中/中 | fast-png 单测；pngcheck/ImageMagick；sRGB chunk；无 ICC | P3 |
| 13 | 色卡自动检测不可靠 | 高/低 | 手动四角为必需；自动为增强；失败回退 | P5 |
| 14 | 色彩参考版本/商标 | 中/低 | 内置 pre-2014 + 自定义；NOTICE；商标声明 | P5 |
| 15 | Node 18 与 Vite/Playwright 兼容 | 中/高 | 升级 Node 22；或固定 Vite 5 + 兼容版本 | P0 |
| 16 | 工程重关联体验/权限 | 中/低 | 大小+哈希；FSA 句柄；下载 fallback | P6 |
| 17 | 多图内存/同步复杂度 | 中/中 | 仅活动全分辨率；未活动预览；归一化视口；E2E | P6 |
| 18 | 恶意/畸形 RAW 导致 OOM | 中/高 | 尺寸/像素上限；解码前校验；try/catch；WASM 隔离 | P1 |
| 19 | F16 暗部精度 | 中/中 | 关键分析用 CPU float64/RAW U16；UI 标注；必要时 F32 局部 | P2/P4 |
| 20 | 平场噪声/错位放大 | 中/中 | gain clamp/mask；提示；不平滑默认；不做配准 | P2 |

---

## 15. 分阶段计划

> 每阶段结束都应有可运行版本、单测/金标和验收记录。不一次性生成全部代码。

### Phase 0 — 工程基座（S）

- Vite + React + TS + Tailwind + Radix + Zustand 脚手架；暗色 tokens。
- Worker/OffscreenCanvas/WebGL2 能力探测；`/bench` 空页面。
- Vitest/Playwright/ESLint/Prettier；CI；LICENSE/NOTICE/THIRD_PARTY。
- 工程/预设 schema 草案；错误边界；状态栏骨架。
- **退出：** `npm run dev/build/test` 通过；WebGL2 能力页可显示；空壳 UI 可交互。

### Phase 1 — RAW 导入与诊断（M）

- 裸 RAW 解包器（支持矩阵内的模式）+ 位精确测试 + fixture 生成器。
- DNG 元数据解析器 + LibRaw WASM 解码适配层（spike 结论落地）。
- 导入对话框、配置校验、自动探测候选、CFA 预览、RAW 直方图、诊断面板。
- 平场导入与兼容性检查（先不做 gain 应用）。
- SHA-256、资源上限、错误码。
- **退出：** DNG/裸 RAW 均能导入；错误配置有具体原因/建议；解包 bit-exact；解码计时显示。

### Phase 2 — GPU 核心管线 + Fast demosaic（L）

- Render Worker + OffscreenCanvas + WebGL2 渲染器；RGBA16F；纹理/缓存。
- Stage 1–4（levels/flat/WB/digitalGain）+ Stage 5 Fast（Bilinear/MHC）+ Stage 7–9（CCM/Gamma/CSC）+ Stage 11 基础输出。
- 参数 schema/defaults/bypass；阶段查看；预览 2048；全分辨率 Fast；A/B（stage bypass）；8-bit PNG。
- 参考实现对拍；MHC PSNR；预览/全分辨率计时。
- **退出：** 固定管线前段可运行；预览 <150ms；24MP Fast 全分辨率 <1s（不含 PNG/Quality）；PSNR/误差达标。

### Phase 3 — 校正、降噪、锐化、Quality、导出（L）

- 平场应用（强度/零值/gain clamp）；WB 灰点拾取；数字增益；CCM 手动/DNG 推导；CSC YUV 调整。
- Guided/bilateral 降噪；USM；裁剪/方向；16-bit PNG；当前视图/全分辨率导出。
- Quality AHD（CPU Worker，tile/进度/取消）；Fast proxy 策略；1:1 ROI 请求。
- Stage cache LRU；内存/显存监控；上下文丢失恢复。
- **退出：** 管线全部可用；Quality <3s；取消有效；16-bit PNG 正确；内存 <2GB（24MP）。

### Phase 4 — 分析套件（L）

- 直方图（全分辨率/GPU 归约）、多探针、SNR、MTF、波形。
- 噪声频谱（FFT/径向/1D PSD）、差异图（stage/跨图、指标、闪烁）。
- 分析阶段选择/域转换；ROI 工具；分析结果缓存。
- 数值门禁：SNR 0.2dB、MTF 5%、FFT/CIEDE 单测。
- **退出：** 所有分析有结果；E2E；性能在预算内。

### Phase 5 — ColorChecker（M）

- 手动四角 + 透视网格 + 中心采样 + 排除坏块。
- LS 初值 + ΔE00 优化 + CCM 推导/应用；逐块 ΔE/ΔC；过期标记。
- 参考数据/自定义导入；自动检测（可选，失败回退手动）。
- **退出：** 合成恢复；真实样张 mean ≤2.5/max ≤5（记录条件）；UI 完整。

### Phase 6 — 工程、预设、多图（L）

- 工程 JSON schema/迁移/保存/打开/relink/SHA 校验。
- IndexedDB 自动保存/恢复；FSA 保存；预设 CRUD/导入导出。
- 2–4 图对比、同步缩放/平移、独立参数、快照、差异。
- **退出：** 重开恢复参数并重新关联；预设往返；多图同步 E2E。

### Phase 7 — 性能、兼容、回归（L）

- 100MP 分块/ROI/导出；24MP 全链路基准；集显记录。
- 上下文丢失、异常输入、内存压力、长任务取消。
- 公开样本/合成/金标回归；Playwright pixelmatch；文档/发布包。
- **退出：** 验收矩阵全部通过；基准报告；release candidate。

**粗略工作量（不含算法调优/法务，单人）：** P0 1–2d，P1 4–6d，P2 5–8d，P3 6–10d，P4 6–10d，P5 3–5d，P6 5–8d，P7 5–8d；合计约 35–57 人日。AHD/DNG 色彩/性能是最大不确定性。

---

## 16. 待确认决策

### 16.1 需要确认

1. **许可证：** Apache-2.0（建议，含专利授权）还是 MIT？
2. **Quality demosaic：** 先 AHD（建议），RCD 后置；还是直接 RCD / 两者都首版？
3. **LibRaw WASM 方案：** 采用 `@colorhythm/libraw-wasm`（MIT bindings + LibRaw LGPL/CDDL）+ 自写 DNG 标签解析（建议）；还是自建 Emscripten 包装（需 Docker/emcc，当前环境未安装）？
4. **Node/构建：** 升级 Node 22 LTS + Vite 7（建议）；还是保持 Node 18 + Vite 5/兼容版本？

### 16.2 默认假设（未反对即按此执行）

- “24MP Fast 1s” 指全分辨率结果可用于显示，不含 PNG 编码与 Quality demosaic。
- 预览 2048；拖动时 Fast proxy；1:1 按可见 ROI 请求全分辨率。
- ColorChecker 内置 pre-2014 Classic 24 参考，支持自定义导入；自动检测非首版必需。
- 裸 RAW 支持第 4.2 节列出的模式；其他 packing 明确拒绝。
- 100MP 只保证降采样预览 + ROI/分块导出，不保证整幅 1:1 实时。
- 项目代码 Apache-2.0；LibRaw 按 LGPL/CDDL 合规分发；ColorChecker 仅作兼容性引用。

---

## 17. 下一步

确认第 16.1 节的 4 个决策后，从 **Phase 0** 开始：

1. 初始化仓库与工具链（不写业务算法）。
2. 建立文档/许可证/CI/测试骨架。
3. 做 WebGL2 + OffscreenCanvas + LibRaw WASM 的最小技术验证。
4. 给出 Phase 0 的可运行版本、测试结果和进入 Phase 1 的检查清单。
