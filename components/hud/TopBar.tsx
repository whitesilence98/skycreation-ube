'use client';

import { useEffect } from 'react';
import { useCharacter } from '@/lib/store';
import { HAIR_TABS } from '@/lib/hair/settings';
import { cn } from '@/lib/cn';
import { IconCamera, IconGear, IconPose, IconEye } from '@/components/hud/Icons';
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
        {/* ── left: wordmark + character name ───────────────────────── */}
        <div className="flex items-center gap-3">
          <h1 className="whitespace-nowrap text-[11px] font-normal tracking-[0.075em] text-[#efece6]/92">
            <span className="font-medium">CHARACTER</span>{' '}
            <span className="font-light text-[#e6e2da]/78">CREATION</span>
          </h1>

          <label className="group flex h-[24px] items-center gap-1.5 rounded-full border border-[#d4b483]/28 bg-[#161311]/85 px-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.5)] backdrop-blur-md transition-all focus-within:border-[#eac87f] focus-within:shadow-[0_0_10px_rgba(234,200,127,0.35)]">
            <span className="shrink-0 text-[8.5px] font-mono tracking-wider text-[#d4b483]/80">NAME:</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().slice(0, 14))}
              spellCheck={false}
              className="w-[74px] bg-transparent text-[9.5px] font-mono tracking-widest text-[#f2dfbe] outline-none placeholder:text-[#8c8477]/40"
              placeholder="LYRA"
              aria-label="Character name"
            />
          </label>
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
                        if (bodyTab === 'gear') setWorkspace('wardrobe');
                      } else {
                        const kind = PRIMARY_CATEGORY[item];
                        if (kind) setActiveCategory(kind);
                        if (workspace === 'wardrobe') setWorkspace('edit');
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
                    <span className="text-[7px] text-[#d4b483]/35 select-none">◆</span>
                  )}
                </div>
              );
            })}
          </nav>

          {primaryTab === 'FACE' && (
          <div className="mt-[3px] flex max-w-full items-center gap-1.5 overflow-x-auto overflow-y-hidden py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:shrink-0">
            {SECONDARY.map((item) => {
              const active = subTab === item;
              return (
                <button
                  key={item}
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
                    'relative flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[9.5px] font-mono tracking-wider transition-all duration-150',
                    active
                      ? 'border-[#eac87f] bg-[#d4b483]/22 font-medium text-[#f2dfbe] shadow-[0_0_10px_rgba(234,200,127,0.3)] ring-1 ring-[#eac87f]/60'
                      : 'border-[#d4b483]/20 bg-black/40 text-[#a8a294]/75 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#e4d8c2]',
                  )}
                >
                  <span
                    className={cn(
                      'rounded-full transition-all duration-150',
                      active
                        ? 'h-1.5 w-1.5 bg-[#eac87f] shadow-[0_0_6px_#eac87f]'
                        : 'h-1 w-1 bg-[#8c8477]/40',
                    )}
                  />
                  <span>{item}</span>
                </button>
              );
            })}
          </div>
          )}

          {primaryTab === 'BODY' && (
            <div className="mt-[3px] flex max-w-full items-center gap-1.5 overflow-x-auto overflow-y-hidden py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
              {/* GEAR SLOTS */}
              <button
                type="button"
                onClick={() => {
                  setBodyTab('gear');
                  setActiveCategory('equipment');
                  setWorkspace('wardrobe');
                }}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[9.5px] font-mono tracking-wider transition-all duration-150',
                  bodyTab === 'gear'
                    ? 'border-[#eac87f] bg-[#d4b483]/22 font-medium text-[#f2dfbe] shadow-[0_0_10px_rgba(234,200,127,0.3)] ring-1 ring-[#eac87f]/60'
                    : 'border-[#d4b483]/20 bg-black/40 text-[#a8a294]/75 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#e4d8c2]',
                )}
              >
                <span
                  className={cn(
                    'rounded-full transition-all duration-150',
                    bodyTab === 'gear'
                      ? 'h-1.5 w-1.5 bg-[#eac87f] shadow-[0_0_6px_#eac87f]'
                      : 'h-1 w-1 bg-[#8c8477]/40',
                  )}
                />
                <span>GEAR SLOTS</span>
              </button>

              {/* BODY SKIN / PHYSIQUE & WEIGHT */}
              <button
                type="button"
                onClick={() => {
                  setBodyTab('physique');
                  setActiveCategory('body');
                  if (workspace === 'wardrobe') setWorkspace('edit');
                }}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[9.5px] font-mono tracking-wider transition-all duration-150',
                  bodyTab === 'physique'
                    ? 'border-[#eac87f] bg-[#d4b483]/22 font-medium text-[#f2dfbe] shadow-[0_0_10px_rgba(234,200,127,0.3)] ring-1 ring-[#eac87f]/60'
                    : 'border-[#d4b483]/20 bg-black/40 text-[#a8a294]/75 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#e4d8c2]',
                )}
              >
                <span
                  className={cn(
                    'rounded-full transition-all duration-150',
                    bodyTab === 'physique'
                      ? 'h-1.5 w-1.5 bg-[#eac87f] shadow-[0_0_6px_#eac87f]'
                      : 'h-1 w-1 bg-[#8c8477]/40',
                  )}
                />
                <span>PHYSIQUE &amp; WEIGHT</span>
              </button>

              {/* Disabled reference slots: INVENTORY / WEAPONS / ACCESSORIES / STATS */}
              {(['INVENTORY', 'WEAPONS', 'ACCESSORIES', 'STATS'] as const).map((slot) => (
                <span
                  key={slot}
                  className="cursor-not-allowed select-none rounded-full border border-black/20 bg-black/20 px-2.5 py-[3px] font-mono text-[9px] font-light tracking-wider text-[#7a7266]/35 opacity-40"
                >
                  {slot}
                </span>
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

        {/* ── right: telemetry pill + toolstrip ───────────────────── */}
        <div className="pointer-events-auto col-start-2 row-start-1 flex items-center justify-end gap-2 xl:col-start-3">
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-[#d4b483]/20 bg-black/45 px-2.5 py-[3px] text-[8.5px] font-mono tracking-wider text-[#a89e8f]/75 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
            <span title="Active Face Mesh Polygons">{stats.faces.toLocaleString('en-US')} F</span>
            <span className="text-[#d4b483]/30">·</span>
            <span title="Vertices">{stats.verts.toLocaleString('en-US')} V</span>
            <span className="text-[#d4b483]/30">·</span>
            <span title="Triangles">{stats.tris.toLocaleString('en-US')} T</span>
          </div>

          {/* POST-FX / ENV / ROT / GLOSS live in the graphics panel on the
              left gutter now; the header carries only the readout and the
              name field. */}

          <div className="flex items-center gap-1.5 rounded-full border border-[#d4b483]/22 bg-[#120f0c]/85 p-1 shadow-[0_4px_20px_rgba(0,0,0,0.55)] backdrop-blur-md">
            {/* Camera Studio Drawer */}
            <button
              type="button"
              onClick={() => setWorkspace(workspace === 'camera' ? 'edit' : 'camera')}
              title="Camera Studio (FOV, Framing Presets, Studio Lighting)"
              className={cn(
                'flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-[9.5px] font-mono tracking-wider transition-all duration-150',
                workspace === 'camera'
                  ? 'border-[#eac87f] bg-[#d4b483]/25 font-medium text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.3)]'
                  : 'border-[#d4b483]/18 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#f0e6d4]'
              )}
            >
              <IconCamera className="h-3 w-3" />
              <span>CAMERA</span>
            </button>

            {/* Graphics & Shaders Drawer */}
            <button
              type="button"
              onClick={() => setWorkspace(workspace === 'graphics' ? 'edit' : 'graphics')}
              title="Graphics & Shaders (ENB, ReShade, Bloom, Post-FX)"
              className={cn(
                'flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-[9.5px] font-mono tracking-wider transition-all duration-150',
                workspace === 'graphics'
                  ? 'border-[#eac87f] bg-[#d4b483]/25 font-medium text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.3)]'
                  : 'border-[#d4b483]/18 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#f0e6d4]'
              )}
            >
              <IconGear className="h-3 w-3" />
              <span>GRAPHICS</span>
            </button>

            {/* Poses & Animations Drawer */}
            <button
              type="button"
              onClick={() => setWorkspace(workspace === 'poses' ? 'edit' : 'poses')}
              title="Poses & Animations"
              className={cn(
                'flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-[9.5px] font-mono tracking-wider transition-all duration-150',
                workspace === 'poses'
                  ? 'border-[#eac87f] bg-[#d4b483]/25 font-medium text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.3)]'
                  : 'border-[#d4b483]/18 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#f0e6d4]'
              )}
            >
              <IconPose className="h-3 w-3" />
              <span>POSES</span>
            </button>

            {/* Settings & Mod Preferences Drawer */}
            <button
              type="button"
              onClick={() => setWorkspace(workspace === 'settings' ? 'edit' : 'settings')}
              title="Settings & Mod Preferences (Ignore Naming, Unrestricted Slots, Visuals)"
              className={cn(
                'flex h-[26px] items-center gap-1 rounded-full border px-2 text-[9.5px] font-mono tracking-wider transition-all duration-150',
                workspace === 'settings'
                  ? 'border-[#eac87f] bg-[#d4b483]/25 font-medium text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.3)]'
                  : 'border-[#d4b483]/18 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#f0e6d4]'
              )}
            >
              <span>SETTINGS</span>
            </button>

            {/* Wardrobe Drawer (Contextual on BODY -> GEAR SLOTS) */}
            {primaryTab === 'BODY' && bodyTab === 'gear' && (
              <button
                type="button"
                onClick={() => setWorkspace(workspace === 'wardrobe' ? 'edit' : 'wardrobe')}
                title="Wardrobe & Equipment Browser (Full Garment Selector)"
                className={cn(
                  'flex h-[26px] items-center gap-1 rounded-full border px-2.5 text-[9.5px] font-mono tracking-wider transition-all duration-150',
                  workspace === 'wardrobe'
                    ? 'border-[#eac87f] bg-[#d4b483]/25 font-medium text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.3)]'
                    : 'border-[#d4b483]/18 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#f0e6d4]'
                )}
              >
                <span>WARDROBE</span>
              </button>
            )}

            {/* Body Weight & Soft-Body Physics Drawer (Contextual on BODY -> PHYSIQUE & WEIGHT) */}
            {primaryTab === 'BODY' && bodyTab === 'physique' && (
              <button
                type="button"
                onClick={() => setWorkspace(workspace === 'physics' ? 'edit' : 'physics')}
                title="Body Weight & CBPC Soft-Body Physics"
                className={cn(
                  'flex h-[26px] items-center gap-1 rounded-full border px-2.5 text-[9.5px] font-mono tracking-wider transition-all duration-150',
                  workspace === 'physics'
                    ? 'border-[#eac87f] bg-[#d4b483]/25 font-medium text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.3)]'
                    : 'border-[#d4b483]/18 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#f0e6d4]'
                )}
              >
                <span>PHYSICS</span>
              </button>
            )}

            {/* 3D Face Sculpting Drawer (Contextual on FACE) */}
            {primaryTab === 'FACE' && (
              <button
                type="button"
                onClick={() => setWorkspace(workspace === 'sculpt' ? 'edit' : 'sculpt')}
                title="3D Face Sculpt Controller (Move, Rotate, Scale)"
                className={cn(
                  'flex h-[26px] items-center gap-1 rounded-full border px-2.5 text-[9.5px] font-mono tracking-wider transition-all duration-150',
                  workspace === 'sculpt'
                    ? 'border-[#eac87f] bg-[#d4b483]/25 font-medium text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.3)]'
                    : 'border-[#d4b483]/18 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#f0e6d4]'
                )}
              >
                <span>SCULPT</span>
              </button>
            )}

            {/* Viewport Preview Toggle */}
            <button
              type="button"
              onClick={() => setPreviewMode(!previewMode)}
              title={previewMode ? 'Exit preview (Esc)' : 'Hide HUD preview'}
              className={cn(
                'flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-[9.5px] font-mono tracking-wider transition-all duration-150',
                previewMode
                  ? 'border-[#c9a86a] bg-[#c9a86a]/20 text-[#f0dfb9] shadow-[0_0_8px_rgba(201,168,106,0.3)]'
                  : 'border-[#d4b483]/18 bg-black/40 text-[#c3b698]/80 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/10 hover:text-[#f0e6d4]'
              )}
            >
              <IconEye className="h-3 w-3" />
              <span>VIEW</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
