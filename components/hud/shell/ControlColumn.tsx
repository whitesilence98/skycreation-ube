'use client';

import { useCharacter } from '@/lib/store';
import { SLIDER_DEFS, type SliderId } from '@/lib/regions';
import { RightPanel } from '@/components/hud/RightPanel';
import { FACE_SECTIONS, faceControlIds, storedFaceControlIds, type FaceSectionId } from '@/lib/faceControls';
import { ANATOMY_BY_ID } from '@/lib/anatomy/params';
import { HudSlider } from '@/components/hud/HudSlider';

const LABELS: Record<SliderId, string> = {
  length: 'Vertical size', width: 'Width', depth: 'Depth', height: 'Move up / down',
  angle: 'Tilt forward / back', protrusion: 'Move front / back',
};
export function ControlColumn({ section }: { section: FaceSectionId }) {
  const item = FACE_SECTIONS.find(s => s.id === section)!;
  const banks = useCharacter(s => s.sliders);
  const anatomy = useCharacter(s => s.anatomy);
  const anatomyMode = useCharacter(s => s.anatomyMode);
  const compare = useCharacter(s => s.faceCompareStart !== null);
  const state = useCharacter.getState;
  const ids = item.region ? faceControlIds(item.region) : [];
  const experimental = storedFaceControlIds(section);
  const slider = (id: SliderId) => {
    if (!item.region) return null;
    const def = SLIDER_DEFS.find(s => s.id === id)!;
    return <HudSlider key={id} label={LABELS[id]} value={banks[item.region][id]}
      min={def.min} max={def.max} step={def.step} display={def.format(banks[item.region][id])}
      onChange={value => state().setSlider(id, value)}
      onActiveChange={active => active ? state().beginFaceEdit() : state().endFaceEdit()} />;
  };
  return <section className="creator-controls" aria-label={`${item.label} adjustments`}>
    <h2>{item.label}</h2>
    <fieldset disabled={compare} className="min-w-0">
      {item.region ? <>
        <p className="creator-hint">Broad feature adjustments</p>
        {(['width', 'length', 'depth'] as const).map(slider)}
        <details className="creator-details">
          <summary>Position &amp; tilt</summary>
          <div className="pt-4">{(['height', 'angle', 'protrusion'] as const).map(slider)}</div>
        </details>
        <details className="creator-details">
          <summary>Direct handles</summary>
          <RightPanel />
        </details>
        {ids.length > 0 && <details className="creator-details">
          <summary>Additional shaping</summary>
          <label className="creator-check"><input type="checkbox" checked={anatomyMode === 'advanced'}
            onChange={e => state().setAnatomyMode(e.target.checked ? 'advanced' : 'legacy')} />Apply saved fine adjustments</label>
          <p className="creator-hint">These conservative offsets build on the broad sliders. 50 adds no offset. Visual review pending.</p>
          {ids.map(id => <HudSlider key={id} label={ANATOMY_BY_ID[id].label}
            disabled={anatomyMode !== 'advanced'} value={anatomy[id]} min={0} max={100} step={1} display={String(anatomy[id])}
            onChange={value => state().setAnatomy(id, value)}
            onActiveChange={active => active ? state().beginFaceEdit() : state().endFaceEdit()} />)}
        </details>}
      </> : <p className="creator-hint">Detailed {item.label.toLowerCase()} deformation has not been connected. Appearance assets are available under Styling.</p>}
      {experimental.length > 0 && <details className="creator-details">
        <summary>Experimental values ({experimental.length})</summary>
        <p className="creator-hint">Stored only; these do not change the character.</p>
        {experimental.map(id => <HudSlider key={id} label={ANATOMY_BY_ID[id].label}
          min={ANATOMY_BY_ID[id].min} max={ANATOMY_BY_ID[id].max} step={ANATOMY_BY_ID[id].step}
          value={anatomy[id]} display={String(anatomy[id])} onChange={value => state().setAnatomy(id, value)}
          onActiveChange={active => active ? state().beginFaceEdit() : state().endFaceEdit()} />)}
      </details>}
    </fieldset>
  </section>;
}
