'use client';

import React from 'react';
import { useCharacter } from '@/lib/store';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { SegmentedControl } from '@/components/hud/common/SegmentedControl';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import type { SculptBrushMode } from '@/lib/head/sculptBrush';
import { cn } from '@/lib/cn';

const BRUSH_MODES: ReadonlyArray<{ id: SculptBrushMode; label: string }> = [
  { id: 'inflate', label: 'Inflate' },
  { id: 'deflate', label: 'Deflate' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'move', label: 'Move' },
];

export function WuxiaSculptBrushPanel() {
  const mode = useCharacter((s) => s.sculptBrushMode);
  const setMode = useCharacter((s) => s.setSculptBrushMode);
  const radius = useCharacter((s) => s.sculptBrushRadius);
  const setRadius = useCharacter((s) => s.setSculptBrushRadius);
  const strength = useCharacter((s) => s.sculptBrushStrength);
  const setStrength = useCharacter((s) => s.setSculptBrushStrength);
  const symmetry = useCharacter((s) => s.sculptBrushSymmetry);
  const setSymmetry = useCharacter((s) => s.setSculptBrushSymmetry);
  const resetBrush = useCharacter((s) => s.resetSculptBrush);
  const showMesh = useCharacter((s) => s.showMesh);
  const setShowMesh = useCharacter((s) => s.setShowMesh);

  return (
    <div className="flex flex-col w-[calc(100vw-108px)] sm:w-[310px] md:w-[330px] max-w-[330px] shrink-0 select-none text-white pointer-events-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-base md:text-lg font-normal tracking-wide text-white">
          3D Sculpt
        </h1>
        <button
          type="button"
          onClick={() => {
            resetBrush();
            useCharacter.getState().showToast('Cleared brush sculpt deltas');
          }}
          className="flex min-h-[28px] items-center gap-1 rounded-sm border border-white/10 bg-[#1f2026]/80 px-2.5 text-[10px] tracking-wider uppercase text-[#c4bcae] hover:border-[#dfba73]/50 hover:text-[#eac87f] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]"
        >
          <span aria-hidden>↺</span>
          <span>Clear Sculpt</span>
        </button>
      </div>

      <WuxiaRibbonPill label="Vertex Brush Sculpt" />

      <div className="mt-3 flex flex-col gap-3 rounded-sm border border-white/8 bg-[#181920]/75 p-3">
        <p className="text-[11px] leading-relaxed text-[#95d6dc]">
          Click &amp; drag directly on the 3D face to sculpt geometry. Drag empty background to orbit.
        </p>

        <SegmentedControl
          segments={BRUSH_MODES}
          value={mode}
          onChange={setMode}
          ariaLabel="3D Sculpt brush mode"
          className="[&>button]:min-h-[28px]"
        />

        <div className="flex flex-col gap-2.5 pt-1">
          <BracketSlider
            label="Brush Radius"
            value={radius * 1000}
            min={5}
            max={80}
            step={1}
            display={`${Math.round(radius * 1000)} mm`}
            onChange={(mm) => setRadius(mm / 1000)}
          />
          <BracketSlider
            label="Brush Strength"
            value={strength}
            min={0.05}
            max={1}
            step={0.05}
            display={`${Math.round(strength * 100)}%`}
            onChange={setStrength}
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/8 pt-2.5">
          <button
            type="button"
            role="switch"
            aria-checked={symmetry}
            onClick={() => setSymmetry(!symmetry)}
            className={cn(
              'flex min-h-[28px] flex-1 items-center justify-center gap-1.5 rounded-sm border px-2.5 text-[10px] font-mono uppercase tracking-wider transition-colors',
              symmetry
                ? 'border-[#dfba73]/70 bg-[#dfba73]/20 text-[#f5ecd8]'
                : 'border-white/10 bg-black/30 text-[#b6ad9c] hover:text-white',
            )}
          >
            <span>X Symmetry: {symmetry ? 'ON' : 'OFF'}</span>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={showMesh}
            onClick={() => setShowMesh(!showMesh)}
            className={cn(
              'flex min-h-[28px] flex-1 items-center justify-center gap-1.5 rounded-sm border px-2.5 text-[10px] font-mono uppercase tracking-wider transition-colors',
              showMesh
                ? 'border-[#63d9e2]/65 bg-[#63d9e2]/15 text-[#d9feff]'
                : 'border-white/10 bg-black/30 text-[#b6ad9c] hover:text-white',
            )}
          >
            <span>Wireframe: {showMesh ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
