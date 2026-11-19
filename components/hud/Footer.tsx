'use client';

import { PresetIO } from '@/components/hud/PresetIO';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

/**
 * Reference footer grammar: a left cluster of plain text actions prefixed by a
 * key glyph, a right cluster that ends in one filled gold button. The key
 * glyphs are shown as small outlined boxes, matching the reference's
 * controller/button hints.
 */
function Key({ children }: { children: React.ReactNode }) {
  return <span className="creator-key" aria-hidden>{children}</span>;
}

export function Footer({ manifest }: { manifest: Mo2Manifest | null }) {
  const isFace = useCharacter(s => s.primaryTab === 'FACE SHAPE');
  const past = useCharacter(s => s.facePast.length);
  const future = useCharacter(s => s.faceFuture.length);
  const comparing = useCharacter(s => s.faceCompareStart !== null);
  const preview = useCharacter(s => s.previewMode);
  const state = useCharacter.getState;
  return <footer className="creator-footer">
    <div className="creator-footer-context">
      <button type="button" onClick={() => state().setWorkspace('edit')}><Key>Esc</Key><span>Return</span></button>
      {isFace && <>
        <button type="button" disabled={!past || comparing} onClick={() => state().undoFace()}><Key>Ctrl+Z</Key><span>Undo</span></button>
        <button type="button" disabled={!future || comparing} onClick={() => state().redoFace()}><Key>Ctrl+Y</Key><span>Redo</span></button>
        <button type="button" aria-pressed={comparing}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); state().beginFaceCompare(); }}
          onPointerUp={() => state().endFaceCompare()} onPointerCancel={() => state().endFaceCompare()}
          onLostPointerCapture={() => state().endFaceCompare()} onBlur={() => state().endFaceCompare()}
          onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); state().beginFaceCompare(); } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') state().endFaceCompare(); }}>
          <Key>C</Key><span>{comparing ? 'Showing last saved point' : 'Hold to compare'}</span>
        </button>
        <button type="button" disabled={comparing} onClick={() => state().resetFaceRegion()}><Key>R</Key><span>Reset region</span></button>
      </>}
    </div>
    <div className="creator-footer-actions">
      <PresetIO manifest={manifest} />
      {!preview && <button type="button" className="creator-primary-action" disabled={comparing}
        onClick={() => {
          state().applyFaceBaseline(); state().setPreviewMode(true);
          state().showToast('Preview on · compare now returns to this point');
        }}><Key>Space</Key><span>Complete</span></button>}
    </div>
  </footer>;
}
