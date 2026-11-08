import React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SliderPrimitive from '@radix-ui/react-slider';

export function Button({
  children,
  onClick,
  disabled,
  variant = 'default',
  title,
  className = '',
  testId,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'ghost';
  title?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className={`btn ${variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <span className="flex items-center gap-2">
      <SwitchPrimitive.Root
        checked={on}
        onCheckedChange={onChange}
        className={`switch ${on ? 'switch-on' : ''}`}
        aria-label={label}
        title={label}
      >
        <SwitchPrimitive.Thumb className="switch-thumb" />
      </SwitchPrimitive.Root>
      {label ? <span className="text-[11px] text-ink-300">{label}</span> : null}
    </span>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  disabled,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
  format?: (v: number) => string;
}) {
  return (
    <div className={disabled ? 'opacity-45' : ''}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-ink-300">{label}</span>
        <span className="mono text-[11px] text-ink-200">
          {format ? format(value) : value}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <SliderPrimitive.Root
        className="slider-root"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0])}
      >
        <SliderPrimitive.Track className="slider-track">
          <SliderPrimitive.Range className="slider-range" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="slider-thumb" />
      </SliderPrimitive.Root>
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  suffix,
  className = '',
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  suffix?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      {label ? <span className="field-label">{label}</span> : null}
      <div className="flex items-center gap-1">
        <input
          aria-label={label}
          className="input input-mono"
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix ? <span className="text-[11px] text-ink-400">{suffix}</span> : null}
      </div>
    </label>
  );
}

export function Section({
  title,
  right,
  children,
  defaultOpen = true,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-ink-700/70">
      <div className="flex h-8 items-center justify-between px-3">
        <button className="flex items-center gap-2 text-left" onClick={() => setOpen(!open)}>
          <span className={`text-ink-400 text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          <span className="text-[11px] font-medium tracking-wide text-ink-200">{title}</span>
        </button>
        {right}
      </div>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </div>
  );
}

export function KV({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span>{k}</span>
      <span className={mono ? 'mono' : ''}>{v}</span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded border border-ink-600 overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`px-2 py-1 text-[11px] ${value === o.value ? 'bg-[#1d4a70] text-[#d8ecff]' : 'bg-ink-850 text-ink-300 hover:bg-ink-800'}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
