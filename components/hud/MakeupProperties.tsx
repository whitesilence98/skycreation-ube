'use client';

import { useCharacter, type OverlayBlend } from '@/lib/store';
import { BEAUTY_SWATCHES, detectSubtype, makeupLabel } from '@/components/hud/MakeupPicker';
import { HudSlider } from '@/components/hud/HudSlider';
import { cn } from '@/lib/cn';

export function MakeupProperties() {
  const layers = useCharacter((s) => s.overlayLayers);
  const activeOverlay = useCharacter((s) => s.activeOverlay);
  const entries = useCharacter((s) => s.assetCatalogues.makeup);
  const setOpacity = useCharacter((s) => s.setOverlayOpacity);
  const setColor = useCharacter((s) => s.setOverlayColor);
  const setBlend = useCharacter((s) => s.setOverlayBlend);
  const setCoverage = useCharacter((s) => s.setOverlayCoverage);
  const makeup = layers.filter((layer) => layer.kind === 'makeup');
  const layer = makeup.find((item) => `makeup:${item.id}` === activeOverlay) ?? makeup[0];
  const entry = entries?.find((item) => item.id === layer?.id);
  const subtype = entry ? detectSubtype(entry) : 'OVERLAYS';
  const label = entry ? makeupLabel(entry) : layer?.id;

  return (
    <aside aria-label="Makeup properties" className="pointer-events-auto w-full select-none p-3 hud-fade">
      <div className="mb-[12px] border-b border-[#d4b483]/20 pb-[6px]">
        <h3 className="text-[10px] font-medium tracking-[0.14em] text-[#d8c39c] uppercase">MAKEUP PROPERTIES</h3>
      </div>
      {!layer ? <p className="px-[4px] py-[18px] text-[10px] leading-relaxed text-[#b5a68c]">Select a layer to edit.<br /><span className="text-[10px] text-[#8f8371]">Add a style from the left to begin.</span></p> : (
        <div className="pt-[2px]">
          <HudSlider label="OPACITY" min={0.02} max={1} step={0.01} value={layer.opacity} display={`${Math.round(layer.opacity * 100)}%`} onChange={(value) => setOpacity('makeup', layer.id, value)} />
          <fieldset className="mb-[17px] border-0 p-0">
            <legend className="mb-[7px] text-[10px] tracking-[0.09em] text-[#cec5b3]">COLOR</legend>
            <div className="mb-[7px] flex items-center gap-[7px]">
              <input aria-label="Makeup color" type="color" value={layer.color} onChange={(event) => setColor('makeup', layer.id, event.target.value)} className="h-[24px] w-[43px] cursor-pointer rounded-xs border border-[#d4b483]/50 bg-transparent p-[2px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]" />
              <span className="num text-[10px] uppercase tracking-[0.06em] text-[#cbb99b]">{layer.color}</span>
            </div>
            <div className="grid grid-cols-8 gap-[4px]">{BEAUTY_SWATCHES[subtype].map((swatch) => <button key={swatch.hex} type="button" aria-label={swatch.name} title={`${swatch.name} ${swatch.hex}`} aria-pressed={layer.color.toLowerCase() === swatch.hex} onClick={() => setColor('makeup', layer.id, swatch.hex)} className={cn('aspect-square rounded-xs border transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#eac87f]', layer.color.toLowerCase() === swatch.hex ? 'border-[#f0dfbe] ring-1 ring-[#d4b483]/60' : 'border-[#d4b483]/30')} style={{ backgroundColor: swatch.hex }} />)}</div>
          </fieldset>
          <label className="mb-[19px] flex items-center justify-between gap-[8px] text-[10px] tracking-[0.06em] text-[#cec5b3]">
            BLENDING MODE
            <select aria-label="Blending mode" value={layer.blend ?? 'normal'} onChange={(event) => setBlend('makeup', layer.id, event.target.value as OverlayBlend)} className="min-w-0 rounded-xs border border-[#d4b483]/35 bg-[#201b14] px-[5px] py-[3px] text-[10px] text-[#e8d4af] outline-none focus:border-[#eac87f]">
              {['normal', 'multiply', 'screen', 'overlay'].map((blend) => <option key={blend} value={blend}>{blend.toUpperCase()}</option>)}
            </select>
          </label>
          <HudSlider label="COVERAGE AREA" min={0.05} max={1} step={0.01} value={layer.coverage ?? 1} display={`${Math.round((layer.coverage ?? 1) * 100)}%`} onChange={(value) => setCoverage('makeup', layer.id, value)} />
          <p className="-mt-[6px] text-[10px] leading-relaxed text-[#9e907b]">Reduces the soft edges of the painted mask.</p>
          <div className="mt-[14px] border-t border-[#d4b483]/20 pt-[8px] text-[10px] leading-relaxed text-[#b3a184]">
            <span className="tracking-[0.09em] text-[#d7c29e]">LAYER {makeup.indexOf(layer) + 1} · {subtype}</span>
            <p className="mt-[3px] truncate" title={label}>{label}</p>
          </div>
        </div>
      )}
    </aside>
  );
}
