'use client';

import React, { useState } from 'react';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { ColorStudio2D, type ColorSwatchItem } from '@/components/hud/common/ColorStudio2D';

const EYE_SWATCHES: ColorSwatchItem[] = [
  { name: 'Sapphire Blue', hex: '#1e4b8a' },
  { name: 'Emerald Green', hex: '#1b663e' },
  { name: 'Amber Gold', hex: '#8a651e' },
  { name: 'Deep Hazel', hex: '#5c4326' },
  { name: 'Amethyst Violet', hex: '#582b7b' },
  { name: 'Crimson Red', hex: '#7b1e22' },
  { name: 'Obsidian Black', hex: '#151515' },
  { name: 'Silver Ice', hex: '#7a8b99' },
];

interface EyePropertiesProps {
  onClose?: () => void;
}

export function EyeProperties({ onClose }: EyePropertiesProps) {
  const [color, setColor] = useState('#1e4b8a');
  const [gloss, setGloss] = useState(0.85);
  const [luminosity, setLuminosity] = useState(0.25);
  const [sclera, setSclera] = useState(0.9);

  return (
    <StudioCard
      title="EYE COLOR & PROPERTIES"
      badge="IRIS & GLOW"
      onClose={onClose}
      footerLeading={<span>+ COR · UBE · IRIS PBR</span>}
      footerTrailing={<span>SPECULAR ACTIVE</span>}
      showSparkle
    >
      <div className="flex flex-col gap-3 pt-0.5">
        {/* Color Studio 2D */}
        <ColorStudio2D
          color={color}
          onChange={setColor}
          swatches={EYE_SWATCHES}
        />

        {/* Sliders */}
        <div className="flex flex-col gap-2.5 pt-1 border-t border-[#463a2e]/40">
          <BracketSlider
            label="GLOSS & WETNESS"
            min={0}
            max={1}
            step={0.01}
            value={gloss}
            display={`${Math.round(gloss * 100)}%`}
            onChange={setGloss}
          />

          <BracketSlider
            label="IRIS LUMINOSITY"
            min={0}
            max={1}
            step={0.01}
            value={luminosity}
            display={`${Math.round(luminosity * 100)}%`}
            onChange={setLuminosity}
          />

          <BracketSlider
            label="SCLERA BRIGHTNESS"
            min={0}
            max={1}
            step={0.01}
            value={sclera}
            display={`${Math.round(sclera * 100)}%`}
            onChange={setSclera}
          />
        </div>
      </div>
    </StudioCard>
  );
}
