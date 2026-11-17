import React from 'react';
import type { Point, ToneCurveChannel } from '../core/types';
import { MAX_TONE_CURVE_POINTS, evaluateToneCurve, sanitizeToneCurvePoints } from '../core/color/tone-curve';

const CHANNEL_COLORS: Record<ToneCurveChannel, string> = {
  rgb: '#d8ecff',
  r: '#ff8a8a',
  g: '#7fe3ae',
  b: '#8ab4ff',
};

const CHANNEL_LABELS: Record<ToneCurveChannel, string> = {
  rgb: 'RGB',
  r: 'R',
  g: 'G',
  b: 'B',
};

function toSvg(x: number, y: number): [number, number] {
  return [x * 100, (1 - y) * 100];
}

function fromEvent(e: React.PointerEvent<SVGSVGElement>): Point {
  const rect = e.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / Math.max(1, rect.height))),
  };
}

export function ToneCurveEditor({
  points,
  channel,
  onChange,
  onChannelChange,
}: {
  points: Point[];
  channel: ToneCurveChannel;
  onChange: (points: Point[]) => void;
  onChannelChange: (channel: ToneCurveChannel) => void;
}) {
  const [drag, setDrag] = React.useState<number | null>(null);
  const safe = React.useMemo(() => sanitizeToneCurvePoints(points), [points]);
  const color = CHANNEL_COLORS[channel];

  const path = React.useMemo(() => {
    const samples = 160;
    let d = '';
    for (let i = 0; i <= samples; i++) {
      const x = i / samples;
      const [sx, sy] = toSvg(x, evaluateToneCurve(safe, x));
      d += `${i === 0 ? 'M' : 'L'}${sx.toFixed(2)} ${sy.toFixed(2)} `;
    }
    return d.trim();
  }, [safe]);

  const updatePoint = (index: number, next: Point) => {
    const out = safe.map((p) => ({ ...p }));
    const isFirst = index === 0;
    const isLast = index === out.length - 1;
    out[index] = {
      x: isFirst ? 0 : isLast ? 1 : Math.max(out[index - 1].x + 0.002, Math.min(out[index + 1].x - 0.002, next.x)),
      y: Math.max(0, Math.min(1, next.y)),
    };
    onChange(sanitizeToneCurvePoints(out));
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = fromEvent(e);
    const hit = safe.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.055);
    if (hit >= 0) {
      setDrag(hit);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (p.x <= 0.002 || p.x >= 0.998) {
      const endpoint = p.x < 0.5 ? 0 : safe.length - 1;
      setDrag(endpoint);
      updatePoint(endpoint, p);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (safe.length >= MAX_TONE_CURVE_POINTS) return;
    const next = sanitizeToneCurvePoints([...safe, p]);
    let index = 0;
    let best = Infinity;
    next.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best) {
        best = d;
        index = i;
      }
    });
    onChange(next);
    setDrag(index);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag === null) return;
    updatePoint(drag, fromEvent(e));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag !== null) {
      setDrag(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / Math.max(1, rect.height)));
    const hit = safe.findIndex((q) => Math.hypot(q.x - x, q.y - y) < 0.06);
    if (hit > 0 && hit < safe.length - 1) {
      onChange(safe.filter((_, i) => i !== hit));
    }
  };

  return (
    <div className="space-y-2" data-testid="tone-curve-controls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex overflow-hidden rounded border border-ink-600">
          {(['rgb', 'r', 'g', 'b'] as ToneCurveChannel[]).map((c) => (
            <button
              key={c}
              type="button"
              className={`px-2 py-1 text-[10px] ${channel === c ? 'bg-[#1d4a70] text-[#d8ecff]' : 'bg-ink-850 text-ink-300 hover:bg-ink-800'}`}
              onClick={() => onChannelChange(c)}
              aria-pressed={channel === c}
            >
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>
        <span className="mono text-[10px] text-ink-500">双击删点 · 端点调黑白</span>
      </div>
      <svg
        data-testid="tone-curve-editor"
        viewBox="0 0 100 100"
        className="mx-auto block aspect-square w-full max-w-[240px] touch-none rounded border border-ink-700 bg-ink-950"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        role="group"
        aria-label="色调曲线编辑器"
      >
        {[25, 50, 75].map((v) => (
          <g key={v} stroke="#2a3540" strokeWidth="0.4">
            <line x1={v} y1="0" x2={v} y2="100" />
            <line x1="0" y1={v} x2="100" y2={v} />
          </g>
        ))}
        <line x1="0" y1="100" x2="100" y2="0" stroke="#3c4a57" strokeWidth="0.5" strokeDasharray="2 2" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.4" />
        {safe.map((p, i) => {
          const [sx, sy] = toSvg(p.x, p.y);
          return (
            <circle
              key={i}
              data-testid={`tone-curve-point-${i}`}
              cx={sx}
              cy={sy}
              r={drag === i ? 2.4 : 1.9}
              fill={drag === i ? '#ffffff' : color}
              stroke="#0b1015"
              strokeWidth="0.6"
            />
          );
        })}
      </svg>
    </div>
  );
}
