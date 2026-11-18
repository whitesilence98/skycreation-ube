'use client';

import { useCharacter } from '@/lib/store';
import { FACE_SECTIONS, type FaceSectionId } from '@/lib/faceControls';

export function SubList({ selected, onSelect }: { selected: FaceSectionId; onSelect: (id: FaceSectionId) => void }) {
  return <nav aria-label="Facial features" className="creator-sublist">
    <h2>Features</h2>
    {FACE_SECTIONS.map(section => <button key={section.id} type="button" aria-pressed={section.id === selected}
      onClick={() => {
        const state = useCharacter.getState();
        state.endFaceEdit();
        if (section.region) state.setActiveRegion(section.region);
        onSelect(section.id);
      }}>{section.label}</button>)}
  </nav>;
}
