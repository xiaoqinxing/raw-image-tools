# AGENTS.md

本文件面向在本仓库工作的 AI coding agents、自动化工具和维护者。  
**用户文档（README）只放产品介绍、功能与使用说明；提示词、内部流程和 agent 约束统一放在这里。**

## 项目是什么

RAW Lab 是一个纯浏览器 RAW 图像编辑与 ISP 分析工作台：

- DNG / 裸 RAW 导入；
- 固定 10 阶段 ISP 管线；
- WebGL2 预览与导出；
- ColorChecker、直方图、SNR、MTF、FFT、差异分析；
- 工程 / 预设 / 快照 / 多图对比；
- 无后端、无上传、无账号。

在线演示：<https://raw-image.li.qinxing.xyz>

## 强制约束

- **数据不能离开浏览器。** 不要为 RAW、工程或分析结果引入上传、云存储、服务端计算或遥测。
- **保持管线顺序固定。** 阶段顺序、色彩域和导出语义不能随意改变；数学实现变更必须有对应数值测试。
- **生产构建不包含测试夹具。** 合成 DNG/RAW 只放在 `tests/fixtures/`，不要放回 `public/`。
- **不要提交生成物。** `dist/`、`node_modules/`、`test-results/`、`*.tsbuildinfo` 均被忽略，不要强制加入 Git。
- **不要静默降级。** 超过资源上限、DNG 标签未执行、AHD 近似实现等限制必须继续在 UI / 文档中说明。
- **桌面功能不能在移动端消失。** 侧栏可以变抽屉、面板可以折叠，但导入、导出、分析、工程等能力必须可达。
- **README 不写提示词。** 需要新增的 AI prompt、仓库工作流和内部规则写入本文件。
- **许可证文件保持完整。** 修改 `public/libraw/` 相关内容时，同步检查 `NOTICE` 与 `THIRD_PARTY_NOTICES.md`。

## 快速上下文

```text
src/core/        RAW 解码、CFA、色彩矩阵、管线参数、CPU 参考、分析
src/gpu/         WebGL2 Renderer 与 shader
src/workers/     decode.worker / render.worker
src/services/    editor 编排、session、项目、benchmark
src/state/       Zustand store
src/ui/          工作台 UI
tests/unit/      Vitest 数值测试
tests/e2e/       Playwright E2E
tests/fixtures/  合成 RAW / DNG 测试数据
scripts/         bench-browser.mjs
docs/            架构与验收记录
```

入口：`src/main.tsx` → `src/App.tsx`。  
主编辑流程：`src/services/editor.ts`。  
管线参数与顺序：`src/core/pipeline/params.ts`。

## 开发命令

