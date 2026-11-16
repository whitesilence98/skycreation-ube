'use client';

import React from 'react';
import { useCharacter } from '@/lib/store';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { ColorStudio2D, type ColorSwatchItem } from '@/components/hud/common/ColorStudio2D';
import { cn } from '@/lib/cn';

const BROW_SWATCHES: ColorSwatchItem[] = [
  { name: 'Espresso Black', hex: '#1a120b' },
  { name: 'Dark Auburn', hex: '#2b1a0a' }, // Active default
  { name: 'Warm Chestnut', hex: '#422817' },
  { name: 'Medium Brown', hex: '#5c3a21' },
  { name: 'Honey Blonde', hex: '#8c6239' },
  { name: 'Sandy Blonde', hex: '#b88e58' },
  { name: 'Platinum Blonde', hex: '#e2c799' },
  { name: 'Chromatic Rainbow', hex: 'chromatic' },
];

export function BrowProperties() {
  const browColor = useCharacter((s) => s.browColor);
  const setBrowColor = useCharacter((s) => s.setBrowColor);
  const browOpacity = useCharacter((s) => s.browOpacity);
  const setBrowOpacity = useCharacter((s) => s.setBrowOpacity);
  const browGloss = useCharacter((s) => s.browGloss);
  const setBrowGloss = useCharacter((s) => s.setBrowGloss);
  const browGlossy = useCharacter((s) => s.browGlossy);
  const setBrowGlossy = useCharacter((s) => s.setBrowGlossy);
  const linkBrowToHair = useCharacter((s) => s.linkBrowToHair);
  const setLinkBrowToHair = useCharacter((s) => s.setLinkBrowToHair);
  const hair = useCharacter((s) => s.hair);
  const showToast = useCharacter((s) => s.showToast);

  return (
    <StudioCard
      title="BROW COLOR & PROPERTIES"
      showSparkle
      headerTrailing={
        <button
          type="button"
          onClick={() => {
            const next = !linkBrowToHair;
            setLinkBrowToHair(next);
            showToast?.(next ? '✦ BROW COLOR LINKED TO HAIR' : '✧ BROW COLOR UNLINKED (CUSTOM)');
          }}
          title={
            linkBrowToHair
              ? 'Eyebrow color synchronizes with hair. Click to unlock custom brow color.'
              : 'Click to synchronize eyebrow color with current hair color.'
          }
          className={cn(
            'flex items-center gap-1.5 border px-2 py-0.5 text-[8.5px] font-mono tracking-wider transition-all',
            linkBrowToHair
              ? 'border-[#eac87f]/70 bg-[#d4b483]/15 text-[#eac87f] shadow-[0_0_8px_rgba(234,200,127,0.15)]'
              : 'border-[#463a2e] bg-black/20 text-[#8c8477] hover:border-[#7a6952] hover:text-[#d8c9ad]',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full transition-all',
              linkBrowToHair ? 'bg-[#eac87f] shadow-[0_0_5px_#eac87f]' : 'bg-[#8c8477]/40',
            )}
          />
          <span>{linkBrowToHair ? 'LINKED TO HAIR' : 'CUSTOM COLOR'}</span>
        </button>
      }
    >
      {/* Synchronization Status Banner */}
      {linkBrowToHair ? (
        <div className="flex items-center justify-between border border-[#eac87f]/25 bg-[#d4b483]/10 px-2 py-1 text-[9px] font-mono text-[#eac87f] shadow-[0_0_8px_rgba(234,200,127,0.06)]">
          <span className="flex items-center gap-1.5">
            <span className="text-[10px]">🔗</span>
            <span>
              SYNCED WITH HAIR (
              {hair.tone && hair.tone.toLowerCase() !== '#ffffff' ? hair.tone.toUpperCase() : 'NATURAL'}
              )
            </span>
          </span>
          <span className="text-[7.5px] tracking-wider text-[#8c8477]">PICK TO CUSTOMIZE</span>
        </div>
      ) : (
        <div className="flex items-center justify-between border border-[#463a2e]/60 bg-black/30 px-2 py-1 text-[9px] font-mono text-[#a89f91]">
          <span className="flex items-center gap-1.5">
            <span className="text-[10px]">✦</span>
            <span>CUSTOM BROW COLOR</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setLinkBrowToHair(true);
              showToast?.('✦ BROW COLOR LINKED TO HAIR');
            }}
            className="text-[7.5px] tracking-wider text-[#eac87f] hover:underline"
          >
            [RESET & LINK]
          </button>
        </div>
      )}

      {/* 2D SV Box, Hue/Tone Bars, 8 Swatches, RGB & HEX */}
      <ColorStudio2D
        color={browColor || '#2B1A0A'}
        onChange={setBrowColor}
        swatches={BROW_SWATCHES}
        swatchCols={8}
      />

      {/* Fine-Tuning Sliders: OPACITY, GLOSS, GLOSSY */}
      <div className="flex flex-col gap-2 pt-0.5">
        <BracketSlider
          label="OPACITY"
          value={browOpacity}
          min={0.05}
          max={1.0}
          step={0.01}
          onChange={setBrowOpacity}
        />
        <BracketSlider
          label="GLOSS"
          value={browGloss}
          min={0.0}
          max={1.0}
          step={0.01}
          onChange={setBrowGloss}
        />
        <BracketSlider
          label="GLOSSY"
          value={browGlossy}
          min={0.0}
          max={1.0}
          step={0.01}
          onChange={setBrowGlossy}
        />
      </div>
    </StudioCard>
  );
}
