import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useStore } from '../state/store';
import { openProjectFile, saveProject, relinkProjectImage, finishProjectRelink, restoreAutosave } from '../services/editor';
import { Button } from './controls';

export function ProjectMenu() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const projectName = useStore((s) => s.projectName);
  const setProjectName = useStore((s) => s.setProjectName);
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);
  return (
    <div className="relative" ref={rootRef}>
      <Button variant="ghost" onClick={() => setOpen(!open)}>工程</Button>
      {open ? (
        <div className="absolute right-0 top-8 z-30 w-[190px] rounded border border-ink-600 bg-[#151b21] p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <button className="block w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-ink-800" onClick={() => {
            setOpen(false);
            const name = window.prompt('工程名称', projectName);
            if (name) setProjectName(name);
          }}>重命名工程…</button>
          <button className="block w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-ink-800" onClick={() => { setOpen(false); saveProject(); }}>保存工程 JSON</button>
          <button className="block w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-ink-800" onClick={() => { setOpen(false); ref.current?.click(); }}>打开工程…</button>
          <button className="block w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-ink-800" onClick={() => { setOpen(false); restoreAutosave(); }}>恢复自动保存</button>
          <div className="px-2 py-1 text-[9px] leading-4 text-ink-500">工程不嵌入 RAW；重开时重新关联。</div>
          <input ref={ref} type="file" accept=".json,.rawlab.json" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openProjectFile(f);
            e.currentTarget.value = '';
            setOpen(false);
          }} />
        </div>
      ) : null}
    </div>
  );
}

export function RelinkDialog() {
  const project = useStore((s) => s.pendingProject);
  const [loaded, setLoaded] = React.useState<Record<string, boolean>>({});
  const [files, setFiles] = React.useState<Record<string, { raw?: File; flat?: File }>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  if (!project) return null;
  const allLoaded = project.images.every((i) => loaded[i.id]);

  const link = async (img: (typeof project.images)[number], raw: File, flat: File | null) => {
    setBusy(true);
    setError(null);
    try {
      await relinkProjectImage(img, raw, flat);
      setLoaded((s) => ({ ...s, [img.id]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(v) => { if (!v) useStore.getState().setPendingProject(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="modal modal-center w-[680px]" aria-describedby={undefined}>
        <div className="flex h-10 items-center justify-between border-b border-ink-700 px-4">
          <div>
            <Dialog.Title className="text-[13px] text-ink-100">重新关联 RAW 文件</Dialog.Title>
            <div className="text-[9px] text-ink-500">工程不包含 RAW 本体；按文件名/大小/SHA-256 校验。</div>
          </div>
          <Button variant="ghost" onClick={() => useStore.getState().setPendingProject(null)}>取消</Button>
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-auto p-4">
          {project.images.map((img) => (
            <div key={img.id} className="rounded border border-ink-700 bg-ink-850 p-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-ink-200">{img.fileName}</div>
                  <div className="mono text-[9px] text-ink-500">{img.decodedMeta.width}×{img.decodedMeta.height} · {img.kind.toUpperCase()} · {img.sha256.slice(0, 12)}…</div>
                </div>
                {loaded[img.id] ? <span className="badge badge-ok">已关联</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="btn btn-xs cursor-pointer">
                  选择 RAW
                  <input
                    data-relink-main={img.id}
                    type="file"
                    accept={img.kind === 'dng' ? '.dng' : '.raw,.bin,.dat'}
                    className="hidden"
                    disabled={busy}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setFiles((s) => ({ ...s, [img.id]: { ...s[img.id], raw: f } }));
                      if (!img.flat) await link(img, f, null);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                {img.flat ? (
                  <>
                    <label className="btn btn-xs cursor-pointer">
                      选择平场（可选）
                      <input
                        type="file"
                        accept=".dng,.raw,.bin"
                        className="hidden"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setFiles((s) => ({ ...s, [img.id]: { ...s[img.id], flat: f } }));
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                    <Button
                      className="btn-xs"
                      disabled={busy || !files[img.id]?.raw}
                      onClick={() => {
                        const sel = files[img.id];
                        if (sel?.raw) link(img, sel.raw, sel.flat ?? null);
                      }}
                    >
                      关联所选文件
                    </Button>
                  </>
                ) : null}
                {files[img.id]?.raw ? <span className="text-[9px] text-ink-500">RAW: {files[img.id]!.raw!.name}</span> : null}
                {files[img.id]?.flat ? <span className="text-[9px] text-ink-500">FLAT: {files[img.id]!.flat!.name}</span> : null}
              </div>
            </div>
          ))}
          {error ? <div className="rounded border border-[#5b2727] bg-[#2a1517] p-2 text-[11px] text-[#ff9a9a]">{error}</div> : null}
        </div>
        <div className="flex items-center justify-between border-t border-ink-700 px-4 py-3">
          <div className="text-[10px] text-ink-500">缺失文件可由用户重新选择；SHA 不匹配会提示。</div>
          <Button variant="primary" disabled={!allLoaded || busy} onClick={() => { finishProjectRelink(); setLoaded({}); setFiles({}); }}>完成恢复</Button>
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
