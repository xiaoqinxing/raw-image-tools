import React from 'react';
import { Header } from './ui/Header';
import { LeftRail } from './ui/LeftRail';
import { CanvasStage } from './ui/CanvasStage';
import { PipelinePanel } from './ui/PipelinePanel';
import { AnalysisDock } from './ui/AnalysisDock';
import { CompareView } from './ui/CompareView';
import { ImportDialog } from './ui/ImportDialog';
import { ExportDialog } from './ui/ExportDialog';
import { RelinkDialog } from './ui/ProjectMenu';
import { useActiveDoc, useStore } from './state/store';
import { analyze, autosaveProject, fitView, loadPresets, renderActive, setStageBypassAndRender } from './services/editor';
import { paramsHash } from './core/pipeline/params';

function StatusBar() {
  const doc = useActiveDoc();
  const busy = useStore((s) => s.busy);
  const busyLabel = useStore((s) => s.busyLabel);
  const selectedStage = useStore((s) => s.selectedStage);
  const viewport = useStore((s) => s.viewport);
  return (
    <footer className="statusbar flex h-6 shrink-0 items-center gap-3 border-t border-ink-700 bg-ink-850 px-3 text-[10px] text-ink-500">
      <span>RAW Lab 0.1.0</span>
      {doc ? (
        <>
          <span className="mono">{doc.meta.geometry.active.w}×{doc.meta.geometry.active.h}</span>
          <span className="mono">{doc.meta.cfa.sites.map((x) => x.startsWith('G') ? 'G' : x).join('')}</span>
          <span className="mono">{doc.meta.geometry.bitDepth}-bit</span>
          <span className="badge">{doc.kind}</span>
          <span className="mono">{doc.source === 'full' ? 'FULL' : 'PREVIEW'}</span>
          <span className="mono">stage {doc.stage}</span>
          <span className="mono">domain {doc.domain}</span>
          {doc.stats ? <span className="mono">render {doc.stats.timings.totalMs.toFixed(0)}ms</span> : null}
          {doc.stats ? <span className="mono">cache {(doc.stats.cacheBytes / 1048576).toFixed(0)}MB</span> : null}
          <span className="mono">view {Math.round(doc.view.zoom * 100)}%</span>
          <span className="mono">{viewport.width}×{viewport.height}@{viewport.dpr.toFixed(1)}</span>
        </>
      ) : <span>就绪 · 导入 DNG 或裸 RAW</span>}
      <span className="ml-auto flex items-center gap-2">
        {busy ? <><span className="spin" /><span>{busyLabel}</span></> : null}
        <span className="mono">Chrome / WebGL2</span>
      </span>
    </footer>
  );
}

export default function App() {
  const doc = useActiveDoc();
  const selectedStage = useStore((s) => s.selectedStage);
  const analysisStage = useStore((s) => s.analysisStage);
  const compareMode = useStore((s) => s.compareMode);
  const toast = useStore((s) => s.toast);
  const order = useStore((s) => s.order);
  const docs = useStore((s) => s.docs);
  const projectName = useStore((s) => s.projectName);
  const showImport = useStore((s) => s.showImport);
  const showExport = useStore((s) => s.showExport);
  const setToast = useStore((s) => s.setToast);
  const busy = useStore((s) => s.busy);
  const [leftOpen, setLeftOpen] = React.useState(false);
  const [pipelineOpen, setPipelineOpen] = React.useState(false);

  React.useEffect(() => { loadPresets(); }, []);

  // Side panels become off-canvas drawers below the desktop breakpoint.
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 1199px)');
    const sync = () => {
      if (!mq.matches) {
        setLeftOpen(false);
        setPipelineOpen(false);
      }
    };
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  React.useEffect(() => {
    if (!showImport && !showExport) return;
    setLeftOpen(false);
    setPipelineOpen(false);
  }, [showImport, showExport]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setLeftOpen(false);
      setPipelineOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    if (!order.length) return;
    const t = window.setTimeout(() => autosaveProject(), 1500);
    return () => window.clearTimeout(t);
  }, [order, docs, projectName]);

  React.useEffect(() => {
    if (!doc || doc.status !== 'ready' || !doc.stats) return;
    const current = doc.analysis.histogram;
    if (current?.kind === 'histogram' && current.paramsHash === paramsHash(doc.params)) return;
    const id = doc.id;
    // Debounce re-renders during decode/resize. If the timer is cancelled by a
    // newer generation, the next effect run schedules it again.
    const t = window.setTimeout(() => {
      const latest = useStore.getState().docs[id];
      if (!latest || latest.status !== 'ready') return;
      void analyze('histogram', { bins: 1024 });
    }, 350);
    return () => window.clearTimeout(t);
  }, [doc?.id, doc?.generation, doc?.stats?.timings.totalMs, doc?.analysis.histogram]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === 'Escape') {
        useStore.getState().setShowImport(false);
        useStore.getState().setShowExport(false);
        setToast(null);
      }
      if (!doc) return;
      if (e.key === 'f' || e.key === 'F') fitView();
      if (e.key === 'b' || e.key === 'B') {
        const current = (doc.params[selectedStage] as { bypass?: boolean }).bypass ?? false;
        setStageBypassAndRender(selectedStage, !current);
      }
      if (e.key === 'p' || e.key === 'P') useStore.getState().setTool('probe');
      if (e.key === 'a' || e.key === 'A') {
        useStore.getState().setAbMode(useStore.getState().abMode === 'stage' ? 'off' : 'stage');
        window.setTimeout(renderActive, 0);
      }
      if (e.key === 'd' || e.key === 'D') {
        useStore.getState().setDiffMode(!useStore.getState().diffMode);
        window.setTimeout(renderActive, 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, selectedStage]);

  return (
    <div className="app-shell flex h-full w-full flex-col bg-ink-950 text-ink-100">
      <Header onOpenImages={() => setLeftOpen(true)} onOpenPipeline={() => setPipelineOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <aside className={`app-sidebar app-left ${leftOpen ? 'is-open' : ''}`} aria-label="图像、快照与预设">
          <LeftRail onClose={() => setLeftOpen(false)} />
        </aside>
        <main className="app-main flex min-w-0 flex-1 flex-col">
          {compareMode ? <CompareView /> : <CanvasStage />}
          <AnalysisDock />
        </main>
        <aside className={`app-sidebar app-right ${pipelineOpen ? 'is-open' : ''}`} aria-label="ISP 管线">
          <PipelinePanel onClose={() => setPipelineOpen(false)} />
        </aside>
      </div>
      <StatusBar />
      {leftOpen || pipelineOpen ? (
        <div className="drawer-backdrop" aria-hidden="true" onClick={() => { setLeftOpen(false); setPipelineOpen(false); }} />
      ) : null}
      <ImportDialog />
      <ExportDialog />
      <RelinkDialog />
      {toast ? (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      ) : null}
      {busy ? <div className="pointer-events-none fixed inset-0 z-40 bg-black/5" /> : null}
    </div>
  );
}
