'use client';

import { useEffect, useRef } from 'react';
import { useCharacter } from '@/lib/store';
import { HAIR_TONES } from '@/lib/hair/settings';
import { HudSlider } from '@/components/hud/HudSlider';
import { cn } from '@/lib/cn';

export function HairController() {
  const hair = useCharacter((s) => s.hair);
  const setHair = useCharacter((s) => s.setHair);
  const hairTab = useCharacter((s) => s.hairTab);
  const selection = useCharacter((s) => s.assetSelection);
  const catalogue = useCharacter((s) => s.assetCatalogues.hairMesh);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    root.current?.querySelector(hairTab === 'GLOSS' ? '#hair-gloss' : '#hair-color')?.scrollIntoView({ block: 'nearest' });
  }, [hairTab]);

  const mesh = catalogue?.find((m) => m.id === selection.hairMesh);

  return (
    <aside ref={root} className="pointer-events-auto w-full select-none p-3 hud-fade">
      <div className="mb-[12px] border-b border-[#d4b483]/20 pb-[6px]">
        <h3 className="text-[10px] font-medium tracking-[0.14em] text-[#d8c39c] uppercase">HAIR PROPERTIES</h3>
      </div>

      <div className="mb-[14px] border border-[#d4b483]/20 bg-[#0c0b09]/50 p-[8px]">
        <h4 className="text-[10px] font-medium tracking-[0.12em] text-[#d8c9ad]">ACTIVE MESH</h4>
        <p className="mt-[3px] truncate text-[10px] font-medium text-[#c9b184]">{mesh?.label ?? 'Default Hair'}</p>
        <p className="mt-[3px] text-[10px] leading-[1.5] text-[#a9a192]/70">Authored geometry preserved. Switch mesh in ASSETS or Left Panel.</p>
      </div>

      <section id="hair-color" className="mb-[16px]">
        <div className="mb-[6px] flex items-baseline justify-between">
          <h4 className="text-[10px] font-medium tracking-[0.12em] text-[#d8c9ad]">HAIR TINT</h4>
          <span className="num text-[10px] uppercase text-[#c9b184]">{hair.tone}</span>
        </div>
        <div className="mb-[8px] grid grid-cols-8 gap-[3px]" role="group" aria-label="Hair tint">
          {HAIR_TONES.map((tone, i) => (
            <button
              key={tone}
              type="button"
              onClick={() => setHair({ tone })}
              aria-label={`Hair tone ${i + 1}, ${tone}`}
              aria-pressed={hair.tone === tone}
              className={cn(
                'h-[20px] rounded-xs border transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]',
                hair.tone === tone
                  ? 'border-[#f0d9a8] ring-1 ring-[#f0d9a8]/50 shadow-[0_0_8px_rgba(240,217,168,0.3)]'
                  : 'border-[#d4b483]/25',
              )}
              style={{ background: tone }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setHair({ tone: '#ffffff' })}
          aria-pressed={hair.tone === '#ffffff'}
          className={cn(
            'mb-[6px] w-full border px-[6px] py-[4px] text-[10px] tracking-[0.08em] transition-colors',
            hair.tone === '#ffffff'
              ? 'border-[#d4b483]/70 bg-[#d4b483]/14 text-[#f0e6d4]'
              : 'border-[#d4b483]/30 text-[#d8c9ad]/80 hover:border-[#d4b483]/55 hover:text-[#f0e6d4]',
          )}
        >
          ORIGINAL ATLAS COLOR
        </button>
        <p className="text-[10px] leading-[1.5] text-[#a9a192]/65">Tint multiplies diffuse texture; dark hair atlases cannot be lightened.</p>
      </section>

      <section id="hair-gloss">
        <HudSlider
          label="HAIR GLOSS"
          min={0}
          max={1}
          step={0.01}
          value={hair.gloss}
          display={hair.gloss.toFixed(2)}
          onChange={(gloss) => setHair({ gloss })}
          bracketed
        />
      </section>
    </aside>
  );
}
