'use client';

import { useEffect, useRef, useState } from 'react';
import { useCharacter, type EnbPreset, type FilterPreset, type ToneMappingId } from '@/lib/store';
import { FILTER_PRESETS } from '@/lib/graphics';
import { useRenderStats } from '@/lib/perf';
import { IconCamera, IconEye, IconGear } from '@/components/hud/Icons';
import { RangeRow as SliderRow } from '@/components/hud/HudSlider';
import { cn } from '@/lib/cn';

/**
 * The gutter's graphics panel — ENB, post-processing FX, colour grade and
 * filter presets, moved off the top bar so the header only carries stats and
 * the character name.
 *
 * Authored in the 1024 × 572 HUD metric: the gutter buttons sit at x 20 y 108
 * (26 × 26), the panel at x 51 y 108, 276 wide, and it ends at y ≈ 469, above
 * the footer gradient. While it is open the asset rail underneath is hidden
 * rather than covered.
 */

/** The ENB/ReShade combinations the composer implements — no invented presets. */
const ENB_OPTIONS: Array<{ id: EnbPreset; label: string }> = [
  { id: 'enb', label: 'ENB PALETTE' },
  { id: 'pure', label: 'PURE RESHADE' },
  { id: 'all', label: 'ENB + PURE' },
];

/** The display transforms the scene can apply, in the order they are listed.
 *  Kept here as labels only — `CharacterScene` owns the id → mode mapping. */
const TONE_MAPPING_OPTIONS: Array<{ id: ToneMappingId; label: string }> = [
  { id: 'neutral', label: 'NEUTRAL (PBR)' },
  { id: 'agx', label: 'AGX' },
  { id: 'aces', label: 'ACES FILMIC' },
  { id: 'cineon', label: 'CINEON' },
];

const FX_CHIPS: Array<{ key: 'smaa' | 'bloom' | 'dof' | 'vignette' | 'grain'; label: string }> = [
  { key: 'smaa', label: 'Anti-Aliasing (SMAA)' },
  { key: 'bloom', label: 'Bloom' },
  { key: 'dof', label: 'DOF (Depth of Field)' },
  { key: 'vignette', label: 'Vignette' },
  { key: 'grain', label: 'Film Grain' },
];
function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-[4px]">
      <h3 className="text-[10px] font-normal tracking-[0.13em] text-[#e6dcc8]/92">{children}</h3>
      {sub && (
        <p className="mt-[1px] text-[10px] tracking-[0.12em] text-[#a49a88]/62">{sub}</p>
      )}
    </div>
  );
}

