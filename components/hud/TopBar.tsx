'use client';

import { useEffect } from 'react';
import { useCharacter } from '@/lib/store';
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
const PRIMARY = ['PRESET', 'HAIR', 'FACE', 'BODY', 'VOICE', 'ZODIAC'] as const;
/** Sub-tabs only exist under FACE; they switch which part the panel lists. */
const SECONDARY = ['SKIN', 'EYES', 'LASHES', 'BROWS', 'MOUTH', 'MAKEUP', 'TATTOO', 'WRINKLE'] as const;

/**
 * Which asset category each tab opens in the panel.
 *
 * The sub-tabs were a highlight and nothing else: MAKEUP lit up and the asset
 * panel went on listing skins. BODY has its own flows, so
 * it leaves the current one alone rather than emptying the panel.
 */
const PRIMARY_CATEGORY: Partial<Record<(typeof PRIMARY)[number], UiCategory>> = {
  PRESET: 'preset',
  HAIR: 'hair',
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



export function TopBar({ manifest: _manifest }: { manifest: Mo2Manifest | null }) {
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
  const bodyTab = useCharacter((s) => s.bodyTab);
  const setBodyTab = useCharacter((s) => s.setBodyTab);
  const stats = useCharacter((s) => s.stats);
  const previewMode = useCharacter((s) => s.previewMode);
  const setPreviewMode = useCharacter((s) => s.setPreviewMode);
  const workspace = useCharacter((s) => s.workspace);
  const setWorkspace = useCharacter((s) => s.setWorkspace);
  const triggerCameraPose = useCharacter((s) => s.triggerCameraPose);

  const FRAMING_BY_TAB: Record<string, { distance: number; targetY: number }> = {
    PRESET: { distance: 1.15, targetY: -0.05 },
    HAIR: { distance: 1.15, targetY: -0.05 },
    FACE: { distance: 0.70, targetY: 0.06 },
    BODY: { distance: 3.8, targetY: -0.65 },
  };

  useEffect(() => {
    if (primaryTab === 'FACE SHAPE' || primaryTab === 'VOICE' || primaryTab === 'ZODIAC') {
      setPrimaryTab('FACE');
      setActiveCategory('skin');
    } else if (primaryTab === 'EQUIPMENT') {
      setPrimaryTab('BODY');
      setBodyTab('gear');
    }
  }, [primaryTab, setPrimaryTab, setActiveCategory, setBodyTab]);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30">
      {/* soft top scrim so the title stays legible over the render */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[86px] bg-gradient-to-b from-black/72 via-black/28 to-transparent" />

      {/* Reference: title baseline at y ≈ 39, x 35–190; nav starts x 312. */}
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 px-4 pt-3 pb-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* ── left: wordmark ─────────────────────────────────────── */}
        <div className="flex h-[18px] items-center">
          <h1 className="whitespace-nowrap text-[11px] font-normal tracking-[0.075em] text-[#efece6]/92">
            <span className="font-medium">CHARACTER</span>{' '}
            <span className="font-light text-[#e6e2da]/78">CREATION</span>
          </h1>
        </div>

        {/* ── centre: nav stacks ─────────────────────────────────── */}
        <div className="pointer-events-auto col-span-2 row-start-2 flex min-w-0 flex-col items-start xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:items-center">
          <nav className="flex max-w-full shrink-0 items-center gap-[7px] overflow-x-auto overflow-y-hidden py-[6px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>div]:shrink-0" aria-label="Primary">
            {PRIMARY.map((item, i) => {
              const active = primaryTab === item;
              const disabled = item === 'VOICE' || item === 'ZODIAC';
              const displayLabel = `${item}${active && !disabled ? ' [ACTIVE]' : ''}`;
              return (
                <div key={item} className="flex items-center gap-[7px]">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      const wasBodyFramed = primaryTab === 'BODY' && item === 'BODY';
                      setPrimaryTab(item);
                      if (item === 'BODY') {
                        setActiveCategory(bodyTab === 'gear' ? 'equipment' : 'body');
                      } else {
                        const kind = PRIMARY_CATEGORY[item];
                        if (kind) setActiveCategory(kind);
                      }
                      const pose = FRAMING_BY_TAB[item];
                      if (pose && !wasBodyFramed) triggerCameraPose(pose);
                    }}
                    className={cn(
                      'group relative whitespace-nowrap text-[10px] tracking-[0.1em] transition-colors duration-200',
                      disabled
                        ? 'cursor-not-allowed text-[#7a7266]/35 select-none'
                        : active
                          ? 'font-medium text-[#e8c691]'
                          : 'font-light text-[#bdb7ab]/70 hover:text-[#e6ddcc]',
                    )}
                    title={disabled ? 'Disabled' : undefined}
                  >
                    {displayLabel}
                    {active && !disabled && (
                      <span className="absolute -bottom-[5px] left-1/2 h-[1px] w-[26px] -translate-x-1/2 bg-gradient-to-r from-transparent via-[#d4b483]/85 to-transparent" />
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
          {primaryTab === 'PRESET' && (
            <div className="mt-[2px] flex max-w-full items-center gap-[6px] overflow-x-auto overflow-y-hidden py-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
              <div className="flex items-center gap-[6px]">
                <span className="mr-[1px] inline-block h-[3px] w-[3px] rounded-full bg-[#d4b483]" />
                <span className="whitespace-nowrap text-[10px] font-medium tracking-[0.11em] text-[#d8c39c]">
                  PRESET SELECTION [ACTIVE]
                </span>
                <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
              </div>
              <div className="flex items-center gap-[6px]">
                <span className="cursor-not-allowed whitespace-nowrap text-[10px] font-light tracking-[0.11em] text-[#7a7266]/35 select-none">
                  SAVED PRESETS
                </span>
                <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
              </div>
              <div className="flex items-center gap-[6px]">
                <span className="cursor-not-allowed whitespace-nowrap text-[10px] font-light tracking-[0.11em] text-[#7a7266]/35 select-none">
                  USER PRESETS
                </span>
              </div>
            </div>
          )}

          {primaryTab === 'FACE' && (
          <div className="mt-[2px] flex max-w-full items-center gap-[6px] overflow-x-auto overflow-y-hidden py-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>div]:shrink-0">
            {SECONDARY.map((item, i) => {
              const active = subTab === item;
              return (
                <div key={item} className="flex items-center gap-[6px]">
                  {active && (
                    <span className="mr-[1px] inline-block h-[3px] w-[3px] rounded-full bg-[#d4b483]" />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSubTab(item);
                      setActiveCategory(SECONDARY_CATEGORY[item]);
                      if (item !== 'SKIN' && item !== 'EYES' && item !== 'BROWS' && item !== 'MAKEUP') {
                        setWorkspace('assets');
                      }
                      if (item === 'EYES' || item === 'LASHES' || item === 'BROWS') {
                        triggerCameraPose({ distance: 0.58, targetY: 0.08 });
                      } else if (item === 'MOUTH') {
                        triggerCameraPose({ distance: 0.58, targetY: 0.03 });
                      } else {
                        triggerCameraPose({ distance: 0.70, targetY: 0.06 });
                      }
                    }}
                    className={cn(
                      'whitespace-nowrap text-[10px] tracking-[0.11em] transition-colors duration-200',
                      active
                        ? 'font-medium text-[#d8c39c]'
                        : 'font-light text-[#a8a294]/52 hover:text-[#d5cdbd]',
                    )}
                  >
                    {item}{active ? ' [ACTIVE]' : ''}
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
            <div className="mt-[2px] flex max-w-full items-center gap-[6px] overflow-x-auto overflow-y-hidden py-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
              {/* GEAR SLOTS */}
              <div className="flex items-center gap-[6px]">
                {bodyTab === 'gear' && (
                  <span className="mr-[1px] inline-block h-[3px] w-[3px] rounded-full bg-[#d4b483]" />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setBodyTab('gear');
                    setActiveCategory('equipment');
                  }}
                  className={cn(
                    'whitespace-nowrap text-[10px] tracking-[0.11em] transition-colors duration-200',
                    bodyTab === 'gear'
                      ? 'font-medium text-[#d8c39c]'
                      : 'font-light text-[#a8a294]/52 hover:text-[#d5cdbd]',
                  )}
                >
                  GEAR SLOTS{bodyTab === 'gear' ? ' [ACTIVE]' : ''}
                </button>
                <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
              </div>

              {/* BODY SKIN / PHYSIQUE & WEIGHT */}
              <div className="flex items-center gap-[6px]">
                {bodyTab === 'physique' && (
                  <span className="mr-[1px] inline-block h-[3px] w-[3px] rounded-full bg-[#d4b483]" />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setBodyTab('physique');
                    setActiveCategory('body');
                  }}
                  className={cn(
                    'whitespace-nowrap text-[10px] tracking-[0.11em] transition-colors duration-200',
                    bodyTab === 'physique'
                      ? 'font-medium text-[#d8c39c]'
                      : 'font-light text-[#a8a294]/52 hover:text-[#d5cdbd]',
                  )}
                >
                  PHYSIQUE & WEIGHT{bodyTab === 'physique' ? ' [ACTIVE]' : ''}
                </button>
                <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
              </div>

              {/* Disabled reference slots: INVENTORY / WEAPONS / ACCESSORIES / STATS */}
              {(['INVENTORY', 'WEAPONS', 'ACCESSORIES', 'STATS'] as const).map((slot, idx, arr) => (
                <div key={slot} className="flex items-center gap-[6px]">
                  <span className="cursor-not-allowed whitespace-nowrap text-[10px] font-light tracking-[0.11em] text-[#7a7266]/35 select-none">
                    {slot}
                  </span>
                  {idx < arr.length - 1 && (
                    <span className="text-[10px] font-extralight text-[#8c8477]/28">/</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {primaryTab === 'HAIR' && (
          <div className="mt-[2px] flex max-w-full items-center gap-[6px] overflow-x-auto overflow-y-hidden py-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
            {HAIR_TABS.map((item, i) => {
              const active = hairTab === item;
              return (
                <div key={item} className="flex items-center gap-[6px]">
                  {active && (
                    <span className="mr-[1px] inline-block h-[3px] w-[3px] rounded-full bg-[#d4b483]" />
                  )}
                  <button
                    type="button"
                    onClick={() => setHairTab(item)}
                    aria-pressed={active}
                    className={cn(
                      'whitespace-nowrap text-[10px] tracking-[0.11em] transition-colors duration-200',
                      active
                        ? 'font-medium text-[#d8c39c]'
                        : 'font-light text-[#a8a294]/52 hover:text-[#d5cdbd]',
                    )}
                  >
                    {item}{active ? ' [ACTIVE]' : ''}
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
        <div className="pointer-events-auto col-start-2 row-start-1 flex items-start justify-end gap-[11px] xl:col-start-3">
          <dl className="num pointer-events-none absolute right-4 top-[112px] flex flex-col items-end gap-[1px] text-[10px] leading-[1.3] tracking-[0.04em] text-[#a49c8d]/72 lg:static lg:mt-[2px]">
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

          {/* POST-FX / ENV / ROT / GLOSS live in the graphics panel on the
              left gutter now; the header carries only the readout and the
              name field. */}

          <div className="flex items-center gap-[5px]">
            {/* Camera Studio Drawer */}
            <button
              type="button"
              onClick={() => setWorkspace(workspace === 'camera' ? 'edit' : 'camera')}
              title="Camera Studio (FOV, Framing Presets, Studio Lighting)"
              className={cn(
                'flex h-[28px] items-center border px-[7px] text-[10px] font-mono tracking-[0.1em] backdrop-blur-[6px] transition-colors',
                workspace === 'camera'
                  ? 'border-[#eac87f] bg-[#d4b483]/22 text-[#f0dfb9] shadow-[0_0_8px_rgba(212,180,131,0.3)]'
                  : 'border-[#d4b483]/30 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/60 hover:text-[#f0e6d4]'
              )}
            >
              [CAMERA]
            </button>

            {/* Graphics & Shaders Drawer */}
            <button
              type="button"
              onClick={() => setWorkspace(workspace === 'graphics' ? 'edit' : 'graphics')}
              title="Graphics & Shaders (ENB, ReShade, Bloom, Post-FX)"
              className={cn(
                'flex h-[28px] items-center border px-[7px] text-[10px] font-mono tracking-[0.1em] backdrop-blur-[6px] transition-colors',
                workspace === 'graphics'
                  ? 'border-[#eac87f] bg-[#d4b483]/22 text-[#f0dfb9] shadow-[0_0_8px_rgba(212,180,131,0.3)]'
                  : 'border-[#d4b483]/30 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/60 hover:text-[#f0e6d4]'
              )}
            >
              [GRAPHICS]
            </button>

            {/* Poses & Animations Drawer */}
            <button
              type="button"
              onClick={() => setWorkspace(workspace === 'poses' ? 'edit' : 'poses')}
              title="Poses & Animations"
              className={cn(
                'flex h-[28px] items-center border px-[7px] text-[10px] font-mono tracking-[0.1em] backdrop-blur-[6px] transition-colors',
                workspace === 'poses'
                  ? 'border-[#eac87f] bg-[#d4b483]/22 text-[#f0dfb9] shadow-[0_0_8px_rgba(212,180,131,0.3)]'
                  : 'border-[#d4b483]/30 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/60 hover:text-[#f0e6d4]'
              )}
            >
              [POSES]
            </button>

            {/* Settings & Mod Preferences Drawer */}
            <button
              type="button"
              onClick={() => setWorkspace(workspace === 'settings' ? 'edit' : 'settings')}
              title="Settings & Mod Preferences (Ignore Naming, Unrestricted Slots, Visuals)"
              className={cn(
                'flex h-[28px] items-center border px-[7px] text-[10px] font-mono tracking-[0.1em] backdrop-blur-[6px] transition-colors',
                workspace === 'settings'
                  ? 'border-[#eac87f] bg-[#d4b483]/22 text-[#f0dfb9] shadow-[0_0_8px_rgba(212,180,131,0.3)]'
                  : 'border-[#d4b483]/30 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/60 hover:text-[#f0e6d4]'
              )}
            >
              [SETTINGS]
            </button>

            {/* Wardrobe Drawer (Contextual on BODY -> GEAR SLOTS) */}
            {primaryTab === 'BODY' && bodyTab === 'gear' && (
              <button
                type="button"
                onClick={() => setWorkspace(workspace === 'wardrobe' ? 'edit' : 'wardrobe')}
                title="Wardrobe & Equipment Browser (Full Garment Selector)"
                className={cn(
                  'flex h-[28px] items-center border px-[7px] text-[10px] font-mono tracking-[0.1em] backdrop-blur-[6px] transition-colors',
                  workspace === 'wardrobe'
                    ? 'border-[#eac87f] bg-[#d4b483]/22 text-[#f0dfb9] shadow-[0_0_8px_rgba(212,180,131,0.3)]'
                    : 'border-[#d4b483]/30 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/60 hover:text-[#f0e6d4]'
                )}
              >
                [WARDROBE]
              </button>
            )}

            {/* Body Weight & Soft-Body Physics Drawer (Contextual on BODY -> PHYSIQUE & WEIGHT) */}
            {primaryTab === 'BODY' && bodyTab === 'physique' && (
              <button
                type="button"
                onClick={() => setWorkspace(workspace === 'physics' ? 'edit' : 'physics')}
                title="Body Weight & CBPC Soft-Body Physics"
                className={cn(
                  'flex h-[28px] items-center border px-[7px] text-[10px] font-mono tracking-[0.1em] backdrop-blur-[6px] transition-colors',
                  workspace === 'physics'
                    ? 'border-[#eac87f] bg-[#d4b483]/22 text-[#f0dfb9] shadow-[0_0_8px_rgba(212,180,131,0.3)]'
                    : 'border-[#d4b483]/30 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/60 hover:text-[#f0e6d4]'
                )}
              >
                [PHYSICS]
              </button>
            )}

            {/* 3D Face Sculpting Drawer (Contextual on FACE) */}
            {primaryTab === 'FACE' && (
              <button
                type="button"
                onClick={() => setWorkspace(workspace === 'sculpt' ? 'edit' : 'sculpt')}
                title="3D Face Sculpt Controller (Move, Rotate, Scale)"
                className={cn(
                  'flex h-[28px] items-center border px-[7px] text-[10px] font-mono tracking-[0.1em] backdrop-blur-[6px] transition-colors',
                  workspace === 'sculpt'
                    ? 'border-[#eac87f] bg-[#d4b483]/22 text-[#f0dfb9] shadow-[0_0_8px_rgba(212,180,131,0.3)]'
                    : 'border-[#d4b483]/30 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/60 hover:text-[#f0e6d4]'
                )}
              >
                [SCULPT]
              </button>
            )}

            {/* Viewport Preview Toggle */}
            <button
              type="button"
              onClick={() => setPreviewMode(!previewMode)}
              title={previewMode ? 'Exit preview (Esc)' : 'Hide HUD preview'}
              className={cn(
                'flex h-[28px] items-center border px-[7px] text-[10px] font-mono tracking-[0.1em] backdrop-blur-[6px] transition-colors',
                previewMode
                  ? 'border-[#c9a86a] bg-[#c9a86a]/20 text-[#f0dfb9]'
                  : 'border-[#d4b483]/30 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/60 hover:text-[#f0e6d4]'
              )}
            >
              [VIEW]
            </button>
          </div>

          <label className="group flex h-[28px] w-[128px] items-center gap-[5px] border border-[#d4b483]/32 bg-black/34 px-[6px] backdrop-blur-[6px] transition-colors focus-within:border-[#d4b483]/62">
            <span className="shrink-0 text-[10px] tracking-[0.12em] text-[#b0a795]/78">NAME:</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().slice(0, 14))}
              spellCheck={false}
              className="w-full min-w-0 bg-transparent text-[10px] tracking-[0.14em] text-[#f1ece0] outline-none placeholder:text-[#8c8477]/40"
              placeholder="LYRA"
              aria-label="Character name"
            />
          </label>
        </div>
      </div>
    </header>
  );
}
