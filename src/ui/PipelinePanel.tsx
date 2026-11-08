import React from 'react';
import { useActiveDoc, useStore } from '../state/store';
import { STAGE_LABELS, STAGE_ORDER, effectiveCsc } from '../core/pipeline/params';
import { applyFittedCcm, attachFlat, renderActive, updateStageAndRender, setStageBypassAndRender, fitColorChecker, savePreset, applyPreset, exportPresets, importPresets, deletePreset } from '../services/editor';
import { Button, NumberField, Section, Segmented, SliderField, Toggle } from './controls';
import type { Mat3, StageId, Vec4 } from '../core/types';
import { IDENTITY3, matrixToString } from '../core/color/matrices';

function StageRow({ stage, index }: { stage: StageId; index: number }) {
  const doc = useActiveDoc();
  const selectedStage = useStore((s) => s.selectedStage);
  const setSelectedStage = useStore((s) => s.setSelectedStage);
  const setAnalysisStage = useStore((s) => s.setAnalysisStage);
  const [open, setOpen] = React.useState(stage === 'levels' || stage === 'wb' || stage === 'demosaic' || stage === 'ccm' || stage === 'csc');
  if (!doc) return null;
  const p = doc.params[stage] as { bypass: boolean };
  const time = doc.stats?.timings.stages[stage];
  const active = selectedStage === stage;
  return (
    <div className={`border-b border-ink-700/60 ${active ? 'stage-active' : ''}`}>
      <div className="stage-row flex h-8 items-center gap-2 px-2">
        <button className="w-4 text-[10px] text-ink-400" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
        <span className="mono w-4 text-[11px] text-ink-500">{index + 1}</span>
        <button
          className="min-w-0 flex-1 truncate text-left text-[11px] text-ink-200 hover:text-white"
          onClick={() => { setSelectedStage(stage); setAnalysisStage(stage); renderActive(); }}
          title={STAGE_LABELS[stage]}
        >
          {STAGE_LABELS[stage]}
        </button>
        {time !== undefined ? <span className="mono text-[10px] text-ink-500">{time.toFixed(0)}ms</span> : null}
        <span className={`badge ${p.bypass ? '' : 'badge-ok'}`}>{p.bypass ? 'BYP' : 'ON'}</span>
        <Toggle on={!p.bypass} onChange={(v) => setStageBypassAndRender(stage, !v)} />
      </div>
      {open ? <div className="px-3 pb-3 pt-1"><StageControls stage={stage} /></div> : null}
    </div>
  );
}

