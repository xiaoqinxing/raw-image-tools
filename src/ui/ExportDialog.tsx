import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useActiveDoc, useStore } from '../state/store';
import { exportActive } from '../services/editor';
import { Button } from './controls';
import { STAGE_LABELS, STAGE_ORDER } from '../core/pipeline/params';

export function ExportDialog() {
  const open = useStore((s) => s.showExport);
  const setOpen = useStore((s) => s.setShowExport);
  const doc = useActiveDoc();
  const selectedStage = useStore((s) => s.selectedStage);
  const setSelectedStage = useStore((s) => s.setSelectedStage);
  const [bitDepth, setBitDepth] = React.useState<8 | 16>(8);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open && doc) setBitDepth(doc.params.output.bitDepth);
  }, [open, doc?.id]);
  if (!open || !doc) return null;
  const crop = doc.params.output.crop;
  const w = crop?.w ?? doc.meta.geometry.active.w;
  const h = crop?.h ?? doc.meta.geometry.active.h;
  const willScale = w * h > 48_000_000;
  return (
    <Dialog.Root open onOpenChange={(v) => { if (!v) setOpen(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="modal modal-center w-[520px]" aria-describedby={undefined}>
        <div className="flex h-10 items-center justify-between border-b border-ink-700 px-4">
          <Dialog.Title className="text-[13px] text-ink-100">导出 PNG</Dialog.Title>
          <button className="text-ink-400 hover:text-white" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded bg-ink-850 p-2"><div className="text-ink-500">尺寸</div><div className="mono">{w}×{h}</div></div>
            <div className="rounded bg-ink-850 p-2"><div className="text-ink-500">色彩</div><div className="mono">sRGB / display</div></div>
            <div className="rounded bg-ink-850 p-2"><div className="text-ink-500">裁剪</div><div className="mono">{crop ? `${crop.x},${crop.y}` : '无'}</div></div>
            <div className="rounded bg-ink-850 p-2"><div className="text-ink-500">当前阶段</div><div className="mono">{selectedStage}{doc.stage !== selectedStage ? ` → ${doc.stage}` : ''}</div></div>
          </div>
          <div>
            <div className="field-label mb-1">导出阶段</div>
            <select
              className="select w-full"
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value as typeof selectedStage)}
            >
              {STAGE_ORDER.map((stage) => (
                <option key={stage} value={stage}>{STAGE_LABELS[stage]}{stage === 'sharpen' ? ' / 最终' : ''}</option>
              ))}
            </select>
            <div className="mt-1 text-[10px] text-ink-500">可导出任意中间阶段；RAW 阶段以 CFA 灰度显示。</div>
          </div>
          <div>
            <div className="field-label mb-1">位深</div>
            <div className="flex flex-wrap gap-2">
              <Button variant={bitDepth === 8 ? 'primary' : 'default'} onClick={() => setBitDepth(8)}>8-bit sRGB（默认）</Button>
              <Button variant={bitDepth === 16 ? 'primary' : 'default'} onClick={() => setBitDepth(16)}>16-bit PNG</Button>
            </div>
            <div className="mt-2 text-[10px] leading-4 text-ink-500">16-bit 使用当前 display-sRGB 值量化到 0..65535；不写 ICC，仅写 sRGB 相关信息。全分辨率导出会按需渲染。</div>
            {willScale ? (
              <div className="mt-2 rounded border border-[#5a441f] bg-[#2b2113] p-2 text-[10px] leading-4 text-[#f3bf6d]">
                当前裁剪约 {(w * h / 1e6).toFixed(1)}MP，超过 48MP 原生上限；导出会使用约 12MP 的全分辨率纹理并放大/降采样，原生 100MP 分块导出尚未实现。
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={async () => {
              setBusy(true);
              await exportActive(bitDepth);
              setBusy(false);
              setOpen(false);
            }}>{busy ? '导出中…' : '导出'}</Button>
          </div>
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
