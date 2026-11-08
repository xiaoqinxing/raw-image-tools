import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useStore } from '../state/store';
import { importBare, importDng } from '../services/editor';
import type { BareRawConfig, CfaPattern, Vec4 } from '../core/types';
import { bareRowBytes } from '../core/raw/bare';
import { defaultLevelsForBitDepth } from '../core/raw/levels';
import { Button, NumberField, Segmented } from './controls';

export function ImportDialog() {
  const open = useStore((s) => s.showImport);
  const setOpen = useStore((s) => s.setShowImport);
  const [tab, setTab] = React.useState<'dng' | 'bare'>('dng');
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [width, setWidth] = React.useState(0);
  const [height, setHeight] = React.useState(0);
  const [cfa, setCfa] = React.useState<CfaPattern>('RGGB');
  const [bitDepth, setBitDepth] = React.useState<8 | 10 | 12 | 14 | 16>(12);
  const initialLevels = React.useMemo(() => defaultLevelsForBitDepth(12), []);
  const [packingKind, setPackingKind] = React.useState<'unpacked' | 'packed'>('unpacked');
  const [container, setContainer] = React.useState<'u8' | 'u16'>('u16');
  const [endian, setEndian] = React.useState<'le' | 'be'>('le');
  const [alignment, setAlignment] = React.useState<'right' | 'left'>('right');
  const [bitOrder, setBitOrder] = React.useState<'lsb' | 'msb'>('lsb');
  const [group, setGroup] = React.useState<'continuous' | 'mipi10' | 'mipi12' | 'mipi14'>('continuous');
  const [headerOffset, setHeaderOffset] = React.useState(0);
  const [rowStride, setRowStride] = React.useState(0);
  const [activeX, setActiveX] = React.useState(0);
  const [activeY, setActiveY] = React.useState(0);
  const [activeW, setActiveW] = React.useState(0);
  const [activeH, setActiveH] = React.useState(0);
  const [blackMode, setBlackMode] = React.useState<'scalar' | 'cfa'>('scalar');
  const [blackScalar, setBlackScalar] = React.useState(initialLevels.black[0]);
  const [whiteScalar, setWhiteScalar] = React.useState(initialLevels.white[0]);
  const [blackCfa, setBlackCfa] = React.useState<Vec4>(initialLevels.black);
  const [whiteCfa, setWhiteCfa] = React.useState<Vec4>(initialLevels.white);
  const [sampleShift, setSampleShift] = React.useState(0);

  const changeBitDepth = (bits: 8 | 10 | 12 | 14 | 16) => {
    setBitDepth(bits);
    const defaults = defaultLevelsForBitDepth(bits);
    setBlackScalar(defaults.black[0]);
    setWhiteScalar(defaults.white[0]);
    setBlackCfa(defaults.black);
    setWhiteCfa(defaults.white);
  };

  React.useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  if (!open) return null;

  const config = (): BareRawConfig => ({
    width,
    height,
    cfa,
    bitDepth,
    packing: packingKind === 'unpacked'
      ? { kind: 'unpacked', container, endian, alignment }
      : { kind: 'packed', bitOrder, group },
    headerOffset,
    rowStride,
    active: activeW > 0 && activeH > 0 ? { x: activeX, y: activeY, w: activeW, h: activeH } : undefined,
    black: blackMode === 'scalar' ? blackScalar : blackCfa,
    white: blackMode === 'scalar' ? whiteScalar : whiteCfa,
    endian,
    sampleShift: sampleShift as BareRawConfig['sampleShift'],
    byteLength: file?.size,
  });

  const estimate = (() => {
    try {
      if (!width || !height) return null;
      const cfg = config();
      const rowBytes = bareRowBytes(cfg);
      const stride = rowStride || rowBytes;
      return { rowBytes, stride, required: headerOffset + stride * (height - 1) + rowBytes };
    } catch {
      return null;
    }
  })();

  const doImport = async () => {
    setError(null);
    if (!file) { setError('请选择文件'); return; }
    if (tab === 'bare') {
      if (!width || !height) { setError('裸 RAW 必须填写存储宽/高'); return; }
      if (whiteScalar <= blackScalar && blackMode === 'scalar') { setError('white level 必须大于 black level'); return; }
    }
    setBusy(true);
    const err = tab === 'dng' ? await importDng(file) : await importBare(file, config());
    setBusy(false);
    if (err) setError(err);
    else setOpen(false);
  };

  return (
    <Dialog.Root open onOpenChange={(v) => { if (!v) setOpen(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="modal modal-center" aria-describedby={undefined}>
        <div className="flex h-10 items-center justify-between border-b border-ink-700 px-4">
          <Dialog.Title className="text-[13px] text-ink-100">导入图像</Dialog.Title>
          <button className="text-ink-400 hover:text-white" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="flex gap-0 border-b border-ink-700 px-4">
          <button className={`tab ${tab === 'dng' ? 'tab-active' : ''}`} onClick={() => setTab('dng')}>DNG</button>
          <button className={`tab ${tab === 'bare' ? 'tab-active' : ''}`} onClick={() => setTab('bare')}>裸 RAW 二进制</button>
        </div>
        <div className="space-y-4 p-3 sm:p-4">
          <label className={`dropzone flex cursor-pointer flex-col items-center justify-center gap-1 py-6 ${file ? 'border-[#3a7fbd]' : ''}`}>
            <input type="file" accept={tab === 'dng' ? '.dng' : '.raw,.bin,.dat,.mipi'} className="hidden" onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && tab === 'bare' && !width && !height) {
                // Don't guess dimensions; leave 0 and show file size.
              }
            }} />
            <div className="text-[12px] text-ink-200">{file ? file.name : '点击选择文件'}</div>
            <div className="text-[11px] text-ink-500">{file ? `${(file.size / 1048576).toFixed(2)} MB` : tab === 'dng' ? 'DNG（LibRaw WASM 解码）' : 'headerless CFA 二进制'}</div>
          </label>

          {tab === 'dng' ? (
            <div className="rounded border border-ink-700 bg-ink-850 p-3 text-[11px] leading-5 text-ink-400">
              DNG 由 LibRaw WASM 解包，并叠加本地 TIFF 元数据解析（ActiveArea / BlackLevel / WhiteLevel / ColorMatrix / ForwardMatrix / AsShotNeutral / Orientation）。导入后会显示 RAW 直方图与 CFA 预览。
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <NumberField label="存储宽" value={width} onChange={setWidth} min={1} max={65535} />
                <NumberField label="存储高" value={height} onChange={setHeight} min={1} max={65535} />
                <label className="flex flex-col gap-1"><span className="field-label">CFA</span><select className="select" value={cfa} onChange={(e) => setCfa(e.target.value as CfaPattern)}><option>RGGB</option><option>BGGR</option><option>GRBG</option><option>GBRG</option></select></label>
                <label className="flex flex-col gap-1"><span className="field-label">位宽</span><select className="select" value={bitDepth} onChange={(e) => changeBitDepth(Number(e.target.value) as typeof bitDepth)}><option value={8}>8</option><option value={10}>10</option><option value={12}>12</option><option value={14}>14</option><option value={16}>16</option></select></label>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1"><span className="field-label">packing</span><select className="select" value={packingKind} onChange={(e) => setPackingKind(e.target.value as typeof packingKind)}><option value="unpacked">unpacked</option><option value="packed">packed</option></select></label>
                {packingKind === 'unpacked' ? <>
                  <label className="flex flex-col gap-1"><span className="field-label">容器</span><select className="select" value={container} onChange={(e) => setContainer(e.target.value as typeof container)}><option value="u16">u16</option><option value="u8">u8</option></select></label>
                  <label className="flex flex-col gap-1"><span className="field-label">端序</span><select className="select" value={endian} onChange={(e) => setEndian(e.target.value as typeof endian)}><option value="le">little</option><option value="be">big</option></select></label>
                  <label className="flex flex-col gap-1"><span className="field-label">对齐</span><select className="select" value={alignment} onChange={(e) => setAlignment(e.target.value as typeof alignment)}><option value="right">右对齐</option><option value="left">左对齐</option></select></label>
                  <NumberField label="sample shift" value={sampleShift} onChange={setSampleShift} min={0} max={8} />
                </> : <>
                  <label className="flex flex-col gap-1"><span className="field-label">位序</span><select className="select" value={bitOrder} onChange={(e) => setBitOrder(e.target.value as typeof bitOrder)}><option value="lsb">LSB-first</option><option value="msb">MSB-first</option></select></label>
                  <label className="flex flex-col gap-1"><span className="field-label">分组</span><select className="select" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}><option value="continuous">continuous</option><option value="mipi10">MIPI RAW10</option><option value="mipi12">MIPI RAW12</option><option value="mipi14">MIPI RAW14</option></select></label>
                </>}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <NumberField label="header offset (B)" value={headerOffset} onChange={setHeaderOffset} min={0} />
                <NumberField label="row stride (B, 0=auto)" value={rowStride} onChange={setRowStride} min={0} />
                <NumberField label="active x" value={activeX} onChange={setActiveX} min={0} />
                <NumberField label="active y" value={activeY} onChange={setActiveY} min={0} />
                <NumberField label="active w (0=full)" value={activeW} onChange={setActiveW} min={0} />
                <NumberField label="active h (0=full)" value={activeH} onChange={setActiveH} min={0} />
              </div>
              <div className="rounded border border-ink-700 p-2">
                <div className="mb-2 flex items-center justify-between"><span className="field-label">黑/白电平</span><Segmented value={blackMode} onChange={setBlackMode} options={[{ value: 'scalar', label: '标量' }, { value: 'cfa', label: '逐 CFA' }]} /></div>
                <div className="mb-2 text-[11px] leading-4 text-ink-500">
                  默认按位宽填充：10-bit 64/1023，12-bit 256/4095；切换位宽会重置为默认值。
                </div>
                {blackMode === 'scalar' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField label="black DN" value={blackScalar} onChange={setBlackScalar} min={0} />
                    <NumberField label="white DN" value={whiteScalar} onChange={setWhiteScalar} min={1} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {(['R', 'G1', 'G2', 'B'] as const).map((n, i) => (
                      <div key={n} className="flex items-center gap-1">
                        <span className="w-5 text-[10px] text-ink-500">{n}</span>
                        <input className="input input-mono h-[22px] text-[11px]" type="number" value={blackCfa[i]} onChange={(e) => { const v = [...blackCfa] as Vec4; v[i] = Number(e.target.value); setBlackCfa(v); }} />
                        <input className="input input-mono h-[22px] text-[11px]" type="number" value={whiteCfa[i]} onChange={(e) => { const v = [...whiteCfa] as Vec4; v[i] = Number(e.target.value); setWhiteCfa(v); }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {estimate ? (
                <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                  <div className="rounded bg-ink-850 p-2"><div className="text-ink-500">每行字节</div><div className="mono">{estimate.rowBytes}</div></div>
                  <div className="rounded bg-ink-850 p-2"><div className="text-ink-500">实际 stride</div><div className="mono">{estimate.stride}</div></div>
                  <div className="rounded bg-ink-850 p-2"><div className="text-ink-500">所需总字节</div><div className="mono">{estimate.required}{file ? ` / ${file.size}` : ''}</div></div>
                </div>
              ) : null}
              <div className="text-[11px] leading-4 text-ink-500">
                支持：8-bit unpacked；10/12/14/16-bit u16 LE/BE 右/左对齐；10/12/14-bit 连续 LSB/MSB；MIPI RAW10/12/14。错误配置会在解码时给出字节差、通道统计与建议。
              </div>
            </div>
          )}

          {error ? <div className="rounded border border-[#63302f] bg-[#341a1e] p-3 text-[11px] leading-5 text-[#ff9a9a]">{error}</div> : null}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" onClick={doImport} disabled={busy || !file}>{busy ? '解码中…' : '导入'}</Button>
          </div>
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
