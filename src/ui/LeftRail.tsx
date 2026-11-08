import React from 'react';
import { useActiveDoc, useStore } from '../state/store';
import { addSnapshot, applyPreset, applySnapshot, removeDoc, renderActive, savePreset, setViewport } from '../services/editor';
import { Button } from './controls';

export function LeftRail({ onClose }: { onClose?: () => void }) {
  const docs = useStore((s) => s.docs);
  const order = useStore((s) => s.order);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const setShowImport = useStore((s) => s.setShowImport);
  const presets = useStore((s) => s.presets);
  const selectedPresetId = useStore((s) => s.selectedPresetId);
  const setSelectedPresetId = useStore((s) => s.setSelectedPresetId);
  const abSnapshotId = useStore((s) => s.abSnapshotId);
  const setAbSnapshotId = useStore((s) => s.setAbSnapshotId);
  const setAbMode = useStore((s) => s.setAbMode);
  const compareMode = useStore((s) => s.compareMode);
  const compareId = useStore((s) => s.compareId);
  const setCompareMode = useStore((s) => s.setCompareMode);
  const setCompareId = useStore((s) => s.setCompareId);
  const doc = useActiveDoc();

  return (
    <aside className="flex h-full w-full min-h-0 shrink-0 flex-col border-r border-ink-700 bg-ink-850">
      <div className="flex h-9 items-center justify-between border-b border-ink-700/70 px-3">
        <span className="text-[11px] font-medium text-ink-200">图像</span>
        <div className="flex items-center gap-1">
          <Button className="btn-xs" onClick={() => setShowImport(true)}>+</Button>
          {onClose ? <button className="drawer-close" onClick={onClose} aria-label="关闭图像面板">✕</button> : null}
        </div>
      </div>
      <div className="max-h-[220px] overflow-auto scroll-thin">
        {order.map((id) => {
          const d = docs[id];
          if (!d) return null;
          return (
            <div key={id} className={`group border-b border-ink-700/50 px-3 py-2 ${activeId === id ? 'bg-[#1d2a34]' : 'hover:bg-[#1c242b]'}`}>
              <button className="w-full text-left" onClick={() => {
                  if (compareMode && id === compareId && activeId) setCompareId(activeId);
                  setActive(id);
                  renderActive();
                  onClose?.();
                }}>
                <div className="truncate text-[11px] text-ink-200">{d.fileName}</div>
                <div className="mono mt-0.5 flex items-center gap-2 text-[10px] text-ink-500">
                  <span>{d.meta.geometry.active.w}×{d.meta.geometry.active.h}</span>
                  <span className="badge h-[15px] px-1 text-[9px]">{d.kind}</span>
                  {d.flat ? <span className="text-[#7fe3ae]">FLAT</span> : null}
                </div>
              </button>
              <div className="mt-1 flex items-center gap-1">
                {id !== activeId ? (
                  <button className={`text-[10px] ${compareId === id ? 'text-[#a8d2ff]' : 'text-ink-500'} hover:text-white`} onClick={() => { setCompareId(id); setCompareMode(true); onClose?.(); }}>对比</button>
                ) : <span className="text-[10px] text-ink-500">A</span>}
                <button className="ml-auto text-[10px] text-ink-500 hover:text-white" onClick={() => removeDoc(id)}>移除</button>
                <button className="text-[10px] text-ink-500 hover:text-white" onClick={() => { setActive(id); window.setTimeout(() => useStore.getState().setShowExport(true), 0); }}>导出</button>
              </div>
            </div>
          );
        })}
        {!order.length ? <div className="p-3 text-[11px] text-ink-500">还没有图像</div> : null}
      </div>

      {compareMode ? <div className="flex h-7 items-center justify-between border-b border-ink-700/70 px-3 text-[11px] text-[#a8d2ff]"><span>对比模式</span><button onClick={() => setCompareMode(false)} className="hover:text-white">退出</button></div> : null}
      <div className="flex h-8 items-center justify-between border-b border-t border-ink-700/70 px-3">
        <span className="text-[11px] font-medium text-ink-200">快照</span>
        <Button className="btn-xs" onClick={addSnapshot} disabled={!doc}>+</Button>
      </div>
      <div className="max-h-[150px] overflow-auto scroll-thin">
        {doc?.snapshots.length ? doc.snapshots.map((s) => (
          <div key={s.id} className={`flex items-center gap-1 px-3 py-1.5 text-[11px] ${abSnapshotId === s.id ? 'bg-[#1e2b36]' : ''}`}>
            <button className="flex-1 truncate text-left text-ink-300 hover:text-white" onClick={() => applySnapshot(s.id)}>{s.name}</button>
            <button
              className={`badge ${abSnapshotId === s.id ? 'badge-ok' : ''}`}
              onClick={() => { setAbSnapshotId(abSnapshotId === s.id ? null : s.id); setAbMode(abSnapshotId === s.id ? 'off' : 'snapshot'); window.setTimeout(renderActive, 0); }}
              title="作为 A/B 参考"
            >
              AB
            </button>
          </div>
        )) : <div className="p-3 text-[11px] text-ink-500">保存同一 RAW 的多组参数，用于 A/B。</div>}
      </div>

      <div className="flex h-8 items-center justify-between border-b border-t border-ink-700/70 px-3">
        <span className="text-[11px] font-medium text-ink-200">预设</span>
        <Button className="btn-xs" onClick={savePreset} disabled={!doc}>+</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scroll-thin">
        {presets.length ? presets.map((p) => (
          <div key={p.id} className={`flex items-center gap-1 px-3 py-1.5 text-[11px] ${selectedPresetId === p.id ? 'bg-[#1e2b36]' : ''}`}>
            <button className="flex-1 truncate text-left text-ink-300 hover:text-white" onClick={() => { setSelectedPresetId(p.id); applyPreset(p.id); }}>{p.name}</button>
          </div>
        )) : <div className="p-3 text-[11px] text-ink-500">预设只保存管线参数，不保存 RAW。</div>}
      </div>

      <div className="border-t border-ink-700/70 p-3">
        <div className="text-[10px] leading-4 text-ink-500">
          纯浏览器 · LibRaw WASM · WebGL2 · 无后端<br />
          当前版本 0.1.0 · Apache-2.0 · LibRaw LGPL/CDDL
        </div>
      </div>
    </aside>
  );
}
