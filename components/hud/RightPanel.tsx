'use client';

import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

/** Shared handle controls; region selection and sliders live in the contextual editor. */
export function RightPanel({ manifest: _manifest, onClose }: { manifest?: Mo2Manifest | null; onClose?: () => void }) {
  const mode = useCharacter(s => s.transformMode);
  const showMesh = useCharacter(s => s.showMesh);
  return <div>
    <div className="creator-inline-options" role="group" aria-label="Handle transform">
      {(['translate', 'rotate', 'scale'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value}
        onClick={() => useCharacter.getState().setTransformMode(value)}>
        {{ translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[value]}
      </button>)}
    </div>
    <label className="creator-check"><input type="checkbox" checked={showMesh}
      onChange={e => useCharacter.getState().setShowMesh(e.target.checked)} />Show face mesh</label>
    <p className="creator-hint">Handles reshape whole regions. Independent left/right sculpting is not connected yet.</p>
    {onClose && <button type="button" onClick={onClose}>Close handles</button>}
  </div>;
}
