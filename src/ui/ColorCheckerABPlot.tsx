import React from 'react';
import type { ColorCheckerResult } from '../core/types';
import { labToLinearSrgb, srgbEncode } from '../core/color/lab';
import { srgbABEnvelope } from '../core/color/gamut';

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
 */
export function ColorCheckerABPlot({ fit }: { fit: ColorCheckerResult }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const hitRef = React.useRef<Array<{ index: number; x: number; y: number }>>([]);

  const gamut = React.useMemo(() => srgbABEnvelope(180, 14), []);

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
      ctx.fillStyle = '#0e1318';
      ctx.fillRect(padL, padT, plotW, plotH);

      ctx.strokeStyle = '#2e3942';
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
      ctx.strokeStyle = '#4c5a66';
      ctx.beginPath(); ctx.moveTo(xOf(0), padT); ctx.lineTo(xOf(0), padT + plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padL, yOf(0)); ctx.lineTo(padL + plotW, yOf(0)); ctx.stroke();

      // sRGB max-chroma envelope; clip it when the view is zoomed to the data.
      if (gamut.length > 2) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(padL, padT, plotW, plotH);
        ctx.clip();
        ctx.beginPath();
        gamut.forEach(([a, b], i) => {
          const x = xOf(a);
          const y = yOf(b);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.strokeStyle = '#4d5b67';
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

        ctx.strokeStyle = errorColor(p.dE00);
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // Arrow head near the measured point.
        const angle = Math.atan2(y1 - y0, x1 - x0);
        const arrow = 4;
        if (Math.hypot(x1 - x0, y1 - y0) > 6) {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - arrow * Math.cos(angle - 0.45), y1 - arrow * Math.sin(angle - 0.45));
          ctx.lineTo(x1 - arrow * Math.cos(angle + 0.45), y1 - arrow * Math.sin(angle + 0.45));
          ctx.closePath();
          ctx.fillStyle = errorColor(p.dE00);
          ctx.fill();
        }

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x0, y0, 4, 0, Math.PI * 2);
        ctx.strokeStyle = labColor(ref);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x1, y1, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = labColor(measured, p.clipped ? 0.45 : 1);
        ctx.fill();
        if (!used || p.clipped) {
          ctx.strokeStyle = p.clipped ? '#ff9a9a' : '#94a3b0';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.fillStyle = '#c7d1da';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(String(p.index + 1), x1 + 5, y1 - 5);
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
          ctx.strokeStyle = '#d8ecff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      ctx.fillStyle = '#94a3b0';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('a*', padL + plotW + 2, padT + 10);
      ctx.fillText('b*', padL - 28, padT + 10);
    };
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    draw();
    return () => ro.disconnect();
  }, [fit, bounds, gamut, hover]);

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
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-2 py-1 text-[10px] leading-4 text-ink-300">
        {hovered ? (
          <>
            <div className="text-ink-100">{hovered.index + 1} · {hovered.name}</div>
            <div className="mono">ΔE00 {hovered.dE00.toFixed(2)} · ΔC' {hovered.dC.toFixed(2)} · ΔH' {(hovered.dH ?? 0).toFixed(2)}</div>
            <div className="mono">L {hovered.measuredLab[0].toFixed(1)} · a {hovered.measuredLab[1].toFixed(1)} · b {hovered.measuredLab[2].toFixed(1)}</div>
          </>
        ) : (
          <span>空心=目标 · 实心=拟合 · 虚线=sRGB 最大彩度（超出视图时截断）</span>
        )}
      </div>
    </div>
  );
}
