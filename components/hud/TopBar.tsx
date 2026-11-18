'use client';

import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

export function TopBar({ manifest: _manifest }: { manifest: Mo2Manifest | null }) {
  const name = useCharacter(s => s.name);
  const preview = useCharacter(s => s.previewMode);
  return <header className="creator-header">
    <div><span className="creator-wordmark">LYRA</span><span className="creator-header-caption">Character studio</span></div>
    <div className="creator-header-actions">
      <label htmlFor="character-name">Name</label>
      <input id="character-name" maxLength={14} value={name} placeholder="LYRA"
        onChange={e => useCharacter.getState().setName(e.target.value)} />
      <button type="button" aria-pressed={preview} onClick={() => useCharacter.getState().setPreviewMode(!preview)}>
        {preview ? 'Return to editor' : 'Preview'}
      </button>
    </div>
  </header>;
}
