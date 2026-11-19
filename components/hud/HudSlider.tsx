'use client';

import { cn } from '@/lib/cn';

interface SliderProps {
  label: string;
  suffix?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
  onActiveChange?: (active: boolean) => void;
  bracketed?: boolean;
  disabled?: boolean;
}

export function HudSlider({ label, suffix, value, min, max, step, display, onChange, onActiveChange, bracketed = false, disabled = false }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={cn("mb-[14px] min-h-[36px]", disabled && "opacity-45")}>
      <div className="mb-[4px] flex min-h-[16px] items-baseline justify-between gap-2">
        <label className="flex items-baseline gap-[4px] text-[10px] tracking-[0.09em] text-[#cec5b3]/90">
          <span>{label}</span>
          {suffix && <span className="text-[10px] tracking-[0.03em] text-[#c4bba8]">{suffix}</span>}
        </label>
        <span className={cn('num text-[10px] tracking-[0.02em]', bracketed ? 'text-[#eac87f]' : 'text-[#d8c9ad]')}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={(event) => !disabled && onChange(Number(event.target.value))}
        onPointerDown={() => !disabled && onActiveChange?.(true)} onPointerUp={() => onActiveChange?.(false)}
        onPointerCancel={() => onActiveChange?.(false)} onFocus={() => !disabled && onActiveChange?.(true)} onBlur={() => onActiveChange?.(false)}
        aria-label={`${label} ${suffix ?? ''}`.trim()}
        aria-valuetext={display}
        className={cn(
          "hud-range h-[9px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#eac87f]",
          disabled && "cursor-not-allowed opacity-50 pointer-events-none"
        )}
        style={{ ['--pct' as string]: `${pct}%` }} />
    </div>
  );
}

/** Integers read signed; glosses and other fractional readouts leave it alone. */
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

interface RangeRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  /** How the bracketed readout is rendered; integers sign, glosses do not. */
  format?: (v: number) => string;
}

/**
 * Compact one-line slider lifted from the graphics panel. Shared with the
 * camera/lighting panel so both read as the same control.
 */
export function RangeRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  format = signed,
}: RangeRowProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="flex min-h-[28px] items-center gap-[6px]">
      <span className="w-[132px] shrink-0 text-[10px] tracking-[0.1em] text-[#cfc6b4]/90">
        {label} <span className="text-[#c4bba8]">[{format(value)}]</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        aria-valuetext={format(value)}
        className="hud-range h-[10px] flex-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#eac87f]"
        style={{ ['--pct' as string]: `${pct}%` }}
      />
    </label>
  );
}
