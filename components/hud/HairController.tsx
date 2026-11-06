'use client';

import { useEffect, useRef } from 'react';
import { useCharacter } from '@/lib/store';
import { HAIR_TONES } from '@/lib/hair/settings';
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
    <aside ref={root} className="pointer-events-auto absolute right-[37px] top-[103px] z-20 w-[214px] select-none hud-fade">
      <h2 className="mb-[7px] text-[9px] tracking-[0.13em] text-[#e2d8c6]">CUSTOMIZATION CONTROLLER</h2>
      <div className="mb-[14px] border-y border-[#d4b483]/25 py-[8px]">
        <h3 className="text-[8px] tracking-[0.12em] text-[#d8c9ad]">MO2 HAIR MESH</h3>
        <p className="mt-[5px] text-[8px] text-[#c9b184]">{mesh?.label ?? 'hair01'}</p>
        <p className="mt-[5px] text-[7px] leading-[1.6] text-[#a9a192]">Premade shape preserved. Choose a different mesh for length, bangs or curls.</p>
      </div>
      <section id="hair-color">
        <h3 className="mb-[8px] text-[8px] tracking-[0.14em] text-[#d8c9ad]">HAIR COLOR</h3>
        <div className="mb-[8px] grid grid-cols-8 gap-[3px]" role="group" aria-label="Hair tint">
          {HAIR_TONES.map((tone, i) => (
            <button key={tone} type="button" onClick={() => setHair({ tone })} aria-label={`Hair tone ${i + 1}, ${tone}`} aria-pressed={hair.tone === tone} className={cn('h-[20px] border', hair.tone === tone ? 'border-[#f0d9a8] ring-1 ring-[#f0d9a8]/40' : 'border-[#d4b483]/25')} style={{ background: tone }} />
          ))}
        </div>
        <button type="button" onClick={() => setHair({ tone: '#ffffff' })} aria-pressed={hair.tone === '#ffffff'} className="mb-[8px] border border-[#d4b483]/30 px-[6px] py-[3px] text-[7px] text-[#d8c9ad]">ORIGINAL ATLAS COLOR</button>
        <p className="text-[7px] leading-[1.6] text-[#a9a192]">Tint multiplies the original texture; dark atlases cannot be lightened.</p>
      </section>
      <section id="hair-gloss" className="mt-[15px]">
        <label htmlFor="hair-gloss-input" className="mb-[5px] flex justify-between text-[8px] tracking-[0.12em] text-[#d8c9ad]">GLOSS <span>{hair.gloss.toFixed(2)}</span></label>
        <input id="hair-gloss-input" type="range" min="0" max="1" step="0.01" value={hair.gloss} onChange={(e) => setHair({ gloss: Number(e.target.value) })} className="hud-range" style={{ ['--pct' as string]: `${hair.gloss * 100}%` }} />
      </section>
    </aside>
  );
}
