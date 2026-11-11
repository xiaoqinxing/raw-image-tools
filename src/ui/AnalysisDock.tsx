import React from 'react';
import { useActiveDoc, useStore, type AnalysisTab } from '../state/store';
import { analyze, applyChartWb, applyFittedCcm, fitColorChecker, renderActive } from '../services/editor';
import type { AnalysisKind, AnalysisResult, ColorCheckerResult, ColorCheckerFitSettings, ColorCheckerSample, HistogramResult, MtfResult, NoiseSpectrumResult, Rect, SnrResult, WaveformResult } from '../core/types';
import { Button, Segmented, SliderField, Toggle } from './controls';
import { paramsHash } from '../core/pipeline/params';
import { ColorCheckerABPlot } from './ColorCheckerABPlot';
import { normalizeColorCheckerSettings } from '../core/colorchecker/settings';
import { getReference, type ColorCheckerPatch } from '../core/color/colorchecker-data';
import { useAnalysisDockResize } from './analysis-dock-resize';

const TABS: Array<{ id: AnalysisTab; label: string }> = [
  { id: 'histogram', label: '直方图' },
  { id: 'waveform', label: '波形' },
  { id: 'snr', label: 'SNR' },
  { id: 'mtf', label: 'MTF' },
  { id: 'colorchecker', label: 'ColorChecker' },
  { id: 'noise', label: '噪声频谱' },
  { id: 'diff', label: '差异' },
];

