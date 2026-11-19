'use client';

import { useEffect } from 'react';
import { useCharacter } from '@/lib/store';
import { ANATOMY_PARAMS, ANATOMY_GROUPS, ANATOMY_COLOR_DEFS, type AnatomyGroupId, type AnatomyParamId } from '@/lib/anatomy/params';
import { ANATOMY_PRESETS, IRIS_COLORS, LIP_COLORS } from '@/lib/anatomy/presets';
import { HudSlider } from '@/components/hud/HudSlider';
import { StudioCard } from '@/components/hud/common/StudioCard';

const buttonClass = 'border border-[#d4b483]/35 px-2 py-1 text-[11px] text-[#e6d3ac] hover:bg-[#d4b483]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f] disabled:cursor-not-allowed disabled:opacity-45';

function Parameter({ id }: { id: AnatomyParamId }) {
  const value = useCharacter(s => s.anatomy[id]);
  const asymmetry = useCharacter(s => s.anatomyAsymmetry[id] ?? 0);
  const p = ANATOMY_PARAMS.find(p => p.id === id)!;
  const s = useCharacter.getState;
  return (
    <div className="mb-4">
      <p className="mb-2 text-[10px] text-[#d8c9b2]">{p.status === 'wired' ? 'Connected: broad region rig · visual review pending' : 'Stored only: deformation not connected'}</p>
      <HudSlider label={p.label} min={p.min} max={p.max} step={p.step} value={value}
        display={String(value)} onChange={v => s().setAnatomy(id, v)}
        onActiveChange={active => active ? s().beginAnatomyEdit() : s().endAnatomyEdit()} />
      <label className="flex items-center justify-between gap-2 text-[11px] text-[#d8c9b2]">
        <span>Exact value ({p.min}–{p.max})</span>
        <input type="number" aria-label={`${p.label} exact value`} min={p.min} max={p.max} step={p.step}
          value={value} className="w-20 border border-[#d4b483]/35 bg-black/30 p-1 text-[#eee4d2] focus-visible:outline focus-visible:outline-[#eac87f]"
          onFocus={() => s().beginAnatomyEdit()} onBlur={() => s().endAnatomyEdit()}
          onChange={e => { if (e.target.value !== '') s().setAnatomy(id, e.target.valueAsNumber); }} />
      </label>
      {p.bilateral && <div className="mt-3">
        <HudSlider label={`${p.label} asymmetry`} min={-100} max={100} step={1} value={asymmetry}
          display={String(asymmetry)} onChange={v => s().setAnatomyAsymmetry(id, v)}
          onActiveChange={active => active ? s().beginAnatomyEdit() : s().endAnatomyEdit()} />
        <p className="text-[10px] text-[#c1b49f]">Signed difference; 0 is symmetric. Stored only.</p>
      </div>}
    </div>
  );
}

