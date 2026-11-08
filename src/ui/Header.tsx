import React from 'react';
import { useActiveDoc, useStore } from '../state/store';
import { attachFlat, exportActive } from '../services/editor';
import { Button } from './controls';
import { ProjectMenu } from './ProjectMenu';

export function Header({ onOpenImages, onOpenPipeline }: { onOpenImages: () => void; onOpenPipeline: () => void }) {
  const doc = useActiveDoc();
  const busy = useStore((s) => s.busy);
  const busyLabel = useStore((s) => s.busyLabel);
  const projectName = useStore((s) => s.projectName);
  const setShowImport = useStore((s) => s.setShowImport);
  const setShowExport = useStore((s) => s.setShowExport);
  const setProjectName = useStore((s) => s.setProjectName);
  const flatRef = React.useRef<HTMLInputElement>(null);
  return (
    <header className="app-header flex h-11 shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-850 px-3">
      <Button variant="ghost" className="header-drawer-btn" onClick={onOpenImages} title="图像、快照与预设">图像</Button>
      <div className="flex shrink-0 items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded bg-[#1d4a70] text-[12px] font-semibold text-[#d8ecff]">R</div>
        <div className="header-brand-text">
          <div className="text-[12px] font-semibold tracking-wide text-ink-100">RAW Lab</div>
          <div className="header-brand-subtitle text-[10px] text-ink-500">ISP WORKBENCH</div>
        </div>
      </div>
      <div className="header-divider mx-2 h-5 w-px bg-ink-700" />
      <button className="header-project max-w-[280px] truncate text-[12px] text-ink-200 hover:text-white" onClick={() => {
        const name = window.prompt('工程名称', projectName);
        if (name) setProjectName(name);
      }} title="点击重命名工程">{projectName}</button>
      <div className="header-actions ml-auto flex min-w-0 items-center gap-1">
        {busy ? <div className="mr-2 flex items-center gap-2 text-[11px] text-ink-300"><span className="spin" /><span className="header-busy-label">{busyLabel}</span></div> : null}
        <Button variant="primary" onClick={() => setShowImport(true)}>
          <span className="hidden sm:inline">导入图像</span>
          <span className="sm:hidden">导入</span>
        </Button>
        <Button className="header-flat" onClick={() => flatRef.current?.click()} disabled={!doc}>平场</Button>
        <input ref={flatRef} type="file" accept=".dng" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) attachFlat(f, true);
          e.currentTarget.value = '';
        }} />
        <Button onClick={() => setShowExport(true)} disabled={!doc}>导出</Button>
        <div className="header-divider mx-1 h-5 w-px bg-ink-700" />
        <ProjectMenu />
        <Button className="header-drawer-btn" onClick={onOpenPipeline} title="ISP 管线">管线</Button>
        {doc?.stats ? (
          <div className="header-stats ml-2 flex items-center gap-2 text-[11px] text-ink-400">
            <span className="badge">{doc.source === 'full' ? 'FULL' : 'PREVIEW'}</span>
            <span className="mono">{doc.stats.timings.totalMs.toFixed(0)} ms</span>
            <span className="mono">{(doc.stats.cacheBytes / 1048576).toFixed(0)} MB</span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
