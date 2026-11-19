'use client';

import { useState } from 'react';
import { useCharacter } from '@/lib/store';
import { FACE_SECTIONS, type FaceSectionId } from '@/lib/faceControls';
import { REGIONS_BY_ID } from '@/lib/regions';

/**
 * The reference's middle column: a narrow vertical strip of square preview
 * tiles. Selecting one reveals its controls in the disclosure beneath, rather
 * than showing a permanent properties panel.
 *
 * The tiles are drawn from the region definition rather than from art, because
 * this machine has no portrait thumbnails. When real thumbs exist they slot in
 * here unchanged — the tile keeps its size and selection affordance.
 */
export function RegionStrip({ selected, onSelect }: { selected: FaceSectionId; onSelect: (id: FaceSectionId) => void }) {
  const activeRegion = useCharacter(s => s.activeRegion);
  return <nav aria-label="Facial features" className="creator-strip">
    {FACE_SECTIONS.map((section, index) => {
      const pressed = section.id === selected;
      return <button key={section.id} type="button" className="creator-strip-tile" aria-pressed={pressed}
        aria-label={section.label} title={section.label}
        onClick={() => {
          const state = useCharacter.getState();
          state.endFaceEdit();
          if (section.region) state.setActiveRegion(section.region);
          onSelect(section.id);
        }}>
        <span className="creator-strip-art" aria-hidden>
          {section.region ? REGIONS_BY_ID[section.region].short.slice(0, 2) : section.label.slice(0, 2).toUpperCase()}
        </span>
        <span className="creator-strip-label">{section.label}</span>
        {section.region === activeRegion && <span className="creator-strip-dot" aria-hidden />}
        <span className="sr-only">{index + 1}</span>
      </button>;
    })}
  </nav>;
}

/** Wraps the slider column so it can be collapsed, as the reference does. */
export function ControlsDisclosure({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return <details className="creator-disclosure" open={open} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
    <summary>Adjust {open ? '▾' : '▸'}</summary>
    {children}
  </details>;
}
