'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useCharacter } from '@/lib/store';
import { cn } from '@/lib/cn';

// 8 Palette swatches matching user mockup
const BROW_SWATCHES = [
  { name: 'Espresso Black', hex: '#1a120b' },
  { name: 'Dark Auburn', hex: '#2b1a0a' }, // Active default
  { name: 'Warm Chestnut', hex: '#422817' },
  { name: 'Medium Brown', hex: '#5c3a21' },
  { name: 'Honey Blonde', hex: '#8c6239' },
  { name: 'Sandy Blonde', hex: '#b88e58' },
  { name: 'Platinum Blonde', hex: '#e2c799' },
  { name: 'Chromatic Rainbow', hex: 'chromatic' },
];

function hexToRgb(hex: string): [number, number, number] {
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

function rgbToHex(r: number, g: number, b: number): string {
  const toH = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toH(r)}${toH(g)}${toH(b)}`.toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
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

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
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

export function BrowProperties() {
  const browColor = useCharacter((s) => s.browColor);
  const setBrowColor = useCharacter((s) => s.setBrowColor);
  const browOpacity = useCharacter((s) => s.browOpacity);
  const setBrowOpacity = useCharacter((s) => s.setBrowOpacity);
  const browGloss = useCharacter((s) => s.browGloss);
  const setBrowGloss = useCharacter((s) => s.setBrowGloss);
  const browGlossy = useCharacter((s) => s.browGlossy);
  const setBrowGlossy = useCharacter((s) => s.setBrowGlossy);

  // Local HSV state synced with browColor
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    const [r, g, b] = hexToRgb(browColor || '#2B1A0A');
    return rgbToHsv(r, g, b);
  });

  const [hexInput, setHexInput] = useState(browColor || '#2B1A0A');

  useEffect(() => {
    if (browColor) {
      setHexInput(browColor.toUpperCase());
      const [r, g, b] = hexToRgb(browColor);
      setHsv(rgbToHsv(r, g, b));
    }
  }, [browColor]);

  const [r, g, b] = hsvToRgb(hsv[0], hsv[1], hsv[2]);

  // Update color from HSV
  const updateFromHsv = useCallback(
    (newHsv: [number, number, number]) => {
      setHsv(newHsv);
      const [newR, newG, newB] = hsvToRgb(newHsv[0], newHsv[1], newHsv[2]);
      const hex = rgbToHex(newR, newG, newB);
      setHexInput(hex);
      setBrowColor(hex);
    },
    [setBrowColor],
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
    <div className="relative flex w-full flex-col select-none text-[#e6e1d8]">
      <div className="flex flex-col gap-3 rounded-xs border border-[#d4b483]/22 bg-black/45 p-3.5 backdrop-blur-md shadow-[0_14px_38px_rgba(0,0,0,0.42)]">
        {/* Top Header: BROW COLOR & PROPERTIES */}
        <div className="border-b border-[#d4b483]/18 pb-2">
          <h2 className="text-[11px] font-medium tracking-[0.14em] text-[#d8c39c] uppercase">
            BROW COLOR &amp; PROPERTIES
          </h2>
        </div>

        {/* ── 2D Color Saturation/Value Box + Vertical Sliders ───────── */}
        <div className="flex gap-2.5">
          {/* Main 2D SV Box */}
          <div
            ref={svBoxRef}
            onPointerDown={(e) => {
              setDraggingSv(true);
              handleSvPointer(e);
            }}
            className="relative h-[146px] flex-1 cursor-crosshair overflow-hidden rounded-xs border border-[#d4b483]/30"
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

            {/* Draggable Reticle / Target Cursor */}
            <div
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-[0_0_4px_rgba(0,0,0,0.9)]"
              style={{
                left: `${hsv[1] * 100}%`,
                top: `${(1 - hsv[2]) * 100}%`,
              }}
            >
              <div className="h-full w-full rounded-full border border-black/80" />
            </div>
          </div>

          {/* Vertical Rainbow Hue Slider */}
          <div
            ref={vHueRef}
            onPointerDown={(e) => {
              setDraggingVHue(true);
              handleVHuePointer(e);
            }}
            className="relative h-[146px] w-[14px] cursor-pointer rounded-xs border border-[#d4b483]/30"
            style={{
              background: 'linear-gradient(to bottom, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
            }}
          >
            {/* Vertical Hue indicator thumb */}
            <div
              className="pointer-events-none absolute -left-[2px] right-[2px] h-[4px] -translate-y-1/2 rounded-xs border border-white bg-black/60 shadow-[0_0_3px_rgba(0,0,0,0.8)]"
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
            className="relative h-[146px] w-[14px] cursor-pointer rounded-xs border border-[#d4b483]/30"
            style={{
              background: `linear-gradient(to bottom, ${pureHueHex}, #000000)`,
            }}
          >
            {/* Vertical Tone indicator thumb */}
            <div
              className="pointer-events-none absolute -left-[2px] right-[2px] h-[4px] -translate-y-1/2 rounded-xs border border-white bg-black/60 shadow-[0_0_3px_rgba(0,0,0,0.8)]"
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
          className="relative h-[10px] w-full cursor-pointer rounded-xs border border-[#d4b483]/30"
          style={{
            background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
          }}
        >
          {/* Horizontal Hue Slider Thumb */}
          <div
            className="pointer-events-none absolute top-1/2 h-[14px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-xs border border-[#efece6] bg-black/80 shadow-[0_0_4px_rgba(0,0,0,0.9)]"
            style={{ left: `${(hsv[0] / 360) * 100}%` }}
          />
        </div>

        {/* ── Color Swatches Palette (8 items) ──────────────────────── */}
        <div className="grid grid-cols-8 gap-1.5 pt-1">
          {BROW_SWATCHES.map((swatch, idx) => {
            const isChromatic = swatch.hex === 'chromatic';
            const isActive = !isChromatic && browColor?.toLowerCase() === swatch.hex.toLowerCase();

            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  if (isChromatic) {
                    // Random / chromatic cycle
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
                  'aspect-square rounded-xs border transition-transform hover:scale-110 focus:outline-none',
                  isActive
                    ? 'border-[#eac87f] ring-1 ring-[#eac87f] shadow-[0_0_6px_rgba(234,200,127,0.4)]'
                    : 'border-[#d4b483]/30 hover:border-[#d4b483]/70',
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

        {/* ── RGB & HEX Numeric Inputs ──────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 border-y border-[#d4b483]/14 py-2 text-[10px] font-mono tracking-wider">
          <div className="flex items-center gap-1.5">
            <span className="text-[#c4b595]/80">RGB</span>
            <div className="flex gap-1 text-[#e2d8c6]">
              <span className="rounded-xs border border-[#d4b483]/25 bg-black/40 px-1.5 py-0.5 text-center min-w-[26px]">
                {r}
              </span>
              <span className="rounded-xs border border-[#d4b483]/25 bg-black/40 px-1.5 py-0.5 text-center min-w-[26px]">
                {g}
              </span>
              <span className="rounded-xs border border-[#d4b483]/25 bg-black/40 px-1.5 py-0.5 text-center min-w-[26px]">
                {b}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[#c4b595]/80">HEX</span>
            <input
              type="text"
              value={hexInput}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                setHexInput(val);
                if (/^#[0-9A-F]{6}$/i.test(val)) {
                  setBrowColor(val);
                  const [nr, ng, nb] = hexToRgb(val);
                  setHsv(rgbToHsv(nr, ng, nb));
                }
              }}
              className="w-[66px] rounded-xs border border-[#d4b483]/25 bg-black/40 px-1.5 py-0.5 text-center text-[#eac87f] outline-none focus:border-[#eac87f]"
            />
          </div>
        </div>

        {/* ── Fine-Tuning Sliders: OPACITY, GLOSS, GLOSSY ────────────── */}
        <div className="flex flex-col gap-2.5 pt-0.5">
          {/* OPACITY */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] font-mono tracking-wider">
              <span className="text-[#c4b595] uppercase">
                OPACITY [{Math.round(browOpacity * 100)}%]
              </span>
            </div>
            {/* Custom Bracket Slider */}
            <div className="flex items-center gap-1 text-[11px] font-mono text-[#d4b483]/60">
              <span>[</span>
              <div className="relative flex-1 py-1">
                <input
                  type="range"
                  min="0.05"
                  max="1.0"
                  step="0.01"
                  value={browOpacity}
                  onChange={(e) => setBrowOpacity(parseFloat(e.target.value))}
                  className="w-full cursor-pointer accent-[#eac87f] bg-transparent"
                />
              </div>
              <span>]</span>
            </div>
          </div>

          {/* GLOSS */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] font-mono tracking-wider">
              <span className="text-[#c4b595] uppercase">
                GLOSS [{Math.round(browGloss * 100)}%]
              </span>
            </div>
            {/* Custom Bracket Slider */}
            <div className="flex items-center gap-1 text-[11px] font-mono text-[#d4b483]/60">
              <span>[</span>
              <div className="relative flex-1 py-1">
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.01"
                  value={browGloss}
                  onChange={(e) => setBrowGloss(parseFloat(e.target.value))}
                  className="w-full cursor-pointer accent-[#eac87f] bg-transparent"
                />
              </div>
              <span>]</span>
            </div>
          </div>

          {/* GLOSSY */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] font-mono tracking-wider">
              <span className="text-[#c4b595] uppercase">
                GLOSSY [{Math.round(browGlossy * 100)}%]
              </span>
            </div>
            {/* Custom Bracket Slider */}
            <div className="flex items-center gap-1 text-[11px] font-mono text-[#d4b483]/60">
              <span>[</span>
              <div className="relative flex-1 py-1">
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.01"
                  value={browGlossy}
                  onChange={(e) => setBrowGlossy(parseFloat(e.target.value))}
                  className="w-full cursor-pointer accent-[#eac87f] bg-transparent"
                />
              </div>
              <span>]</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
