'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/cn';

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
    return [r, g, b];
  }
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toH = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toH(r)}${toH(g)}${toH(b)}`.toUpperCase();
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s, v];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hn = (h % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hn % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;

  if (hn >= 0 && hn < 1) { r = c; g = x; b = 0; }
  else if (hn >= 1 && hn < 2) { r = x; g = c; b = 0; }
  else if (hn >= 2 && hn < 3) { r = 0; g = c; b = x; }
  else if (hn >= 3 && hn < 4) { r = 0; g = x; b = c; }
  else if (hn >= 4 && hn < 5) { r = x; g = 0; b = c; }
  else if (hn >= 5 && hn < 6) { r = c; g = 0; b = x; }

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export interface ColorSwatchItem {
  name: string;
  hex: string;
}

export interface ColorStudio2DProps {
  color: string;
  onChange: (hex: string) => void;
  swatches?: ColorSwatchItem[];
  swatchCols?: number;
  className?: string;
}

export function ColorStudio2D({
  color,
  onChange,
  swatches = [],
  swatchCols = 8,
  className,
}: ColorStudio2DProps) {
  // Local HSV state synced with active color
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    const [r, g, b] = hexToRgb(color || '#2B1A0A');
    return rgbToHsv(r, g, b);
  });

  const [hexInput, setHexInput] = useState(color || '#2B1A0A');

  useEffect(() => {
    if (color) {
      setHexInput(color.toUpperCase());
      const [r, g, b] = hexToRgb(color);
      setHsv(rgbToHsv(r, g, b));
    }
  }, [color]);

  const [r, g, b] = hsvToRgb(hsv[0], hsv[1], hsv[2]);

  const updateFromHsv = useCallback(
    (newHsv: [number, number, number]) => {
      setHsv(newHsv);
      const [newR, newG, newB] = hsvToRgb(newHsv[0], newHsv[1], newHsv[2]);
      const hex = rgbToHex(newR, newG, newB);
      setHexInput(hex);
      onChange(hex);
    },
    [onChange],
  );

  // SV 2D Canvas interaction
  const svBoxRef = useRef<HTMLDivElement>(null);
  const [draggingSv, setDraggingSv] = useState(false);

  const handleSvPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
      if (!svBoxRef.current) return;
      const rect = svBoxRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const s = x / rect.width;
      const v = 1 - y / rect.height;
      updateFromHsv([hsv[0], s, v]);
    },
    [hsv, updateFromHsv],
  );

  useEffect(() => {
    if (!draggingSv) return;
    const onMove = (e: PointerEvent) => handleSvPointer(e);
    const onUp = () => setDraggingSv(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingSv, handleSvPointer]);

  // Hue Bar interaction
  const hueBarRef = useRef<HTMLDivElement>(null);
  const [draggingHue, setDraggingHue] = useState(false);

  const handleHuePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
      if (!hueBarRef.current) return;
      const rect = hueBarRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const h = (x / rect.width) * 360;
      updateFromHsv([h, hsv[1], hsv[2]]);
    },
    [hsv, updateFromHsv],
  );

  useEffect(() => {
    if (!draggingHue) return;
    const onMove = (e: PointerEvent) => handleHuePointer(e);
    const onUp = () => setDraggingHue(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingHue, handleHuePointer]);

  // Vertical Hue interaction
  const vHueRef = useRef<HTMLDivElement>(null);
  const [draggingVHue, setDraggingVHue] = useState(false);

  const handleVHuePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
      if (!vHueRef.current) return;
      const rect = vHueRef.current.getBoundingClientRect();
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const h = (y / rect.height) * 360;
      updateFromHsv([h, hsv[1], hsv[2]]);
    },
    [hsv, updateFromHsv],
  );

  useEffect(() => {
    if (!draggingVHue) return;
    const onMove = (e: PointerEvent) => handleVHuePointer(e);
    const onUp = () => setDraggingVHue(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingVHue, handleVHuePointer]);

  // Value/Tone vertical bar
  const vToneRef = useRef<HTMLDivElement>(null);
  const [draggingTone, setDraggingTone] = useState(false);

  const handleTonePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
      if (!vToneRef.current) return;
      const rect = vToneRef.current.getBoundingClientRect();
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const v = 1 - y / rect.height;
      updateFromHsv([hsv[0], hsv[1], v]);
    },
    [hsv, updateFromHsv],
  );

  useEffect(() => {
    if (!draggingTone) return;
    const onMove = (e: PointerEvent) => handleTonePointer(e);
    const onUp = () => setDraggingTone(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingTone, handleTonePointer]);

  // Pure Hue color for SV box background
  const pureHueRgb = hsvToRgb(hsv[0], 1, 1);
  const pureHueHex = rgbToHex(pureHueRgb[0], pureHueRgb[1], pureHueRgb[2]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* ── 2D Color Saturation/Value Box + Vertical Sliders ───────── */}
      <div className="flex gap-2">
        {/* Main 2D SV Box */}
        <div
          ref={svBoxRef}
          onPointerDown={(e) => {
            setDraggingSv(true);
            handleSvPointer(e);
          }}
          className="relative h-[138px] flex-1 cursor-crosshair overflow-hidden rounded-[2px] border border-[#443729]"
          style={{ backgroundColor: pureHueHex }}
        >
          {/* Horizontal White gradient (Saturation) */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to right, #ffffff, transparent)',
            }}
          />
          {/* Vertical Black gradient (Value/Darkness) */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to bottom, transparent, #000000)',
            }}
          />

          {/* Draggable Target Reticle Cursor */}
          <div
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${hsv[1] * 100}%`,
              top: `${(1 - hsv[2]) * 100}%`,
            }}
          >
            <div className="h-full w-full rotate-45 border border-[#efece6] shadow-[0_0_4px_rgba(0,0,0,0.95)]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-1 w-1 rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
            </div>
          </div>
        </div>

        {/* Vertical Rainbow Hue Slider */}
        <div
          ref={vHueRef}
          onPointerDown={(e) => {
            setDraggingVHue(true);
            handleVHuePointer(e);
          }}
          className="relative h-[138px] w-[12px] cursor-pointer rounded-[2px] border border-[#443729]"
          style={{
            background:
              'linear-gradient(to bottom, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
          }}
        >
          <div
            className="pointer-events-none absolute -left-[1px] -right-[1px] h-[3px] -translate-y-1/2 rounded-[1px] border border-black/80 bg-white shadow-[0_0_3px_rgba(0,0,0,0.8)]"
            style={{ top: `${(hsv[0] / 360) * 100}%` }}
          />
        </div>

        {/* Vertical Brightness / Tone Slider */}
        <div
          ref={vToneRef}
          onPointerDown={(e) => {
            setDraggingTone(true);
            handleTonePointer(e);
          }}
          className="relative h-[138px] w-[12px] cursor-pointer rounded-[2px] border border-[#443729]"
          style={{
            background: `linear-gradient(to bottom, ${pureHueHex}, #000000)`,
          }}
        >
          <div
            className="pointer-events-none absolute -left-[1px] -right-[1px] h-[3px] -translate-y-1/2 rounded-[1px] border border-black/80 bg-white shadow-[0_0_3px_rgba(0,0,0,0.8)]"
            style={{ top: `${(1 - hsv[2]) * 100}%` }}
          />
        </div>
      </div>

      {/* ── Horizontal Rainbow Hue Slider Bar ─────────────────────── */}
      <div
        ref={hueBarRef}
        onPointerDown={(e) => {
          setDraggingHue(true);
          handleHuePointer(e);
        }}
        className="relative h-[8px] w-full cursor-pointer rounded-[2px] border border-[#443729]"
        style={{
          background:
            'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
        }}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-[12px] w-[4px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] border border-black/80 bg-white shadow-[0_0_4px_rgba(0,0,0,0.9)]"
          style={{ left: `${(hsv[0] / 360) * 100}%` }}
        />
      </div>

      {/* ── Color Swatches Palette ────────────────────────────────── */}
      {swatches.length > 0 && (
        <div
          className="grid gap-1.5 pt-0.5"
          style={{ gridTemplateColumns: `repeat(${swatchCols}, minmax(0, 1fr))` }}
        >
          {swatches.map((swatch, idx) => {
            const isChromatic = swatch.hex === 'chromatic';
            const isActive = !isChromatic && color?.toLowerCase() === swatch.hex.toLowerCase();

            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  if (isChromatic) {
                    updateFromHsv([(hsv[0] + 45) % 360, 0.75, 0.45]);
                  } else {
                    const [sr, sg, sb] = hexToRgb(swatch.hex);
                    updateFromHsv(rgbToHsv(sr, sg, sb));
                  }
                }}
                title={swatch.name}
                aria-label={swatch.name}
                aria-pressed={isActive}
                className={cn(
                  'aspect-square rounded-[2px] border transition-transform hover:scale-105 focus:outline-none',
                  isActive
                    ? 'border-[#eac87f] ring-1 ring-[#eac87f] shadow-[0_0_6px_rgba(234,200,127,0.5)]'
                    : 'border-[#443729] hover:border-[#7a6952]',
                )}
                style={
                  isChromatic
                    ? {
                        background:
                          'linear-gradient(135deg, #ff0000 0%, #ffff00 25%, #00ff00 50%, #00ffff 75%, #ff00ff 100%)',
                      }
                    : { backgroundColor: swatch.hex }
                }
              />
            );
          })}
        </div>
      )}

      {/* ── RGB & HEX Numeric Inputs ──────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 border-y border-[#463a2e]/50 py-1.5 text-[10px] font-mono tracking-wider leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="text-[#8f8576]">RGB</span>
          <div className="flex gap-1 text-[#d4cbb8]">
            <span className="rounded-[2px] border border-[#443729] bg-[#1a1512] px-1.5 py-0.5 text-center min-w-[24px]">
              {r}
            </span>
            <span className="rounded-[2px] border border-[#443729] bg-[#1a1512] px-1.5 py-0.5 text-center min-w-[24px]">
              {g}
            </span>
            <span className="rounded-[2px] border border-[#443729] bg-[#1a1512] px-1.5 py-0.5 text-center min-w-[24px]">
              {b}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[#8f8576]">HEX</span>
          <input
            type="text"
            value={hexInput}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              setHexInput(val);
              if (/^#[0-9A-F]{6}$/i.test(val)) {
                onChange(val);
                const [nr, ng, nb] = hexToRgb(val);
                setHsv(rgbToHsv(nr, ng, nb));
              }
            }}
            className="w-[66px] rounded-[2px] border border-[#443729] bg-[#1a1512] px-1.5 py-0.5 text-center text-[#eac87f] outline-none focus:border-[#b89552]"
          />
        </div>
      </div>
    </div>
  );
}
