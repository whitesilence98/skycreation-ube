'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/cn';

export interface BracketSliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  display?: string;
  unit?: string;
  disabled?: boolean;
  title?: string;
  onChange: (v: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: () => void;
}

export function BracketSlider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  display,
  unit = '%',
  disabled = false,
  title,
  onChange,
  onChangeStart,
  onChangeEnd,
}: BracketSliderProps) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
      if (disabled || !trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const ratio = x / rect.width;
      const raw = min + ratio * (max - min);
      const stepped = Math.round(raw / step) * step;
      onChange(Math.max(min, Math.min(max, Number(stepped.toFixed(4)))));
    },
    [min, max, step, disabled, onChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => handlePointer(e);
    const onUp = () => {
      setDragging(false);
      onChangeEnd?.();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, handlePointer, onChangeEnd]);

  const readout = display ?? `${Math.round(value * (max <= 1 ? 100 : 1))}${unit}`;

  return (
    <div className={cn('flex flex-col gap-0.5', disabled && 'opacity-40 cursor-not-allowed')} title={title}>
      <div className="flex items-center justify-between text-[10px] font-mono tracking-wider mb-1">
        <span className="text-[#a89e8f] uppercase">{label}</span>
        <span className="text-[#eac87f] font-medium tabular-nums">{readout}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#a49a88]">
        <span className="select-none text-[#a49a88] font-light" aria-hidden="true">[</span>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-orientation="horizontal"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={readout}
          aria-disabled={disabled || undefined}
          onKeyDown={(e) => {
            if (disabled) return;
            const largeStep = step * 10;
            const next = e.key === 'Home' ? min
              : e.key === 'End' ? max
              : e.key === 'PageUp' ? Math.min(max, value + largeStep)
              : e.key === 'PageDown' ? Math.max(min, value - largeStep)
              : ['ArrowRight', 'ArrowUp'].includes(e.key) ? value + step
              : ['ArrowLeft', 'ArrowDown'].includes(e.key) ? value - step : null;
            if (next === null) return;
            e.preventDefault();
            if (!e.repeat) onChangeStart?.();
            onChange(Math.max(min, Math.min(max, Number(next.toFixed(4)))));
          }}
          onKeyUp={(e) => {
            if (['Home', 'End', 'PageUp', 'PageDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'].includes(e.key)) {
              onChangeEnd?.();
            }
          }}
          onPointerDown={(e) => {
            if (!disabled) {
              onChangeStart?.();
              setDragging(true);
              handlePointer(e);
            }
          }}
          className={cn(
            'relative h-[24px] min-h-[24px] flex-1 flex items-center',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
            'focus-visible:outline-2 focus-visible:outline-[#eac87f] focus-visible:outline-offset-2',
          )}
        >
          {/* Hairline Track line */}
          <div className="h-[1px] w-full bg-[#786650]/80">
            <div
              className="h-[1px] bg-[#d4b483]"
              style={{ width: `${pct}%` }}
            />
          </div>
          {/* Vertical Bar Indicator Thumb */}
          <div
            className="pointer-events-none absolute top-1/2 h-[10px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-[#f0e2ca] shadow-[0_0_4px_rgba(0,0,0,0.9)]"
            style={{ left: `${pct}%` }}
          />
        </div>
        <span className="select-none text-[#a49a88] font-light" aria-hidden="true">]</span>
      </div>
    </div>
  );
}
