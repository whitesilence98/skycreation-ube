'use client';

import React from 'react';
import { useCharacter } from '@/lib/store';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { ColorStudio2D, type ColorSwatchItem } from '@/components/hud/common/ColorStudio2D';
import { cn } from '@/lib/cn';
import { HAIR_LIMITS, HAIR_OFFSET_METRES } from '@/lib/hair/settings';

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
  const showScalp = useCharacter((s) => s.showScalp);
  const setShowScalp = useCharacter((s) => s.setShowScalp);
  const showToast = useCharacter((s) => s.showToast);

  const hairTone = hair.tone || '#b5834f';
  const hairAlpha = hair.alpha ?? 1.0;
  const hairGloss = hair.gloss ?? 0.5;
  const hairOffset = hair.hairOffset ?? 0;
  /* The slider reads in millimetres, which is what the user sees move; the
     stored value stays in neutral slider units so presets survive a retune of
     `HAIR_OFFSET_METRES`. A unit is 1.5 mm, so an integer step can land on a
     half millimetre. */
  const offsetMm = hairOffset * HAIR_OFFSET_METRES * 1000;

  return (
    <div className="flex flex-col gap-3 pt-1">
      {/* ── Subheader with Quick Actions ── */}
      <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6]">
          HAIR PROPERTIES
        </span>
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
              'flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-mono tracking-wider transition-colors',
              linkBrowToHair
                ? 'border-[#eac87f] bg-[#d4b483]/15 text-[#eac87f]'
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
              'border px-1.5 py-0.5 text-[9px] font-mono tracking-wider transition-colors',
              hairTone.toLowerCase() === '#ffffff'
                ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f0e6d4]'
                : 'border-[#463a2e] text-[#8f8778] hover:border-[#7a6952] hover:text-[#d8c9ad]',
            )}
          >
            [ORIGINAL]
          </button>
        </div>
      </div>

      {/* 2D SV Box, Hue/Tone Bars, 16 Swatches, RGB & HEX */}
      <ColorStudio2D
        color={hairTone}
        onChange={(hex) => setHair({ tone: hex })}
        swatches={HAIR_PALETTE_SWATCHES}
        swatchCols={8}
      />

      {/* Fit + fine-tuning: HEIGHT, OPACITY, GLOSS */}
      <div className="flex flex-col gap-2 pt-0.5">
        <BracketSlider
          label="HAIR HEIGHT"
          value={hairOffset}
          min={HAIR_LIMITS.hairOffset[0]}
          max={HAIR_LIMITS.hairOffset[1]}
          step={1}
          display={offsetMm === 0 ? 'NEUTRAL' : `${offsetMm > 0 ? '+' : ''}${offsetMm.toFixed(1)}mm`}
          onChange={(v) => setHair({ hairOffset: v })}
        />
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
        <button
          type="button"
          onClick={() => {
            const next = !showScalp;
            setShowScalp(next);
            showToast?.(next ? 'Hairline & scalp cap visible' : 'Hairline & scalp cap hidden');
          }}
          className={cn(
            'mt-1 flex w-full items-center justify-between border px-2.5 py-1.5 rounded-sm text-[11px] font-mono tracking-wider transition-colors',
            showScalp
              ? 'border-[#eac87f] bg-[#d4b483]/15 text-[#f2dfbe]'
              : 'border-white/10 bg-black/30 text-[#8a8793] hover:border-white/30 hover:text-white'
          )}
        >
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'h-2 w-2 rounded-full transition-colors',
                showScalp ? 'bg-[#eac87f] shadow-[0_0_5px_#eac87f]' : 'bg-neutral-600'
              )}
            />
            SCALP CAP
          </span>
          <span className="text-[10px] font-semibold uppercase text-[#dfba73]">
            {showScalp ? 'VISIBLE' : 'HIDDEN'}
          </span>
        </button>
      </div>
    </div>
  );
}
