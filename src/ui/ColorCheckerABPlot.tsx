import React from 'react';
import type { ColorCheckerResult } from '../core/types';
import { labToLinearSrgb, srgbEncode } from '../core/color/lab';
import { abSliceColor, srgbABEnvelope, srgbABSlice, srgbChromaLimitAtL } from '../core/color/gamut';
import { Button } from './controls';

/** a*b* is a 2D projection, so the chroma field needs one fixed lightness. */
const SLICE_L = 50;
const FIELD_SCALE = 0.5;

function labColor(lab: [number, number, number], alpha = 1): string {
  const lin = labToLinearSrgb(lab);
  const rgb = lin.map((v) => Math.round(Math.max(0, Math.min(1, srgbEncode(v))) * 255));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function errorColor(dE: number): string {
  if (dE > 5) return '#ff9a9a';
  if (dE > 2.5) return '#ffca7a';
  return '#7fe3ae';
}

/**
 * a*b* view of the fitted ColorChecker. Target points are hollow, measured
 * points are filled, and the segment between them shows the remaining error.
 * The background is the matching sRGB chroma slice at L*=50 (toggleable), so a
 * deviation can be read as "toward which colour" instead of just "how far".
 */
export function ColorCheckerABPlot({ fit }: { fit: ColorCheckerResult }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const [showChroma, setShowChroma] = React.useState(true);
  const hitRef = React.useRef<Array<{ index: number; x: number; y: number }>>([]);
  const fieldRef = React.useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);

  const gamut = React.useMemo(() => srgbABEnvelope(180, 14), []);
  const slice = React.useMemo(() => srgbABSlice(SLICE_L), []);
  const chromaLimit = React.useMemo(() => srgbChromaLimitAtL(SLICE_L), []);

  const bounds = React.useMemo(() => {
    let maxAbs = 30;
    for (const p of fit.patches) {
      for (const lab of [p.refLab, p.measuredLab]) {
        maxAbs = Math.max(maxAbs, Math.abs(lab[1]), Math.abs(lab[2]));
      }
    }
    maxAbs *= 1.18;
    return { min: -maxAbs, max: maxAbs };
  }, [fit]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const buildField = (plotW: number, plotH: number): HTMLCanvasElement => {
      const fw = Math.max(2, Math.round(plotW * FIELD_SCALE));
      const fh = Math.max(2, Math.round(plotH * FIELD_SCALE));
      const off = document.createElement('canvas');
      off.width = fw;
      off.height = fh;
      const octx = off.getContext('2d');
      if (!octx) return off;
      const image = octx.createImageData(fw, fh);
      const data = image.data;
      const span = bounds.max - bounds.min;
      for (let py = 0; py < fh; py++) {
        const b = bounds.min + (1 - (py + 0.5) / fh) * span;
        for (let px = 0; px < fw; px++) {
          const a = bounds.min + ((px + 0.5) / fw) * span;
          const [r, g, bb] = abSliceColor(a, b, SLICE_L, chromaLimit);
          const offset = (py * fw + px) * 4;
          data[offset] = r;
          data[offset + 1] = g;
          data[offset + 2] = bb;
          data[offset + 3] = 255;
        }
      }
      octx.putImageData(image, 0, 0);
      return off;
    };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(2, wrap.clientWidth);
      const h = Math.max(2, wrap.clientHeight);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const padL = 38, padR = 14, padT = 18, padB = 30;
      const plotW = Math.max(1, w - padL - padR);
      const plotH = Math.max(1, h - padT - padB);
      const span = bounds.max - bounds.min;
      const xOf = (a: number) => padL + ((a - bounds.min) / span) * plotW;
      const yOf = (b: number) => padT + plotH - ((b - bounds.min) / span) * plotH;

      ctx.fillStyle = '#12171c';
      ctx.fillRect(0, 0, w, h);

      if (showChroma) {
        const key = `${Math.round(plotW)}x${Math.round(plotH)}|${bounds.min.toFixed(3)}|${bounds.max.toFixed(3)}|${SLICE_L}`;
        if (!fieldRef.current || fieldRef.current.key !== key) {
          fieldRef.current = { key, canvas: buildField(plotW, plotH) };
        }
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(fieldRef.current.canvas, padL, padT, plotW, plotH);
        // Keep the hues readable but hold markers and labels at a workable contrast.
        ctx.fillStyle = 'rgba(14, 19, 24, 0.55)';
        ctx.fillRect(padL, padT, plotW, plotH);
      } else {
        ctx.fillStyle = '#0e1318';
        ctx.fillRect(padL, padT, plotW, plotH);
      }

      ctx.strokeStyle = showChroma ? 'rgba(255, 255, 255, 0.12)' : '#2e3942';
      ctx.lineWidth = 1;
      const ticks = 4;
      ctx.fillStyle = '#94a3b0';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      for (let i = 0; i <= ticks; i++) {
        const a = bounds.min + (span * i) / ticks;
        const x = xOf(a);
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
        if (i > 0 && i < ticks) ctx.fillText(a.toFixed(0), x - 4, padT + plotH + 15);
      }
      ctx.textAlign = 'center';
      for (let i = 0; i <= ticks; i++) {
        const b = bounds.min + (span * i) / ticks;
        const y = yOf(b);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        if (i > 0 && i < ticks) ctx.fillText(b.toFixed(0), padL - 20, y + 3.5);
      }

      // Neutral axes.
      ctx.strokeStyle = showChroma ? 'rgba(255, 255, 255, 0.38)' : '#4c5a66';
      ctx.beginPath(); ctx.moveTo(xOf(0), padT); ctx.lineTo(xOf(0), padT + plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padL, yOf(0)); ctx.lineTo(padL + plotW, yOf(0)); ctx.stroke();

      // sRGB gamut outline: the L*=50 slice matches the background, otherwise
      // the all-L* envelope keeps points of any lightness inside the view.
      const outline = showChroma ? slice : gamut;
      if (outline.length > 2) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(padL, padT, plotW, plotH);
        ctx.clip();
        ctx.beginPath();
        outline.forEach(([a, b], i) => {
          const x = xOf(a);
          const y = yOf(b);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.strokeStyle = showChroma ? 'rgba(255, 255, 255, 0.34)' : '#4d5b67';
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      hitRef.current = [];
      for (const p of fit.patches) {
        const ref = p.refLab;
        const measured = p.measuredLab;
        const x0 = xOf(ref[1]), y0 = yOf(ref[2]);
        const x1 = xOf(measured[1]), y1 = yOf(measured[2]);
        const used = p.used && (p.weight ?? 1) > 0;
        const alpha = used ? 1 : 0.35;

        // Dark under-stroke keeps the error arrows legible on saturated hues.
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#0b0f13';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = errorColor(p.dE00);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // Arrow head near the measured point.
        const angle = Math.atan2(y1 - y0, x1 - x0);
        if (Math.hypot(x1 - x0, y1 - y0) > 6) {
          const head = (size: number) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 - size * Math.cos(angle - 0.45), y1 - size * Math.sin(angle - 0.45));
            ctx.lineTo(x1 - size * Math.cos(angle + 0.45), y1 - size * Math.sin(angle + 0.45));
            ctx.closePath();
            ctx.fill();
          };
          ctx.fillStyle = '#0b0f13';
          head(5.5);
          ctx.fillStyle = errorColor(p.dE00);
          head(4);
        }

        ctx.beginPath();
        ctx.arc(x0, y0, 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#0b0f13';
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.strokeStyle = labColor(ref);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x1, y1, 4.4, 0, Math.PI * 2);
        ctx.fillStyle = '#0b0f13';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x1, y1, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = labColor(measured, p.clipped ? 0.45 : 1);
        ctx.fill();
        if (!used || p.clipped) {
          ctx.strokeStyle = p.clipped ? '#ff9a9a' : '#94a3b0';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 3;
        ctx.fillStyle = '#c7d1da';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(String(p.index + 1), x1 + 5, y1 - 5);
        ctx.restore();
        hitRef.current.push({ index: p.index, x: x1, y: y1 });
        hitRef.current.push({ index: p.index, x: x0, y: y0 });
        ctx.globalAlpha = 1;
      }

      if (hover !== null) {
        const p = fit.patches.find((item) => item.index === hover);
        if (p) {
          const x = xOf(p.measuredLab[1]);
          const y = yOf(p.measuredLab[2]);
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#0b0f13';
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#d8ecff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      ctx.fillStyle = '#94a3b0';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('a*', padL + plotW + 2, padT + plotH);
      ctx.fillText('b*', padL - 28, padT + plotH);
    };

    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    draw();
    return () => ro.disconnect();
  }, [bounds, chromaLimit, fit, gamut, hover, showChroma, slice]);

  const hovered = hover === null ? null : fit.patches.find((p) => p.index === hover) ?? null;

  return (
    <div ref={wrapRef} className="relative min-h-[150px] w-full flex-1">
      <canvas
        ref={canvasRef}
        className="h-full min-h-[150px] w-full rounded border border-ink-700"
        aria-label="ColorChecker a*b* 偏差图"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          let nearest: { index: number; d: number } | null = null;
          for (const hit of hitRef.current) {
            const d = Math.hypot(hit.x - x, hit.y - y);
            if (!nearest || d < nearest.d) nearest = { index: hit.index, d };
          }
          setHover(nearest && nearest.d < 12 ? nearest.index : null);
        }}
        onMouseLeave={() => setHover(null)}
      />
      <div className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%_-_108px)] rounded bg-black/55 px-2 py-1 text-[10px] leading-4 text-ink-300">
        {hovered ? (
          <>
            <div className="text-ink-100">{hovered.index + 1} · {hovered.name}</div>
            <div className="mono">ΔE00 {hovered.dE00.toFixed(2)} · ΔC' {hovered.dC.toFixed(2)} · ΔH' {(hovered.dH ?? 0).toFixed(2)}</div>
            <div className="mono">L {hovered.measuredLab[0].toFixed(1)} · a {hovered.measuredLab[1].toFixed(1)} · b {hovered.measuredLab[2].toFixed(1)}</div>
          </>
        ) : (
          <span>
            空心=目标 · 实心=拟合 · 虚线=sRGB 色域
            {showChroma ? '（L*50 切片）' : '（全 L* 包络）'}
          </span>
        )}
      </div>
      <div className="pointer-events-auto absolute right-2 top-2">
        <Button
          className="btn-xs"
          variant={showChroma ? 'primary' : 'ghost'}
          ariaPressed={showChroma}
          title="背景显示 a*b* 对应的 sRGB 颜色（固定 L*=50）；色域外按色相钳制到边界"
          onClick={() => setShowChroma((v) => !v)}
        >
          色度背景 {showChroma ? '开' : '关'}
        </Button>
      </div>
    </div>
  );
}
