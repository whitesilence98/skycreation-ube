'use client';

import React from 'react';
import { useCharacter } from '@/lib/store';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { ColorStudio2D, type ColorSwatchItem } from '@/components/hud/common/ColorStudio2D';
import { cn } from '@/lib/cn';

export const SKIN_PALETTE_SWATCHES: ColorSwatchItem[] = [
  // Row 1: Fair & Pale
  { name: 'Nordic Snow', hex: '#FFF5EB' },
  { name: 'Frost Ivory', hex: '#FDF0E6' },
  { name: 'Breton Fair', hex: '#F7E6D7' },
  { name: 'Rosy Peach', hex: '#F4D6C6' },
  { name: 'Alabaster', hex: '#EED0BA' },
  { name: 'Warm Bisque', hex: '#E8C6AA' },
  { name: 'Imperial Cream', hex: '#E6C4A4' },
  { name: 'Golden Sand', hex: '#DDBB98' },
  // Row 2: Medium & Olive
  { name: 'Warm Honey', hex: '#D8B490' },
  { name: 'Sunkissed Amber', hex: '#D2A882' },
  { name: 'Dunmer Ash Pale', hex: '#B0B4B8' },
  { name: 'Dunmer Slate', hex: '#8A9098' },
  { name: 'Altmer Golden', hex: '#DEC480' },
  { name: 'Bosmer Ochre', hex: '#C8A870' },
  { name: 'Orcish Olive', hex: '#8A9678' },
  { name: 'Deep Bronze', hex: '#B08258' },
  // Row 3: Deep & Rich
  { name: 'Redguard Copper', hex: '#9E6E48' },
  { name: 'Desert Dune', hex: '#8C5D38' },
  { name: 'Spiced Umber', hex: '#7A4D2E' },
  { name: 'Rich Mahogany', hex: '#663B20' },
  { name: 'Deep Chestnut', hex: '#542C16' },
  { name: 'Dark Espresso', hex: '#401E0E' },
  { name: 'Obsidian Night', hex: '#2E1408' },
  { name: 'Chromatic Rainbow', hex: 'chromatic' },
];

export function SkinProperties() {
  const skinColor = useCharacter((s) => s.skinColor);
  const setSkinColor = useCharacter((s) => s.setSkinColor);
  const skinGloss = useCharacter((s) => s.skinGloss);
  const setSkinGloss = useCharacter((s) => s.setSkinGloss);
  const skinSss = useCharacter((s) => s.skinSss);
  const setSkinSss = useCharacter((s) => s.setSkinSss);
  const skinSheen = useCharacter((s) => s.skinSheen);
  const setSkinSheen = useCharacter((s) => s.setSkinSheen);
  const skinDetail = useCharacter((s) => s.skinDetail);
  const setSkinDetail = useCharacter((s) => s.setSkinDetail);

  const activeColor = skinColor || '#ffffff';

  return (
    <div className="flex flex-col gap-3 pt-1">
      {/* ── Subheader with Quick Actions ── */}
      <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6]">
          SKIN COLOR &amp; PROPERTIES
        </span>
        <button
          type="button"
          onClick={() => setSkinColor('#ffffff')}
          title="Reset to original authored skin diffuse atlas"
          className={cn(
            'border px-1.5 py-0.5 text-[9px] font-mono tracking-wider leading-tight transition-colors',
            activeColor.toLowerCase() === '#ffffff'
              ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f0e6d4]'
              : 'border-[#463a2e] text-[#8f8778] hover:border-[#7a6952] hover:text-[#d8c9ad]',
          )}
        >
          [ORIGINAL]
        </button>
      </div>

      {/* 2D SV Box, Hue/Tone Bars, 24 Swatches, RGB & HEX */}
      <ColorStudio2D
        color={activeColor}
        onChange={setSkinColor}
        swatches={SKIN_PALETTE_SWATCHES}
        swatchCols={8}
      />

      {/* PBR Physical Skin Shader Bracket Sliders */}
      <div className="flex flex-col gap-2 pt-0.5">
        <BracketSlider
          label="SKIN GLOSS"
          value={skinGloss}
          min={0.0}
          max={1.0}
          step={0.01}
          onChange={setSkinGloss}
        />
        <BracketSlider
          label="SCATTERING (SSS)"
          value={skinSss}
          min={0.0}
          max={1.0}
          step={0.01}
          onChange={setSkinSss}
        />
        <BracketSlider
          label="SPECULAR SHEEN"
          value={skinSheen}
          min={0.0}
          max={1.0}
          step={0.01}
          onChange={setSkinSheen}
        />
        <BracketSlider
          label="MICRODETAIL PORES"
          value={skinDetail}
          min={0.0}
          max={1.0}
          step={0.01}
          onChange={setSkinDetail}
        />
      </div>
    </div>
  );
}
