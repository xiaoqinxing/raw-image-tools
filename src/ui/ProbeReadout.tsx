import { cfaChannelLabel, wbRatios } from '../core/color/display';
import { useProbeSample } from './probe-store';

function hexOf(rgb8: readonly [number, number, number]): string {
  return `#${rgb8.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Live pixel readout. `panel` is the left-rail version; `inline` is the
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
  const channel = cfaChannelLabel(sample.raw.channel);
  const rgb = sample.stage.rgb8;
  const hex = hexOf(rgb);
  if (variant === 'inline') {
    return (
      <span className="mono flex shrink-0 items-center gap-2" data-testid="probe-inline">
        <span>px {sample.x},{sample.y}</span>
        <span>RAW {channel} {sample.raw.dn}</span>
        <span>RGB {rgb.join(',')}</span>
        <span>{hex}</span>
      </span>
    );
  }
  const wb = wbRatios(sample.wb.multipliers);
  return (
    <div className="space-y-0.5 font-mono text-[10px] leading-4 text-ink-300" data-testid="probe-panel">
      <div className="break-words">
        x {sample.x} y {sample.y}
        <span className="text-ink-500"> · </span>RAW {channel} {sample.raw.dn}
      </div>
      <div className="break-words">
        WB R {wb[0].toFixed(2)} G {wb[1].toFixed(2)} B {wb[2].toFixed(2)}
      </div>
      <div className="break-words">
        RGB {rgb.join(' ')}
        <span className="text-ink-500"> · </span>{hex}
      </div>
    </div>
  );
}
