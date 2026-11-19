'use client';

import { useCharacter } from '@/lib/store';
import { EDITOR_CATEGORIES, CATEGORY_LABELS, type EditorCategory } from '@/lib/faceControls';
import { IconAlbum, IconFocus, IconHanger, IconPose, IconSparkle, IconEye } from '@/components/hud/Icons';

const ICONS = { preset: IconAlbum, face: IconFocus, hair: IconSparkle, body: IconPose, outfit: IconHanger, styling: IconEye };

/**
 * The reference's left rail: a vertical stack of square icon tiles, each with
 * its label centred beneath. The tile is the click target and the only thing
 * that carries selection — the label never changes colour independently, which
 * is what keeps the rail readable over a bright stage.
 */
export function CategoryRail({ selected, onSelect }: { selected: EditorCategory; onSelect: (category: EditorCategory) => void }) {
  const comparing = useCharacter(s => s.faceCompareStart !== null);
  return <nav aria-label="Character categories" className="creator-categories">
    {EDITOR_CATEGORIES.map(id => {
      const Icon = ICONS[id];
      return <button key={id} type="button" className="creator-category" aria-pressed={selected === id}
        disabled={comparing} onClick={() => onSelect(id)}>
        <span className="creator-category-tile"><Icon className="h-[22px] w-[22px]" /></span>
        <span className="creator-category-label">{CATEGORY_LABELS[id]}</span>
      </button>;
    })}
  </nav>;
}
