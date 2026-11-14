'use client';

import { useCharacter } from '@/lib/store';
import { SLIDER_DEFS, REGIONS_BY_ID, REGIONS, type TransformMode } from '@/lib/regions';
import { IconCheck, IconMove, IconRotate, IconScale, IconSparkle } from '@/components/hud/Icons';
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

export function RightPanel({ manifest: _manifest = null }: RightPanelProps) {
  const mode = useCharacter((s) => s.transformMode);
  const setMode = useCharacter((s) => s.setTransformMode);
  const activeRegion = useCharacter((s) => s.activeRegion);
  const setActiveRegion = useCharacter((s) => s.setActiveRegion);
  const bisymmetry = useCharacter((s) => s.bisymmetry);
  const setBisymmetry = useCharacter((s) => s.setBisymmetry);
  const asymmetry = useCharacter((s) => s.asymmetry);
  const setAsymmetry = useCharacter((s) => s.setAsymmetry);

  const sliders = useCharacter((s) => s.sliders[s.activeRegion]);
  const setSlider = useCharacter((s) => s.setSlider);
  const setActiveSlider = useCharacter((s) => s.setActiveSlider);

  const region = REGIONS_BY_ID[activeRegion];
  const axisSliders = SLIDER_DEFS.filter((s) => s.style === 'axis');
  const morphSliders = SLIDER_DEFS.filter((s) => s.style === 'morph');

  return (
    <div className="pointer-events-auto w-full select-none p-3 hud-fade">
      <div className="mb-[12px] border-b border-[#d4b483]/20 pb-[6px]">
        <h3 className="text-[10px] font-medium tracking-[0.14em] text-[#d8c39c] uppercase font-mono">
          3D FACE SCULPT CONTROLLER
        </h3>
      </div>

      {/* ── Facial Region Selection ─────────────────────────────────── */}
      <div className="mb-[12px] border border-[#d4b483]/22 bg-black/40 p-2">
        <div className="mb-[6px] flex items-center justify-between text-[10px] font-mono tracking-wider text-[#d8c39c]">
          <span>SELECT REGION:</span>
          <span className="text-[#eac87f]">[{region?.label ?? activeRegion.toUpperCase()}]</span>
        </div>
        <div className="grid grid-cols-3 gap-[4px]">
          {REGIONS.map((r) => {
            const isSelected = activeRegion === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveRegion(r.id)}
                className={cn(
                  'border py-[4px] px-[2px] text-center text-[9.5px] font-mono tracking-wider transition-colors',
                  isSelected
                    ? 'border-[#eac87f] bg-[#d4b483]/20 font-medium text-[#f0dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                    : 'border-[#d4b483]/22 bg-black/30 text-[#a9a192] hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {/* Symmetry Toggles */}
        <div className="mt-[8px] flex items-center gap-[14px] pt-1.5 border-t border-[#d4b483]/15 text-[9.5px] font-mono">
          <button
            type="button"
            onClick={() => setBisymmetry(!bisymmetry)}
            className="flex items-center gap-1.5"
          >
            <span
              className={cn(
                'flex h-[10px] w-[10px] items-center justify-center border',
                bisymmetry ? 'border-[#eac87f] bg-[#d4b483] text-black' : 'border-[#d4b483]/30 bg-black/40',
              )}
            >
              {bisymmetry && <IconCheck className="h-[7px] w-[7px]" />}
            </span>
            <span className={bisymmetry ? 'text-[#e8d4af]' : 'text-[#8f8778]'}>Bisymmetry</span>
          </button>

          <button
            type="button"
            onClick={() => setAsymmetry(!asymmetry)}
            className="flex items-center gap-1.5"
          >
            <span
              className={cn(
                'flex h-[10px] w-[10px] items-center justify-center border',
                asymmetry ? 'border-[#eac87f] bg-[#d4b483] text-black' : 'border-[#d4b483]/30 bg-black/40',
              )}
            >
              {asymmetry && <IconCheck className="h-[7px] w-[7px]" />}
            </span>
            <span className={asymmetry ? 'text-[#e8d4af]' : 'text-[#8f8778]'}>Asymmetry</span>
          </button>
        </div>
      </div>

      {/* ── Transform Mode Tabs (MOVE / ROTATE / SCALE) ──────────────── */}
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
                'relative flex h-[34px] flex-1 items-center justify-center gap-[4px] border px-[4px] transition-all duration-200 font-mono',
                active
                  ? 'border-[#d8b273]/85 bg-[#d4b483]/[0.12] text-[#f2e4c8] shadow-[0_0_12px_rgba(216,178,115,0.25)]'
                  : 'border-[#d4b483]/26 bg-black/32 text-[#b6aea0]/78 hover:border-[#d4b483]/52 hover:text-[#e4dbc9]',
              )}
            >
              <Icon className={cn('h-[9px] w-[9px] shrink-0', active ? 'opacity-90' : 'opacity-55')} />
              <span className="whitespace-nowrap text-[9.5px] tracking-[0.1em]">
                [{label}]
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Slider Stack ─────────────────────────────────────────── */}
      <div className="relative mt-[14px] pl-[1px] pr-[6px]">
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

        <div className="hud-divider my-[12px] ml-[-1px] mr-[6px]" />

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
          <IconSparkle className="h-[14px] w-[14px] text-[#cfc0a2]/42" />
        </div>
      </div>

      <p className="mt-[10px] whitespace-nowrap pl-[1px] text-[9.5px] font-mono tracking-[0.13em] text-[#8b8375]/52">
        {region.short} · {region.bone} · RACEMENU MORPH
      </p>
    </div>
  );
}
