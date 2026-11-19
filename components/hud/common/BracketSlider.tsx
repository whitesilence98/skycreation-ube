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
  onChange: (v: number) => void;
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
  onChange,
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
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, handlePointer]);

  const readout = display ?? `${Math.round(value * (max <= 1 ? 100 : 1))}${unit}`;

  return (
    <div className={cn('flex flex-col gap-0.5', disabled && 'opacity-40 cursor-not-allowed')}>
      <div className="flex items-center justify-between text-[9.5px] font-mono tracking-wider">
        <span className="text-[#a89e8f] uppercase">
          {label} [{readout}]
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8f8576]">
        <span className="select-none text-[#8f8576] font-light">[</span>
        <div
          ref={trackRef}
          onPointerDown={(e) => {
            if (!disabled) {
              setDragging(true);
              handlePointer(e);
            }
          }}
          className={cn(
            'relative h-[14px] flex-1 flex items-center',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          {/* Hairline Track line */}
          <div className="h-[1px] w-full bg-[#4a3e30]">
            <div
              className="h-[1px] bg-[#8c7857]"
              style={{ width: `${pct}%` }}
            />
          </div>
          {/* Vertical Bar Indicator Thumb */}
          <div
            className="pointer-events-none absolute top-1/2 h-[10px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-[#f0e2ca] shadow-[0_0_4px_rgba(0,0,0,0.9)]"
            style={{ left: `${pct}%` }}
          />
        </div>
        <span className="select-none text-[#8f8576] font-light">]</span>
      </div>
    </div>
  );
}