function Vec4Editor({ value, onChange, min = 0, max = 65535, step = 1, label }: { value: Vec4; onChange: (v: Vec4) => void; min?: number; max?: number; step?: number; label: string }) {
  return (
    <div>
      <div className="field-label mb-1">{label}</div>
      <div className="grid grid-cols-4 gap-1">
        {(['R', 'G1', 'G2', 'B'] as const).map((n, i) => (
          <label key={n} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-ink-500">{n}</span>
            <input
              className="input input-mono h-[22px] px-1 text-[11px]"
              type="number"
              value={Number(value[i].toFixed(6))}
              min={min}
              max={max}
              step={step}
              onChange={(e) => {
                const v = [...value] as Vec4;
                v[i] = Number(e.target.value);
                onChange(v);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function MatrixEditor({ value, onChange }: { value: Mat3; onChange: (v: Mat3) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {value.map((v, i) => (
        <input
          key={i}
          className="input input-mono text-[11px]"
          type="number"
          step={0.001}
          value={Number(v.toFixed(6))}
          onChange={(e) => {
            const m = [...value] as Mat3;
            m[i] = Number(e.target.value);
            onChange(m);
          }}
        />
      ))}
    </div>
  );
}

function StageControls({ stage }: { stage: StageId }) {
  const doc = useActiveDoc();
  const [flatInput] = React.useState(() => React.createRef<HTMLInputElement>());
  if (!doc) return null;
  const p = doc.params[stage] as any;
  const set = (patch: Record<string, unknown>) => updateStageAndRender(stage as keyof typeof doc.params, patch as never);

  if (stage === 'levels') {
    return (
      <div className="space-y-2">
        <Vec4Editor label="黑电平（DN，R/G1/G2/B）" value={doc.params.levels.black} onChange={(v) => updateStageAndRender('levels', { black: v })} />
        <Vec4Editor label="白电平（DN）" value={doc.params.levels.white} onChange={(v) => updateStageAndRender('levels', { white: v })} max={131071} />
        <Toggle on={doc.params.levels.clampNegative} onChange={(v) => updateStageAndRender('levels', { clampNegative: v })} label="扣除负值" />
        <div className="kv"><span>来源</span><span className="mono">{doc.params.levels.source}</span></div>
        <div className="text-[11px] leading-4 text-ink-500">Bypass 时按 0 / 65535 做容器归一化，保证后续阶段仍可运行。</div>
      </div>
    );
  }
  if (stage === 'flat') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button className="btn-xs" onClick={() => flatInput.current?.click()}>加载平场</Button>
          <input ref={flatInput} type="file" accept=".dng,.raw,.bin" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const isDng = /\.dng$/i.test(f.name);
            attachFlat(f, isDng);
            e.currentTarget.value = '';
          }} />
          {doc.flat ? <span className="badge badge-ok">已加载</span> : <span className="badge">无</span>}
        </div>
        {doc.flat ? (
          <div className="space-y-1">
            <SliderField label="强度" value={doc.params.flat.strength} min={0} max={100} unit="%" onChange={(v) => updateStageAndRender('flat', { strength: v })} />
            <div className="kv"><span>通道均值</span><span className="mono">{doc.flat.stats.means.map((v) => v.toFixed(3)).join(' / ')}</span></div>
            <div className="kv"><span>有效像素</span><span className="mono">{doc.flat.stats.validFraction.map((v) => (v * 100).toFixed(1) + '%').join(' / ')}</span></div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="epsilon" value={doc.params.flat.epsilon} step={0.0001} min={0} onChange={(v) => updateStageAndRender('flat', { epsilon: v })} />
          <NumberField label="max gain" value={doc.params.flat.maxGain} step={0.5} min={1} onChange={(v) => updateStageAndRender('flat', { maxGain: v })} />
        </div>
      </div>
    );
  }
  if (stage === 'wb') {
    return (
      <div className="space-y-2">
        <Vec4Editor label="R / G1 / G2 / B 增益（G=1）" value={doc.params.wb.multipliers} onChange={(v) => updateStageAndRender('wb', { multipliers: v, mode: 'custom' })} min={0} max={16} step={0.001} />
        <div className="flex gap-2">
          <Button className="btn-xs" onClick={() => updateStageAndRender('wb', { multipliers: doc.meta.wb.asShot ?? [1, 1, 1, 1], mode: 'as-shot' })}>As Shot</Button>
          <Button className="btn-xs" onClick={() => updateStageAndRender('wb', { multipliers: [1, 1, 1, 1], mode: 'custom' })}>中性 1:1:1</Button>
          <Button className="btn-xs" onClick={() => useStore.getState().setTool('gray')} title="点击画布上的灰点，自动计算 WB 增益">灰点</Button>
        </div>
        <div className="kv"><span>模式</span><span className="mono">{doc.params.wb.mode}</span></div>
        <div className="text-[11px] leading-4 text-ink-500">灰点在平场校正后的线性 RAW 上采样，按 G=1 归一化。</div>
      </div>
    );
  }
  if (stage === 'demosaic') {
    return (
      <div className="space-y-2">
        <Segmented
          value={doc.params.demosaic.algorithm}
          onChange={(v) => updateStageAndRender('demosaic', { algorithm: v })}
          options={[
            { value: 'mhc', label: 'Fast · MHC' },
            { value: 'bilinear', label: 'Fast · Bilinear' },
            { value: 'ahd', label: 'Quality · AHD' },
          ]}
        />
        {doc.params.demosaic.algorithm === 'ahd' ? (
          <div className="rounded border border-[#5c4a24] bg-[#332713] p-2 text-[11px] leading-4 text-[#ffca7a]">
            AHD 在 Render Worker 内以 CPU 执行（净室 AHD 近似）；全分辨率 24MP 目标不到 3s，进度/取消将在下一轮优化。
          </div>
        ) : null}
        <div className="text-[11px] leading-4 text-ink-500">MHC 为 5×5 Malvar-He-Cutler，GPU；AHD 为方向性 homogeneous 选择，Worker/CPU。</div>
      </div>
    );
  }
  if (stage === 'denoise') {
    return (
      <div className="space-y-2">
        <Segmented
          value={doc.params.denoise.method}
          onChange={(v) => updateStageAndRender('denoise', { method: v })}
          options={[{ value: 'guided', label: 'Guided' }, { value: 'bilateral', label: 'Bilateral' }]}
        />
        <SliderField label="亮度强度" value={doc.params.denoise.luma} min={0} max={100} unit="%" onChange={(v) => updateStageAndRender('denoise', { luma: v })} />
        <SliderField label="色度强度" value={doc.params.denoise.chroma} min={0} max={100} unit="%" onChange={(v) => updateStageAndRender('denoise', { chroma: v })} />
        <SliderField label="细节保护" value={doc.params.denoise.detail} min={0} max={100} unit="%" onChange={(v) => updateStageAndRender('denoise', { detail: v })} />
        <div className="flex items-center justify-between">
          <span className="field-label">半径</span>
          <Segmented value={String(doc.params.denoise.radius)} onChange={(v) => updateStageAndRender('denoise', { radius: Number(v) as 3 | 5 })} options={[{ value: '3', label: '3' }, { value: '5', label: '5' }]} />
        </div>
        <div className="text-[11px] leading-4 text-ink-500">Guided：亮度/色度分离；Bilateral：可分离交叉双边近似，强度取亮度/色度较大者。</div>
      </div>
    );
  }
  if (stage === 'ccm') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="field-label">3×3 相机 RGB 校正</span>
          <span className="badge">{doc.params.ccm.source}</span>
        </div>
        <MatrixEditor value={doc.params.ccm.matrix} onChange={(m) => updateStageAndRender('ccm', { matrix: m, source: 'manual' })} />
        <div className="flex flex-wrap gap-1">
          <Button className="btn-xs" onClick={() => updateStageAndRender('ccm', { matrix: [...IDENTITY3] as Mat3, source: 'identity' })}>单位阵</Button>
          <Button className="btn-xs" onClick={() => updateStageAndRender('ccm', { matrix: effectiveCsc(doc.params), source: 'fit' })}>复制 CSC</Button>
          {doc.colorChecker.fit ? <Button className="btn-xs" variant="primary" onClick={applyFittedCcm}>应用拟合 CCM</Button> : null}
        </div>
        {doc.colorChecker.fit ? (
          <div className="kv"><span>拟合 ΔE00</span><span className="mono">mean {doc.colorChecker.fit.meanDE00.toFixed(2)} / max {doc.colorChecker.fit.maxDE00.toFixed(2)}</span></div>
        ) : null}
        <div className="text-[11px] leading-4 text-ink-500">CCM 在相机 RGB 域。最终 total = CSC × CCM；拟合时先求 camera→linear sRGB 总矩阵，再反解 CCM。</div>
      </div>
    );
  }
  if (stage === 'csc') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="field-label">相机 RGB → 线性 sRGB</span>
          <span className="badge">{doc.params.csc.source}</span>
        </div>
        <MatrixEditor value={doc.params.csc.matrix} onChange={(m) => updateStageAndRender('csc', { matrix: m, source: 'manual' })} />
        <div className="flex flex-wrap gap-1">
          <Button className="btn-xs" onClick={() => {
            const csc = effectiveCsc(doc.params);
            updateStageAndRender('csc', { matrix: csc, source: 'dng' });
          }}>从 DNG 推导</Button>
          <Button className="btn-xs" onClick={() => updateStageAndRender('csc', { matrix: [...IDENTITY3] as Mat3, source: 'identity' })}>单位阵</Button>
        </div>
        <div className="mono whitespace-pre-wrap text-[10px] leading-4 text-ink-500">{matrixToString(doc.params.csc.matrix, 4)}</div>
        {doc.meta.color?.warnings?.length ? <div className="text-[11px] leading-4 text-[#ffca7a]">{doc.meta.color.warnings.slice(0, 3).join(' ')}</div> : null}
      </div>
    );
  }
  if (stage === 'gamma') {
    return (
      <div className="space-y-2">
        <Segmented value={doc.params.gamma.mode} onChange={(v) => updateStageAndRender('gamma', { mode: v })} options={[{ value: 'srgb', label: 'sRGB' }, { value: 'gamma22', label: 'Gamma 2.2' }, { value: 'linear', label: 'Linear' }]} />
        <div className="text-[11px] leading-4 text-ink-500">默认 sRGB 传输函数（线性→显示）。Gamma 阶段之后才做 USM。</div>
      </div>
    );
  }
  if (stage === 'sharpen') {
    return (
      <div className="space-y-2">
        <SliderField label="强度" value={doc.params.sharpen.amount} min={0} max={200} unit="%" onChange={(v) => updateStageAndRender('sharpen', { amount: v })} />
        <SliderField label="半径" value={doc.params.sharpen.radius} min={0.5} max={3} step={0.1} unit="px" onChange={(v) => updateStageAndRender('sharpen', { radius: v })} />
        <SliderField label="阈值" value={doc.params.sharpen.threshold} min={0} max={0.2} step={0.001} onChange={(v) => updateStageAndRender('sharpen', { threshold: v })} />
        <div className="text-[11px] leading-4 text-ink-500">USM 在 gamma 域，按亮度通道锐化并保持色相。</div>
      </div>
    );
  }
  return null;
}

export function PipelinePanel({ onClose }: { onClose?: () => void }) {
  const doc = useActiveDoc();
  const setTool = useStore((s) => s.setTool);
  const setShowImport = useStore((s) => s.setShowImport);
  const presets = useStore((s) => s.presets);
  const selectedPresetId = useStore((s) => s.selectedPresetId);
  const setSelectedPresetId = useStore((s) => s.setSelectedPresetId);
  const setShowExport = useStore((s) => s.setShowExport);
  const presetFileRef = React.useRef<HTMLInputElement>(null);
  const header = (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-ink-700/70 px-3">
      <span className="text-[11px] font-medium tracking-wide text-ink-200">ISP 管线</span>
      <div className="flex items-center gap-1">
        <Button className="btn-xs" onClick={() => setTool('probe')} title="像素探针" disabled={!doc}>探针</Button>
        <Button className="btn-xs" onClick={() => setShowImport(true)}>导入</Button>
        {onClose ? <button className="drawer-close" onClick={onClose} aria-label="关闭管线面板">✕</button> : null}
      </div>
    </div>
  );
  if (!doc) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[11px] leading-5 text-ink-500">
          导入 RAW 后可在此调整 ISP 管线。
        </div>
      </div>
    );
  }
  const img = doc.meta;
  const stageTime = doc.stats ? Object.values(doc.stats.timings.stages).reduce((a, b) => a + (b ?? 0), 0) : 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-auto scroll-thin">
        <div className="border-b border-ink-700/60 p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-[12px] text-ink-100">{doc.fileName}</div>
              <div className="mono text-[11px] text-ink-500">{img.geometry.active.w}×{img.geometry.active.h} · {img.cfa.sites.map((x) => x.startsWith('G') ? 'G' : x).join('')} · {img.geometry.bitDepth}bit</div>
            </div>
            <span className={`badge ${doc.kind === 'dng' ? 'badge-ok' : ''}`}>{doc.kind.toUpperCase()}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="rounded bg-ink-850 p-1.5">
              <div className="text-[10px] text-ink-500">解码</div>
              <div className="mono text-[11px]">{doc.decodeMs.toFixed(0)}ms</div>
            </div>
            <div className="rounded bg-ink-850 p-1.5">
              <div className="text-[10px] text-ink-500">阶段</div>
              <div className="mono text-[11px]">{stageTime.toFixed(0)}ms</div>
            </div>
            <div className="rounded bg-ink-850 p-1.5">
              <div className="text-[10px] text-ink-500">缓存</div>
              <div className="mono text-[11px]">{doc.stats ? (doc.stats.cacheBytes / 1048576).toFixed(0) : 0}MB</div>
            </div>
          </div>
        </div>
        <Section title="RAW 诊断" defaultOpen={false}>
          <div className="space-y-1">
            <div className="kv"><span>字节差</span><span className="mono">{img.diagnostics.bytesDelta}</span></div>
            <div className="kv"><span>CFA 一致性</span><span className="mono">{(img.diagnostics.cfaConsistency * 100).toFixed(1)}%</span></div>
            {img.diagnostics.perChannel.map((c) => (
              <div key={c.channel} className="kv"><span>{c.channel}</span><span className="mono">{c.p1} / {c.p50} / {c.p99} · max {c.max}</span></div>
            ))}
            {img.diagnostics.warnings.slice(0, 4).map((w, i) => <div key={i} className="text-[11px] leading-4 text-[#ffca7a]">{w.message}</div>)}
            {img.diagnostics.suggestions.slice(0, 4).map((s, i) => <div key={i} className="text-[11px] leading-4 text-[#a8d2ff]">建议：{s.label}</div>)}
          </div>
        </Section>
        {STAGE_ORDER.map((stage, i) => <StageRow key={stage} stage={stage} index={i} />)}
        <Section title="输出" defaultOpen>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="field-label">裁剪</span>
              <div className="flex gap-1">
                <Button className="btn-xs" onClick={() => setTool('crop')}>框选</Button>
                <Button className="btn-xs" onClick={() => updateStageAndRender('output', { crop: null })}>清除</Button>
              </div>
            </div>
            {doc.params.output.crop ? <div className="mono text-[11px] text-ink-400">{`${doc.params.output.crop.x},${doc.params.output.crop.y} ${doc.params.output.crop.w}×${doc.params.output.crop.h}`}</div> : <div className="text-[11px] text-ink-500">全画幅</div>}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1"><span className="field-label">位深</span><select className="select" value={doc.params.output.bitDepth} onChange={(e) => updateStageAndRender('output', { bitDepth: Number(e.target.value) as 8 | 16 })}><option value={8}>8-bit</option><option value={16}>16-bit</option></select></label>
              <Button className="mt-4" onClick={() => setShowExport(true)}>导出 PNG</Button>
            </div>
          </div>
        </Section>
        <Section title="预设" defaultOpen={false}>
          <div className="space-y-2">
            <div className="flex gap-1">
              <select className="select flex-1" value={selectedPresetId ?? ''} onChange={(e) => setSelectedPresetId(e.target.value || null)}>
                <option value="">选择预设…</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Button className="btn-xs" disabled={!selectedPresetId} onClick={() => selectedPresetId && applyPreset(selectedPresetId)}>应用</Button>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button className="btn-xs" onClick={savePreset}>保存当前</Button>
              <Button className="btn-xs" onClick={exportPresets}>导出</Button>
              <Button className="btn-xs" onClick={() => presetFileRef.current?.click()}>导入</Button>
              {selectedPresetId ? <Button className="btn-xs" onClick={() => selectedPresetId && deletePreset(selectedPresetId)}>删除</Button> : null}
            </div>
            <input ref={presetFileRef} type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importPresets(f); e.currentTarget.value = ''; }} />
          </div>
        </Section>
        <div className="p-3 text-[11px] leading-4 text-ink-500">
          <div className="kv"><span>阶段缓存</span><span className="mono">预览全阶段 / 全分辨率仅目标</span></div>
          <div className="kv"><span>内存估算</span><span className="mono">{doc.stats ? (doc.stats.cacheBytes / 1048576).toFixed(1) : 0} MB</span></div>
          <div className="kv"><span>色彩域</span><span className="mono">{doc.domain}</span></div>
        </div>
      </div>
    </div>
  );
}
