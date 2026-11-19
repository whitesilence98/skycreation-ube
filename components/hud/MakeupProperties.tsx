'use client';

import { useCharacter, type OverlayBlend } from '@/lib/store';
import { BEAUTY_SWATCHES, detectSubtype, makeupLabel } from '@/components/hud/MakeupPicker';
import { TATTOO_INK_SWATCHES, tattooLabel } from '@/components/hud/TattooPicker';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { cn } from '@/lib/cn';
import type { AssetKind } from '@/lib/manifestSelect';

type OverlayKind = Extract<AssetKind, 'makeup' | 'tattoo'>;

interface MakeupPropertiesProps {
  onClose?: () => void;
  /** Which overlay stack to edit. Tattoos share the whole properties shape. */
  kind?: OverlayKind;
}

export function MakeupProperties({ onClose, kind = 'makeup' }: MakeupPropertiesProps) {
  const layers = useCharacter((s) => s.overlayLayers);
  const activeOverlay = useCharacter((s) => s.activeOverlay);
  const entries = useCharacter((s) => s.assetCatalogues[kind]);
  const setOpacity = useCharacter((s) => s.setOverlayOpacity);
  const setColor = useCharacter((s) => s.setOverlayColor);
  const setBlend = useCharacter((s) => s.setOverlayBlend);
  const setCoverage = useCharacter((s) => s.setOverlayCoverage);
  const isTattoo = kind === 'tattoo';
  const stack = layers.filter((layer) => layer.kind === kind);
  const layer = stack.find((item) => `${kind}:${item.id}` === activeOverlay) ?? stack[0];
  const entry = entries?.find((item) => item.id === layer?.id);
  const subtype = !isTattoo && entry ? detectSubtype(entry) : null;
  const label = entry ? (isTattoo ? tattooLabel(entry) : makeupLabel(entry)) : layer?.id;
  const swatches = isTattoo ? TATTOO_INK_SWATCHES : BEAUTY_SWATCHES[subtype ?? 'OVERLAYS'];

  const content = (
    <div className="flex flex-col gap-3 pt-1">
      {/* ── Subheader ── */}
      <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6]">
          {isTattoo ? 'TATTOO & INK' : 'MAKEUP & TINT'}
        </span>
        <span className="font-mono text-[10px] text-[#a49a88]">
          {layer ? (isTattoo ? 'TATTOO' : subtype ?? 'MAKEUP') : 'EMPTY'}
        </span>
      </div>

      {!layer ? (
        <div className="py-8 text-center text-[10px] leading-relaxed text-[#8f8371]">
          <p className="text-[#b5a68c]">No {isTattoo ? 'tattoo' : 'makeup'} layer selected.</p>
          <p className="mt-1 text-[9px]">Select a style from above to edit.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pt-1">
          {/* Active Layer Label */}
          <div className="rounded-[2px] border border-[#d4b483]/15 bg-black/40 px-2 py-1.5">
            <span className="text-[8.5px] font-mono tracking-widest text-[#d4b483]/70 uppercase">
              ACTIVE LAYER:
            </span>
            <p className="truncate font-mono text-[9.5px] text-[#e8d4af]" title={label}>
              {label}
            </p>
          </div>

          {/* Opacity Bracket Slider */}
          <BracketSlider
            label="OPACITY"
            min={0.02}
            max={1}
            step={0.01}
            value={layer.opacity}
            display={`${Math.round(layer.opacity * 100)}%`}
            onChange={(value) => setOpacity(kind, layer.id, value)}
          />

          {/* Color & Palette Swatches */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono tracking-wider text-[#b8ab97]">
              <span>{isTattoo ? 'INK COLOR' : 'TINT COLOR'}</span>
              <div className="flex items-center gap-1.5">
                <input
                  aria-label={isTattoo ? 'Tattoo ink color' : 'Makeup color'}
                  type="color"
                  value={layer.color}
                  onChange={(event) => setColor(kind, layer.id, event.target.value)}
                  className="h-4 w-7 cursor-pointer rounded-xs border border-[#d4b483]/40 bg-transparent p-0"
                />
                <span className="text-[9.5px] text-[#eac87f] font-mono uppercase">{layer.color}</span>
              </div>
            </div>
            <div className="grid grid-cols-8 gap-1 pt-0.5">
              {swatches.map((swatch) => {
                const isActive = layer.color.toLowerCase() === swatch.hex.toLowerCase();
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    aria-label={swatch.name}
                    title={`${swatch.name} (${swatch.hex})`}
                    aria-pressed={isActive}
                    onClick={() => setColor(kind, layer.id, swatch.hex)}
                    className={cn(
                      'aspect-square rounded-[1px] border transition-transform hover:scale-110',
                      isActive ? 'border-[#f0dfbe] ring-1 ring-[#eac87f]' : 'border-[#d4b483]/25',
                    )}
                    style={{ backgroundColor: swatch.hex }}
                  />
                );
              })}
            </div>
          </div>

          {/* Blending Mode */}
          <div className="flex items-center justify-between text-[10px] font-mono tracking-wider text-[#b8ab97]">
            <span>BLEND MODE</span>
            <select
              aria-label="Blending mode"
              value={layer.blend ?? 'normal'}
              onChange={(event) => setBlend(kind, layer.id, event.target.value as OverlayBlend)}
              className="rounded-xs border border-[#d4b483]/30 bg-[#120f0d] px-2 py-1 text-[9.5px] font-mono text-[#e8d4af] outline-none focus:border-[#eac87f]"
            >
              {['normal', 'multiply', 'screen', 'overlay'].map((blend) => (
                <option key={blend} value={blend}>
                  {blend.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Coverage Slider */}
          <BracketSlider
            label="COVERAGE AREA"
            min={0.05}
            max={1}
            step={0.01}
            value={layer.coverage ?? 1}
            display={`${Math.round((layer.coverage ?? 1) * 100)}%`}
            onChange={(value) => setCoverage(kind, layer.id, value)}
          />
        </div>
      )}
    </div>
  );

  if (!onClose) {
    return content;
  }

  return (
    <StudioCard
      title={isTattoo ? 'TATTOO & INK' : 'MAKEUP & TINT'}
      badge={layer ? (isTattoo ? 'TATTOO' : subtype ?? 'MAKEUP') : 'EMPTY'}
      onClose={onClose}
      footerLeading={<span>{isTattoo ? '+ WARPAINT · COR' : '+ TINTMASK · UBE'}</span>}
      footerTrailing={layer ? <span>LAYER {stack.indexOf(layer) + 1}</span> : undefined}
      showSparkle
    >
      {content}
    </StudioCard>
  );
}
