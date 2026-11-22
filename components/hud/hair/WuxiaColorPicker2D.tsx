'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/cn';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '@/components/hud/common/ColorStudio2D';

export interface WuxiaColorPicker2DProps {
  color: string;
  onChange: (hex: string) => void;
  onReset?: () => void;
  className?: string;
}

const DEFAULT_RECENT_COLORS = ['#8C382C', '#1C1512', '#B5834F', '#2B1D16', '#633722'];

/**
 * WuxiaColorPicker2D matches the Advanced Hair Dye reference design:
 * - Left: Vertical rainbow Hue spectrum slider (12px width) with circular white ring thumb.
 * - Right: 2D Saturation / Value canvas (240px x 250px) with circular reticle cursor.
 * - Bottom: "Recently Used" swatches history + Reset button (↺ Reset).
 */
export function WuxiaColorPicker2D({
  color,
  onChange,
  onReset,
  className,
}: WuxiaColorPicker2DProps) {
  // Local HSV state synced with active color
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    const [r, g, b] = hexToRgb(color || '#8C382C');
    return rgbToHsv(r, g, b);
  });

  const [recentColors, setRecentColors] = useState<string[]>(DEFAULT_RECENT_COLORS);

  useEffect(() => {
    if (color) {
      const [r, g, b] = hexToRgb(color);
      setHsv(rgbToHsv(r, g, b));
    }
  }, [color]);

  const updateFromHsv = useCallback(
    (newHsv: [number, number, number]) => {
      setHsv(newHsv);
      const [newR, newG, newB] = hsvToRgb(newHsv[0], newHsv[1], newHsv[2]);
      const hex = rgbToHex(newR, newG, newB);
      onChange(hex);
    },
    [onChange],
  );

  const commitRecentColor = useCallback((hex: string) => {
    setRecentColors((prev) => {
      const upper = hex.toUpperCase();
      const filtered = prev.filter((c) => c !== upper);
      return [upper, ...filtered].slice(0, 5);
    });
  }, []);

  // 1. Vertical Hue Slider Dragging
  const vHueRef = useRef<HTMLDivElement>(null);
  const [draggingHue, setDraggingHue] = useState(false);

  const handleHuePointer = useCallback(
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
    if (!draggingHue) return;
    const onMove = (e: PointerEvent) => handleHuePointer(e);
    const onUp = () => {
      setDraggingHue(false);
      const [newR, newG, newB] = hsvToRgb(hsv[0], hsv[1], hsv[2]);
      commitRecentColor(rgbToHex(newR, newG, newB));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingHue, handleHuePointer, hsv, commitRecentColor]);

  // 2. 2D Saturation / Value Canvas Dragging
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
    const onUp = () => {
      setDraggingSv(false);
      const [newR, newG, newB] = hsvToRgb(hsv[0], hsv[1], hsv[2]);
      commitRecentColor(rgbToHex(newR, newG, newB));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingSv, handleSvPointer, hsv, commitRecentColor]);

  // Pure Hue RGB/HEX for 2D Canvas Background
  const pureHueRgb = hsvToRgb(hsv[0], 1, 1);
  const pureHueHex = rgbToHex(pureHueRgb[0], pureHueRgb[1], pureHueRgb[2]);

  return (
    <div className={cn('flex flex-col gap-4 select-none', className)}>
      {/* ── 2D Color Studio Area (Hue on Left, SV Box on Right) ─────── */}
      <div className="flex items-center gap-3">
        {/* 1. Vertical Rainbow Hue Bar (12px Width x 250px Height) */}
        <div
          ref={vHueRef}
          onPointerDown={(e) => {
            setDraggingHue(true);
            handleHuePointer(e);
          }}
          className="relative h-[250px] w-3 shrink-0 cursor-pointer rounded-full border border-white/20 shadow-inner"
          style={{
            background:
              'linear-gradient(to bottom, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
          }}
          role="slider"
          aria-label="Hair Hue Spectrum"
          aria-valuenow={Math.round(hsv[0])}
          aria-valuemin={0}
          aria-valuemax={360}
          tabIndex={0}
        >
          {/* Circular Ring Thumb */}
          <div
            className="pointer-events-none absolute -left-1 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_6px_rgba(0,0,0,0.85)] ring-1 ring-black/40"
            style={{ top: `${(hsv[0] / 360) * 100}%` }}
          />
        </div>

        {/* 2. Main 2D SV Box (240px Width x 250px Height) */}
        <div
          ref={svBoxRef}
          onPointerDown={(e) => {
            setDraggingSv(true);
            handleSvPointer(e);
          }}
          className="relative h-[250px] w-[240px] md:w-[250px] shrink-0 cursor-crosshair overflow-hidden rounded-xs border border-white/20 shadow-2xl"
          style={{ backgroundColor: pureHueHex }}
          role="region"
          aria-label="Saturation and Brightness Picker"
        >
          {/* Horizontal White gradient (Saturation: Left white -> Right pure hue) */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to right, #ffffff, transparent)',
            }}
          />

          {/* Vertical Black gradient (Brightness: Top transparent -> Bottom black) */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to bottom, transparent, #000000)',
            }}
          />

          {/* Target Reticle Circular Cursor */}
          <div
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${hsv[1] * 100}%`,
              top: `${(1 - hsv[2]) * 100}%`,
            }}
          >
            {/* Outer white ring with shadow */}
            <div className="h-full w-full rounded-full border-2 border-white shadow-[0_0_5px_rgba(0,0,0,0.9)]" />
          </div>
        </div>
      </div>

      {/* ── Recently Used Colors & Reset Row ────────────────────────── */}
      <div className="flex flex-col gap-2 pt-1">
        <span className="text-[11px] font-medium tracking-wider text-[#9f9da6] uppercase">
          Recently Used
        </span>

        <div className="flex items-center gap-2">
          {recentColors.map((hex, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                const [r, g, b] = hexToRgb(hex);
                setHsv(rgbToHsv(r, g, b));
                onChange(hex);
              }}
              className={cn(
                'h-7 w-9 rounded-xs border transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
                color?.toUpperCase() === hex.toUpperCase()
                  ? 'border-[#dfba73] ring-1 ring-[#dfba73]/80'
                  : 'border-white/15 hover:border-white/40'
              )}
              style={{ backgroundColor: hex }}
              title={`Apply ${hex}`}
              aria-label={`Recent color ${hex}`}
            />
          ))}
        </div>

        {/* ↺ Reset Button */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => {
              if (onReset) {
                onReset();
              } else {
                onChange('#FFFFFF');
                const [r, g, b] = hexToRgb('#FFFFFF');
                setHsv(rgbToHsv(r, g, b));
              }
            }}
            className="group inline-flex items-center gap-1.5 text-[11px] text-[#9f9da6] hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]"
            aria-label="Reset hair dye to original authored color"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 fill-none stroke-current stroke-[2] transition-transform group-hover:-rotate-90"
              aria-hidden
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            <span className="font-medium">Reset</span>
          </button>
        </div>
      </div>
    </div>
  );
}
