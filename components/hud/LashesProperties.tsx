'use client';

import { useCharacter } from '@/lib/store';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { cn } from '@/lib/cn';

/** Six ink tones, in the order lash tint reads: darkest first. */
export const LASH_INK_SWATCHES: Array<{ name: string; hex: string }> = [
  { name: 'Ink Black', hex: '#1a1412' },
  { name: 'Soft Black', hex: '#241d19' },
  { name: 'Espresso', hex: '#2c231e' },
  { name: 'Dark Brown', hex: '#3a2b21' },
  { name: 'Chestnut', hex: '#4a3527' },
  { name: 'Auburn', hex: '#5a3327' },
];

export function LashesProperties() {
  const lashesColor = useCharacter((s) => s.lashesColor);
  const setLashesColor = useCharacter((s) => s.setLashesColor);
  const lashesOpacity = useCharacter((s) => s.lashesOpacity);
  const setLashesOpacity = useCharacter((s) => s.setLashesOpacity);

  return (
    <StudioCard
      title="LASH COLOR & PROPERTIES"
      showSparkle
      badge={`${Math.round(lashesOpacity * 100)}%`}
    >
      <div className="flex flex-col gap-3 pt-1">
        <div className="flex items-center justify-between text-[10px] font-mono tracking-wider text-[#b8ab97]">
          <span>TINT COLOR</span>
          <div className="flex items-center gap-1.5">
            <input
              aria-label="Lash color"
              type="color"
              value={lashesColor}
              onChange={(event) => setLashesColor(event.target.value)}
              className="h-4 w-7 cursor-pointer rounded-xs border border-[#d4b483]/40 bg-transparent p-0"
            />
            <span className="text-[9.5px] text-[#eac87f] font-mono uppercase">{lashesColor}</span>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-1">
          {LASH_INK_SWATCHES.map((swatch) => {
            const isActive = lashesColor.toLowerCase() === swatch.hex.toLowerCase();
            return (
              <button
                key={swatch.hex}
                type="button"
                aria-label={swatch.name}
                aria-pressed={isActive}
                title={`${swatch.name} (${swatch.hex})`}
                onClick={() => setLashesColor(swatch.hex)}
                className={cn(
                  'aspect-square rounded-[1px] border transition-transform hover:scale-110',
                  isActive ? 'border-[#f0dfbe] ring-1 ring-[#eac87f]' : 'border-[#d4b483]/25',
                )}
                style={{ backgroundColor: swatch.hex }}
              />
            );
          })}
        </div>

        <BracketSlider
          label="OPACITY"
          value={lashesOpacity}
          min={0}
          max={1}
          step={0.01}
          onChange={setLashesOpacity}
        />
      </div>
    </StudioCard>
  );
}