function sameRect(a: Rect | null | undefined, b: Rect | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function useAnalysis<T extends AnalysisResult>(kind: AnalysisKind): T | null {
  const doc = useActiveDoc();
  return (doc?.analysis[kind] as T | undefined) ?? null;
}

function HistogramView({ result }: { result: HistogramResult }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [log, setLog] = React.useState(false);
  const maxCount = React.useMemo(() => {
    let max = 1;
    for (const ch of [result.channels.r, result.channels.g, result.channels.b, result.channels.y]) {
      for (let i = 0; i < ch.length; i++) if (ch[i] > max) max = ch[i];
    }
    return max;
  }, [result]);
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

      const padL = 48, padR = 12, padT = 16, padB = 34;
      const plotW = Math.max(1, w - padL - padR);
      const plotH = Math.max(1, h - padT - padB);
      const yFrac = (count: number) => log
        ? Math.min(1, Math.log10(1 + count) / Math.log10(1 + maxCount))
        : Math.min(1, count / maxCount);
      const fmtCount = (v: number) => v >= 1e6
        ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`
        : v >= 1e3
          ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`
          : `${Math.round(v)}`;

      ctx.fillStyle = '#12171c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0e1318';
      ctx.fillRect(padL, padT, plotW, plotH);

      ctx.strokeStyle = '#2e3942';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const x = padL + (plotW * i) / 4;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      }
      ctx.fillStyle = '#94a3b0';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const count = (maxCount * i) / 4;
        const y = padT + plotH * (1 - yFrac(count));
        if (i > 0) {
          ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        }
        ctx.fillText(fmtCount(count), padL - 5, y + 3.5);
      }
      ctx.textAlign = 'left';
      ctx.fillText('数量', 4, 10);
      ctx.textAlign = 'center';
      for (let i = 0; i <= 4; i++) {
        const x = padL + (plotW * i) / 4;
        ctx.fillText((i / 4).toFixed(2), x, h - 18);
      }
      ctx.fillText('亮度值', padL + plotW / 2, h - 4);

      const count = result.bins;
      const series = (arr: Uint32Array, color: string) => {
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const x = padL + (i / Math.max(1, count - 1)) * plotW;
          const y = padT + plotH * (1 - yFrac(arr[i]));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT, plotW, plotH);
      ctx.clip();
      series(result.channels.r, '#ff7b7b');
      series(result.channels.g, '#5fd99a');
      series(result.channels.b, '#5cb0ff');
      series(result.channels.y, '#d5dde5');
      ctx.restore();
    };
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    draw();
    return () => ro.disconnect();
  }, [result, log, maxCount]);
  const [meanR, meanG, meanB] = result.channelMeans;
  const [ratioR, , ratioB] = result.channelRatios;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
          <span className="mono">{result.bins} bins</span>
          <span>clip low {result.clipped.low.reduce((a, b) => a + b, 0)} / high {result.clipped.high.reduce((a, b) => a + b, 0)}</span>
          <span className="mono">Y 均值 {result.mean.toFixed(4)}</span>
          <span className="flex items-center gap-1.5">
            <span className="text-[#ff7b7b]">R</span>
            <span className="text-[#5fd99a]">G</span>
            <span className="text-[#5cb0ff]">B</span>
            <span className="text-ink-200">Y</span>
          </span>
        </div>
        <Segmented value={log ? 'log' : 'linear'} onChange={(v) => setLog(v === 'log')} options={[{ value: 'linear', label: '线性' }, { value: 'log', label: '对数' }]} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-400" data-testid="histogram-stats">
        <span>R 均值 <span className="mono text-[#ff7b7b]">{meanR.toFixed(4)}</span></span>
        <span>G 均值 <span className="mono text-[#5fd99a]">{meanG.toFixed(4)}</span></span>
        <span>B 均值 <span className="mono text-[#5cb0ff]">{meanB.toFixed(4)}</span></span>
        <span>比例 R/G <span className="mono">{ratioR.toFixed(3)}</span> · B/G <span className="mono">{ratioB.toFixed(3)}</span>（G=1）</span>
      </div>
      <canvas ref={ref} className="hist-canvas min-h-[90px] w-full flex-1 rounded border border-ink-700" />
      <div className="text-[10px] text-ink-500">横轴固定 0–1 亮度值；纵轴为像素数量（自适应）。R/G/B 均值为当前 ROI 内统计。</div>
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
      <div className="text-[11px] text-ink-500">SNR = 20log10(mean/std)，线性域；display 阶段先逆 gamma。统计范围为下方共享 ROI。</div>
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
        <span className="text-[11px] text-ink-500">在所选 ROI 内检测斜边。ISO 12233 · 4× oversampling · Hann · FFT</span>
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
        <div className="mt-2 text-[11px] text-ink-500">在所选 ROI 内计算（中心最多 1024×1024）· 去趋势 plane · Hann 窗 · 径向平均 · H/V 1D PSD</div>
        <div className="mt-2 h-16 overflow-hidden">
          <div className="flex h-full items-end gap-[1px]">
            {result.radial.filter((_, i) => i % 2 === 0).map((p, i) => <div key={i} className="flex-1 bg-[#5cb0ff]/70" style={{ height: `${Math.max(2, p.power * 100)}%` }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

const WEIGHT_PRESETS: Array<{ label: string; make: () => number[] }> = [
  { label: '全部 1', make: () => Array.from({ length: 24 }, () => 1) },
  { label: '中性优先', make: () => Array.from({ length: 24 }, (_, i) => (i >= 18 ? 2 : 1)) },
  { label: '肤色优先', make: () => Array.from({ length: 24 }, (_, i) => (i <= 1 ? 2 : 1)) },
  { label: '彩色优先', make: () => Array.from({ length: 24 }, (_, i) => (i < 18 ? 2 : 1)) },
  { label: '排除暗块', make: () => Array.from({ length: 24 }, (_, i) => (i >= 21 ? 0 : 1)) },
  { label: '仅中性', make: () => Array.from({ length: 24 }, (_, i) => (i >= 18 ? 1 : 0)) },
];

const SAMPLE_REASON_LABELS: Record<string, string> = {
  clipped: '裁切',
  dark: '欠曝',
  nan: '非法',
  outside: '越界',
};

function PatchWeightTable({
  weights,
  patches,
  samples,
  onWeight,
}: {
  weights: number[];
  patches: ColorCheckerPatch[];
  samples?: ColorCheckerSample[];
  onWeight: (index: number, value: number) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto scroll-thin">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 z-10 bg-ink-900 text-ink-500">
          <tr className="text-left">
            <th className="w-8 py-1">#</th>
            <th className="py-1">色块</th>
            <th className="w-16 py-1">取样</th>
            <th className="w-20 py-1">权重</th>
          </tr>
        </thead>
        <tbody className="mono">
          {patches.map((patch, i) => {
            const weight = weights[i] ?? 1;
            const sample = samples?.[i];
            const status = sample
              ? sample.valid
                ? '有效'
                : SAMPLE_REASON_LABELS[sample.reason ?? ''] ?? '无效'
              : '待拟合';
            return (
              <tr
                key={i}
                data-testid={`cc-weight-row-${i}`}
                className={`border-t border-ink-700/60 ${weight <= 0 ? 'opacity-50' : ''}`}
              >
                <td className="py-0.5">{i + 1}</td>
                <td className="py-0.5 font-sans text-ink-300">
                  <span
                    className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm border border-black/40 align-middle"
                    style={{ backgroundColor: `rgb(${patch.srgb[0]}, ${patch.srgb[1]}, ${patch.srgb[2]})` }}
                  />
                  {patch.nameZh}
                </td>
                <td className={`py-0.5 ${sample && !sample.valid ? 'text-[#ff9a9a]' : 'text-ink-500'}`}>{status}</td>
                <td className="py-0.5">
                  <input
                    className="input input-mono w-16 px-1 py-0.5 text-[10px]"
                    type="number"
                    min={0}
                    max={4}
                    step={0.1}
                    value={weight}
                    aria-label={`色块 ${i + 1} 权重`}
                    onChange={(e) => onWeight(i, Number(e.target.value))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ColorCheckerView({ result }: { result: ColorCheckerResult | null }) {
  const doc = useActiveDoc();
  const setColorChecker = useStore((s) => s.setColorChecker);
  const setColorCheckerSettings = useStore((s) => s.setColorCheckerSettings);
  const setTool = useStore((s) => s.setTool);
  const tool = useStore((s) => s.tool);
  const fitCreatedAt = doc?.colorChecker.fit?.createdAt ?? 0;
  const [view, setView] = React.useState<'weights' | 'table' | 'ab'>(fitCreatedAt ? 'table' : 'weights');
  const lastFitCreatedAt = React.useRef(fitCreatedAt);
  React.useEffect(() => {
    if (fitCreatedAt && fitCreatedAt !== lastFitCreatedAt.current) {
      lastFitCreatedAt.current = fitCreatedAt;
      setView('table');
    }
  }, [fitCreatedAt]);
  if (!doc) return null;
  const fit = result ?? doc.colorChecker.fit ?? null;
  const referencePatches = getReference(doc.colorChecker.referenceId);
  const settings = normalizeColorCheckerSettings(doc.colorCheckerSettings);
  const updateSettings = (patch: Partial<ColorCheckerFitSettings>) =>
    setColorCheckerSettings(doc.id, normalizeColorCheckerSettings({ ...settings, ...patch }));
  const setWeight = (index: number, value: number) => {
    const weights = [...settings.weights];
    weights[index] = Math.max(0, Math.min(4, Number.isFinite(value) ? value : 1));
    updateSettings({ weights });
  };
  const targetAdjusted = Math.abs(settings.target.saturation - 100) > 1e-9 || Math.abs(settings.target.hue) > 1e-9;
  const showStandard = !!fit && (
    targetAdjusted ||
    (typeof fit.meanDE00Standard === 'number' && Math.abs(fit.meanDE00 - fit.meanDE00Standard) > 1e-6)
  );
  const settingsChanged = !!fit && (
    Math.abs((fit.targetSaturation ?? 100) - settings.target.saturation) > 1e-9 ||
    Math.abs((fit.targetHue ?? 0) - settings.target.hue) > 1e-9 ||
    (fit.objective ?? 'de00') !== settings.objective ||
    (fit.weights ?? []).some((w, i) => Math.abs(w - settings.weights[i]) > 1e-9)
  );
  const saturationGain = fit && typeof fit.saturationGain === 'number' && Number.isFinite(fit.saturationGain)
    ? fit.saturationGain
    : null;
  const saturationTarget = fit && typeof fit.saturationGainTarget === 'number' && Number.isFinite(fit.saturationGainTarget)
    ? fit.saturationGainTarget
    : null;
  const targetSaturation = fit?.targetSaturation ?? 100;
  const saturationDeviation = saturationTarget === null ? null : saturationTarget - 100;
  const saturationOff = saturationDeviation !== null && Math.abs(saturationDeviation) > 5;
  const suggestedSaturation = saturationTarget !== null && saturationTarget > 1
    ? Math.max(0, Math.min(200, Math.round((targetSaturation * 100) / saturationTarget)))
    : null;
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto scroll-thin sm:flex-row sm:overflow-hidden">
      <div className="w-full shrink-0 space-y-2 overflow-auto scroll-thin sm:w-[260px] sm:overflow-y-auto">
        <div className="field-label">参考版本</div>
        <select
          className="select w-full"
          value={doc.colorChecker.referenceId}
          onChange={(e) => setColorChecker(doc.id, { ...doc.colorChecker, referenceId: e.target.value })}
        >
          <option value="classic24-pre2014-d65">Classic 24 · pre-2014 · D65</option>
        </select>
        <div className="flex flex-wrap gap-1">
          <Button className="btn-xs" variant={tool === 'colorchecker' ? 'primary' : 'ghost'} onClick={() => setTool(tool === 'colorchecker' ? 'pan' : 'colorchecker')}>
            四角框选
          </Button>
          <Button className="btn-xs" onClick={() => setColorChecker(doc.id, { ...doc.colorChecker, corners: null, fit: undefined })}>重置</Button>
          <Button className="btn-xs" variant="primary" onClick={fitColorChecker} disabled={!doc.colorChecker.corners}>拟合 CCM</Button>
        </div>
        <div className="kv"><span>四角</span><span className="mono">{doc.colorChecker.corners?.length ?? 0}/4</span></div>

        <div className="rounded border border-ink-700 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="field-label">拟合目标</span>
            <Segmented
              value={settings.objective}
              onChange={(v) => updateSettings({ objective: v })}
              options={[{ value: 'de00', label: '色准' }, { value: 'chroma', label: '色度优先' }]}
            />
          </div>
          <div className="text-[10px] leading-4 text-ink-500">色度优先 = ΔC00+ΔH00 为主，L* 只做弱约束。</div>
          <SliderField label="目标饱和度" testId="cc-target-saturation" value={settings.target.saturation} min={0} max={200} unit="%" onChange={(v) => updateSettings({ target: { ...settings.target, saturation: v } })} />
          <SliderField label="目标色调" testId="cc-target-hue" value={settings.target.hue} min={-60} max={60} unit="°" onChange={(v) => updateSettings({ target: { ...settings.target, hue: v } })} />
          <SliderField label="取样内缩" testId="cc-target-inset" value={Math.round(settings.inset * 100)} min={30} max={70} unit="%" onChange={(v) => updateSettings({ inset: v / 100 })} />
          <div className="mt-1 flex items-center justify-between gap-2">
            <Toggle on={settings.autoWb} onChange={(v) => updateSettings({ autoWb: v })} label="拟合前按中性块校正 WB" />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Button className="btn-xs" onClick={applyChartWb} disabled={!doc.colorChecker.corners}>按色卡中性块设 WB</Button>
          </div>
          <div className="mt-1 text-[10px] leading-4 text-ink-500">使用底行中间四块（20–23：Neutral 8 / 6.5 / 5 / 3.5）。</div>
        </div>

        {!fit ? (
          <div className="rounded border border-ink-700 p-2 text-[11px] leading-4 text-ink-500">
            点击“四角框选”后，在画布上依次点选 24 色块区域的四角（不是卡片外框）。已选角点会在画布上用序号标出；选满 4 点后点“拟合 CCM”。取样框只在 ColorChecker 面板展开时显示。
          </div>
        ) : null}
      </div>

      <div className="flex min-h-[320px] min-w-0 flex-1 flex-col gap-2 sm:min-h-0 sm:overflow-hidden">
        {fit ? (
          <div className="shrink-0 rounded border border-ink-700 p-2" data-testid="cc-fit-summary">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
              <span>有效 <span className="mono text-ink-200">{fit.validCount}/24</span> · 参与 <span className="mono text-ink-200">{fit.usedCount ?? fit.validCount}</span></span>
              <span>目标 mean <span className="mono text-[15px]" style={{ color: (fit.weightedMeanDE00 ?? fit.meanDE00) <= 2.5 ? '#7fe3ae' : '#ffca7a' }}>{(fit.weightedMeanDE00 ?? fit.meanDE00).toFixed(3)}</span></span>
              <span>全块 <span className="mono text-ink-200">{fit.meanDE00.toFixed(3)}</span></span>
              {showStandard ? <span>标准 <span className="mono text-ink-200">{fit.meanDE00Standard?.toFixed(3)}</span></span> : null}
              <span>max <span className="mono" style={{ color: fit.maxDE00 <= 5 ? '#7fe3ae' : '#ffca7a' }}>{fit.maxDE00.toFixed(3)}</span></span>
              <span>|ΔC'| <span className="mono text-ink-200">{fit.meanAbsDC.toFixed(3)}</span> · |ΔH'| <span className="mono text-ink-200">{(fit.meanAbsDH ?? 0).toFixed(3)}</span></span>
              {saturationGain !== null ? (
                <span
                  data-testid="cc-saturation"
                  title={`Imatest Chroma%：前 18 个彩色块中参与拟合块的加权平均 C* 比（n=${fit.saturationCount ?? 0}）；100% = 与标准参考一致`}
                >
                  饱和度{' '}
                  <span className={`mono ${saturationOff ? 'text-[#ffca7a]' : 'text-ink-200'}`}>{saturationGain.toFixed(1)}%</span>
                  <span className="text-ink-500">
                    （目标 {targetSaturation}%
                    {targetSaturation !== 100 && saturationTarget !== null
                      ? ` · 实测/目标 ${saturationTarget.toFixed(1)}%`
                      : ''}
                    ）
                  </span>
                </span>
              ) : null}
              <span>{fit.method === 'chroma-optimized' ? '色度优先优化' : fit.method === 'de00-optimized' ? 'ΔE00 优化' : '最小二乘'}</span>
              {fit.wb ? <span>WB <span className="mono text-ink-200">R {fit.wb.multipliers[0].toFixed(2)} / B {fit.wb.multipliers[3].toFixed(2)}</span></span> : null}
              <Button className="btn-xs ml-auto" variant="primary" onClick={applyFittedCcm}>应用 CCM</Button>
            </div>
            {settingsChanged ? (
              <div className="mt-1 text-[10px] leading-4 text-[#ffca7a]">权重或目标已改变，请重新拟合；当前结果使用旧设置。</div>
            ) : null}
            {saturationOff && saturationGain !== null && saturationDeviation !== null ? (
              <div className="mt-1 text-[10px] leading-4 text-[#ffca7a]" data-testid="cc-saturation-note">
                拟合后饱和度 {saturationGain.toFixed(0)}%，{saturationDeviation > 0 ? '高于' : '低于'}目标 {Math.abs(saturationDeviation).toFixed(0)} 个百分点
                {suggestedSaturation !== null && (fit.gamutClippedCount ?? 0) === 0
                  ? `；可把目标饱和度调到约 ${suggestedSaturation}% 后重新拟合`
                  : ''}。
              </div>
            ) : null}
            {fit.warnings.length ? (
              <div className="mt-1 text-[10px] leading-4 text-[#ffca7a]">{fit.warnings.join(' · ')}</div>
            ) : null}
            <div className="mt-1 text-[10px] leading-4 text-ink-500">拟合矩阵与本次 WB/曝光绑定；换图或改曝光后请重新拟合。</div>
          </div>
        ) : null}
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Button className="btn-xs" variant={view === 'weights' ? 'primary' : 'ghost'} onClick={() => setView('weights')}>权重表</Button>
          <Button className="btn-xs" variant={view === 'table' ? 'primary' : 'ghost'} onClick={() => setView('table')} disabled={!fit}>色块表</Button>
          <Button className="btn-xs" variant={view === 'ab' ? 'primary' : 'ghost'} onClick={() => setView('ab')} disabled={!fit}>a*b* 图</Button>
          {view === 'weights' ? (
            <select
              className="select w-auto py-0.5 text-[10px]"
              aria-label="权重预设"
              value=""
              onChange={(e) => {
                const preset = WEIGHT_PRESETS.find((item) => item.label === e.target.value);
                if (preset) updateSettings({ weights: preset.make() });
              }}
            >
              <option value="">权重预设…</option>
              {WEIGHT_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.label}>{preset.label}</option>
              ))}
            </select>
          ) : null}
          <span className="ml-auto text-[10px] text-ink-500">0=不参与 · 1=正常 · &gt;1=加强</span>
        </div>
        {view === 'weights' ? (
          <PatchWeightTable
            weights={settings.weights}
            patches={referencePatches}
            samples={fit?.samples}
            onWeight={setWeight}
          />
        ) : !fit ? (
          <div className="flex h-full items-center justify-center text-center text-[11px] text-ink-500">
            尚未拟合。四角框选完成后点击“拟合 CCM”。
          </div>
        ) : view === 'ab' ? (
          <ColorCheckerABPlot fit={fit} />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto scroll-thin">
            <table className="w-full text-[11px]">
              <thead className="text-ink-500">
                <tr className="text-left"><th>#</th><th>色块</th><th>权重</th><th>ΔE00</th><th>ΔC'</th><th>ΔH'</th>{showStandard ? <th>标准 ΔE</th> : null}<th>参与</th></tr>
              </thead>
              <tbody className="mono">
                {fit.patches.map((p, i) => {
                  const weight = settings.weights[i] ?? p.weight ?? 1;
                  return (
                    <tr key={i} className={`border-t border-ink-700/60 ${!p.used ? 'opacity-45' : ''}`}>
                      <td>{i + 1}</td>
                      <td className="font-sans text-ink-300">{p.name}</td>
                      <td>
                        <input
                          className="input input-mono w-14 px-1 py-0.5 text-[10px]"
                          type="number"
                          min={0}
                          max={4}
                          step={0.1}
                          value={weight}
                          aria-label={`色块 ${i + 1} 权重`}
                          onChange={(e) => setWeight(i, Number(e.target.value))}
                        />
                      </td>
                      <td style={{ color: p.dE00 > 5 ? '#ff9a9a' : p.dE00 > 2.5 ? '#ffca7a' : '#7fe3ae' }}>{p.dE00.toFixed(2)}</td>
                      <td>{p.dC.toFixed(2)}</td>
                      <td>{(p.dH ?? 0).toFixed(2)}</td>
                      {showStandard ? <td>{p.dE00Standard?.toFixed(2) ?? '—'}</td> : null}
                      <td>{p.used ? '✓' : p.invalidReason ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
  const roi = doc.roi;
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto scroll-thin sm:flex-row sm:overflow-hidden">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button className="btn-xs" onClick={() => { useStore.getState().setDiffMode(!useStore.getState().diffMode); renderActive(); }}>差异预览</Button>
          <Button className="btn-xs" onClick={() => { useStore.getState().setAbMode('stage'); renderActive(); }}>A/B 当前 vs bypass</Button>
          <Button className="btn-xs" variant="primary" onClick={() => { if (roi) analyze('diff'); else useStore.getState().setTool('roi'); }}>计算差异指标</Button>
          <span className="text-[11px] text-ink-500">{roi ? 'A/B 在画布中显示；指标在 Worker 内计算。' : '差异分析需要先框选 ROI。'}</span>
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
  const tab = useStore((s) => s.analysisTab);
  const setTab = useStore((s) => s.setAnalysisTab);
  const collapsed = useStore((s) => s.analysisCollapsed);
  const setCollapsed = useStore((s) => s.setAnalysisCollapsed);
  const analysisStage = useStore((s) => s.analysisStage);
  const setAnalysisStage = useStore((s) => s.setAnalysisStage);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const setRoi = useStore((s) => s.setRoi);
  const clearAnalysis = useStore((s) => s.clearAnalysis);
  const analysisBusy = useStore((s) => s.analysisBusy);
  const requiresRoi = tab === 'snr' || tab === 'mtf' || tab === 'noise' || tab === 'diff';
  const roiKey = doc?.roi ? `${doc.roi.x},${doc.roi.y},${doc.roi.w},${doc.roi.h}` : 'full';
  const lastRunKey = React.useRef<{ roiKey: string; tab: AnalysisTab } | null>(null);
  const [dockNode, setDockNode] = React.useState<HTMLDivElement | null>(null);
  const dockResize = useAnalysisDockResize(dockNode, !collapsed);

  React.useEffect(() => {
    const mq = window.matchMedia('(max-height: 520px) and (max-width: 1199px)');
    const onChange = () => { if (mq.matches) setCollapsed(true); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Analyses refresh automatically while the dock is expanded, including after
  // parameter or ROI changes. A collapsed dock performs no analysis work.
  const autoKey = doc ? paramsHash(doc.params) : '';
  React.useEffect(() => {
    if (collapsed || !doc || doc.status !== 'ready') return;
    if (tab === 'colorchecker') return;
    if (requiresRoi && !doc.roi) return;
    const current = tab === 'diff' ? doc.analysis.diff : doc.analysis[tab];
    if (current && current.paramsHash === autoKey && current.stage === analysisStage && sameRect(current.roi, doc.roi)) return;
    const id = doc.id;
    // ROI or tab changes recompute immediately; slider edits are debounced.
    const immediate = lastRunKey.current !== null && (lastRunKey.current.roiKey !== roiKey || lastRunKey.current.tab !== tab);
    lastRunKey.current = { roiKey, tab };
    const t = window.setTimeout(() => {
      const latest = useStore.getState().docs[id];
      if (!latest || latest.status !== 'ready') return;
      if (tab === 'diff') void analyze('diff');
      else void analyze(tab);
    }, immediate ? 0 : 300);
    return () => window.clearTimeout(t);
  }, [collapsed, doc?.id, doc?.status, doc?.generation, tab, analysisStage, autoKey, roiKey, requiresRoi]);

  if (!doc) return null;

  const selectTab = (next: AnalysisTab) => {
    setTab(next);
    setCollapsed(false);
    const nextRequiresRoi = next === 'snr' || next === 'mtf' || next === 'noise' || next === 'diff';
    if (nextRequiresRoi && !doc.roi) clearAnalysis(doc.id, next);
    if (!nextRequiresRoi && tool === 'roi') setTool('pan');
  };
  const run = () => {
    setCollapsed(false);
    if (tab === 'colorchecker') fitColorChecker();
    else if (requiresRoi && !doc.roi) setTool('roi');
    else if (tab === 'diff') analyze('diff');
    else analyze(tab);
  };
  const result = tab === 'diff' ? doc.analysis.diff : doc.analysis[tab];
  const roi = doc.roi;
  return (
    <div ref={setDockNode} style={dockResize.style} className={`analysis-dock flex flex-col border-t border-ink-700 bg-ink-900 ${collapsed ? 'is-collapsed' : ''} ${!collapsed && tab === 'colorchecker' ? 'is-colorchecker' : ''}`}>
      {!collapsed ? (
        <div
          className={`analysis-resize-handle ${dockResize.resizing ? 'is-resizing' : ''}`}
          {...dockResize.handleProps}
        />
      ) : null}
      <div className="analysis-toolbar flex items-center border-b border-ink-700/70">
        <div className="analysis-tabs flex min-w-0 flex-1 items-center overflow-x-auto px-2 scroll-thin">
          {TABS.map((t) => (
            <button key={t.id} data-testid={`analysis-tab-${t.id}`} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => selectTab(t.id)}>{t.label}</button>
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
          {analysisBusy ? <span className="flex items-center gap-1 text-[11px] text-ink-400" data-testid="analysis-busy"><span className="spin" />计算中</span> : null}
          <Button className="btn-xs" variant="primary" onClick={run} testId="analysis-run">{tab === 'colorchecker' ? '拟合' : tab === 'diff' ? '差异' : requiresRoi && !roi ? '框选 ROI' : result ? '重算' : '运行'}</Button>
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
          {tab !== 'colorchecker' ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-400" data-testid="analysis-range">
              <span className="field-label">分析范围</span>
              {requiresRoi ? (
                <Button
                  className="btn-xs"
                  variant={tool === 'roi' ? 'primary' : 'ghost'}
                  onClick={() => setTool(tool === 'roi' ? 'pan' : 'roi')}
                  title="点击开始/结束持续框选"
                >
                  框选
                </Button>
              ) : (
                <Segmented
                  value={roi ? 'roi' : 'full'}
                  onChange={(v) => {
                    if (v === 'full') {
                      setRoi(doc.id, null);
                      setTool('pan');
                      clearAnalysis(doc.id, 'snr');
                      clearAnalysis(doc.id, 'mtf');
                      clearAnalysis(doc.id, 'noise');
                      clearAnalysis(doc.id, 'diff');
                    } else {
                      setTool('roi');
                    }
                  }}
                  options={[{ value: 'full', label: '全图' }, { value: 'roi', label: '框选' }]}
                />
              )}
              {roi ? (
                <span className="mono">{Math.round(roi.w)}×{Math.round(roi.h)} @ {roi.x},{roi.y}</span>
              ) : requiresRoi ? (
                <span className="text-[#ffca7a]">尚未框选</span>
              ) : (
                <span>整幅图像</span>
              )}
              {tool === 'roi' ? <span className="text-[#a8d2ff]">在画布上拖拽框选</span> : null}
            </div>
          ) : null}
          {result?.warnings?.length ? (
            <div className="mb-2 rounded border border-[#5c4a24] bg-[#332713] px-2 py-1 text-[11px] leading-4 text-[#ffca7a]" data-testid="analysis-warnings">
              {result.warnings.join(' · ')}
            </div>
          ) : null}
          {tab === 'histogram' ? (result?.kind === 'histogram' ? <HistogramView result={result} /> : <Empty text="直方图：RGB + 亮度、线性/对数、剪切计数。" />) : null}
          {tab === 'waveform' ? (result?.kind === 'waveform' ? <WaveformView result={result} /> : <Empty text="波形：亮度波形 / RGB parade；默认全图，可框选限制范围。" />) : null}
          {tab === 'snr' ? (result?.kind === 'snr' ? <SnrView result={result} /> : <Empty text="请先框选 ROI：选择“框选”后在画布上拖拽平坦区域，再计算 mean/std 与 SNR dB。" />) : null}
          {tab === 'mtf' ? (result?.kind === 'mtf' ? <MtfView result={result} /> : <Empty text="请先框选 ROI：在画布上拖拽包含清晰斜边的区域，再计算 ISO 12233 MTF50/MTF10。" />) : null}
          {tab === 'colorchecker' ? <ColorCheckerView result={result?.kind === 'colorchecker' ? result : null} /> : null}
          {tab === 'noise' ? (result?.kind === 'noise' ? <SpectrumView result={result} /> : <Empty text="请先框选 ROI：在画布上拖拽平坦区域，再计算 2D FFT 噪声功率谱（最多采样 1024×1024）。" />) : null}
          {tab === 'diff' ? <DiffView /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-center text-[11px] text-ink-500">{text}</div>;
}
