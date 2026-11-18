'use client';

import { useCharacter } from '@/lib/store';
import { EDITOR_CATEGORIES, CATEGORY_LABELS, type EditorCategory } from '@/lib/faceControls';
import { IconAlbum, IconFocus, IconHanger, IconPose, IconSparkle, IconEye } from '@/components/hud/Icons';
const ICONS = { preset: IconAlbum, face: IconFocus, hair: IconSparkle, body: IconPose, outfit: IconHanger, styling: IconEye };
export function CategoryRail({ selected, onSelect }: { selected: EditorCategory; onSelect: (category: EditorCategory) => void }) {
  const comparing = useCharacter(s => s.faceCompareStart !== null);
  return <nav aria-label="Character categories" className="creator-categories">
    {EDITOR_CATEGORIES.map(id => {
      const Icon = ICONS[id];
      return <button key={id} type="button" className="creator-category" aria-pressed={selected === id}
        disabled={comparing} onClick={() => onSelect(id)}>
        <Icon className="h-5 w-5" /><span>{CATEGORY_LABELS[id]}</span>
      </button>;
    })}
  </nav>;
}
