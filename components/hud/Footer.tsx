'use client';

import { PresetIO } from '@/components/hud/PresetIO';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

export function Footer({ manifest }: { manifest: Mo2Manifest | null }) {
  const isFace = useCharacter(s => s.primaryTab === 'FACE SHAPE');
  const past = useCharacter(s => s.facePast.length);
  const future = useCharacter(s => s.faceFuture.length);
  const comparing = useCharacter(s => s.faceCompareStart !== null);
  const state = useCharacter.getState;
  return <footer className="creator-footer">
    <div className="creator-footer-context">
      <button type="button" onClick={() => state().setWorkspace('edit')}>Return</button>
      {isFace ? <>
        <button type="button" disabled={!past || comparing} onClick={() => state().undoFace()}>Undo</button>
        <button type="button" disabled={!future || comparing} onClick={() => state().redoFace()}>Redo</button>
        <button type="button" aria-pressed={comparing}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); state().beginFaceCompare(); }}
          onPointerUp={() => state().endFaceCompare()} onPointerCancel={() => state().endFaceCompare()}
          onLostPointerCapture={() => state().endFaceCompare()} onBlur={() => state().endFaceCompare()}
          onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); state().beginFaceCompare(); } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') state().endFaceCompare(); }}>
          {comparing ? 'Showing original' : 'Hold to compare'}
        </button>
        <button type="button" disabled={comparing} onClick={() => state().resetFaceRegion()}>Reset region</button>
      </> : <span className="creator-footer-hint">Drag to orbit · Scroll to zoom</span>}
    </div>
    <div className="creator-footer-actions">
      <PresetIO manifest={manifest} />
      <button type="button" className="creator-primary-action" disabled={comparing}
        onClick={() => {
          state().applyFaceBaseline(); state().setPreviewMode(true);
          state().showToast('Preview · face comparison baseline updated');
        }}>Apply &amp; preview</button>
    </div>
  </footer>;
}
