import React from 'react';
import { useStore } from '../state/store';
import { comparePaneIds, getSession, renderCompare } from '../services/editor';
import { paramsHash, STAGE_ORDER, STAGE_SHORT_LABELS } from '../core/pipeline/params';
import { Button } from './controls';

const STAGE_OPTIONS = STAGE_ORDER.map((stage) => ({ value: stage, label: STAGE_SHORT_LABELS[stage] }));

export function CompareView() {
  const activeId = useStore((s) => s.activeId);
  const compareId = useStore((s) => s.compareId);
  const compareLayout = useStore((s) => s.compareLayout);
  const docs = useStore((s) => s.docs);
  const selectedStage = useStore((s) => s.selectedStage);
  const setSelectedStage = useStore((s) => s.setSelectedStage);
  const setAnalysisStage = useStore((s) => s.setAnalysisStage);
  const setCompareMode = useStore((s) => s.setCompareMode);
  const setCompareId = useStore((s) => s.setCompareId);
  const setCompareLayout = useStore((s) => s.setCompareLayout);
  const setActive = useStore((s) => s.setActive);

  const paneIds = comparePaneIds(useStore.getState());
  const paneKey = paneIds.join(',');
  const active = activeId ? docs[activeId] : null;

  const renderKey = paneIds
    .map((id) => `${id}:${docs[id] ? paramsHash(docs[id].params) : ''}`)
    .join('|');

  const hosts = React.useRef(new Map<string, HTMLDivElement>());
  const drag = React.useRef<{ x: number; y: number } | null>(null);
  const [sizes, setSizes] = React.useState<Record<string, { w: number; h: number }>>({});

  const setHost = (id: string) => (el: HTMLDivElement | null) => {
    if (el) hosts.current.set(id, el);
    else hosts.current.delete(id);
  };

  React.useEffect(() => {
    for (const id of paneIds) {
      const host = hosts.current.get(id);
      const session = getSession(id);
      if (!host || !session) continue;
      if (session.canvas.parentElement !== host) host.replaceChildren(session.canvas);
      session.canvas.style.width = '100%';
      session.canvas.style.height = '100%';
    }
  }, [paneKey]);

  React.useEffect(() => {
    const observers: ResizeObserver[] = [];
    for (const id of paneIds) {
      const host = hosts.current.get(id);
      if (!host) continue;
      const update = () => {
        const r = host.getBoundingClientRect();
        setSizes((prev) => {
          const cur = prev[id];
          if (cur && Math.abs(cur.w - r.width) < 0.5 && Math.abs(cur.h - r.height) < 0.5) return prev;
          return { ...prev, [id]: { w: Math.max(2, r.width), h: Math.max(2, r.height) } };
        });
      };
      const ro = new ResizeObserver(update);
      ro.observe(host);
      update();
      observers.push(ro);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, [paneKey]);

  const viewportsNow = React.useCallback(() => {
    const dpr = window.devicePixelRatio || 1;
    const out: Record<string, { width: number; height: number; dpr: number }> = {};
    for (const id of paneIds) {
      const s = sizes[id];
      if (s) out[id] = { width: s.w, height: s.h, dpr };
    }
    return out;
  }, [paneKey, sizes]);

  React.useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => renderCompare(viewportsNow()), 30);
    return () => window.clearTimeout(t);
  }, [renderKey, paneKey, selectedStage, activeId, compareLayout, sizes]);

  if (!active || !compareId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[12px] text-ink-400">
        <div>对比需要至少两张图像</div>
        <Button onClick={() => setCompareMode(false)}>返回单图</Button>
      </div>
    );
  }

  const layoutClass = compareLayout === 'two-h'
    ? 'grid-cols-2 grid-rows-1'
    : compareLayout === 'two-v'
      ? 'grid-cols-1 grid-rows-2'
      : 'grid-cols-2 grid-rows-2';
  const slots = compareLayout === 'quad' ? 4 : 2;

  const activate = (id: string) => {
    if (!activeId || id === activeId) return;
    const prev = activeId;
    if (id === compareId) setCompareId(prev);
    setActive(id);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!active) return;
    const zoom = Math.max(0.1, Math.min(32, active.view.zoom * Math.exp(-e.deltaY * 0.0015)));
    useStore.getState().setView(active.id, { zoom });
    window.setTimeout(() => renderCompare(viewportsNow()), 0);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !active) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    const vp = sizes[active.id];
    if (!vp) return;
    const fit = Math.min(vp.w / active.meta.geometry.active.w, vp.h / active.meta.geometry.active.h) * 0.96;
    const scale = fit * active.view.zoom;
    useStore.getState().setView(active.id, {
      panX: active.view.panX - dx / scale,
      panY: active.view.panY - dy / scale,
    });
    renderCompare(viewportsNow());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-ink-700/70 bg-ink-900 px-2 scroll-thin">
        <span className="text-[11px] text-ink-300">对比</span>
        <span className="badge">同步视图</span>
        <div className="flex overflow-hidden rounded border border-ink-600">
          {([['two-h', '2H'], ['two-v', '2V'], ['quad', '4']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`px-2 py-1 text-[11px] ${compareLayout === value ? 'bg-[#1d4a70] text-[#d8ecff]' : 'bg-ink-850 text-ink-300 hover:bg-ink-800'}`}
              onClick={() => setCompareLayout(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="select"
          value={selectedStage}
          onChange={(e) => {
            setSelectedStage(e.target.value as typeof selectedStage);
            setAnalysisStage(e.target.value as typeof selectedStage);
          }}
        >
          {STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="compare-hint text-[11px] text-ink-500">{paneIds.length} / {slots} 图 · 滚轮缩放 · 拖拽平移 · 点击标题切换编辑对象</span>
        <div className="ml-auto flex gap-1">
          <Button className="btn-xs" onClick={() => { setActive(compareId); setCompareId(activeId); }}>交换 A/B</Button>
          <Button className="btn-xs" onClick={() => setCompareMode(false)}>退出对比</Button>
        </div>
      </div>
      <div
        className={`compare-grid grid min-h-0 flex-1 gap-px bg-ink-700 ${layoutClass}`}
        data-layout={compareLayout}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        {paneIds.map((id, idx) => {
          const d = docs[id];
          if (!d) return null;
          return (
            <div key={id} className="relative flex min-h-0 flex-col bg-ink-950">
              <div className={`flex h-6 items-center gap-2 border-b border-ink-700/60 px-2 text-[11px] ${id === activeId ? 'bg-[#1d2a34]' : ''}`}>
                <span className={`badge ${id === activeId ? 'badge-ok' : ''}`}>{String.fromCharCode(65 + idx)}</span>
                <button className="min-w-0 truncate text-left text-ink-300 hover:text-white" onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => activate(id)}
                  title="切换为编辑对象">
                  {d.fileName}
                </button>
                <span className="ml-auto mono shrink-0 text-ink-500">{d.stage} · {d.source}</span>
              </div>
              <div ref={setHost(id)} className="canvas-host checker min-h-0 flex-1 overflow-hidden" />
              <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-[10px] text-ink-300">
                {d.params.demosaic.algorithm.toUpperCase()} · {d.params.denoise.bypass ? 'DN off' : 'DN on'} · {d.params.ccm.source}
              </div>
            </div>
          );
        })}
        {Array.from({ length: Math.max(0, slots - paneIds.length) }).map((_, i) => (
          <div key={`empty-${i}`} className="flex min-h-0 items-center justify-center bg-ink-950 text-[11px] text-ink-500">
            空位 · 在左侧选择图像以加入对比
          </div>
        ))}
      </div>
    </div>
  );
}
