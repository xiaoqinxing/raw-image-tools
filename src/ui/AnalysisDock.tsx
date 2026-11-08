import React from 'react';
import { useActiveDoc, useStore } from '../state/store';
import { analyze, applyFittedCcm, fitColorChecker, renderActive } from '../services/editor';
import type { AnalysisKind, AnalysisResult, ColorCheckerResult, HistogramResult, MtfResult, NoiseSpectrumResult, ProbeResult, SnrResult, WaveformResult } from '../core/types';
import { Button, KV, Segmented } from './controls';
import { paramsHash } from '../core/pipeline/params';

const TABS: Array<{ id: AnalysisKind | 'diff'; label: string }> = [
  { id: 'histogram', label: '直方图' },
  { id: 'waveform', label: '波形' },
  { id: 'probe', label: '探针' },
  { id: 'snr', label: 'SNR' },
  { id: 'mtf', label: 'MTF' },
  { id: 'colorchecker', label: 'ColorChecker' },
  { id: 'noise', label: '噪声频谱' },
  { id: 'diff', label: '差异' },
];

function useAnalysis<T extends AnalysisResult>(kind: AnalysisKind): T | null {
  const doc = useActiveDoc();
  return (doc?.analysis[kind] as T | undefined) ?? null;
}

function HistogramView({ result }: { result: HistogramResult }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [log, setLog] = React.useState(false);
  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (w < 2 || h < 2) return;
      c.width = w * dpr; c.height = h * dpr;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#12171c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2e3942';
      for (let i = 1; i < 4; i++) {
        const x = (w * i) / 4;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      const count = result.bins;
      let max = 1;
      for (const ch of [result.channels.r, result.channels.g, result.channels.b, result.channels.y]) {
        for (let i = 0; i < count; i++) {
          const v = log ? Math.log10(1 + ch[i]) : ch[i];
          if (v > max) max = v;
        }
      }
      const drawSeries = (arr: Uint32Array, color: string, fill = false) => {
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const v = log ? Math.log10(1 + arr[i]) : arr[i];
          const x = (i / (count - 1)) * w;
          const y = h - (v / max) * (h - 6);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        if (fill) {
          ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
          ctx.fillStyle = color; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      };
      drawSeries(result.channels.r, '#ff7b7b');
      drawSeries(result.channels.g, '#5fd99a');
      drawSeries(result.channels.b, '#5cb0ff');
      drawSeries(result.channels.y, '#d5dde5');
      ctx.fillStyle = '#94a3b0'; ctx.font = '11px monospace';
      ctx.fillText(`${result.min.toFixed(3)}`, 3, h - 3);
      ctx.fillText(`${result.max.toFixed(3)}`, w - 42, h - 3);
    };
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    draw();
    return () => ro.disconnect();
  }, [result, log]);
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
          <span className="mono">{result.bins} bins</span>
          <span>clip low {result.clipped.low.reduce((a, b) => a + b, 0)} / high {result.clipped.high.reduce((a, b) => a + b, 0)}</span>
          <span className="mono">mean {result.mean.toFixed(4)}</span>
        </div>
        <Segmented value={log ? 'log' : 'linear'} onChange={(v) => setLog(v === 'log')} options={[{ value: 'linear', label: '线性' }, { value: 'log', label: '对数' }]} />
      </div>
      <canvas ref={ref} className="hist-canvas min-h-[90px] w-full flex-1 rounded border border-ink-700" />
    </div>
  );
}

function WaveformView({ result }: { result: WaveformResult }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = result.width; c.height = result.height;
    const ctx = c.getContext('2d')!;
    const img = new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height);
    ctx.putImageData(img, 0, 0);
  }, [result]);
  return <canvas ref={ref} className="waveform-canvas h-full max-h-[170px] w-full rounded border border-ink-700 object-contain" style={{ imageRendering: 'pixelated' }} />;
}

