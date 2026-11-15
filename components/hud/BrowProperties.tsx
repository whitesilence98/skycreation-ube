'use client';

import React from 'react';
import { useCharacter } from '@/lib/store';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { ColorStudio2D, type ColorSwatchItem } from '@/components/hud/common/ColorStudio2D';

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

  return (
    <StudioCard title="BROW COLOR & PROPERTIES" showSparkle>
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
