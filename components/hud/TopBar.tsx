'use client';

import { useCharacter, type PostFxMode } from '@/lib/store';
import { ENV_CONFIG } from '@/components/scene/environments';
import { HAIR_TABS } from '@/lib/hair/settings';
import { cn } from '@/lib/cn';
import type { UiCategory } from '@/lib/manifestSelect';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

/**
 * Primary sections.
 *
 * FACE SHAPE is its own section, not a sub-tab of FACE: it is the slider
 * controller over the sculpt, while FACE is the MO2 browser for the textures
 * that skin it. Sharing one tab meant clicking SKIN silently replaced the
 * shape controls the user was mid-way through adjusting.
 */
const PRIMARY = ['PRESET', 'HAIR', 'FACE SHAPE', 'FACE', 'BODY', 'VOICE', 'ZODIAC'] as const;
/** Sub-tabs only exist under FACE; they switch which part the panel lists. */
const SECONDARY = ['SKIN', 'EYES', 'LASHES', 'BROWS', 'MOUTH', 'MAKEUP', 'TATTOO', 'WRINKLE'] as const;

/**
 * Which asset category each tab opens in the panel.
 *
 * The sub-tabs were a highlight and nothing else: MAKEUP lit up and the asset
 * panel went on listing skins. BODY, VOICE and ZODIAC have no MO2 category, so
 * they leave the current one alone rather than emptying the panel.
 */
const PRIMARY_CATEGORY: Partial<Record<(typeof PRIMARY)[number], UiCategory>> = {
  PRESET: 'preset',
  HAIR: 'hair',
  'FACE SHAPE': 'headMesh',
  FACE: 'skin',
  BODY: 'body',
};

const SECONDARY_CATEGORY: Record<(typeof SECONDARY)[number], UiCategory> = {
  SKIN: 'skin',
  EYES: 'eyes',
  LASHES: 'lashes',
  BROWS: 'brows',
  MOUTH: 'mouth',
  MAKEUP: 'makeup',
  TATTOO: 'tattoo',
  WRINKLE: 'wrinkle',
};

/** BODY keeps one optional sub-tab: the supplied outfit. */
const BODY_TABS = ['BODY', 'CLOTHING'] as const;
const BODY_CATEGORY: Record<(typeof BODY_TABS)[number], UiCategory> = {
  BODY: 'body',
  CLOTHING: 'clothing',
};

const FX_CONFIG: Record<PostFxMode, { label: string; dot: string; next: PostFxMode }> = {
  all: { label: 'ENB + PURE', dot: 'bg-[#5cd4b4] shadow-[0_0_6px_#5cd4b4]', next: 'enb' },
  enb: { label: 'ENB PALETTE', dot: 'bg-[#d4b483] shadow-[0_0_6px_#d4b483]', next: 'pure' },
  pure: { label: 'PURE RESHADE', dot: 'bg-[#b69bf8] shadow-[0_0_6px_#b69bf8]', next: 'off' },
  off: { label: 'POST-FX: OFF', dot: 'bg-[#8c8477]/40 shadow-none', next: 'all' },
};

