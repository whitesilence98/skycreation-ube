'use client';

import React from 'react';
import { useCharacter } from '@/lib/store';
import { SLIDER_DEFS, type SliderId } from '@/lib/regions';
import { RightPanel } from '@/components/hud/RightPanel';
import { FACE_SECTIONS, faceControlIds, storedFaceControlIds, type FaceSectionId } from '@/lib/faceControls';
import { ANATOMY_BY_ID } from '@/lib/anatomy/params';
import { BracketSlider } from '@/components/hud/common/BracketSlider';

const LABELS: Record<SliderId, string> = {
  length: 'Vertical size',
  width: 'Width',
  depth: 'Depth',
  height: 'Move up / down',
  angle: 'Tilt forward / back',
  protrusion: 'Move front / back',
};

export function ControlColumn({ section }: { section: FaceSectionId }) {
  const item = FACE_SECTIONS.find((s) => s.id === section) || FACE_SECTIONS[0];
  const banks = useCharacter((s) => s.sliders);
  const anatomy = useCharacter((s) => s.anatomy);
  const compare = useCharacter((s) => s.faceCompareStart !== null);
  const state = useCharacter.getState;
  const ids = item.region ? faceControlIds(item.region) : [];
  const experimental = storedFaceControlIds(section);

  const slider = (id: SliderId) => {
    if (!item.region) return null;
    const def = SLIDER_DEFS.find((s) => s.id === id)!;
    return (
      <div key={id} onDoubleClick={() => state().setSlider(id, 0)} className="cursor-pointer">
        <BracketSlider
          label={LABELS[id]}
          value={banks[item.region][id]}
          min={def.min}
          max={def.max}
          step={def.step}
          display={def.format(banks[item.region][id])}
          onChange={(value) => {
            state().beginFaceEdit();
            state().setSlider(id, value);
          }}
        />
      </div>
    );
  };

  return (
    <section className="creator-controls w-full flex flex-col scrollbar-none" aria-label={`${item.label} adjustments`}>
      {/* Feature Title Header */}
      <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1 mb-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#efece6] m-0">
          {item.label.toUpperCase()} ADJUSTMENTS
        </h2>
      </div>

      <fieldset disabled={compare} className="min-w-0 border-0 p-0 m-0">
        <>
            {/* Direct 3D Handles Widget */}
            <RightPanel />

            {/* Proportions & Dimensions (Length, Width, Depth) */}
            <div className="flex flex-col gap-0.5 mb-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#9f9da6] mb-1">
                Proportions &amp; Size
              </span>
              {(['width', 'length', 'depth'] as const).map(slider)}
            </div>

            {/* Position & Orientation (Height, Angle, Protrusion) */}
            <div className="flex flex-col gap-0.5 mb-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#9f9da6] mb-1">
                Position &amp; Tilt
              </span>
              {(['height', 'angle', 'protrusion'] as const).map(slider)}
            </div>

            {/* Fine Wired Anatomy Morphs */}
            {ids.length > 0 && (
              <div className="flex flex-col gap-0.5 mb-2">
                <div className="flex items-center justify-between border-b border-white/5 pb-1 mb-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#9f9da6]">
                    Additional Shaping ({ids.length})
                  </span>
                </div>
                <p className="text-[10px] text-[#75737d] mb-2 leading-snug">
                  These offsets build on the broad sliders above. 50 adds nothing.
                </p>
                {ids.map((id) => (
                  <div key={id} onDoubleClick={() => state().setAnatomy(id, 50)} className="cursor-pointer mb-1.5">
                    <BracketSlider
                      label={ANATOMY_BY_ID[id].label}
                      value={anatomy[id]}
                      min={0}
                      max={100}
                      step={1}
                      display={String(anatomy[id])}
                      onChange={(value) => {
                        state().setAnatomyMode('advanced');
                        state().beginFaceEdit();
                        state().setAnatomy(id, value);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </>

        {/* Stored / Not connected Morphs */}
        {experimental.length > 0 && (
          <details className="group rounded border border-white/5 bg-[#1a1b20]/60 p-2 text-xs mb-3">
            <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider text-[#75737d] group-hover:text-[#a8a5b0] select-none flex items-center justify-between">
              <span>Not Connected ({experimental.length})</span>
              <span className="text-[10px] text-[#55535c] transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="pt-2">
              <p className="text-[10px] text-[#75737d] mb-2 leading-snug">
                Saved with your preset, but they do not change the character yet. Disabled until they do.
              </p>
              {experimental.map((id) => (
                <div key={id} className="mb-1.5">
                  <BracketSlider
                    label={ANATOMY_BY_ID[id].label}
                    disabled
                    min={ANATOMY_BY_ID[id].min}
                    max={ANATOMY_BY_ID[id].max}
                    step={ANATOMY_BY_ID[id].step}
                    value={anatomy[id]}
                    display="Not connected"
                    onChange={() => {}}
                  />
                </div>
              ))}
            </div>
          </details>
        )}
      </fieldset>
    </section>
  );
}
