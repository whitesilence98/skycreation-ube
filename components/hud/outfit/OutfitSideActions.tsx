'use client';

import { exitWardrobe, navigateCategory } from '@/lib/editorNav';
import { useCharacter } from '@/lib/store';
import { IconAlbum, IconSparkle } from '@/components/hud/Icons';

export function OutfitSideActions() {
  const setPreviewMode = useCharacter(s => s.setPreviewMode);
  return <nav className="creator-outfit-actions" aria-label="Wardrobe actions">
    <button type="button" onClick={exitWardrobe} aria-label="Exit wardrobe" title="Exit wardrobe">
      <span aria-hidden="true">×</span>
    </button>
    <button type="button" onClick={() => navigateCategory('preset')} aria-label="Character presets" title="Character presets">
      <IconAlbum className="h-5 w-5" />
    </button>
    <button type="button" onClick={() => setPreviewMode(true)} aria-label="Preview character" title="Preview character">
      <IconSparkle className="h-5 w-5" />
    </button>
  </nav>;
}
