import React from 'react';
import { useStore, useActiveDoc } from '../state/store';
import { getSession } from '../services/editor';
import {
  cssToImage,
  fitView,
  pickGray,
  imageToCss,
  panBy,
  presentActive,
  probeAt,
  renderActive,
  renderFull,
  setViewport,
  zoomAt,
} from '../services/editor';
import { applyHomography, buildColorCheckerGrid, homographyFromCorners } from '../core/colorchecker/geometry';
import type { Point, Rect } from '../core/types';
import { linearPreviewFor, STAGE_ORDER, STAGE_SHORT_LABELS } from '../core/pipeline/params';
import { Button } from './controls';
import { setProbeSample } from './probe-store';

const STAGE_OPTIONS = STAGE_ORDER.map((stage) => ({ value: stage, label: STAGE_SHORT_LABELS[stage] }));
const CC_CORNER_LABELS = ['左上 TL', '右上 TR', '右下 BR', '左下 BL'] as const;
const CC_CORNER_LABELS_SHORT = ['左上', '右上', '右下', '左下'] as const;

export function CanvasStage() {
  const doc = useActiveDoc();
  const activeId = useStore((s) => s.activeId);
  const viewport = useStore((s) => s.viewport);
  const tool = useStore((s) => s.tool);
  const selectedStage = useStore((s) => s.selectedStage);
  const falseColor = useStore((s) => s.falseColor);
  const abMode = useStore((s) => s.abMode);
  const diffMode = useStore((s) => s.diffMode);
  const flicker = useStore((s) => s.flicker);
  const split = useStore((s) => s.split);
  const showClipping = useStore((s) => s.showClipping);
  const analysisTab = useStore((s) => s.analysisTab);
  const analysisCollapsed = useStore((s) => s.analysisCollapsed);
  const setSelectedStage = useStore((s) => s.setSelectedStage);
  const setAnalysisStage = useStore((s) => s.setAnalysisStage);
  const setTool = useStore((s) => s.setTool);
  const setFalseColor = useStore((s) => s.setFalseColor);
  const setShowClipping = useStore((s) => s.setShowClipping);
  const setAbMode = useStore((s) => s.setAbMode);
  const setDiffMode = useStore((s) => s.setDiffMode);
  const setFlicker = useStore((s) => s.setFlicker);
  const setSplit = useStore((s) => s.setSplit);
  const setColorChecker = useStore((s) => s.setColorChecker);
  const setView = useStore((s) => s.setView);
  const setSource = useStore((s) => s.setSource);

  const hostRef = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<null | {
    mode: 'pan' | 'roi' | 'crop';
    start: Point;
    current: Point;
  }>(null);
  const [ccDraft, setCcDraft] = React.useState<Point[]>([]);
  const ccDraftRef = React.useRef<Point[]>([]);
  const panRef = React.useRef<{ x: number; y: number } | null>(null);
  const splitRef = React.useRef(false);
  const probeRef = React.useRef<{ inFlight: boolean; next: Point | null; raf: number; hover: boolean }>({
    inFlight: false,
    next: null,
    raf: 0,
    hover: false,
  });

  React.useEffect(() => { setCcDraft([]); ccDraftRef.current = []; }, [activeId]);
  React.useEffect(() => { if (tool !== 'colorchecker') { setCcDraft([]); ccDraftRef.current = []; } }, [tool]);
  React.useEffect(() => {
    probeRef.current.next = null;
    probeRef.current.hover = false;
    setProbeSample(null);
    return () => {
      if (probeRef.current.raf) window.cancelAnimationFrame(probeRef.current.raf);
      probeRef.current.raf = 0;
      probeRef.current.hover = false;
      probeRef.current.next = null;
      setProbeSample(null);
    };
  }, [activeId]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || !activeId) return;
    const session = getSession(activeId);
    if (!session) return;
    host.replaceChildren(session.canvas);
    session.canvas.style.width = '100%';
    session.canvas.style.height = '100%';
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      setViewport({ width: Math.max(2, r.width), height: Math.max(2, r.height), dpr: window.devicePixelRatio || 1 });
    });
    ro.observe(host);
    const r = host.getBoundingClientRect();
    setViewport({ width: Math.max(2, r.width), height: Math.max(2, r.height), dpr: window.devicePixelRatio || 1 });
    return () => ro.disconnect();
  }, [activeId]);

  React.useEffect(() => {
    if (flicker) {
      const t = window.setInterval(() => presentActive(), 200);
      return () => window.clearInterval(t);
    }
    return undefined;
  }, [flicker]);

  if (!doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="text-[32px] font-light tracking-wide text-ink-400">RAW Lab</div>
        <div className="max-w-[420px] text-[12px] leading-6 text-ink-400">
          导入 DNG 或裸 RAW 开始。固定 ISP 管线、阶段 A/B、ColorChecker 拟合与 ISP 分析都在本地浏览器完成。
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => useStore.getState().setShowImport(true)}>导入图像</Button>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 text-left text-[11px] text-ink-500 sm:grid-cols-3 sm:gap-6">
          <div><span className="text-ink-300">1.</span> 导入 RAW / 平场</div>
          <div><span className="text-ink-300">2.</span> 调参 / 看阶段</div>
          <div><span className="text-ink-300">3.</span> 分析 / 导出</div>
        </div>
      </div>
    );
  }

  const rectToCss = (r: Rect) => {
    const a = imageToCss(doc, viewport, r.x, r.y);
    const b = imageToCss(doc, viewport, r.x + r.w, r.y + r.h);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  };
  const roi = doc.roi;
  const roiCss = roi ? rectToCss(roi) : null;
  const ccPicking = tool === 'colorchecker';
  const ccCorners = ccDraft.length ? ccDraft : doc.colorChecker.corners;
  const ccCss = ccCorners?.map((p) => imageToCss(doc, viewport, p.x, p.y)) ?? null;
  const ccPickPoints = ccPicking
    ? (ccDraft.length ? ccDraft : doc.colorChecker.corners?.length === 4 ? doc.colorChecker.corners : [])
    : [];
  const ccPickCss = ccPickPoints.map((p) => imageToCss(doc, viewport, p.x, p.y));
  const ccHint = ccDraft.length
    ? `已选 ${ccDraft.length}/4 · 下一角：${CC_CORNER_LABELS[ccDraft.length] ?? ''}`
    : '点选 24 色块区域四角（TL/TR/BR/BL，不是卡片外框）';
  const ccHintMobile = ccDraft.length
    ? `已选 ${ccDraft.length}/4 · 下一角 ${CC_CORNER_LABELS_SHORT[ccDraft.length] ?? ''}`
    : '点 24 色块区域四角';
  let ccGrid: Array<[Point, Point]> = [];
  if (ccCorners && ccCorners.length === 4 && ccCss) {
    const h = homographyFromCorners(ccCorners as [Point, Point, Point, Point]);
    if (h) {
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        const a = applyHomography(h, u, 0), b = applyHomography(h, u, 1);
        ccGrid.push([imageToCss(doc, viewport, a.x, a.y), imageToCss(doc, viewport, b.x, b.y)]);
      }
      for (let j = 0; j <= 4; j++) {
        const v = j / 4;
        const a = applyHomography(h, 0, v), b = applyHomography(h, 1, v);
        ccGrid.push([imageToCss(doc, viewport, a.x, a.y), imageToCss(doc, viewport, b.x, b.y)]);
      }
    }
  }
  const showCcOverlay = analysisTab === 'colorchecker' && !analysisCollapsed && !!ccCorners && ccCorners.length === 4;
  const ccCells = showCcOverlay && ccCorners && ccCorners.length === 4
    ? buildColorCheckerGrid(ccCorners as [Point, Point, Point, Point], doc.colorCheckerSettings?.inset ?? 0.5)
    : null;
  const fitSamples = doc.colorChecker.fit?.samples ?? null;
  const crop = doc.params.output.crop;
  const cropCss = crop ? rectToCss(crop) : null;
  const linearDisplay = linearPreviewFor(doc.params, selectedStage);

  const pointer = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return cssToImage(doc, viewport, e.clientX - r.left, e.clientY - r.top);
  };

  const flushProbe = () => {
    const st = probeRef.current;
    st.raf = 0;
    if (st.inFlight || !st.next) return;
    const point = st.next;
    st.next = null;
    st.inFlight = true;
    const id = doc.id;
    probeAt(id, point)
      .then((s) => {
        st.inFlight = false;
        if (useStore.getState().activeId !== id) return;
        if (!probeRef.current.hover) return;
        if (probeRef.current.next) flushProbe();
        else setProbeSample(s);
      })
      .catch(() => {
        st.inFlight = false;
        if (probeRef.current.next) flushProbe();
      });
  };

  const queueProbe = (p: Point) => {
    const st = probeRef.current;
    const inside = p.x >= 0 && p.y >= 0 && p.x < doc.meta.geometry.active.w && p.y < doc.meta.geometry.active.h;
    st.hover = inside;
    if (!inside) {
      st.next = null;
      setProbeSample(null);
      return;
    }
    st.next = p;
    if (!st.inFlight && !st.raf) st.raf = window.requestAnimationFrame(flushProbe);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') queueProbe(pointer(e));
    if ((abMode !== 'off' || diffMode) && tool === 'pan') {
      const r = e.currentTarget.getBoundingClientRect();
      if (Math.abs(e.clientX - r.left - split * r.width) < 8) {
        splitRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (e.button === 1 || e.altKey) {
      panRef.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'pan') {
      panRef.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const p = pointer(e);
    if (tool === 'gray') {
      pickGray(p);
      setTool('pan');
      return;
    }
    if (tool === 'colorchecker') {
      const stored = useStore.getState().docs[doc.id]?.colorChecker.corners ?? null;
      let base = ccDraftRef.current;
      if (!base.length) base = stored && stored.length < 4 ? stored : [];
      const corners = [...base, p].slice(0, 4);
      ccDraftRef.current = corners;
      setCcDraft(corners);
      if (corners.length === 4) {
        setColorChecker(doc.id, {
          ...useStore.getState().docs[doc.id].colorChecker,
          corners: corners as [Point, Point, Point, Point],
          fit: undefined,
        });
        ccDraftRef.current = [];
        setCcDraft([]);
        setTool('pan');
        useStore.getState().setToast('四角已选，点击下方“拟合 CCM”');
      }
      return;
    }
    if (tool === 'roi' || tool === 'crop') {
      setDrag({ mode: tool, start: p, current: p });
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    queueProbe(pointer(e));
    if (splitRef.current) {
      const r = e.currentTarget.getBoundingClientRect();
      const next = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / Math.max(1, r.width)));
      setSplit(next);
      presentActive();
      return;
    }
    if (panRef.current) {
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      panRef.current = { x: e.clientX, y: e.clientY };
      panBy(dx, dy);
      return;
    }
    if (drag) setDrag({ ...drag, current: pointer(e) });
  };

  const finishDrag = () => {
    if (splitRef.current) {
      splitRef.current = false;
      return;
    }
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    if (!drag) return;
    const x0 = Math.min(drag.start.x, drag.current.x);
    const y0 = Math.min(drag.start.y, drag.current.y);
    const x1 = Math.max(drag.start.x, drag.current.x);
    const y1 = Math.max(drag.start.y, drag.current.y);
    const r: Rect = {
      x: Math.max(0, Math.round(x0)),
      y: Math.max(0, Math.round(y0)),
      w: Math.max(2, Math.round(x1 - x0)),
      h: Math.max(2, Math.round(y1 - y0)),
    };
    if (drag.mode === 'roi') {
      useStore.getState().setRoi(doc.id, r);
      setDrag(null);
      // Keep the marquee tool active so the ROI can be adjusted repeatedly.
      return;
    }
    if (drag.mode === 'crop') {
      useStore.getState().updateStage(doc.id, 'output', { crop: r });
      setDrag(null);
      renderActive();
      return;
    }
    setDrag(null);
  };

  const fit1to1 = () => {
    const fit = Math.min(viewport.width / doc.meta.geometry.active.w, viewport.height / doc.meta.geometry.active.h) * 0.96;
    setView(doc.id, { zoom: Math.max(0.1, 1 / fit), panX: doc.meta.geometry.active.w / 2, panY: doc.meta.geometry.active.h / 2 });
    presentActive();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="canvas-toolbar flex h-9 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-ink-700/70 bg-ink-900 px-2 scroll-thin">
        <Button variant="ghost" onClick={fitView} title="适配窗口 (F)">适配</Button>
        <Button variant="ghost" onClick={fit1to1} title="1:1">1:1</Button>
        <Button variant="ghost" onClick={() => zoomAt(viewport.width / 2, viewport.height / 2, 180)} title="缩小">−</Button>
        <Button variant="ghost" onClick={() => zoomAt(viewport.width / 2, viewport.height / 2, -180)} title="放大">+</Button>
        <div className="mx-1 h-4 w-px bg-ink-700" />
        <select
          className="select"
          value={selectedStage}
          onChange={(e) => {
            const stage = e.target.value as typeof selectedStage;
            setSelectedStage(stage);
            setAnalysisStage(stage);
            renderActive();
          }}
          title="查看阶段"
        >
          {STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Button
          variant={doc.source === 'full' ? 'primary' : 'ghost'}
          onClick={() => {
            if (doc.source === 'full') {
              setSource(doc.id, 'preview');
              renderActive();
            } else {
              renderFull();
            }
          }}
          title="全分辨率渲染（可能较慢）"
        >
          {doc.source === 'full' ? '全分辨率' : '预览'}
        </Button>
        <div className="mx-1 h-4 w-px bg-ink-700" />
        <Button variant={falseColor ? 'primary' : 'ghost'} onClick={() => { setFalseColor(!falseColor); presentActive(); }} title="CFA 伪彩">CFA</Button>
        <Button variant={showClipping ? 'primary' : 'ghost'} onClick={() => { setShowClipping(!showClipping); window.setTimeout(presentActive, 0); }} title="剪切提示">剪切</Button>
        <div className="mx-1 h-4 w-px bg-ink-700" />
        <Button
          variant={abMode === 'stage' ? 'primary' : 'ghost'}
          onClick={() => {
            setAbMode(abMode === 'stage' ? 'off' : 'stage');
            window.setTimeout(renderActive, 0);
          }}
          title="当前 vs 当前阶段 bypass"
        >
          A/B
        </Button>
        <Button
          variant={diffMode ? 'primary' : 'ghost'}
          onClick={() => { setDiffMode(!diffMode); window.setTimeout(renderActive, 0); }}
          title="差异图"
        >
          差异
        </Button>
        <Button
          variant={flicker ? 'primary' : 'ghost'}
          onClick={() => setFlicker(!flicker)}
          title="闪烁对比"
        >
          闪烁
        </Button>
        <div className="mx-1 h-4 w-px bg-ink-700" />
        <Button variant={tool === 'crop' ? 'primary' : 'ghost'} onClick={() => setTool(tool === 'crop' ? 'pan' : 'crop')}>裁剪</Button>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-ink-400">
          <span className="mono">{Math.round(doc.view.zoom * 100)}%</span>
          <span className="badge">{doc.stage}</span>
          {linearDisplay ? <span className="badge badge-warn" title="Gamma 已 bypass：按线性值直接显示">LINEAR</span> : null}
          {doc.stats ? <span className="mono">{doc.stats.timings.totalMs.toFixed(0)}ms</span> : null}
          {doc.source === 'full' ? <span className="badge badge-warn">FULL</span> : null}
        </div>
      </div>

      <div
        className={`canvas-host checker relative min-h-0 flex-1 overflow-hidden${ccPicking ? ' is-cc-picking' : ''}`}
        onWheel={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onPointerLeave={(e) => {
          if (e.pointerType === 'touch') return;
          probeRef.current.hover = false;
          probeRef.current.next = null;
          setProbeSample(null);
        }}
        onDoubleClick={fitView}
      >
        <div ref={hostRef} className="absolute inset-0" />
        <svg className="overlay-svg">
          {showCcOverlay && ccCss ? (
            <g>
              <polygon points={ccCss.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ffb85c" strokeWidth={1.5} />
              {ccGrid.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffb85c" strokeOpacity={0.45} strokeWidth={0.7} />)}
              {!ccPicking ? ccCss.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} fill="#ffb85c" stroke="#101418" strokeWidth={1.5} />) : null}
              {ccCells?.map((cell) => {
                const sample = fitSamples?.[cell.index];
                const weight = sample?.weight ?? doc.colorCheckerSettings?.weights?.[cell.index] ?? 1;
                const valid = sample?.valid ?? true;
                const used = valid && weight > 0;
                const points = cell.sampleQuad
                  .map((p) => imageToCss(doc, viewport, p.x, p.y))
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ');
                const center = imageToCss(doc, viewport, cell.center.x, cell.center.y);
                const stroke = !valid ? '#ff9a9a' : used ? '#5fd99a' : '#94a3b0';
                const fill = !valid ? 'rgba(255,154,154,0.10)' : used ? 'rgba(95,217,154,0.10)' : 'rgba(148,163,176,0.06)';
                const reason = sample?.reason;
                return (
                  <g key={cell.index}>
                    <polygon
                      data-testid={`cc-sample-${cell.index}`}
                      points={points}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={1}
                      strokeDasharray={used ? undefined : '3 2'}
                    />
                    <text x={center.x} y={center.y - 1} textAnchor="middle" fill="#e7edf3" fontSize={9} fontFamily="monospace">
                      {cell.index + 1}
                    </text>
                    {weight !== 1 ? (
                      <text x={center.x} y={center.y + 9} textAnchor="middle" fill={used ? '#a8d2ff' : '#ffca7a'} fontSize={8} fontFamily="monospace">
                        {weight <= 0 ? '0' : `×${weight.toFixed(1)}`}
                      </text>
                    ) : null}
                    {!valid && reason ? (
                      <text x={center.x} y={center.y + 9} textAnchor="middle" fill="#ff9a9a" fontSize={8} fontFamily="monospace">
                        {reason === 'clipped' ? 'C' : reason === 'dark' ? 'D' : '!'}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          ) : null}
          {roiCss ? (
            <g>
              <rect x={roiCss.x} y={roiCss.y} width={roiCss.w} height={roiCss.h} fill="none" stroke="#5cb0ff" strokeWidth={1.2} strokeDasharray="4 3" />
              <text x={roiCss.x + 4} y={roiCss.y - 4} fill="#a8d2ff" fontSize={10} fontFamily="monospace">ROI {roi ? `${Math.round(roi.w)}×${Math.round(roi.h)}` : ''}</text>
            </g>
          ) : null}
          {drag && drag.mode !== 'pan' ? (() => {
            const a = imageToCss(doc, viewport, drag.start.x, drag.start.y);
            const b = imageToCss(doc, viewport, drag.current.x, drag.current.y);
            return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={drag.mode === 'crop' ? 'rgba(92,176,255,0.08)' : 'rgba(92,176,255,0.12)'} stroke="#5cb0ff" strokeWidth={1.2} />;
          })() : null}
          {cropCss ? (
            <rect x={cropCss.x} y={cropCss.y} width={cropCss.w} height={cropCss.h} fill="none" stroke="#5fd99a" strokeWidth={1.2} />
          ) : null}
          {ccPickCss.length ? (
            <g data-testid="cc-corner-picking">
              {ccPickCss.length > 1 ? (
                <polyline
                  points={ccPickCss.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#ffb85c"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  strokeOpacity={0.85}
                />
              ) : null}
              {ccPickCss.map((p, i) => {
                const latest = i === ccPickCss.length - 1;
                const labelX = Math.min(p.x + 17, viewport.width - 72);
                return (
                  <g key={i} data-testid={`cc-corner-${i + 1}`}>
                    {latest ? (
                      <circle className="cc-corner-pulse" cx={p.x} cy={p.y} r={13} fill="none" stroke="#ffb85c" strokeWidth={1.5} />
                    ) : null}
                    <g stroke="#ffb85c" strokeWidth={2} strokeLinecap="round">
                      <line x1={p.x - 17} y1={p.y} x2={p.x - 9} y2={p.y} />
                      <line x1={p.x + 9} y1={p.y} x2={p.x + 17} y2={p.y} />
                      <line x1={p.x} y1={p.y - 17} x2={p.x} y2={p.y - 9} />
                      <line x1={p.x} y1={p.y + 9} x2={p.x} y2={p.y + 17} />
                    </g>
                    <circle cx={p.x} cy={p.y} r={8.5} fill="rgba(16,20,24,0.82)" stroke="#ffb85c" strokeWidth={2} />
                    <text x={p.x} y={p.y + 3.5} textAnchor="middle" fill="#ffe1b8" fontSize={11} fontWeight={700} fontFamily="monospace">{i + 1}</text>
                    <text
                      x={labelX}
                      y={p.y + 4}
                      fill="#ffe1b8"
                      fontSize={10}
                      fontFamily="monospace"
                      stroke="#101418"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {CC_CORNER_LABELS[i] ?? ''}
                    </text>
                  </g>
                );
              })}
            </g>
          ) : null}
          {abMode !== 'off' || diffMode ? (
            <g>
              <line x1={split * viewport.width} y1={0} x2={split * viewport.width} y2={viewport.height} stroke="#ffffff" strokeOpacity={0.5} strokeWidth={1} />
              <rect x={split * viewport.width - 10} y={0} width={20} height={18} rx={3} fill="#252d35" stroke="#5a6a78" />
              <text x={split * viewport.width} y={12} textAnchor="middle" fill="#d5dde5" fontSize={10} fontFamily="monospace">↔</text>
            </g>
          ) : null}
        </svg>
        <div className="canvas-hint pointer-events-none absolute bottom-2 left-2 rounded bg-black/45 px-2 py-1 text-[11px] text-ink-300">
          <span className="hidden sm:inline">{tool === 'pan' ? '拖拽平移 · 滚轮缩放 · 双击适配' : tool === 'roi' ? '拖拽框选分析 ROI · Esc 结束 · Alt+拖拽平移' : tool === 'gray' ? '点击灰点（平场校正后 RAW）' : tool === 'colorchecker' ? ccHint : '拖拽设置输出裁剪'}</span>
          <span className="sm:hidden">{tool === 'pan' ? '拖拽平移 · 双击适配' : tool === 'roi' ? '拖拽框选 ROI · 可连续调整' : tool === 'gray' ? '点击灰点' : tool === 'colorchecker' ? ccHintMobile : '拖拽裁剪'}</span>
        </div>
        <div className="pointer-events-none absolute left-2 top-2 max-w-[70%] truncate rounded bg-black/50 px-2 py-1 text-[11px] text-ink-300 sm:hidden">
          {doc.fileName} · {doc.meta.geometry.active.w}×{doc.meta.geometry.active.h}
        </div>
        {showClipping ? (
          <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-2 py-1 text-[11px] text-[#ff9a9a]">
            剪切：高光 ≥ 1.0 · 阴影 ≤ 0
          </div>
        ) : null}
        {doc.status === 'error' ? <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[12px] text-[#ff9a9a]">{doc.error}</div> : null}
      </div>
    </div>
  );
}
