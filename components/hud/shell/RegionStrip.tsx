'use client';

import { useState } from 'react';
import { useCharacter } from '@/lib/store';
import { FACE_SECTIONS, type FaceSectionId } from '@/lib/faceControls';
import { cn } from '@/lib/cn';

/**
 * Feature Option List matching Image 2 reference:
 * Clean, modern Wuxia menu bars with header, right chevrons, and signature
 * golden outline selection bracket with top accent notch.
 * Replaces the obsolete 2-letter square badges [FO], [BR], [NO].
 */
export function RegionStrip({
  selected,
  onSelect,
}: {
  selected: FaceSectionId;
  onSelect: (id: FaceSectionId) => void;
}) {
  const activeRegion = useCharacter((s) => s.activeRegion);

  return (
    <div className="flex flex-col w-full select-none" role="region" aria-label="Feature options">
      {/* Header: Features */}
      <h2 className="text-[13px] font-normal tracking-wide text-white/90 mb-2.5 px-0.5">
        Features
      </h2>

      {/* Options List */}
      <nav aria-label="Facial features" className="flex flex-col gap-1.5 w-full">
        {FACE_SECTIONS.map((section, index) => {
          const isSelected = section.id === selected;
          const isCurrentRegion = section.region === activeRegion;

          return (
            <button
              key={section.id}
              type="button"
              className={cn(
                'group relative flex h-11 w-full items-center justify-between rounded-sm px-3.5 text-left transition-all',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
                isSelected
                  ? 'border border-[#d4b483] bg-[#1a1b20]/90 shadow-[inset_0_0_12px_rgba(212,180,131,0.12)]'
                  : 'border border-white/5 bg-[#1f2026]/75 hover:border-[#dfba73]/40 hover:bg-[#272830]'
              )}
              aria-pressed={isSelected}
              aria-label={section.label}
              title={section.label}
              onClick={() => {
                const state = useCharacter.getState();
                state.endFaceEdit();
                if (section.region) state.setActiveRegion(section.region);
                onSelect(section.id);
              }}
            >
              {/* Golden accent notch on the top border when active (Image 2 Match) */}
              {isSelected && (
                <span
                  className="absolute -top-[1.5px] left-1/2 -translate-x-1/2 h-[2px] w-4 rounded-full bg-[#eac87f]"
                  aria-hidden
                />
              )}

              {/* Section Name */}
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'text-xs tracking-wide truncate transition-colors',
                    isSelected
                      ? 'font-medium text-white'
                      : 'text-[#d4d3d9] group-hover:text-white'
                  )}
                >
                  {section.label}
                </span>
                {isCurrentRegion && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-[#d4b483] shadow-[0_0_4px_rgba(212,180,131,0.8)]"
                    title="Active 3D Region"
                    aria-hidden
                  />
                )}
              </div>

              {/* Right Chevron > */}
              <span
                className={cn(
                  'text-sm transition-colors',
                  isSelected
                    ? 'text-[#eac87f] font-normal'
                    : 'text-[#75737d] font-light group-hover:text-white'
                )}
                aria-hidden
              >
                ›
              </span>
              <span className="sr-only">{index + 1}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/** Wraps the slider column so it can be collapsed, maintaining clean layout. */
export function ControlsDisclosure({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <details
      className="mt-3 border-t border-white/10 pt-2.5 text-xs text-white/80"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none py-1 text-xs font-medium text-[#d4b483] hover:text-[#eac87f] flex items-center justify-between">
        <span>Adjust Parameters</span>
        <span className="font-mono text-[10px] text-white/50">{open ? '▾' : '▸'}</span>
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}