export function TopBar({ manifest }: { manifest: Mo2Manifest | null }) {
  /* Whether a `_0`/`_1` pair exists is a property of the pack, not of anything
     the user has selected, so it comes from the manifest — reading the
     catalogue here would leave the control dead until the asset panel had
     been opened on BODY at least once. */
  const hasBodyPair = Boolean(
    (manifest?.assets?.bodyMesh as Array<{ weightVariants?: unknown }> | undefined)
      ?.some((row) => row.weightVariants),
  );
  const name = useCharacter((s) => s.name);
  const setName = useCharacter((s) => s.setName);
  const primaryTab = useCharacter((s) => s.primaryTab);
  const subTab = useCharacter((s) => s.subTab);
  const activeCategory = useCharacter((s) => s.activeCategory);
  const setPrimaryTab = useCharacter((s) => s.setPrimaryTab);
  const setSubTab = useCharacter((s) => s.setSubTab);
  const setActiveCategory = useCharacter((s) => s.setActiveCategory);
  /* Hair keeps its own secondary state: FACE's sub-tabs index the asset
     browser, while these scroll the hair controller. Sharing one field would
     light a hair section from a stale texture category. */
  const hairTab = useCharacter((s) => s.hairTab);
  const setHairTab = useCharacter((s) => s.setHairTab);
  const stats = useCharacter((s) => s.stats);
  const postFxMode = useCharacter((s) => s.postFxMode);
  const setPostFxMode = useCharacter((s) => s.setPostFxMode);
  const envMode = useCharacter((s) => s.envMode);
  const setEnvMode = useCharacter((s) => s.setEnvMode);
  const envRotation = useCharacter((s) => s.envRotation);
  const setEnvRotation = useCharacter((s) => s.setEnvRotation);
  const garmentVisible = useCharacter((s) => s.garmentVisible);
  const setGarmentVisible = useCharacter((s) => s.setGarmentVisible);
  const weight = useCharacter((s) => s.weight);
  const setWeight = useCharacter((s) => s.setWeight);
  const skinGloss = useCharacter((s) => s.skinGloss);
  const setSkinGloss = useCharacter((s) => s.setSkinGloss);

  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 z-30">
      {/* soft top scrim so the title stays legible over the render */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[86px] bg-gradient-to-b from-black/72 via-black/28 to-transparent" />

      {/* Reference: title baseline at y ≈ 39, x 35–190; nav starts x 312. */}
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-6 px-[35px] pt-[22px] pb-2">
        {/* ── left: wordmark ─────────────────────────────────────── */}
        <div className="flex h-[18px] items-center">
          <h1 className="whitespace-nowrap text-[11px] font-normal tracking-[0.075em] text-[#efece6]/92">
            <span className="font-medium">CHARACTER</span>{' '}
            <span className="font-light text-[#e6e2da]/78">CREATION</span>
          </h1>
        </div>

        {/* ── centre: nav stacks ─────────────────────────────────── */}
        <div className="flex flex-col items-center">
          <nav className="flex items-center gap-[7px]" aria-label="Primary">
            {PRIMARY.map((item, i) => {
              const active = primaryTab === item;
              return (
                <div key={item} className="flex items-center gap-[7px]">
                  <button
                    type="button"
                    onClick={() => {
                      setPrimaryTab(item);
                      const kind = PRIMARY_CATEGORY[item];
                      if (kind) setActiveCategory(kind);
                    }}
                    className={cn(
                      'group relative whitespace-nowrap text-[9.5px] tracking-[0.1em] transition-colors duration-200',
                      active
                        ? 'font-medium text-[#e8c691]'
                        : 'font-light text-[#bdb7ab]/70 hover:text-[#e6ddcc]',
                    )}
                  >
                    {item}
                    {active && (
                      <span className="absolute -bottom-[9px] left-1/2 h-[1px] w-[26px] -translate-x-1/2 bg-gradient-to-r from-transparent via-[#d4b483]/85 to-transparent" />
                    )}
                  </button>
                  {i < PRIMARY.length - 1 && (
                    <span className="text-[11px] font-extralight text-[#8c8477]/38">/</span>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Only FACE has texture sub-tabs; FACE SHAPE owns its own rail, so
              the row collapses everywhere else instead of showing a stale
              highlight for a category that tab does not list. */}
          {primaryTab === 'FACE' && (
          <div className="mt-[11px] flex -translate-x-[32px] items-center gap-[6px]">
            {SECONDARY.map((item, i) => {
              const active = subTab === item;
              return (
                <div key={item} className="flex items-center gap-[6px]">
                  {i === 0 && (
                    <span
                      className={cn(
                        'mr-[1px] inline-block h-[3px] w-[3px] rounded-full transition-colors',
                        active ? 'bg-[#d4b483]' : 'bg-[#8c8477]/50',
                      )}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSubTab(item);
                      setActiveCategory(SECONDARY_CATEGORY[item]);
                    }}
                    className={cn(
                      'whitespace-nowrap text-[9px] tracking-[0.11em] transition-colors duration-200',
                      active
                        ? 'font-medium text-[#d8c39c]'
                        : 'font-light text-[#a8a294]/52 hover:text-[#d5cdbd]',
                    )}
                  >
                    {item}
                  </button>
                  {i < SECONDARY.length - 1 && (
                    <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
                  )}
                </div>
              );
            })}
          </div>
          )}

          {/* HAIR's own secondary row. It highlights a scroll target in the
              hair controller rather than picking an asset category, so it is
              deliberately separate from FACE's `subTab`. */}
          {primaryTab === 'BODY' && (
            <div className="mt-[11px] flex items-center gap-[6px]">
              {BODY_TABS.map((item, i) => {
                const active = activeCategory === BODY_CATEGORY[item];
                return (
                  <div key={item} className="flex items-center gap-[6px]">
                    {i === 0 && (
                      <span
                        className={cn(
                          'mr-[1px] inline-block h-[3px] w-[3px] rounded-full transition-colors',
                          active ? 'bg-[#d4b483]' : 'bg-[#8c8477]/50',
                        )}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveCategory(BODY_CATEGORY[item])}
                      aria-pressed={active}
                      className={cn(
                        'whitespace-nowrap text-[9px] tracking-[0.11em] transition-colors duration-200',
                        active
                          ? 'font-medium text-[#d8c39c]'
                          : 'font-light text-[#a8a294]/52 hover:text-[#d5cdbd]',
                      )}
                    >
                      {item}
                    </button>
                    {i < BODY_TABS.length - 1 && (
                      <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
                    )}
                  </div>
                );
              })}
              <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
              {/* Garment and body are separate authored shapes: the toggle
                  hides only the garment, never the embedded body. */}
              <button
                type="button"
                onClick={() => setGarmentVisible(!garmentVisible)}
                aria-pressed={garmentVisible}
                title="Show the outfit's garment shapes"
                className={cn(
                  'whitespace-nowrap border px-[4px] py-[1px] text-[8px] tracking-[0.11em] transition-colors',
                  garmentVisible
                    ? 'border-[#d4b483]/45 bg-[#d4b483]/[0.08] text-[#e8c691]'
                    : 'border-[#8c8477]/30 text-[#a8a294]/52 hover:text-[#d5cdbd]',
                )}
              >
                {garmentVisible ? 'GARMENT ON' : 'GARMENT OFF'}
              </button>
              {/* Body weight, 0–1 — Skyrim's own slider. It only does anything
                  when the pack supplied a `_0`/`_1` pair, so it is shown dimmed
                  and disabled rather than hidden: an absent control reads as a
                  missing feature, a disabled one reads as "this body has no
                  pair", which is the truth. */}
              <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
              <label
                title={
                  hasBodyPair
                    ? 'Body weight — blends femalebody_0 → femalebody_1'
                    : 'This body ships no _0/_1 pair, so weight cannot be changed'
                }
                className={cn('flex items-center gap-[5px]', !hasBodyPair && 'opacity-40')}
              >
                <span className="shrink-0 text-[8px] tracking-[0.11em] text-[#a8a294]/72">WEIGHT</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={weight}
                  disabled={!hasBodyPair}
                  onChange={(e) => setWeight(Number(e.target.value))}
                  aria-label="Body weight"
                  className="hud-range h-[9px] w-[76px]"
                  style={{ ['--pct' as string]: `${Math.round(weight * 100)}%` }}
                />
                <span className="num w-[20px] text-[8px] tabular-nums text-[#d8c9ad]/88">
                  {weight.toFixed(2)}
                </span>
              </label>
            </div>
          )}

          {primaryTab === 'HAIR' && (
          <div className="mt-[11px] flex items-center gap-[6px]">
            <span
              className={cn(
                'mr-[1px] inline-block h-[3px] w-[3px] rounded-full',
                hairTab === 'STYLE' ? 'bg-[#d4b483]' : 'bg-[#8c8477]/50',
              )}
            />
            {HAIR_TABS.map((item, i) => {
              const active = hairTab === item;
              return (
                <div key={item} className="flex items-center gap-[6px]">
                  <button
                    type="button"
                    onClick={() => setHairTab(item)}
                    aria-pressed={active}
                    className={cn(
                      'whitespace-nowrap text-[9px] tracking-[0.11em] transition-colors duration-200',
                      active
                        ? 'font-medium text-[#d8c39c]'
                        : 'font-light text-[#a8a294]/52 hover:text-[#d5cdbd]',
                    )}
                  >
                    {item}
                  </button>
                  {i < HAIR_TABS.length - 1 && (
                    <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </div>

        {/* ── right: stats + name ─────────────────────────────────── */}
        <div className="flex items-start justify-end gap-[11px]">
          <dl className="num mt-[2px] flex flex-col items-end gap-[1px] text-[6.5px] leading-[1.3] tracking-[0.04em] text-[#a49c8d]/72">
            <div className="flex items-baseline gap-[5px]">
              <dt className="text-[#8d8577]/62">Faces:</dt>
              <dd>{stats.faces.toLocaleString('en-US')}</dd>
            </div>
            <div className="flex items-baseline gap-[5px]">
              <dt className="text-[#8d8577]/62">Verts:</dt>
              <dd>{stats.verts.toLocaleString('en-US')}</dd>
            </div>
            <div className="flex items-baseline gap-[5px]">
              <dt className="text-[#8d8577]/62">Tris:</dt>
              <dd>{stats.tris.toLocaleString('en-US')}</dd>
            </div>
          </dl>

          {/* Post-FX Toggle (ENB & Pure ReShade) */}
          <button
            type="button"
            onClick={() => setPostFxMode(FX_CONFIG[postFxMode].next)}
            title="Cycle Post-FX preset: ENB + Pure ReShade / ENB Palette / Pure ReShade / Off"
            className="group flex h-[23px] items-center gap-[6px] border border-[#d4b483]/32 bg-black/34 px-[8px] backdrop-blur-[6px] transition-all hover:border-[#d4b483]/62"
          >
            <span className={cn('h-[5px] w-[5px] rounded-full transition-all', FX_CONFIG[postFxMode].dot)} />
            <span className="text-[7.5px] font-medium tracking-[0.14em] text-[#e0d6c4]">
              {FX_CONFIG[postFxMode].label}
            </span>
          </button>

          {/* HDR Environment Lighting Switcher */}
          <button
            type="button"
            onClick={() => setEnvMode(ENV_CONFIG[envMode].next)}
            title={`Cycle Environment: ${ENV_CONFIG[envMode].description}`}
            className="group flex h-[23px] items-center gap-[6px] border border-[#d4b483]/32 bg-black/34 px-[8px] backdrop-blur-[6px] transition-all hover:border-[#d4b483]/62"
          >
            <span className={cn('h-[5px] w-[5px] rounded-full transition-all', ENV_CONFIG[envMode].dot)} />
            <span className="text-[7.5px] font-medium tracking-[0.14em] text-[#e0d6c4]">
              {ENV_CONFIG[envMode].label}
            </span>
          </button>

          {/* Environment Rotation Button (visible when an environment preset is active) */}
          {envMode !== 'off' && (
            <button
              type="button"
              onClick={() => setEnvRotation((envRotation + 45) % 360)}
              title="Rotate HDR environment lighting 45° around character"
              className="flex h-[23px] items-center gap-[4px] border border-[#d4b483]/32 bg-black/34 px-[6px] backdrop-blur-[6px] transition-all hover:border-[#d4b483]/62"
            >
              <span className="text-[7px] text-[#b0a795]/78">ROT:</span>
              <span className="font-mono text-[7.5px] font-medium tracking-[0.08em] text-[#e0d6c4]">
                {envRotation}°
              </span>
            </button>
          )}

          {/* Skin Glossiness Slider */}
          <div
            title="Adjust character skin glossiness & specular shine"
            className="flex h-[23px] items-center gap-[5px] border border-[#d4b483]/32 bg-black/34 px-[7px] backdrop-blur-[6px]"
          >
            <span className="text-[7px] tracking-[0.11em] text-[#b0a795]/78">GLOSS:</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={skinGloss}
              onChange={(e) => setSkinGloss(Number(e.target.value))}
              aria-label="Skin glossiness"
              className="hud-range h-[8px] w-[46px]"
              style={{ ['--pct' as string]: `${Math.round(skinGloss * 100)}%` }}
            />
            <span className="font-mono text-[7.5px] font-medium tabular-nums text-[#e0d6c4]">
              {Math.round(skinGloss * 100)}%
            </span>
          </div>

          <label className="group flex h-[23px] w-[80px] items-center gap-[5px] border border-[#d4b483]/32 bg-black/34 px-[6px] backdrop-blur-[6px] transition-colors focus-within:border-[#d4b483]/62">
            <span className="shrink-0 text-[7px] tracking-[0.12em] text-[#b0a795]/78">NAME:</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().slice(0, 14))}
              spellCheck={false}
              className="w-full min-w-0 bg-transparent text-[8px] tracking-[0.14em] text-[#f1ece0] outline-none placeholder:text-[#8c8477]/40"
              placeholder="LYRA"
              aria-label="Character name"
            />
          </label>
        </div>
      </div>
    </header>
  );
}
