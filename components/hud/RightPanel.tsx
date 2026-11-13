'use client';

import { useCharacter } from '@/lib/store';
import { SLIDER_DEFS, REGIONS_BY_ID, type TransformMode } from '@/lib/regions';
import { IconMove, IconRotate, IconScale, IconSparkle } from '@/components/hud/Icons';
import { HairController } from '@/components/hud/HairController';
import { MakeupProperties } from '@/components/hud/MakeupProperties';
import { BodyProperties } from '@/components/hud/BodyProperties';
import { HudSlider as Slider } from '@/components/hud/HudSlider';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

const MODES: Array<{ id: TransformMode; label: string; Icon: (p: { className?: string }) => React.JSX.Element }> = [
  { id: 'translate', label: 'MOVE', Icon: IconMove },
  { id: 'rotate', label: 'ROTATE', Icon: IconRotate },
  { id: 'scale', label: 'SCALE', Icon: IconScale },
];

interface RightPanelProps {
  manifest?: Mo2Manifest | null;
}

export function RightPanel({ manifest = null }: RightPanelProps) {
  const mode = useCharacter((s) => s.transformMode);
  const setMode = useCharacter((s) => s.setTransformMode);
  const activeRegion = useCharacter((s) => s.activeRegion);
  /* The controller edits the sculpt, so it belongs to FACE SHAPE alone. On
     FACE the rail was still offering MOVE/ROTATE sliders for a region the
     tab lists no assets for, which read as two competing sections. */
  const primaryTab = useCharacter((s) => s.primaryTab);
  const subTab = useCharacter((s) => s.subTab);
  const sliders = useCharacter((s) => s.sliders[s.activeRegion]);
  const setSlider = useCharacter((s) => s.setSlider);
  const setActiveSlider = useCharacter((s) => s.setActiveSlider);

  const region = REGIONS_BY_ID[activeRegion];
  const axisSliders = SLIDER_DEFS.filter((s) => s.style === 'axis');
  const morphSliders = SLIDER_DEFS.filter((s) => s.style === 'morph');

  /* HAIR owns its own controller rail (and the length ruler beside it); the
     sculpt controller is a different tool for a different tab. */
  if (primaryTab === 'HAIR') return <HairController />;
  if (primaryTab === 'FACE' && subTab === 'MAKEUP') return <MakeupProperties />;
  if (primaryTab === 'BODY') return <BodyProperties manifest={manifest} />;
  if (primaryTab !== 'FACE SHAPE') return null;

  return (
    /* Fluid rail body: the owning aside supplies the dock and scroll, so this
       column only handles its own padding and width. */
    <div className="pointer-events-auto w-full select-none p-3 hud-fade">
      <div className="mb-[12px] border-b border-[#d4b483]/20 pb-[6px]">
        <h3 className="text-[10px] font-medium tracking-[0.14em] text-[#d8c39c] uppercase">SCULPT CONTROLLER</h3>
      </div>

      {/* ── transform tabs ────────────────────────────────────────── */}
      <div className="flex items-stretch gap-[5px]">
        {MODES.map(({ id, label, Icon }) => {
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={active}
              className={cn(
                'relative flex h-[36px] flex-1 items-center justify-center gap-[4px] border px-[4px] transition-all duration-200',
                active
                  ? 'border-[#d8b273]/85 bg-[#d4b483]/[0.09] text-[#f2e4c8] shadow-[0_0_14px_rgba(216,178,115,0.22),inset_0_0_12px_rgba(216,178,115,0.06)]'
                  : 'border-[#d4b483]/26 bg-black/32 text-[#b6aea0]/78 hover:border-[#d4b483]/52 hover:text-[#e4dbc9]',
              )}
            >
              <Icon className={cn('h-[9px] w-[9px] shrink-0', active ? 'opacity-90' : 'opacity-55')} />
              <span className="whitespace-nowrap text-[10px] tracking-[0.1em]">
                [ {label} ]
              </span>
              {active && (
                <>
                  <span className="pointer-events-none absolute -right-[1px] -top-[1px] h-[2px] w-[2px] rounded-full bg-[#f0d9a8] shadow-[0_0_4px_rgba(240,217,168,0.9)]" />
                  <span className="absolute -bottom-[7px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#e8c98e] shadow-[0_0_6px_rgba(232,201,142,0.8)]" />
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* ── slider stack ─────────────────────────────────────────── */}
      {/* Reference pitch, measured off the rails in reference.png: tracks at
          y 278, 320, (divider) 380, 421, 462, 503 — a 42 px rhythm with a
          60 px gap across the divider. The earlier 57 px pitch pushed
          PROTRUSION below the frame entirely. */}
      <div className="relative mt-[50px] pl-[1px] pr-[6px]">
        {/* scroll indicator — reference runs y 194 → 334, x ≈ 987 */}
        <div className="hud-scrollbar absolute -right-[8px] top-[2px] h-[140px]" aria-hidden />

        {axisSliders.map((s) => (
          <Slider
            key={s.id}
            label={s.label}
            suffix={s.axis ? `(${s.axis}-axis)` : undefined}
            value={sliders[s.id]}
            min={s.min}
            max={s.max}
            step={s.step}
            display={s.format(sliders[s.id])}
            onChange={(v) => setSlider(s.id, v)}
            onActiveChange={(on) => setActiveSlider(on ? s.id : null)}
            bracketed
          />
        ))}

        <div className="hud-divider my-[15.25px] ml-[-1px] mr-[6px]" />

        {morphSliders.map((s) => (
          <Slider
            key={s.id}
            label={s.label}
            value={sliders[s.id]}
            min={s.min}
            max={s.max}
            step={s.step}
            display={s.format(sliders[s.id])}
            onChange={(v) => setSlider(s.id, v)}
            onActiveChange={(on) => setActiveSlider(on ? s.id : null)}
            bracketed={false}
          />
        ))}

        <div className="mt-[4px] flex justify-end pr-[4px]">
          <IconSparkle className="h-[17px] w-[17px] text-[#cfc0a2]/42" />
        </div>
      </div>

      <p className="mt-[10px] whitespace-nowrap pl-[1px] text-[10px] tracking-[0.13em] text-[#8b8375]/52">
        {region.short} · {region.bone} · RACEMENU MORPH
      </p>
    </div>
  );
}