/** Square on/off box used by the ENB toggle and the overlay rows. */
function CheckSquare({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-[9px] w-[9px] shrink-0 items-center justify-center border transition-colors',
        on
          ? 'border-[#d8b273] bg-[#d8b273]/85 text-[#221a10]'
          : 'border-[#9a9181]/55 bg-black/34 text-transparent',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="h-[7px] w-[7px]" aria-hidden>
        <path
          d="M3 8.4l3.1 3.1L13 4.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function GraphicsPanel() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const enbEnabled = useCharacter((s) => s.enbEnabled);
  const enbPreset = useCharacter((s) => s.enbPreset);
  const setEnbEnabled = useCharacter((s) => s.setEnbEnabled);
  const setEnbPreset = useCharacter((s) => s.setEnbPreset);

  const fx = useCharacter((s) => s.fx);
  const toggleFx = useCharacter((s) => s.toggleFx);

  const grade = useCharacter((s) => s.grade);
  const setGrade = useCharacter((s) => s.setGrade);
  const setOverlay = useCharacter((s) => s.setOverlay);

  const skinSss = useCharacter((s) => s.skinSss);
  const setSkinSss = useCharacter((s) => s.setSkinSss);
  const skinGloss = useCharacter((s) => s.skinGloss);
  const setSkinGloss = useCharacter((s) => s.setSkinGloss);
  const skinDetail = useCharacter((s) => s.skinDetail);
  const setSkinDetail = useCharacter((s) => s.setSkinDetail);
  const skinSheen = useCharacter((s) => s.skinSheen);
  const setSkinSheen = useCharacter((s) => s.setSkinSheen);
  const toneMapping = useCharacter((s) => s.toneMapping);
  const setToneMapping = useCharacter((s) => s.setToneMapping);

  const perf = useRenderStats();

  /* Click-away closes the ENB dropdown; a panel this small has no room for an
     invisible hit area swallowing the row beneath it. */
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pickerOpen]);

  return (
    <section
      id="graphics-panel"
      aria-label="Graphics engine and visuals"
      className="flex h-full min-h-0 w-full select-none flex-col overflow-y-auto thin-scroll"
    >
      <header className="sticky top-0 z-10 border-b border-[#d4b483]/16 bg-[#14100b]/96 px-[12px] py-[6px] backdrop-blur-md">
        <h2 className="text-[10px] font-medium tracking-[0.14em] text-[#efe3c8]">
          GRAPHICS ENGINE &amp; VISUALS (ENB/FX)
        </h2>
      </header>

      <div className="flex flex-col gap-[7px] px-[12px] py-[9px]">
        {/* ── ENB ─────────────────────────────────────────────────── */}
            <div>
              <SectionTitle>ENB PRESETS</SectionTitle>
              <div className="flex items-center gap-[6px]">
                {/* Custom dropdown rather than a native <select>: at this
                    font size Chromium draws the option text on the border,
                    and a styled list keeps the HUD's type and spacing. */}
                <div className="relative min-w-0 flex-1" ref={pickerRef}>
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={pickerOpen}
                    aria-label="ENB preset"
                    className="flex h-[17px] w-full items-center justify-between border border-[#d4b483]/40 bg-black/36 px-[5px] text-[10px] tracking-[0.1em] text-[#e8dcc2] transition-colors hover:border-[#d4b483]/62 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80"
                  >
                    {/* The mockup carries the on/off state inside the picker
                        rather than beside it, so the toggle beside it can stay
                        a plain checkbox label. */}
                    <span className="flex min-w-0 flex-1 items-center gap-[4px]">
                      <span className="truncate">
                        {ENB_OPTIONS.find((o) => o.id === enbPreset)?.label}
                      </span>
                      <span
                        className={cn(
                          'ml-auto flex shrink-0 items-center gap-[3px] text-[10px] tracking-[0.08em]',
                          enbEnabled ? 'text-[#eac87f]' : 'text-[#8e8574]',
                        )}
                      >
                        <span
                          className={cn(
                            'h-[3px] w-[3px] rounded-full',
                            enbEnabled
                              ? 'bg-[#eac87f] shadow-[0_0_5px_rgba(234,200,127,0.75)]'
                              : 'bg-[#8e8574]',
                          )}
                        />
                        {enbEnabled ? 'ON' : 'OFF'}
                      </span>
                    </span>
                    <svg
                      viewBox="0 0 16 16"
                      className={cn(
                        'ml-[3px] h-[7px] w-[7px] shrink-0 text-[#c9b184]/80 transition-transform',
                        pickerOpen && 'rotate-180',
                      )}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M4 6.2L8 10l4-3.8" />
                    </svg>
                  </button>
                  {pickerOpen && (
                    <ul
                      role="listbox"
                      aria-label="ENB presets"
                      className="absolute left-0 right-0 top-[19px] z-20 flex flex-col border border-[#d4b483]/45 bg-[#0d0b08]/97 py-[2px] shadow-[0_10px_24px_rgba(0,0,0,0.6)]"
                    >
                      {ENB_OPTIONS.map((o) => (
                        <li key={o.id} role="option" aria-selected={o.id === enbPreset}>
                          <button
                            type="button"
                            onClick={() => {
                              setEnbPreset(o.id);
                              setPickerOpen(false);
                            }}
                            className={cn(
                              'flex h-[15px] w-full items-center px-[6px] text-left text-[10px] tracking-[0.1em] transition-colors',
                              o.id === enbPreset
                                ? 'bg-[#d4b483]/14 text-[#f2e7cf]'
                                : 'text-[#c8bfae]/82 hover:bg-[#d4b483]/[0.08] hover:text-[#eee4cf]',
                            )}
                          >
                            {o.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEnbEnabled(!enbEnabled)}
                  aria-pressed={enbEnabled}
                  title="Turn the ENB / ReShade pass on or off"
                  className="flex h-[18px] shrink-0 items-center gap-[4px] px-[2px] text-[10px] tracking-[0.09em] text-[#d9cfba]/88 transition-colors hover:text-[#f2e7cf]"
                >
                  <CheckSquare on={enbEnabled} />
                  <span>Toggle ENB</span>
                </button>
              </div>

              {/* Native <select> on purpose: the tone-mapping list is the one
                  control here a screen reader has to announce as a real choice,
                  and the HUD's custom listbox would have to re-implement
                  arrow-key roving and typeahead to match it. */}
              <label className="mt-[5px] flex items-center gap-[6px]">
                <span className="w-[132px] shrink-0 text-[10px] tracking-[0.1em] text-[#cfc6b4]/88">
                  TONE MAPPING
                </span>
                <select
                  value={toneMapping}
                  onChange={(e) => setToneMapping(e.target.value as ToneMappingId)}
                  aria-label="Tone mapping"
                  className="h-[18px] min-w-0 flex-1 border border-[#d4b483]/40 bg-black/36 px-[4px] text-[10px] tracking-[0.08em] text-[#e8dcc2] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80"
                >
                  {TONE_MAPPING_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>

              <div className="mt-[3px] flex flex-col">
                <SliderRow
                  label="CONTRAST"
                  value={grade.contrast}
                  min={-100}
                  max={100}
                  onChange={(contrast) => setGrade({ contrast })}
                  ariaLabel="Contrast"
                />
                <SliderRow
                  label="COLOR SATURATION"
                  value={grade.saturation}
                  min={-100}
                  max={100}
                  onChange={(saturation) => setGrade({ saturation })}
                  ariaLabel="Color saturation"
                />
                <SliderRow
                  label="AMBIENT LIGHT"
                  value={grade.ambient}
                  min={-10}
                  max={10}
                  onChange={(ambient) => setGrade({ ambient })}
                  ariaLabel="Ambient light"
                />
                <SliderRow
                  label="SKIN GLOSS"
                  value={skinGloss}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={setSkinGloss}
                  ariaLabel="Skin gloss"
                  format={(v) => v.toFixed(2)}
                />
                <SliderRow
                  label="SKIN DETAIL"
                  value={skinDetail}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={setSkinDetail}
                  ariaLabel="Skin detail"
                  format={(v) => v.toFixed(2)}
                />
                <SliderRow
                  label="SKIN SHEEN"
                  value={skinSheen}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={setSkinSheen}
                  ariaLabel="Skin sheen"
                  format={(v) => v.toFixed(2)}
                />
                <button
                  type="button"
                  onClick={() => setSkinSss(skinSss > 0 ? 0 : 1)}
                  aria-pressed={skinSss > 0}
                  title="Sub-surface scattering on the skin shader"
                  className="flex h-[14px] items-center justify-between text-[10px] tracking-[0.1em] text-[#cfc6b4]/88"
                >
                  <span>SUB-SURFACE SCATTERING</span>
                  <span className="flex items-center gap-[5px]">
                    <span
                      className={cn(
                        'h-[4px] w-[4px] rounded-full transition-all',
                        skinSss > 0
                          ? 'bg-[#e0b877] shadow-[0_0_6px_#e0b877]'
                          : 'bg-[#8c8477]/40 shadow-none',
                      )}
                    />
                    <span className={skinSss > 0 ? 'text-[#e8dcc2]' : 'text-[#9a9181]/60'}>SSS</span>
                  </span>
                </button>
              </div>
            </div>

            <div className="hud-divider" />

            {/* ── post-processing ─────────────────────────────────────── */}
            <div>
              <SectionTitle sub="CAMERA &amp; SCREEN OVERLAYS">POST-PROCESSING FX</SectionTitle>
              <div className="grid grid-cols-2 gap-[4px]">
                {FX_CHIPS.slice(0, 4).map(({ key, label }) => {
                  const on = fx[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleFx(key)}
                      aria-pressed={on}
                      title={`${label}: ${on ? 'on' : 'off'}`}
                      className={cn(
                        'flex h-[17px] items-center justify-between border px-[5px] text-[10px] tracking-[0.08em] transition-all duration-150',
                        on
                          ? 'border-[#d4b483]/52 bg-[#d4b483]/[0.09] text-[#f0e3c6]'
                          : 'border-[#8c8477]/28 bg-black/30 text-[#a9a192]/72 hover:border-[#d4b483]/45 hover:text-[#e4dbc9]',
                      )}
                    >
                      <span className="truncate">[ {label} ]</span>
                      <span
                        className={cn(
                          'ml-[3px] h-[4px] w-[4px] shrink-0 rounded-full transition-all',
                          on
                            ? 'bg-[#e0b877] shadow-[0_0_6px_#e0b877]'
                            : 'bg-[#8c8477]/35 shadow-none',
                        )}
                      />
                    </button>
                  );
                })}
                {/* Motion blur is listed because the mockup lists it, but
                    postprocessing 6.39.6 ships no such effect and the composer
                    has no velocity buffer. A disabled chip is the honest state;
                    rendering a fake accumulation pass would not be. */}
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title="Not available: postprocessing has no motion-blur effect and the composer exposes no velocity buffer"
                  className="flex h-[17px] cursor-not-allowed items-center justify-between border border-[#8c8477]/20 bg-black/20 px-[5px] text-[10px] tracking-[0.08em] text-[#8c8477]/45"
                >
                  <span className="truncate">[ Motion Blur ]</span>
                  <span className="ml-[3px] shrink-0">N/A</span>
                </button>
              </div>
            </div>

            <div className="hud-divider" />

            {/* ── filters + overlays ───────────────────────────────────── */}
            <div>
              <SectionTitle sub="COLORS + FILTER OVERLAYS">RE-SHADE / FILTERS</SectionTitle>
              <div className="flex items-start gap-[7px]">
                {/* overlay rows: enable, tint, strength, reset */}
                <div className="flex w-[106px] shrink-0 flex-col gap-[4px]">
                  {grade.overlays.map((overlay, i) => (
                    <div key={i} className="flex items-center gap-[4px]">
                      <button
                        type="button"
                        onClick={() => setOverlay(i as 0 | 1 | 2, { enabled: !overlay.enabled })}
                        aria-pressed={overlay.enabled}
                        aria-label={`Overlay ${i + 1} enabled`}
                        className="shrink-0"
                      >
                        <CheckSquare on={overlay.enabled} />
                      </button>
                      <input
                        type="color"
                        value={overlay.color}
                        onChange={(e) => setOverlay(i as 0 | 1 | 2, { color: e.target.value })}
                        aria-label={`Overlay ${i + 1} colour`}
                        title="Tint colour"
                        className="h-[10px] w-[15px] shrink-0 cursor-pointer border border-[#8c8477]/40 bg-transparent p-0"
                      />
                      <input
                        type="range"
                        min={-100}
                        max={100}
                        step={1}
                        value={overlay.amount}
                        onChange={(e) => setOverlay(i as 0 | 1 | 2, { amount: Number(e.target.value) })}
                        aria-label={`Overlay ${i + 1} strength`}
                        className="hud-range hud-range-tint h-[9px] min-w-0 flex-1"
                        style={{
                          ['--pct' as string]: `${((overlay.amount + 100) / 200) * 100}%`,
                          ['--tint' as string]: overlay.color,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setOverlay(i as 0 | 1 | 2, { amount: 0, enabled: false })}
                        aria-label={`Reset overlay ${i + 1}`}
                        title="Reset this overlay"
                        className="flex h-[11px] w-[11px] shrink-0 items-center justify-center border border-[#8c8477]/35 text-[10px] leading-none text-[#a9a192]/70 transition-colors hover:border-[#d4b483]/55 hover:text-[#e8dcc2]"
                      >
                        –
                      </button>
                    </div>
                  ))}
                </div>

                {/* filter presets: CSS swatches, labelled as presets, not shots */}
                <div className="grid min-w-0 flex-1 grid-cols-4 gap-[3px]">
                  {FILTER_PRESETS.map((preset) => {
                    const active = grade.filter === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setGrade({ filter: preset.id as FilterPreset })}
                        aria-pressed={active}
                        title={`Filter preset: ${preset.label}`}
                        className="group flex min-w-0 flex-col items-stretch gap-[2px]"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'block h-[24px] w-full border transition-all duration-150',
                            active
                              ? 'border-[#e0c48d] shadow-[0_0_8px_rgba(224,196,141,0.35)]'
                              : 'border-[#8c8477]/30 group-hover:border-[#d4b483]/55',
                          )}
                          style={{ backgroundImage: preset.swatch }}
                        />
                        <span
                          className={cn(
                            'truncate text-center text-[10px] tracking-[0.06em] transition-colors',
                            active ? 'text-[#e8dcc2]' : 'text-[#a49a88]/72 group-hover:text-[#d5ccbb]',
                          )}
                        >
                          {preset.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="hud-divider" />

            {/* ── real renderer counters ─────────────────────────────────
                WebGL reports draw counts, never GPU memory, so VRAM is
                labelled unavailable instead of printing a fabricated total
                the way the mockup's placeholder does. */}
            <div
              className="num flex flex-col gap-[1px] pb-[1px] text-[10px] tracking-[0.06em] text-[#a49a88]/78"
              title="Live renderer counters. WebGL does not expose GPU memory, so no VRAM figure can be shown."
            >
              <span>
                FPS {perf.fps || '—'} · CALLS {perf.calls || '—'} · TRIS{' '}
                {perf.tris ? perf.tris.toLocaleString('en-US') : '—'} · TEX {perf.textures || '—'}
              </span>
              <span className="text-[#8f8778]/55">VRAM N/A — not exposed by WebGL</span>
            </div>
      </div>
    </section>
  );
}
