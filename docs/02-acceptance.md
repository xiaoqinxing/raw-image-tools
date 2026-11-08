# 实现与验收记录

日期：2026-11-07
版本：0.1.0（初始验收基线；当前版本由构建自动生成）
环境：Linux，Node 18.19.1，无头 Chromium（headless shell 1194），
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`，
viewport 1440×900 / 1024×768 / 390×844 / 844×390，`deviceScaleFactor=1`。

> 软件渲染只用于功能与内存验证；显示 present 的墙钟时间不代表硬件 WebGL2 性能。
> 表中把管线命令/CPU 耗时与包含 present/读回的墙钟时间分开记录。

## 自动化测试

| 套件 | 数量 | 结果 |
|------|------|------|
| Vitest 单元/数值 | 84 | 全部通过 |
| Playwright E2E：DNG 导入 / 阶段 / 16-bit 导出 / 工程保存 | 1 | 通过 |
| Playwright E2E：裸 RAW 导入 + 错误配置 | 1 | 通过 |
| Playwright E2E：ColorChecker 四角 + CCM 拟合 | 1 | 通过 |
| Playwright E2E：差异指标 | 1 | 通过 |
| Playwright E2E：工程 JSON 重开 + 重关联 | 1 | 通过 |
| Playwright E2E：工程重关联同时附加平场 | 1 | 通过 |
| Playwright E2E：IndexedDB 自动保存恢复 | 1 | 通过 |
| Playwright E2E：多图对比 + 同步缩放 + A/B 切换 + 2H/2V/4 格 | 1 | 通过 |
| Playwright E2E：Bilateral 降噪 shader | 1 | 通过 |
| Playwright E2E：预设保存 / 应用 / 导出 | 1 | 通过 |
| Playwright E2E：桌面 / 平板 / 手机 / 横屏响应式布局与抽屉 | 1 | 通过 |
| Playwright E2E：状态栏版本号 + 自动更新日志弹窗 | 1 | 通过 |
| Playwright E2E：分析按需统计 / 单次预览 / 悬停读数 | 3 | 通过 |
| **E2E 合计** | **15** | **全部通过** |

覆盖的数值测试：

- CIEDE2000 Sharma 40 组标准向量（误差 < 1e-3）。
- 色彩矩阵求逆、Bradford D50→D65、sRGB 传递函数往返。
- 裸 RAW：u16 LE/BE、左/右对齐、packed 10/12/14-bit LSB/MSB、MIPI RAW10/12/14、header/stride/active crop/CFA 相位、截断与非法电平。
- DNG：TIFF 标签解析、Black/White/AsShotNeutral/CFA/ActiveArea、LibRaw 解包。
- 去马赛克：Bilinear / MHC / AHD 常量保持，MHC 与 GPU 结果最大误差约 1.7e-4。
- 分析：直方图、SNR（高斯噪声 <0.2 dB）、MTF50（高斯模糊斜边误差 <5%）、白噪声频谱平坦度、CCM 最小二乘恢复（mean ΔE00 < 1）。
- ColorChecker：合成色卡 mean ΔE00 ≈ 0.01，max ≈ 0.03。
- 悬停读数显示编码：raw-cfa gamma 2.2、camera/linear sRGB 传递函数、display sRGB 保持与 8-bit 映射。
- 构建信息：版本号 = package major.minor + Git 提交数；git log 解析与异常行过滤。
- 主题调色板：`src/styles.css` 的 CSS 变量与 `src/ui/palette.ts` 保持一致；所有文字色对 `ink-950/900/850/800` 的对比度 ≥ 4.5:1，主文字 ≥ 12:1；组件中不允许出现低对比 `text-ink-*`。

## 性能实测

### 24MP（6000×4000）

MHC Fast：

| 项目 | 管线 / CPU | 墙钟（含 present + 1px 同步） |
|------|------------|-------------------------------|
| 预览（1500×1000，factor 4） | 4.5 ms | 476 ms |
| 全分辨率（factor 1） | 2.6 ms | 7288 ms |
| 8-bit PNG 导出（含重渲染） | — | 9993 ms |
| 缓存 VRAM 估算 | 360 MB | — |
| JS heap（导出后） | 326 MB | — |

AHD Quality：

| 项目 | 管线 / CPU | 墙钟 |
|------|------------|------|
| 预览（1500×1000） | 189 ms（去马赛克 185 ms） | 512 ms |
| 全分辨率（6000×4000） | 2652 ms（去马赛克 2632 ms） | 7980 ms |
| 8-bit PNG 导出 | — | 10298 ms |
| 缓存 VRAM 估算 | 360 MB | — |

结论：

- MHC 管线远低于 1s 目标；墙钟主要被 SwiftShader 的显示/同步占据。
- AHD 24MP 去马赛克 2.63s，满足 <3s 目标（本机 CPU；低功耗设备可能超出）。
- 预览管线低于 150ms；软件 present 不具代表性。
- 24MP 缓存 + heap 明显低于 2GB。
- 冷启动未单独计时；页面加载、WASM 834KB 获取与首个 DNG 导入在 E2E 中约 1–2s 完成。

### 100MP（10000×10000）

| 项目 | 结果 |
|------|------|
| 导入 / setRaw | 288 ms |
| 预览（factor 6） | 6.3 ms 管线；849 ms 墙钟 |
| 全分辨率 | factor 4，输出 2500×2500；2.5 ms 管线；2080 ms 墙钟 |
| 导出 | 2500×2500，`scaled=true`，2909 ms |
| 崩溃 | 无 |
| JS heap | 约 307 MB |

结论：100MP 采用“降级渲染 + 明确警告”，满足“不崩溃”的降级路径；原生 100MP 分块导出仍未实现。

## 功能验收

| 项 | 状态 | 备注 |
|----|------|------|
| DNG 导入 + DNG 专属标签 | 通过 | Opcode/Linearization 未执行，提示 |
| 裸 RAW：8/10/12/14/16、packed/unpacked、LE/BE、stride/offset/active/CFA | 通过 | 单元测试覆盖 |
| 固定 10 阶段、逐阶段 bypass/调参/查看 | 通过 | 预览与全分辨率 |
| 阶段 A/B / 快照 A/B / 闪烁 / 可拖分割线 | 通过 | 手动验证 + 差异 E2E |
| 平场、灰点 WB、guided/bilateral 降噪 | 通过 | 平场兼容性检查；Bilateral E2E |
| Fast MHC/Bilinear GPU；Quality AHD CPU | 通过 | AHD 为净室近似 |
| CCM 手动/拟合、CSC DNG 推导、USM、裁剪、8/16-bit PNG、任意阶段导出 | 通过 | 16-bit 无 ICC；RAW 阶段灰度 |
| 直方图/悬停读数/SNR/MTF/波形/噪声频谱/ColorChecker/差异 | 通过 | 差异为 A vs bypass/快照；统计在展开/切换时刷新，参数变化标记过期 |
| CFA 伪彩默认开启 | 通过 | 仅影响 raw-cfa 阶段显示 |
| 分析运行不阻塞画布 | 通过 | 无全屏遮罩、不重发预览、不覆盖当前显示阶段 |
| 2–4 图对比、2H/2V/4 格、同步缩放平移、独立参数 | 通过 | E2E（3 图）验证 |
| 工程 JSON 保存/打开/重关联/自动保存 | 通过 | 文件选择器重关联；自动保存 E2E |
| 预设 CRUD / 导入导出 / IndexedDB | 通过 | 保存/应用/导出 E2E；`window.prompt` 命名 |
| 24MP Fast <1s / preview <150ms / Quality <3s | 部分通过 | 管线满足；软件 present 不具代表性 |
| 24MP <2GB | 通过 | 实测约 0.7GB 峰值量级 |
| 100MP 不崩溃 | 通过 | 降级到 2500×2500 |
| 冷启动 <10s | 未严格计时 | E2E 导入约 1–2s |

## 已知差距

1. 原生 100MP 分块渲染/导出未实现；>48MP 降采样。
2. AHD 是方向性近似，不是参考实现；RCD 未实现。
3. DNG OpcodeList / LinearizationTable / BlackLevelDelta 不执行。
4. 16-bit PNG 不写 ICC；显示链路固定 sRGB。
5. File System Access API 持久化句柄未接入；工程重开依赖文件选择器。
6. 冷启动与硬件 GPU 的 present 性能需要在目标桌面环境复测。
7. `window.prompt` 命名预设/工程在部分浏览器策略下可能被拦截，后续改为 Radix Dialog。
8. 旧工程中的 `probes` 字段仍可加载但不再显示；探针交互已由左下角实时悬停读数取代。