export function AnatomyPanel({ onClose }: { onClose?: () => void }) {
  const colors = useCharacter(s => s.anatomyColors);
  const canUndo = useCharacter(s => s.anatomyPast.length > 0 || s.anatomyEditStart !== null);
  const canRedo = useCharacter(s => s.anatomyFuture.length > 0);
  const hairTone = useCharacter(s => s.hair.tone);
  const overlays = useCharacter(s => s.overlayLayers);
  const s = useCharacter.getState;
  useEffect(() => {
    const finish = () => s().endAnatomyEdit();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    return () => {
      finish();
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
    };
  }, []);
  return <StudioCard title="ADVANCED CUSTOMIZATION" badge="DRAFT" onClose={onClose}
    footerLeading={<span>Broad rig controls + stored drafts</span>}>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} onClick={() => s().setAnatomyMode('legacy')}>Back to working sculpt</button>
      <button type="button" className={buttonClass} disabled={!canUndo} onClick={() => s().undoAnatomy()}>Undo values</button>
      <button type="button" className={buttonClass} disabled={!canRedo} onClick={() => s().redoAnatomy()}>Redo values</button>
    </div>
    <p role="note" className="border border-[#d4b483]/35 p-2 text-[12px] leading-relaxed text-[#ecd9b5]">
      These controls are connected: broad face regions to the facial rig and body shape to skeleton bone scaling. The body values live in the Body tab. Appearance still needs visual review; unreviewed controls and all asymmetry values are stored only. Switching to legacy sculpt previews the original face without these advanced offsets.
    </p>
    {(Object.entries(ANATOMY_GROUPS) as [AnatomyGroupId, string][]).map(([group, label]) => <details key={group} className="border-b border-[#d4b483]/25 py-2">
      <summary className="cursor-pointer py-2 text-[12px] text-[#eee0c8] focus-visible:outline focus-visible:outline-[#eac87f]">{label} · {ANATOMY_PARAMS.some(p => p.group === group && p.status === 'wired') ? 'broad rig + stored drafts' : 'stored only'}</summary>
      <div className="pt-3">
        <button type="button" className={`${buttonClass} mb-4`} onClick={() => s().resetAnatomyGroup(group)}>Reset {label.toLowerCase()} values</button>
        {ANATOMY_PARAMS.filter(p => p.group === group).map(p => <Parameter key={p.id} id={p.id} />)}
        {ANATOMY_COLOR_DEFS.filter(p => p.group === group).map(p => <fieldset key={p.id} className="mb-4">
          <legend className="mb-2 text-[11px] text-[#e3d3b9]">{p.label} · stored only</legend>
          <label className="flex items-center gap-2 text-[11px] text-[#d8c9b2]">
            <input type="color" aria-label={p.label} value={colors[p.id]} onFocus={() => s().beginAnatomyEdit()}
              onBlur={() => s().endAnatomyEdit()} onChange={e => s().setAnatomyColor(p.id, e.target.value)} />
            <input key={colors[p.id]} aria-label={`${p.label} hex RGB`} defaultValue={colors[p.id]} maxLength={7}
              className="w-24 border border-[#d4b483]/35 bg-black/30 p-1 text-[#eee4d2] focus-visible:outline focus-visible:outline-[#eac87f]"
              pattern="#[0-9a-fA-F]{6}" onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              onBlur={e => { s().endAnatomyEdit(); s().setAnatomyColor(p.id, e.target.value); e.target.value = s().anatomyColors[p.id]; }} />
          </label>
          {p.id !== 'facialHair.color' && <div className="mt-2 flex flex-wrap gap-1">
            {(p.id === 'iris.color' ? IRIS_COLORS : LIP_COLORS).map(color => <button key={color} type="button"
              className="h-7 w-7 border border-[#d4b483]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
              aria-label={`${p.label} ${color}`} aria-pressed={colors[p.id] === color}
              style={{ backgroundColor: color }} onClick={() => { s().endAnatomyEdit(); s().setAnatomyColor(p.id, color); }} />)}
          </div>}
        </fieldset>)}
        {ANATOMY_PRESETS.some(p => p.group === group) && <fieldset className="mb-3">
          <legend className="mb-2 text-[11px] text-[#d8c9b2]">Unreviewed draft values · not authored shapes</legend>
          <div className="flex flex-wrap gap-1">{ANATOMY_PRESETS.filter(p => p.group === group).map(p => <button type="button" key={p.id}
            className={buttonClass} disabled={!Object.keys(p.values).length}
            title={Object.keys(p.values).length ? 'Apply sample stored values only' : 'Tip-specific shape targets have not been authored'}
            onClick={() => s().applyAnatomyPreset(p.id)}>{p.label}</button>)}</div>
        </fieldset>}
        {group === 'body' && <p className="text-[11px] text-[#d8c9b2]">Body shape and height are driven from the Body tab as skeleton bone scaling. Authored BodySlide morphs and garment fitting are a later phase.</p>}
        {group === 'surface' && <div className="space-y-3 border-t border-[#d4b483]/25 pt-3">
          <label className="flex items-center justify-between text-[11px] text-[#e3d3b9]">Existing hair color · live
            <input type="color" aria-label="Existing hair color (live)" value={hairTone}
              onChange={e => s().setHair({ tone: e.target.value })} />
          </label>
          <p className="text-[11px] text-[#d8c9b2]">Live hair and layer edits use their existing state; advanced-value undo/reset does not affect them.</p>
          {overlays.map((layer, index) => <HudSlider key={`${index}:${layer.kind}:${layer.id}`} label={`${layer.kind}: ${layer.id} (live opacity)`}
            min={0} max={1} step={0.01} value={layer.opacity} display={`${Math.round(layer.opacity * 100)}%`}
            onChange={opacity => s().setOverlayLayers(s().overlayLayers.map((entry, i) => i === index ? { ...entry, opacity } : entry))} />)}
          <p className="text-[11px] text-[#d8c9b2]">Use the existing Makeup editor to choose masks and colors. Independent foundation/eyeshadow/blush classification and scar/tattoo placement need supported assets; no duplicate layer state is created here.</p>
        </div>}
      </div>
    </details>)}
  </StudioCard>;
}
