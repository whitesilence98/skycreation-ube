'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { findHairGroupForPartId, type HairGroup } from '@/lib/hair';
import { getCuratedHairGroups } from '@/lib/hairGlbRegistry';
import { ItemTile } from '@/components/hud/common/ItemTile';
import { WuxiaSubCategoryRail } from '@/components/hud/common/WuxiaSubCategoryRail';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { WuxiaColorPicker2D } from '@/components/hud/hair/WuxiaColorPicker2D';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { HAIR_LIMITS, HAIR_OFFSET_METRES } from '@/lib/hair/settings';
import { HAIR_PALETTE_SWATCHES } from '@/components/hud/HairProperties';
import { cn } from '@/lib/cn';

export type HairSectionId = 'models' | 'basic_dye' | 'advanced_dye' | 'finish';

interface SectionConfig {
  id: HairSectionId;
  label: string;
  badge?: string;
}

export function HairStyles({ manifest: _manifest }: { manifest: Mo2Manifest | null }) {
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const hair = useCharacter((s) => s.hair);
  const setHair = useCharacter((s) => s.setHair);
  const linkBrowToHair = useCharacter((s) => s.linkBrowToHair);
  const setLinkBrowToHair = useCharacter((s) => s.setLinkBrowToHair);
  const showToast = useCharacter((s) => s.showToast);
  const hairPhysicsEnabled = useCharacter((s) => s.hairPhysicsEnabled);
  const setHairPhysicsEnabled = useCharacter((s) => s.setHairPhysicsEnabled);
  const secondaryStiffness = useCharacter((s) => s.secondaryStiffness);
  const setSecondaryStiffness = useCharacter((s) => s.setSecondaryStiffness);
  const secondaryWindIntensity = useCharacter((s) => s.secondaryWindIntensity);
  const setSecondaryWindIntensity = useCharacter((s) => s.setSecondaryWindIntensity);
  const triggerSecondaryImpulse = useCharacter((s) => s.triggerSecondaryImpulse);

  const [activeSection, setActiveSection] = useState<HairSectionId | null>(null);
  const [query, setQuery] = useState('');

  // Curated standalone GLB hairstyles
  const hairGroups: HairGroup[] = useMemo(() => {
    return getCuratedHairGroups();
  }, []);

  // Ensure an initial hair is selected if none currently chosen
  useEffect(() => {
    if (!selection.hairMesh && hairGroups.length > 0) {
      setAssets({ hairMesh: hairGroups[0].id });
    }
  }, [selection.hairMesh, hairGroups, setAssets]);

  // Global Escape key listener to return to View 1
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeSection !== null) {
        e.preventDefault();
        setActiveSection(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection]);

  // Direct search filter over hairstyles
  const filtered = useMemo(() => {
    if (!query.trim()) return hairGroups;
    const q = query.toLowerCase().trim();
    return hairGroups.filter(
      (g) =>
        g.label.toLowerCase().includes(q) ||
        g.groupKey.toLowerCase().includes(q) ||
        (g.mod && g.mod.toLowerCase().includes(q)) ||
        g.parts.some((p) => p.label.toLowerCase().includes(q))
    );
  }, [hairGroups, query]);

  const activeGroup = useMemo(() => {
    return findHairGroupForPartId(hairGroups, selection.hairMesh) ?? hairGroups[0];
  }, [hairGroups, selection.hairMesh]);

  const selectedGroupId = activeGroup?.id;

  const sections: SectionConfig[] = [
    {
      id: 'models',
      label: 'Hairstyle Models',
      badge: `${hairGroups.length} STYLES`,
    },
    {
      id: 'basic_dye',
      label: 'Salon Color Swatches',
      badge: 'QUICK DYE',
    },
    {
      id: 'advanced_dye',
      label: '2D Color Studio',
      badge: 'CUSTOM',
    },
    {
      id: 'finish',
      label: 'Fit & Secondary Physics',
      badge: 'PHYSICS',
    },
  ];

  const hairTone = hair.tone ?? '#ffffff';
  const hairOffset = hair.hairOffset ?? 0;
  const hairAlpha = hair.alpha ?? 1.0;
  const hairGloss = hair.gloss ?? 0.5;
  const offsetMm = (hairOffset / HAIR_OFFSET_METRES) * 1000;

  return (
    <div className="flex items-start gap-5 select-none text-white">
      {/* 1. Reusable Left Sub-Category Rail */}
      <WuxiaSubCategoryRail activeTab="hairstyle" onSelectTab={() => setActiveSection(null)} />

      {/* 2. Main Content Area */}
      <div className="flex flex-col w-[300px] md:w-[330px]">
        {/* ======================================================== */}
        {/* VIEW 1: CATEGORY ROOT MENU                               */}
        {/* ======================================================== */}
        {activeSection === null ? (
          <div className="flex flex-col">
            <h1 className="text-base font-normal tracking-wide text-white mb-3">
              Hairstyle
            </h1>

            <div className="flex flex-col gap-1.5" role="menu" aria-label="Hairstyle Categories">
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className="group flex h-11 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73] cursor-pointer"
                  role="menuitem"
                >
                  <div className="flex flex-col">
                    <span className="text-xs tracking-wide text-[#d4d3d9] transition-colors group-hover:text-white">
                      {sec.label}
                    </span>
                    {sec.badge && (
                      <span className="font-mono text-[9px] text-[#75737d] group-hover:text-[#dfba73]/80">
                        {sec.badge}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-sm font-light text-[#75737d] transition-colors group-hover:text-white"
                    aria-hidden
                  >
                    ›
                  </span>
                </button>
              ))}
            </div>

            {/* Current Active Summary Card */}
            {activeGroup && (
              <div className="mt-5 rounded-sm border border-white/5 bg-[#17181c]/60 p-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#9f9da6] mb-1">
                  Active Hairstyle
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-white">{activeGroup.label}</div>
                  <span className="rounded-xs bg-[#eac87f]/15 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#eac87f]">
                    {activeGroup.partCount} PARTS
                  </span>
                </div>
                {activeGroup.mod && (
                  <div className="text-[11px] text-[#75737d] mt-0.5">{activeGroup.mod}</div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ======================================================== */
          /* VIEW 2: DRILL-DOWN SUB-SCREEN                             */
          /* ======================================================== */
          <div className="flex flex-col">
            {/* Breadcrumb Header */}
            <WuxiaBreadcrumbs
              category="Hairstyle"
              subCategory={sections.find((s) => s.id === activeSection)?.label}
              onBack={() => setActiveSection(null)}
            />

            {/* Sub-Category Ribbon Pill */}
            <div className="mt-2.5 mb-3 flex items-center justify-between">
              <WuxiaRibbonPill
                label={sections.find((s) => s.id === activeSection)?.label ?? ''}
                icon="✦"
              />
            </div>

            {/* Sub-Screen Content Area */}
            <div className="mt-1">
              {/* SUB-SECTION 1: HAIRSTYLE MODELS (ItemTile Grid) */}
              {activeSection === 'models' && (
                <div className="flex flex-col">
                  {/* Search input (when collection grows) */}
                  {hairGroups.length > 9 && (
                    <div className="mb-2.5">
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search hairstyle…"
                        aria-label="Search hairstyle"
                        className="h-8 w-full rounded-sm border border-white/10 bg-[#1e1e23]/90 px-2.5 font-mono text-xs text-[#e6e1d8] placeholder-[#7a7882] backdrop-blur-md transition-colors focus:border-[#eac87f] focus:outline-none"
                      />
                    </div>
                  )}

                  {/* 3-Column ItemTile Grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {filtered.map((g) => {
                      const isSelected = selectedGroupId === g.id;
                      const thumb = (g.representative as any)?.thumbnailUrl;

                      return (
                        <ItemTile
                          key={g.id}
                          id={g.id}
                          title={g.label}
                          subtitle={`${g.brand}${g.partCount > 1 ? ` (${g.partCount} Parts)` : ''}`}
                          isSelected={isSelected}
                          showCheckmark={true}
                          onClick={() => {
                            setAssets({
                              hairMesh: g.id,
                              ...(g.pairedTextureId ? { hair: g.pairedTextureId } : {}),
                            });
                            showToast?.(`Selected ${g.label}`);
                          }}
                          thumbnail={
                            thumb ? (
                              <img
                                src={thumb}
                                alt={g.label}
                                className="h-full w-full object-cover rounded-xs"
                              />
                            ) : (
                              <div className="h-full w-full flex flex-col items-center justify-center bg-[#1c1d24]/90 border border-white/5 rounded-xs p-2 text-center select-none group-hover:border-[#dfba73]/30 transition-all">
                                <span className="font-mono text-xs font-semibold tracking-wider text-[#eac87f]">GLB</span>
                                <span className="text-[10px] text-[#9f9da6] mt-0.5 line-clamp-1">{g.label}</span>
                              </div>
                            )
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SUB-SECTION 2: BASIC HAIR DYE (Salon Swatches) */}
              {activeSection === 'basic_dye' && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      Salon Curated Swatches
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setHair({ tone: '#ffffff' });
                        showToast?.('Reset to original hair tone');
                      }}
                      className="text-[10px] font-mono text-[#dfba73] hover:text-white transition-colors"
                    >
                      ↺ Reset
                    </button>
                  </div>

                  {/* Swatches Grid */}
                  <div className="grid grid-cols-4 gap-2">
                    {HAIR_PALETTE_SWATCHES.filter((s) => s.hex !== 'chromatic').map((s) => {
                      const isSelected = hairTone.toLowerCase() === s.hex.toLowerCase();
                      return (
                        <button
                          key={s.hex}
                          type="button"
                          onClick={() => {
                            setHair({ tone: s.hex });
                            showToast?.(`Hair dye: ${s.name}`);
                          }}
                          className={cn(
                            'group flex flex-col items-center gap-1.5 p-2 rounded-sm border transition-all text-center',
                            isSelected
                              ? 'border-[#dfba73] bg-[#22232a] shadow-[0_0_8px_rgba(223,186,115,0.25)]'
                              : 'border-white/5 bg-[#1f2026]/80 hover:border-white/20 hover:bg-[#25262f]'
                          )}
                        >
                          <span
                            className={cn(
                              'h-7 w-7 rounded-full border shadow-sm transition-transform group-hover:scale-105',
                              isSelected ? 'border-white ring-2 ring-[#dfba73]' : 'border-white/20'
                            )}
                            style={{ backgroundColor: s.hex }}
                          />
                          <span className="text-[10px] text-[#d4d3d9] leading-tight font-medium truncate w-full">
                            {s.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Brow Sync Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      const next = !linkBrowToHair;
                      setLinkBrowToHair(next);
                      showToast?.(next ? 'Eyebrows linked to hair' : 'Eyebrows unlinked');
                    }}
                    className={cn(
                      'mt-2 flex w-full items-center justify-between border px-3 py-2 rounded-sm text-xs font-mono tracking-wider transition-colors',
                      linkBrowToHair
                        ? 'border-[#eac87f] bg-[#d4b483]/15 text-[#f2dfbe]'
                        : 'border-white/10 bg-black/30 text-[#8a8793] hover:border-white/30 hover:text-white'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full transition-colors',
                          linkBrowToHair ? 'bg-[#eac87f] shadow-[0_0_5px_#eac87f]' : 'bg-neutral-600'
                        )}
                      />
                      LINK BROWS TO HAIR
                    </span>
                    <span className="text-[10px] font-semibold uppercase text-[#dfba73]">
                      {linkBrowToHair ? 'ACTIVE' : 'OFF'}
                    </span>
                  </button>
                </div>
              )}

              {/* SUB-SECTION 3: ADVANCED HAIR DYE (2D Hue / SV Studio) */}
              {activeSection === 'advanced_dye' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1 mb-2">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      2D Hue &amp; Saturation Studio
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setHair({ tone: '#ffffff' });
                        showToast?.('Reset to original hair tone');
                      }}
                      className="text-[10px] font-mono text-[#dfba73] hover:text-white transition-colors"
                    >
                      ↺ Reset
                    </button>
                  </div>

                  <WuxiaColorPicker2D
                    color={hairTone}
                    onChange={(hex) => setHair({ tone: hex })}
                  />
                </div>
              )}

              {/* SUB-SECTION 4: HAIR FINISH & PHYSICS */}
              {activeSection === 'finish' && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      Material &amp; Hairline Fit
                    </span>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <BracketSlider
                      label="HAIR HEIGHT / OFFSET"
                      value={hairOffset}
                      min={HAIR_LIMITS.hairOffset[0]}
                      max={HAIR_LIMITS.hairOffset[1]}
                      step={1}
                      display={
                        offsetMm === 0 ? 'NEUTRAL' : `${offsetMm > 0 ? '+' : ''}${offsetMm.toFixed(1)}mm`
                      }
                      onChange={(v) => setHair({ hairOffset: v })}
                    />

                    <BracketSlider
                      label="HAIR OPACITY (ALPHA)"
                      value={hairAlpha}
                      min={0.05}
                      max={1.0}
                      step={0.01}
                      display={`${Math.round(hairAlpha * 100)}%`}
                      onChange={(v) => setHair({ alpha: v })}
                    />

                    <BracketSlider
                      label="HAIR GLOSS (SPECULAR)"
                      value={hairGloss}
                      min={0.0}
                      max={1.0}
                      step={0.01}
                      display={`${Math.round(hairGloss * 100)}%`}
                      onChange={(v) => setHair({ gloss: v })}
                    />
                  </div>

                  {/* Eyebrow Sync Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      const next = !linkBrowToHair;
                      setLinkBrowToHair(next);
                      showToast?.(next ? 'Eyebrows linked to hair' : 'Eyebrows unlinked');
                    }}
                    className={cn(
                      'mt-2 flex w-full items-center justify-between border px-3 py-2 rounded-sm text-xs font-mono tracking-wider transition-colors',
                      linkBrowToHair
                        ? 'border-[#eac87f] bg-[#d4b483]/15 text-[#f2dfbe]'
                        : 'border-white/10 bg-black/30 text-[#8a8793] hover:border-white/30 hover:text-white'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full transition-colors',
                          linkBrowToHair ? 'bg-[#eac87f] shadow-[0_0_5px_#eac87f]' : 'bg-neutral-600'
                        )}
                      />
                      LINK BROWS TO HAIR
                    </span>
                    <span className="text-[10px] font-semibold uppercase text-[#dfba73]">
                      {linkBrowToHair ? 'ACTIVE' : 'OFF'}
                    </span>
                  </button>

                  {/* ── Hair Secondary Physics & SMP Dynamics ──────── */}
                  <div className="mt-3 flex flex-col gap-2.5 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                        Secondary Hair Dynamics (SMP)
                      </span>
                      <button
                        type="button"
                        onClick={triggerSecondaryImpulse}
                        disabled={!hairPhysicsEnabled}
                        title="Trigger test impulse to preview hair swing"
                        className={cn(
                          'border px-2 py-0.5 text-[10px] font-mono tracking-wider transition-colors rounded-sm',
                          hairPhysicsEnabled
                            ? 'border-[#dfba73]/40 bg-[#dfba73]/10 text-[#dfba73] hover:border-[#dfba73] hover:bg-[#dfba73]/20 active:scale-95'
                            : 'border-white/10 bg-transparent text-white/30 cursor-not-allowed'
                        )}
                      >
                        TEST SWAY ⟲
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const next = !hairPhysicsEnabled;
                        setHairPhysicsEnabled(next);
                        showToast?.(next ? 'Hair physics enabled' : 'Hair physics disabled');
                      }}
                      className={cn(
                        'flex w-full items-center justify-between border px-3 py-2 rounded-sm text-xs font-mono tracking-wider transition-colors',
                        hairPhysicsEnabled
                          ? 'border-[#eac87f] bg-[#d4b483]/15 text-[#f2dfbe]'
                          : 'border-white/10 bg-black/30 text-[#8a8793] hover:border-white/30 hover:text-white'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full transition-colors',
                            hairPhysicsEnabled ? 'bg-[#eac87f] shadow-[0_0_5px_#eac87f]' : 'bg-neutral-600'
                          )}
                        />
                        HAIR SECONDARY DYNAMICS
                      </span>
                      <span className="text-[10px] font-semibold uppercase text-[#dfba73]">
                        {hairPhysicsEnabled ? 'ACTIVE' : 'OFF'}
                      </span>
                    </button>

                    {hairPhysicsEnabled && (
                      <div className="flex flex-col gap-2 pt-1">
                        <BracketSlider
                          label="FLEXIBILITY / BOUNCE"
                          value={Math.round((1 - secondaryStiffness) * 100)}
                          min={10}
                          max={90}
                          step={1}
                          display={`${Math.round((1 - secondaryStiffness) * 100)}%`}
                          onChange={(v) => setSecondaryStiffness(1 - v / 100)}
                        />

                        <BracketSlider
                          label="WIND SWAY (BREEZE)"
                          value={Math.round(secondaryWindIntensity * 100)}
                          min={0}
                          max={100}
                          step={5}
                          display={secondaryWindIntensity === 0 ? 'CALM' : `${Math.round(secondaryWindIntensity * 100)}%`}
                          onChange={(v) => setSecondaryWindIntensity(v / 100)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
