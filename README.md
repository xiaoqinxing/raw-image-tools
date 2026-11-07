# RAW Lab

[![CI](https://github.com/xiaoqinxing/raw-image-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/xiaoqinxing/raw-image-tools/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

纯浏览器、暗色专业风格的 RAW 图像编辑与 ISP 分析工作台。DNG / 裸 RAW 导入、固定 10 阶段管线、ColorChecker 拟合、ISP 分析、工程 / 预设与多图对比全部在本地完成，无后端、无上传。

在线演示：<https://raw-image.li.qinxing.xyz>

> 当前版本 0.1.0。技术设计与取舍见 [`docs/00-architecture.md`](docs/00-architecture.md)，验收记录与实测数据见 [`docs/02-acceptance.md`](docs/02-acceptance.md)。

## 快速开始

需要 Node.js ≥ 18.19。

```bash
git clone https://github.com/xiaoqinxing/raw-image-tools.git
cd raw-image-tools
npm ci
npm run dev          # http://127.0.0.1:5173
```

常用命令：

```bash
npm run build
npm run typecheck
npm test             # Vitest（单元 / 数值）
npx playwright install chromium
npm run test:e2e     # Playwright（自动启动 dev server）
```

浏览器要求：桌面 Chrome / Edge，WebGL2 + `EXT_color_buffer_float`。建议独立显卡或较新的集显；软件渲染可以运行，但全分辨率显示会明显变慢。

## 功能

### 导入

- **DNG**：LibRaw WASM 解包像素；自带 TIFF/DNG 标签解析器补齐 `ActiveArea`、`DefaultCrop`、`BlackLevel`、`WhiteLevel`、`ColorMatrix1/2`、`ForwardMatrix1/2`、`AsShotNeutral`、`CalibrationIlluminant`、`Orientation`、`CFA`、`BaselineExposure` 等元数据。
- **裸 RAW 二进制**：显式配置宽高、CFA（RGGB/BGGR/GRBG/GBRG）、位宽（8/10/12/14/16）、packing、端序、对齐、header offset、row stride、active area、逐 CFA 黑/白电平。
  - unpacked：u8 / u16，LE / BE，右对齐 / 左对齐 + sample shift。
  - packed：连续 LSB-first / MSB-first，MIPI RAW10 / RAW12 / RAW14。
  - 导入前实时显示每行字节、实际 stride、所需总字节与文件大小的差额。
- 导入后给出逐通道 min/p1/p50/p99/max、低于黑电平 / 高于白电平比例、G1/G2 一致性、警告与修正建议。
- CFA 伪彩预览；DNG 的 OpcodeList、LinearizationTable、BlackLevelDelta 等未执行项会明确提示。

### 固定管线

顺序固定，全部阶段可 bypass、可调、可查看中间结果：

| # | 阶段 | 色彩域 | 实现 |
|---|------|--------|------|
| 1 | 黑/白电平 | raw CFA | GPU R16F |
| 2 | 平场 | raw CFA | GPU，逐 CFA 增益，强度 / epsilon / max gain |
| 3 | 白平衡 | raw CFA | As Shot、手动、灰点吸管 |
| 4 | 去马赛克 | camera RGB | Fast：GPU MHC（5×5 Malvar-He-Cutler）或 Bilinear；Quality：Worker/CPU 净室 AHD 近似 |
| 5 | 降噪 | camera RGB | Guided（亮度/色度分离）或 Bilateral（可分离交叉双边近似），GPU 多 pass |
| 6 | CCM | camera RGB | 手动 3×3、单位阵、ColorChecker 拟合 |
| 7 | CSC | linear sRGB | DNG ForwardMatrix / ColorMatrix 推导，Bradford 适应，手动矩阵 |
| 8 | Gamma | display sRGB | sRGB / Gamma 2.2 / Linear |
| 9 | USM | display sRGB | 亮度通道高斯模糊 + 阈值 + 强度 |
| 10 | 输出 | — | 裁剪、8/16-bit PNG、任意阶段导出、全分辨率 |

- 中间阶段可单独查看、导出 PNG；阶段 A/B、快照 A/B、差异图、闪烁对比、可拖动分割线。
- 剪切提示：高光 ≥1.0 标红、负值 ≤0 标蓝。
- 阶段缓存：只重算参数变化影响的下游阶段；全分辨率只保留目标阶段，避免缓存爆炸。
- 预览使用偶数因子降采样以保持 2×2 CFA 相位；24MP 预览约 1500×1000。
- 全分辨率 ≤48MP 原生；>48MP 使用资源上限（约 12MP 纹理）降级，避免 OOM。

### 分析

- 直方图（RGB + 亮度，256/1024 bins，线性/对数，剪切计数）。
- 像素探针（RAW CFA DN、阶段 RGB、WB 乘数）。
- SNR（ROI 内逐通道 mean/std / dB，display 域自动逆 gamma）。
- MTF（斜边检测、4× oversampling、Hann、FFT、MTF50/MTF10）。
- ColorChecker Classic 24（pre-2014 D65）：手动四角、透视网格、色块采样、最小二乘 + ΔE00 优化、逐块 ΔE00/ΔC'、一键应用 CCM。
- 波形（luma / RGB parade）。
- 噪声频谱（2D FFT、log power、径向平均、H/V 1D PSD、去趋势、Hann）。
- 差异指标（MAE / PSNR / max diff，A vs 当前阶段 bypass 或快照）。

### 工程与预设

- 工程 JSON：图像元数据、裸 RAW 配置、管线参数、快照、ColorChecker、ROI、探针、视图、布局；不嵌入 RAW 本体。
- 打开工程后逐张重新关联 RAW；显示 SHA-256 校验结果；支持同时关联平场。
- 自动保存到 IndexedDB（工程结构，不含 RAW）；可从工程菜单恢复。
- 预设：只保存管线参数（不含平场 / 裁剪等文件相关字段），IndexedDB 持久化，支持导入 / 导出 / 删除。
- 快照：同一图像多组参数，可应用或作为 A/B 参考。
- 2–4 图对比：2H / 2V / 4 格布局、同步缩放/平移、各图独立参数、点击标题切换编辑对象、交换 A/B。

### 界面适配

- ≥1200px 使用左图像栏、中央画布/分析、右 ISP 管线三栏布局；1200–1399px 自动收窄两侧栏。
- <1200px 两侧栏改为抽屉，通过顶栏“图像 / 管线”按钮打开；画布占满可用宽度。
- 手机端顶栏自动精简，分析面板可折叠；短屏横屏时默认折叠分析面板以保留画布空间。
- 分析视图、导入/导出/重关联对话框在窄屏下自动改为纵向布局，并保证页面无横向溢出。
- 触屏设备加大按钮与输入控件高度，画布禁用浏览器手势冲突；支持安全区 inset。

## 性能目标与实测

目标：24MP Fast 全分辨率渲染 <1s（不含 PNG 编码与 Quality 去马赛克）、预览 <150ms、Quality <3s、冷启动 <10s、24MP <2GB、100MP 降级/分块不崩溃。

本机无头 Chromium + SwiftShader（软件 GL）实测（详见 `docs/02-acceptance.md`）：

| 场景 | 管线耗时 | 说明 |
|------|----------|------|
| 24MP MHC 预览（1500×1000） | 4.5 ms | 显示 present 在 SwiftShader 下约 0.48s |
| 24MP MHC 全分辨率 | 2.6 ms | 墙钟约 7.3s，主要为软件 GL 显示/同步 |
| 24MP AHD 全分辨率 | 2.65 s | 去马赛克 2.63s，满足 <3s 目标 |
| 100MP MHC | 2.5 ms @ factor 4 | 输出 2500×2500，无崩溃 |
| 24MP 导出 8-bit PNG | — | 约 10s（含全分辨率重渲染 + PNG 编码） |

软件渲染无法代表硬件 WebGL2 的显示性能；上表把“管线命令耗时”和“墙钟”分开记录，避免把 SwiftShader 的 present 成本误算到 ISP 管线。

## 已知限制

- AHD 是净室方向性近似实现（方向性绿通道 + 色差插值），不是 GPL 参考实现逐行移植；RCD 尚未实现。
- DNG 的 OpcodeList、LinearizationTable、BlackLevelDeltaH/V 不执行，只提示；依赖这些标签的 DNG 可能出现黑/白电平或暗角偏差。
- 16-bit PNG 不写 ICC profile；颜色按当前 display-sRGB 值量化。
- >48MP 不做原生全分辨率渲染；导出为降采样结果，警告会显示在导出对话框与 toast。原生 100MP 分块渲染尚未实现。
- 全分辨率 AHD 在低内存设备上可能触发浏览器限制；建议 24MP 以内使用，或保持 Fast 模式。
- 4 格布局会同时渲染最多 4 个预览会话，显存/内存占用随图像数量线性增加；未激活图像只保留预览规模。
- 工程打开使用文件选择器重新关联；尚未接入 File System Access API 的授权句柄持久化。
- 测试用的合成 DNG/裸 RAW 位于 `tests/fixtures/test-*`，仅用于演示与 E2E，不代表真实相机校准数据。

## 目录

```
src/core/          RAW 解码、色彩、管线参数、CPU 参考、分析
src/gpu/           WebGL2 Renderer 与 shader
src/workers/       decode.worker / render.worker
src/services/      editor 编排、session、项目、benchmark
src/state/         Zustand store
src/ui/            暗色工作台 UI
tests/unit/        Vitest 数值测试
tests/e2e/         Playwright 端到端
scripts/           bench-browser.mjs
public/libraw/     LibRaw WASM 与许可证
```

## 测试与基准

```bash
npm test
npm run test:e2e
npm run bench -- --width=6000 --height=4000 --algorithms=mhc
npm run bench -- --width=6000 --height=4000 --algorithms=ahd
npm run bench -- --width=10000 --height=10000 --algorithms=mhc
```

`npm run test:e2e` 会自动启动 Vite dev server（`playwright.config.ts`），也可以手动指定已运行的地址：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npm run test:e2e
```

`npm run bench` 需要先启动 `npm run dev`。Playwright 在无系统 Chromium 的环境下可设置：

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
LD_LIBRARY_PATH=/path/to/libasound \
npm run test:e2e
```

`window.__rawlab` 仅在 DEV 暴露，用于 E2E 与基准；生产构建不包含。

## 持续集成

GitHub Actions 工作流 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 在每次 push / PR 时执行：

- Vitest 单元与数值测试；
- 生产构建；
- Playwright E2E（自动安装 Chromium，失败时上传 `test-results/`）。

CI 使用 SwiftShader 软件 WebGL 运行浏览器测试，不依赖 GPU。

## 部署

项目是纯静态站点，`npm run build` 后的 `dist/` 可直接部署到任意静态服务器：

```bash
npm run build
rsync -az --delete dist/ user@host:/srv/rawlab/
```

测试夹具位于 `tests/fixtures/`，不会进入 `public/` 和构建产物。若使用 Caddy，需确保 `.wasm` 返回 `application/wasm`，并给带哈希的 `assets/*` 设置长期缓存、`index.html` 设置 `no-cache`。

## 许可证

项目代码：Apache-2.0，见 `LICENSE`。
第三方组件与 LibRaw（LGPL-2.1 / CDDL-1.0）声明见 `THIRD_PARTY_NOTICES.md` 与 `NOTICE`。