function ProbeView({ result }: { result: ProbeResult }) {
  const doc = useActiveDoc();
  return (
    <div className="h-full overflow-auto scroll-thin">
      <table className="w-full text-[11px]">
        <thead className="text-ink-500">
          <tr className="text-left"><th className="py-1">探针</th><th>坐标</th><th>RAW</th><th>R</th><th>G</th><th>B</th><th>WB</th></tr>
        </thead>
        <tbody className="mono">
          {result.points.map((p, i) => (
            <tr key={p.id} className="border-t border-ink-700/60">
              <td className="py-1 text-[#ffb85c]">P{i + 1}</td>
              <td>{Math.round(p.x)},{Math.round(p.y)}</td>
              <td>{p.rawCfa.channel}={p.rawCfa.dn}</td>
              <td>{p.stageRgb[0].toFixed(4)}</td>
              <td>{p.stageRgb[1].toFixed(4)}</td>
              <td>{p.stageRgb[2].toFixed(4)}</td>
              <td>{p.wbMultipliers.map((v) => v.toFixed(2)).join('/')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex gap-2">
        <Button className="btn-xs" onClick={() => useStore.getState().setTool('probe')}>添加探针</Button>
        {doc?.probes.length ? <Button className="btn-xs" onClick={() => { doc.probes.forEach((p) => useStore.getState().removeProbe(doc.id, p.id)); }}>清空</Button> : null}
      </div>
      <div className="mt-2 text-[11px] text-ink-500">探针值来自当前预览 stage 的 F16 纹理；RAW 值来自原始 U16 缓冲。</div>
    </div>
  );
}

function SnrView({ result }: { result: SnrResult }) {
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px]">
        <thead className="text-ink-500"><tr className="text-left"><th>通道</th><th>mean</th><th>std</th><th>SNR dB</th><th>样本</th></tr></thead>
        <tbody className="mono">
          {result.perChannel.map((c) => (
            <tr key={c.channel} className="border-t border-ink-700/60"><td>{c.channel}</td><td>{c.mean.toFixed(5)}</td><td>{c.std.toFixed(5)}</td><td className="text-[#7fe3ae]">{c.snrDb.toFixed(2)}</td><td>{c.samples}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-ink-500">SNR = 20log10(mean/std)，线性域；display 阶段先逆 gamma。ROI 为矩形平坦区域。</div>
      <Button className="btn-xs" onClick={() => { useStore.getState().setRoiKind('snr'); useStore.getState().setTool('roi'); }}>重新框选 ROI</Button>
    </div>
  );
}

function MtfView({ result }: { result: MtfResult }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (w < 2 || h < 2) return;
      c.width = w * dpr; c.height = h * dpr;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#12171c'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2e3942';
      for (let i = 0; i <= 5; i++) { const x = (w * i) / 5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let i = 0; i <= 5; i++) { const y = (h * i) / 5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      const colors = ['#ff7b7b', '#5fd99a', '#5cb0ff', '#e7edf3'];
      result.perChannel.forEach((ch, idx) => {
        if (!ch.curve.length) return;
        ctx.beginPath();
        ch.curve.forEach((p, i) => {
          const x = (p.f / 0.5) * w;
          const y = h - p.mtf * h;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = colors[idx]; ctx.lineWidth = 1.2; ctx.stroke();
      });
      ctx.fillStyle = '#94a3b0'; ctx.font = '11px monospace';
      ctx.fillText('0', 3, h - 3); ctx.fillText('0.5 cyc/px', w - 70, h - 3);
    };
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    draw();
    return () => ro.disconnect();
  }, [result]);
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap gap-3 text-[11px]">
        {result.perChannel.map((c) => (
          <span key={c.channel} className="mono"><span className={c.channel === 'R' ? 'text-[#ff7b7b]' : c.channel === 'G' ? 'text-[#5fd99a]' : c.channel === 'B' ? 'text-[#5cb0ff]' : 'text-ink-200'}>{c.channel}</span> 50%={c.mtf50.toFixed(3)} 10%={c.mtf10.toFixed(3)}</span>
        ))}
        <span className="text-ink-500">angle {result.edge.angleDeg.toFixed(1)}° · contrast {result.edge.contrast.toFixed(2)}</span>
      </div>
      <canvas ref={ref} className="min-h-[110px] w-full flex-1 rounded border border-ink-700" />
      <div className="flex items-center gap-2">
        <Button className="btn-xs" onClick={() => { useStore.getState().setRoiKind('mtf'); useStore.getState().setTool('roi'); }}>重新框选斜边 ROI</Button>
        <span className="text-[11px] text-ink-500">ISO 12233 · 4× oversampling · Hann · FFT</span>
      </div>
    </div>
  );
}

function SpectrumView({ result }: { result: NoiseSpectrumResult }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const img = document.createElement('canvas');
    img.width = result.width; img.height = result.height;
    const ictx = img.getContext('2d')!;
    const id = ictx.createImageData(result.width, result.height);
    for (let i = 0; i < result.spectrum.length; i++) {
      const v = Math.max(0, Math.min(1, result.spectrum[i]));
      id.data[i * 4] = Math.round(v * 255);
      id.data[i * 4 + 1] = Math.round(Math.pow(v, 0.7) * 255);
      id.data[i * 4 + 2] = Math.round(Math.pow(v, 0.35) * 255);
      id.data[i * 4 + 3] = 255;
    }
    ictx.putImageData(id, 0, 0);
    c.width = 380; c.height = 220;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, c.width, c.height);
  }, [result]);
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto scroll-thin sm:flex-row sm:overflow-hidden">
      <canvas ref={ref} className="h-[150px] w-full rounded border border-ink-700 sm:h-[170px] sm:w-[300px] sm:shrink-0" style={{ imageRendering: 'pixelated' }} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-ink-300">2D FFT · log power · {result.width}×{result.height}</div>
        <div className="mt-1 text-[11px] text-ink-500">去趋势 plane · Hann 窗 · 径向平均 · H/V 1D PSD</div>
        <div className="mt-2 flex gap-2">
          <Button className="btn-xs" onClick={() => { useStore.getState().setRoiKind('noise'); useStore.getState().setTool('roi'); }}>重新框选平坦 ROI</Button>
        </div>
        <div className="mt-2 h-16 overflow-hidden">
          <div className="flex h-full items-end gap-[1px]">
            {result.radial.filter((_, i) => i % 2 === 0).map((p, i) => <div key={i} className="flex-1 bg-[#5cb0ff]/70" style={{ height: `${Math.max(2, p.power * 100)}%` }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorCheckerView({ result }: { result: ColorCheckerResult }) {
  const doc = useActiveDoc();
  const setColorChecker = useStore((s) => s.setColorChecker);
  const setTool = useStore((s) => s.setTool);
  if (!doc) return null;
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto scroll-thin sm:flex-row sm:overflow-hidden">
      <div className="w-full shrink-0 space-y-2 sm:w-[260px]">
        <div className="field-label">参考版本</div>
        <select
          className="select w-full"
          value={doc.colorChecker.referenceId}
          onChange={(e) => setColorChecker(doc.id, { ...doc.colorChecker, referenceId: e.target.value })}
        >
          <option value="classic24-pre2014-d65">Classic 24 · pre-2014 · D65</option>
        </select>
        <div className="flex flex-wrap gap-1">
          <Button className="btn-xs" onClick={() => setTool('colorchecker')}>四角框选</Button>
          <Button className="btn-xs" onClick={() => setColorChecker(doc.id, { ...doc.colorChecker, corners: null, fit: undefined })}>重置</Button>
          <Button className="btn-xs" variant="primary" onClick={fitColorChecker} disabled={!doc.colorChecker.corners}>拟合 CCM</Button>
        </div>
        <div className="kv"><span>四角</span><span className="mono">{doc.colorChecker.corners?.length ?? 0}/4</span></div>
        <div className="kv"><span>有效块</span><span className="mono">{result.validCount}/24</span></div>
        <div className="rounded border border-ink-700 p-2">
          <div className="text-[11px] text-ink-500">mean ΔE00</div>
          <div className="mono text-[20px]" style={{ color: result.meanDE00 <= 2.5 ? '#7fe3ae' : '#ffca7a' }}>{result.meanDE00.toFixed(3)}</div>
          <div className="text-[11px] text-ink-500">max ΔE00</div>
          <div className="mono text-[15px]" style={{ color: result.maxDE00 <= 5 ? '#7fe3ae' : '#ffca7a' }}>{result.maxDE00.toFixed(3)}</div>
          <div className="mt-1 text-[11px] text-ink-500">mean |ΔC'| {result.meanAbsDC.toFixed(3)}</div>
          <div className="text-[11px] text-ink-500">{result.method === 'de00-optimized' ? 'ΔE00 优化' : '最小二乘'}</div>
        </div>
        <Button className="btn-xs" variant="primary" onClick={applyFittedCcm}>应用 CCM 到管线</Button>
      </div>
      <div className="min-w-0 flex-1 overflow-auto scroll-thin">
        <table className="w-full text-[11px]">
          <thead className="text-ink-500"><tr className="text-left"><th>#</th><th>色块</th><th>ΔE00</th><th>ΔC'</th><th>used</th></tr></thead>
          <tbody className="mono">
            {result.patches.map((p, i) => (
              <tr key={i} className="border-t border-ink-700/60">
                <td>{i + 1}</td>
                <td className="font-sans text-ink-300">{p.name}</td>
                <td style={{ color: p.dE00 > 5 ? '#ff9a9a' : p.dE00 > 2.5 ? '#ffca7a' : '#7fe3ae' }}>{p.dE00.toFixed(2)}</td>
                <td>{p.dC.toFixed(2)}</td>
                <td>{p.used ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiffView() {
  const doc = useActiveDoc();
  const diff = useAnalysis<import('../core/types').DiffResult>('diff');
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current;
    if (!c || !diff?.rgba) return;
    c.width = diff.width ?? 1;
    c.height = diff.height ?? 1;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(diff.rgba), diff.width ?? 1, diff.height ?? 1), 0, 0);
  }, [diff]);
  if (!doc) return null;
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto scroll-thin sm:flex-row sm:overflow-hidden">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button className="btn-xs" onClick={() => { useStore.getState().setDiffMode(!useStore.getState().diffMode); renderActive(); }}>差异预览</Button>
          <Button className="btn-xs" onClick={() => { useStore.getState().setAbMode('stage'); renderActive(); }}>A/B 当前 vs bypass</Button>
          <Button className="btn-xs" variant="primary" onClick={() => analyze('diff')}>计算差异指标</Button>
          <span className="text-[11px] text-ink-500">A/B 在画布中显示；指标在 Worker 内计算。</span>
        </div>
        {diff ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded bg-ink-850 p-2"><div className="text-[11px] text-ink-500">MAE</div><div className="mono">{diff.metrics.mae.toFixed(5)}</div></div>
            <div className="rounded bg-ink-850 p-2"><div className="text-[11px] text-ink-500">PSNR</div><div className="mono">{Number.isFinite(diff.metrics.psnrDb) ? diff.metrics.psnrDb.toFixed(2) + ' dB' : '∞'}</div></div>
            <div className="rounded bg-ink-850 p-2"><div className="text-[11px] text-ink-500">max diff</div><div className="mono">{diff.metrics.maxDiff.toFixed(4)}</div></div>
          </div>
        ) : <div className="text-[11px] text-ink-500">点击“计算差异指标”：当前管线 vs 当前阶段 bypass（或所选快照）。</div>}
      </div>
      <canvas ref={ref} className="h-[140px] w-full rounded border border-ink-700 sm:h-[160px] sm:w-[220px] sm:shrink-0" style={{ imageRendering: 'pixelated' }} />
    </div>
  );
}

export function AnalysisDock() {
  const doc = useActiveDoc();
  const [tab, setTab] = React.useState<AnalysisKind>('histogram');
  const [collapsed, setCollapsed] = React.useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-height: 520px) and (max-width: 1199px)').matches,
  );
  const analysisStage = useStore((s) => s.analysisStage);
  const setAnalysisStage = useStore((s) => s.setAnalysisStage);
  const setRoiKind = useStore((s) => s.setRoiKind);
  const setTool = useStore((s) => s.setTool);

  React.useEffect(() => {
    const mq = window.matchMedia('(max-height: 520px) and (max-width: 1199px)');
    const onChange = () => { if (mq.matches) setCollapsed(true); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (!doc) return null;

  const selectTab = (next: AnalysisKind) => {
    setTab(next);
    setCollapsed(false);
  };
  const run = () => {
    setCollapsed(false);
    if (tab === 'colorchecker') fitColorChecker();
    else if (tab === 'diff') analyze('diff');
    else if (tab === 'probe') analyze('probe');
    else {
      setRoiKind(tab);
      if (tab === 'snr' || tab === 'mtf' || tab === 'noise') {
        if (!doc.rois[tab]) { setTool('roi'); return; }
      }
      analyze(tab, tab === 'histogram' ? { bins: 1024 } : undefined);
    }
  };
  const result = doc.analysis[tab];
  const stale = !!result && result.paramsHash !== paramsHash(doc.params);
  return (
    <div className={`analysis-dock flex flex-col border-t border-ink-700 bg-ink-900 ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="analysis-toolbar flex items-center border-b border-ink-700/70">
        <div className="analysis-tabs flex min-w-0 flex-1 items-center overflow-x-auto px-2 scroll-thin">
          {TABS.map((t) => (
            <button key={t.id} data-testid={`analysis-tab-${t.id}`} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => selectTab(t.id as AnalysisKind)}>{t.label}</button>
          ))}
        </div>
        <div className="analysis-controls flex shrink-0 items-center gap-2 px-2">
          <span className="field-label analysis-stage-label">阶段</span>
          <select className="select h-[22px] text-[11px]" value={analysisStage} onChange={(e) => setAnalysisStage(e.target.value as typeof analysisStage)}>
            <option value="levels">RAW</option>
            <option value="demosaic">去马赛克</option>
            <option value="denoise">降噪后</option>
            <option value="sharpen">最终</option>
          </select>
          {stale ? <span className="badge badge-warn analysis-stale" title="参数已变化，结果可能过期">参数已变化</span> : null}
          <Button className="btn-xs" variant="primary" onClick={run} testId="analysis-run">{tab === 'colorchecker' ? '拟合' : tab === 'diff' ? '差异' : result ? '重算' : '运行'}</Button>
        </div>
        <button
          className="analysis-collapse"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? '展开分析面板' : '折叠分析面板'}
          aria-expanded={!collapsed}
          title={collapsed ? '展开分析面板' : '折叠分析面板'}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>
      {!collapsed ? (
        <div className="analysis-content min-h-0 flex-1 overflow-auto p-3 scroll-thin">
          {tab === 'histogram' ? (result?.kind === 'histogram' ? <HistogramView result={result} /> : <Empty text="运行直方图：RGB + 亮度、线性/对数、剪切计数。" />) : null}
          {tab === 'waveform' ? (result?.kind === 'waveform' ? <WaveformView result={result} /> : <Empty text="运行波形：亮度波形 / RGB parade。" />) : null}
          {tab === 'probe' ? (result?.kind === 'probe' ? <ProbeView result={result} /> : <Empty text="点击“添加探针”后在画布上取点；显示 RAW CFA、各阶段 RGB、WB 乘数。" />) : null}
          {tab === 'snr' ? (result?.kind === 'snr' ? <SnrView result={result} /> : <Empty text="在平坦区域框选 ROI，逐通道计算 mean/std 与 SNR dB。" />) : null}
          {tab === 'mtf' ? (result?.kind === 'mtf' ? <MtfView result={result} /> : <Empty text="框选斜边 ROI，计算 ISO 12233 MTF50/MTF10。" />) : null}
          {tab === 'colorchecker' ? (result?.kind === 'colorchecker' ? <ColorCheckerView result={result} /> : <Empty text="在画布上依次点选色卡四角（TL/TR/BR/BL），然后拟合 CCM。" />) : null}
          {tab === 'noise' ? (result?.kind === 'noise' ? <SpectrumView result={result} /> : <Empty text="框选平坦 ROI，计算 2D FFT 噪声功率谱、径向平均与 1D PSD。" />) : null}
          {tab === 'diff' ? <DiffView /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-center text-[11px] text-ink-500">{text}</div>;
}