```bash
npm ci
npm run dev
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

- Node.js ≥ 18.19；CI 使用 Node 22。
- Playwright 会自动启动 Vite；不要依赖手工启动的 dev server。
- 本机无系统 Chromium 时，可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 和 `LD_LIBRARY_PATH`。
- 性能测试先启动 `npm run dev`，再执行 `npm run bench -- --width=... --height=... --algorithms=...`。

## 修改流程

1. 先读相关实现和对应测试，确认改动属于 core、gpu、worker 还是 UI。
2. 先改数据/算法，再改 UI 和文档；不要用 UI 特判掩盖底层问题。
3. 数值算法变更补充 Vitest；交互路径变更补充或更新 Playwright。
4. 至少执行：

   ```bash
   npm run typecheck
   npm test
   npm run build
   npm run test:e2e
   ```

5. 如果测试数量、性能数据、功能范围或已知限制发生变化，同步更新 `docs/02-acceptance.md` 和 README 中对应描述。
6. 检查 `git diff`，确认没有夹具、构建产物、临时脚本或截图误入提交。

## 测试约定

- 单元测试优先验证可计算的数值性质：常量保持、矩阵往返、边界值、误差范围。
- E2E 测试通过用户可见交互驱动；`window.__rawlab` 只用于断言内部状态，不能替代交互。
- E2E 需要等待真实状态（文档数量、canvas、分析结果），不要只等文件名字符串；文件名可能先出现在导入对话框中。
- 新增测试夹具必须体积小、内容合成、来源可说明。
- 冷启动时 Vite 可能发现 worker 依赖并触发页面刷新；新增 worker-only 依赖时，考虑加入 `vite.config.ts` 的 `optimizeDeps.include`。

## UI 约定

- 深色工作台风格，颜色使用 `ink` 调色板和 `styles.css` 中的 CSS 变量。
- 新面板先保证桌面三栏布局，再验证 1200px、1024px、768px、390px 和横屏。
- 不引入重型 UI 框架；优先复用 `src/ui/controls.tsx` 的 Button / Slider / Segmented / Section。
- 主要按钮保持中文短标签；技术名词可保留英文（RAW、CFA、MHC、AHD、CCM、CSC、SNR、MTF）。
- 不用颜色作为唯一状态信号；同时提供文字、标签或图标。
- 任何新增交互都要考虑触屏：可点击区域、横向滚动和抽屉关闭路径。

## 部署

- 构建产物：`dist/`。
- 纯静态部署，目标环境需正确返回 `application/wasm`。
- 带哈希的 `assets/*` 设置长缓存，`index.html` 设置 `no-cache`。
- 部署前执行完整测试和生产构建。
- 不要在仓库中提交服务器地址、SSH 密钥、Token 或 Caddy 私密配置。

## 可复用提示词

以下提示词用于本仓库的 AI 协作，不应复制进 README。

### README 优化

```text
你是资深开源项目维护者，擅长把技术项目写得既准确又有吸引力。

请重写这个项目的 README，要求：
1. 开头用一句话说清楚“它是什么、为谁解决什么问题”，并给出一张真实界面截图。
2. 用“为什么值得试”而不是堆功能列表来建立吸引力；突出纯浏览器、RAW 全流程、可解释管线、隐私、可复现。
3. 保留关键技术细节、准确的性能数据、浏览器要求、已知限制和许可证信息，不夸大、不虚构未实现能力。
4. 给出清晰的在线体验入口、三步上手、核心功能、技术架构、本地运行、测试和部署方式。
5. 使用简洁的二级/三级标题、表格和短段落；避免营销空话和重复描述。
6. 提示词、AI 工作流和内部维护规则不要写进 README，放到 AGENTS.md。
```

### 新功能实现

```text
先阅读 AGENTS.md、相关 core 实现、现有测试和 docs/00-architecture.md。
在不破坏固定 ISP 阶段顺序和纯浏览器约束的前提下实现该功能。
先补/改数值测试，再改实现，最后补 UI 与 E2E。
列出你修改的数学语义、边界条件和未覆盖的限制。
```

### Bug 修复

```text
先复现问题并定位是解码、GPU 管线、Worker、状态管理还是 UI 布局。
不要用延迟、重试或隐藏控件掩盖根因；如果是时序问题，修状态/依赖而不是单纯加 timeout。
补一个能在修复前失败、修复后通过的回归测试。
```

### 性能优化

```text
先给出基线：场景、分辨率、算法、GPU/软件渲染条件。
优化必须保持输出数值性质和阶段缓存语义。
优先减少重复渲染、纹理分配、GPU/CPU 同步和主线程阻塞。
报告优化前后数据，并说明是否影响低内存设备或 >48MP 降级路径。
```

### 代码审查

```text
重点检查：
- 是否破坏无后端 / 无上传约束；
- 是否改变 ISP 阶段顺序、色彩域或导出语义；
- 是否遗漏数值测试和移动端路径；
- 是否引入内存泄漏、未释放纹理/Worker、重复渲染；
- 是否更新了 docs/02-acceptance.md 中的测试数量和已知限制。
```
