'use client';

import React from 'react';
import { useCharacter } from '@/lib/store';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { ColorStudio2D, type ColorSwatchItem } from '@/components/hud/common/ColorStudio2D';
import { cn } from '@/lib/cn';

export const HAIR_PALETTE_SWATCHES: ColorSwatchItem[] = [
  { name: 'Raven Black', hex: '#110e0c' },
  { name: 'Espresso', hex: '#1c1512' },
  { name: 'Dark Chestnut', hex: '#2b1d16' },
  { name: 'Mocha Brown', hex: '#3d281e' },
  { name: 'Warm Chocolate', hex: '#523829' },
  { name: 'Auburn Bronze', hex: '#633722' },
  { name: 'Deep Copper', hex: '#7b3d22' },
  { name: 'Spiced Rust', hex: '#8c482c' },
  { name: 'Caramel Amber', hex: '#9e673a' },
  { name: 'Honey Blonde', hex: '#b5834f' },
  { name: 'Golden Wheat', hex: '#cca368' },
  { name: 'Ash Blonde', hex: '#a6977e' },
  { name: 'Platinum Ice', hex: '#d9d0c1' },
  { name: 'Silver Frost', hex: '#9ea2a6' },
  { name: 'Charcoal Grey', hex: '#403d3c' },
  { name: 'Chromatic Rainbow', hex: 'chromatic' },
];

export function HairProperties() {
  const hair = useCharacter((s) => s.hair);
  const setHair = useCharacter((s) => s.setHair);
  const linkBrowToHair = useCharacter((s) => s.linkBrowToHair);
  const setLinkBrowToHair = useCharacter((s) => s.setLinkBrowToHair);
  const showToast = useCharacter((s) => s.showToast);

  const hairTone = hair.tone || '#b5834f';
  const hairAlpha = hair.alpha ?? 1.0;
  const hairGloss = hair.gloss ?? 0.5;

  return (
    <StudioCard
      title="HAIR COLOR & PROPERTIES"
      showSparkle
      headerTrailing={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const next = !linkBrowToHair;
              setLinkBrowToHair(next);
              showToast?.(next ? '✦ BROW COLOR LINKED TO HAIR' : '✧ BROW COLOR UNLINKED (CUSTOM)');
            }}
            title={
              linkBrowToHair
                ? 'Brows synchronize with hair color. Click to unlock custom brow color.'
                : 'Brows are custom. Click to link brow color to hair.'
            }
            className={cn(
              'flex items-center gap-1 border px-1.5 py-0.5 text-[8.5px] font-mono tracking-wider transition-colors',
              linkBrowToHair
                ? 'border-[#eac87f]/60 bg-[#d4b483]/15 text-[#eac87f]'
                : 'border-[#463a2e] text-[#8f8778] hover:border-[#7a6952] hover:text-[#d8c9ad]',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                linkBrowToHair ? 'bg-[#eac87f] shadow-[0_0_4px_#eac87f]' : 'bg-[#8c8477]/40',
              )}
            />
            <span>{linkBrowToHair ? 'BROWS LINKED' : 'BROWS UNLINKED'}</span>
          </button>
          <button
            type="button"
            onClick={() => setHair({ tone: '#ffffff' })}
            title="Reset to original authored hair texture"
            className={cn(
              'border px-1.5 py-0.5 text-[8.5px] font-mono tracking-wider transition-colors',
              hairTone.toLowerCase() === '#ffffff'
                ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f0e6d4]'
                : 'border-[#463a2e] text-[#8f8778] hover:border-[#7a6952] hover:text-[#d8c9ad]',
            )}
          >
            [ORIGINAL]
          </button>
        </div>
      }
    >
      {/* 2D SV Box, Hue/Tone Bars, 16 Swatches, RGB & HEX */}
      <ColorStudio2D
        color={hairTone}
        onChange={(hex) => setHair({ tone: hex })}
        swatches={HAIR_PALETTE_SWATCHES}
        swatchCols={8}
      />

      {/* Fine-Tuning Sliders: OPACITY, GLOSS */}
      <div className="flex flex-col gap-2 pt-0.5">
        <BracketSlider
          label="HAIR OPACITY"
          value={hairAlpha}
          min={0.05}
          max={1.0}
          step={0.01}
          onChange={(v) => setHair({ alpha: v })}
        />
        <BracketSlider
          label="HAIR GLOSS"
          value={hairGloss}
          min={0.0}
          max={1.0}
          step={0.01}
          onChange={(v) => setHair({ gloss: v })}
        />
      </div>
    </StudioCard>
  );
}
