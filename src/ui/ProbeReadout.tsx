import { useProbeSample } from './probe-store';

function hexOf(rgb8: readonly [number, number, number]): string {
  return `#${rgb8.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Live pixel readout. `panel` is the detailed left-rail version; `inline` is a
 * compact status-bar variant. Neither overlays the canvas.
 */
export function ProbeReadout({ variant }: { variant: 'panel' | 'inline' }) {
  const sample = useProbeSample();
  if (!sample) {
    if (variant === 'panel') {
      return <div className="text-[10px] leading-4 text-ink-500">移入画布查看像素信息</div>;
    }
    return null;
  }
  if (variant === 'inline') {
    return (
      <span className="mono flex shrink-0 items-center gap-2" data-testid="probe-inline">
        <span>px {sample.x},{sample.y}</span>
        <span>RAW {sample.raw.channel} {sample.raw.dn}</span>
        <span>RGB {sample.stage.rgb8.join(',')}</span>
        <span>{hexOf(sample.stage.rgb8)}</span>
      </span>
    );
  }
  return (
    <div className="space-y-0.5 font-mono text-[10px] leading-4 text-ink-300" data-testid="probe-panel">
      <div className="break-words">
        x {sample.x} y {sample.y}
        <span className="text-ink-500"> · </span>RAW {sample.raw.channel} {sample.raw.dn}/{Math.round(sample.raw.white)}
        <span className="text-ink-500"> · </span>{sample.raw.normalized.toFixed(4)}
      </div>
      <div className="break-words">
        WB {sample.wb.multipliers.map((v) => v.toFixed(2)).join(' / ')}
        <span className="text-ink-500"> · </span>{sample.raw.channel}→{sample.wb.corrected.toFixed(4)}
      </div>
      <div className="break-words">
        RGB {sample.stage.rgb.map((v) => v.toFixed(3)).join(' ')}
        <span className="text-ink-500"> · </span>{sample.stage.rgb8.join(',')}
        <span className="text-ink-500"> · </span>{hexOf(sample.stage.rgb8)}
      </div>
      <div className="break-words text-ink-500">{sample.stage.domain} / {sample.stage.id}</div>
    </div>
  );
}
