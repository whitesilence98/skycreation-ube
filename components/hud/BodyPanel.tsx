'use client';

import React, { useState, useEffect } from 'react';
import { useCharacter, BODY_WEIGHT_ENABLED } from '@/lib/store';
import { ANATOMY_PARAMS, type AnatomyParamId } from '@/lib/anatomy/params';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { HudSlider } from '@/components/hud/HudSlider';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { BodySlidePanel } from '@/components/hud/bodyslide/BodySlidePanel';
import { HandsPanel } from '@/components/hud/bodyslide/HandsPanel';
import { FeetPanel } from '@/components/hud/bodyslide/FeetPanel';
import { WuxiaSubCategoryRail } from '@/components/hud/common/WuxiaSubCategoryRail';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';

/** The body-build sliders grouped into 2 ergonomic sections (RaceMenu parity). */
const PROPORTION_SLIDERS: { id: AnatomyParamId; customLabel?: string }[] = [
  { id: 'body.heightCm', customLabel: 'HEIGHT' },
  { id: 'body.headScale', customLabel: 'HEAD SCALE' },
  { id: 'body.armLength', customLabel: 'ARM LENGTH' },
  { id: 'body.legLength', customLabel: 'LEG LENGTH' },
  { id: 'body.shoulderWidth', customLabel: 'SHOULDER WIDTH' },
  { id: 'body.handSize', customLabel: 'HAND SIZE' },
  { id: 'body.fingerLength', customLabel: 'FINGER LENGTH' },
  { id: 'body.footSize', customLabel: 'FOOT SIZE' },
];

const SILHOUETTE_SLIDERS: { id: AnatomyParamId; customLabel?: string }[] = [
  { id: 'body.chestSize', customLabel: 'CHEST & BUST' },
  { id: 'body.waistSize', customLabel: 'WAIST TAPER' },
  { id: 'body.hipWidth', customLabel: 'HIP WIDTH' },
  { id: 'body.buttSize', customLabel: 'BUTT VOLUME' },
  { id: 'body.thighWidth', customLabel: 'THIGH FULLNESS' },
  { id: 'body.belly', customLabel: 'BELLY SOFTNESS' },
  { id: 'body.fat', customLabel: 'BODY FAT' },
];

function BodyShapeSlider({ id, customLabel }: { id: AnatomyParamId; customLabel?: string }) {
  const value = useCharacter((s) => s.anatomy[id]);
  const p = ANATOMY_PARAMS.find((entry) => entry.id === id)!;
  const s = useCharacter.getState;
  const isHeight = id === 'body.heightCm';
  return (
    <BracketSlider
      label={customLabel ?? p.label}
      min={p.min}
      max={p.max}
      step={p.step}
      value={value}
      display={isHeight ? `${Math.round(value)} cm` : `${Math.round(value)}%`}
      onChange={(v) => {
        s().beginAnatomyEdit();
        s().setAnatomy(id, v);
      }}
    />
  );
}

export type PhysiqueSectionId =
  | 'weight_build'
  | 'torso_chest'
  | 'waist_hips'
  | 'legs_butt'
  | 'hands_arms'
  | 'feet'
  | 'skeleton_scale';

interface SectionConfig {
  id: PhysiqueSectionId;
  label: string;
  badge?: string;
  count?: string;
}

const PHYSIQUE_SECTIONS: SectionConfig[] = [
  {
    id: 'weight_build',
    label: 'Weight & Base Build',
    badge: 'WEIGHT / HEIGHT',
  },
  {
    id: 'torso_chest',
    label: 'Torso & Chest (0Necoco)',
    badge: 'CHEST & BUST',
  },
  {
    id: 'waist_hips',
    label: 'Waist & Hips (0Necoco)',
    badge: 'WAIST & BELLY',
  },
  {
    id: 'legs_butt',
    label: 'Legs & Butt (0Necoco)',
    badge: 'BUTT & THIGHS',
  },
  {
    id: 'hands_arms',
    label: 'Hands & Arms (0Necoco)',
    badge: 'HANDS',
    count: '43',
  },
  {
    id: 'feet',
    label: 'Feet (0Necoco)',
    badge: 'FEET',
    count: '69',
  },
  {
    id: 'skeleton_scale',
    label: 'Skeleton Scale (RaceMenu)',
    badge: 'RACEMENU',
  },
];

interface BodyPanelProps {
  manifest?: Mo2Manifest | null;
}

export function BodyPanel({ manifest = null }: BodyPanelProps) {
  const weight = useCharacter((s) => s.weight);
  const setWeight = useCharacter((s) => s.setWeight);
  const linkFaceToWeight = useCharacter((s) => s.linkFaceToWeight);
  const setLinkFaceToWeight = useCharacter((s) => s.setLinkFaceToWeight);
  const garmentVisible = useCharacter((s) => s.garmentVisible);
  const setGarmentVisible = useCharacter((s) => s.setGarmentVisible);
  const skinGloss = useCharacter((s) => s.skinGloss);
  const setSkinGloss = useCharacter((s) => s.setSkinGloss);
  const skinSss = useCharacter((s) => s.skinSss);
  const setSkinSss = useCharacter((s) => s.setSkinSss);
  const bodyPhysicsEnabled = useCharacter((s) => s.bodyPhysicsEnabled);
  const triggerPhysicsImpulse = useCharacter((s) => s.triggerPhysicsImpulse);
  const workspace = useCharacter((s) => s.workspace);
  const setWorkspace = useCharacter((s) => s.setWorkspace);

  const [activeSection, setActiveSection] = useState<PhysiqueSectionId | null>(null);

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

  const hasBodyPair = Boolean(
    (manifest?.assets?.bodyMesh as Array<{ weightVariants?: unknown }> | undefined)
      ?.some((row) => row.weightVariants),
  );

  const currentSection = activeSection
    ? PHYSIQUE_SECTIONS.find((s) => s.id === activeSection)
    : null;

  return (
    <div className="flex items-start gap-4 md:gap-5 select-none text-white pointer-events-auto">
      {/* 1. Left Sub-Category Rail (72px) */}
      <WuxiaSubCategoryRail
        activeTab="physique"
        onSelectTab={() => setActiveSection(null)}
      />

      {/* ─────────────────────────────────────────────────────────────────────────────
          MAIN CONTENT AREA: Root Menu (View 1) OR Drill-Down (View 2)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col w-[300px] md:w-[330px] shrink-0">
        {activeSection === null ? (
          /* ─────────────────────────────────────────────────────────────────────────
             VIEW 1: PHYSIQUE ROOT MENU
             ───────────────────────────────────────────────────────────────────────── */
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-base font-normal tracking-wide text-white">Physique</h1>
              <button
                type="button"
                onClick={() => setGarmentVisible(!garmentVisible)}
                className={cn(
                  'flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-[10px] font-mono tracking-wider transition-all min-h-[26px]',
                  garmentVisible
                    ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                    : 'border-[#d09e88]/50 bg-[#d09e88]/15 text-[#e0a898]',
                )}
                title="Toggle between wearing outfit and viewing bare anatomy"
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    garmentVisible ? 'bg-[#eac87f] shadow-[0_0_4px_#eac87f]' : 'bg-[#e0a898]',
                  )}
                />
                <span>{garmentVisible ? 'OUTFIT ON' : 'ANATOMY ONLY'}</span>
              </button>
            </div>

            <div
              className="flex flex-col gap-1.5"
              role="menu"
              aria-label="Physique Sub-categories"
            >
              {PHYSIQUE_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className="group flex h-11 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]"
                  role="menuitem"
                >
                  <span className="text-xs tracking-wide text-[#d4d3d9] transition-colors group-hover:text-white truncate">
                    {sec.label}
                  </span>

                  <div className="flex items-center gap-2 shrink-0">
                    {sec.count && (
                      <span className="font-mono text-[10px] text-[#8a8793]">{sec.count}</span>
                    )}
                    {sec.badge && (
                      <span className="rounded bg-[#dfba73]/15 px-1.5 py-0.5 text-[9px] font-mono text-[#dfba73]">
                        {sec.badge}
                      </span>
                    )}
                    <span
                      className="text-sm font-light text-[#75737d] transition-colors group-hover:text-white"
                      aria-hidden
                    >
                      ›
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ─────────────────────────────────────────────────────────────────────────
             VIEW 2: PHYSIQUE DRILL-DOWN SUB-SCREEN
             ───────────────────────────────────────────────────────────────────────── */
          <div className="flex flex-col">
            {/* Breadcrumb Header */}
            <WuxiaBreadcrumbs
              category="Physique"
              subCategory={currentSection?.label}
              onBack={() => setActiveSection(null)}
            />

            {/* Sub-Category Ribbon Pill & Quick Garment Toggle */}
            <div className="mt-2.5 flex items-center justify-between">
              <WuxiaRibbonPill
                label={currentSection?.label ?? ''}
                icon={
                  <svg viewBox="0 0 24 10" className="h-2.5 w-6 fill-current text-neutral-800" aria-hidden>
                    <path d="M1 8 C6 2 16 1 23 4 C18 5 9 6 1 8 Z" />
                  </svg>
                }
              />

              <button
                type="button"
                onClick={() => setGarmentVisible(!garmentVisible)}
                className={cn(
                  'flex items-center gap-1.5 rounded-[2px] border px-2 py-0.5 text-[10px] font-mono tracking-wider transition-all min-h-[24px]',
                  garmentVisible
                    ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                    : 'border-[#d09e88]/50 bg-[#d09e88]/15 text-[#e0a898]',
                )}
                title="Toggle between wearing outfit and viewing bare anatomy"
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    garmentVisible ? 'bg-[#eac87f] shadow-[0_0_4px_#eac87f]' : 'bg-[#e0a898]',
                  )}
                />
                <span>{garmentVisible ? 'OUTFIT ON' : 'ANATOMY ONLY'}</span>
              </button>
            </div>

            {/* Sub-Section Content */}
            <div className="mt-3 flex flex-col max-h-[calc(100vh-210px)] overflow-y-auto scrollbar-none pr-1">
              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 1: WEIGHT & BASE BUILD
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'weight_build' && (
                <div className="flex flex-col gap-3">
                  {/* Master Body Weight Slider */}
                  <div className="flex flex-col gap-1.5 border-b border-[#d4b483]/14 pb-2.5">
                    <BracketSlider
                      label="BODY WEIGHT"
                      min={0}
                      max={1}
                      step={0.01}
                      value={weight}
                      disabled={!BODY_WEIGHT_ENABLED || !hasBodyPair}
                      display={!BODY_WEIGHT_ENABLED ? '0% (DISABLED)' : `${Math.round(weight * 100)}%`}
                      onChange={(v) => {
                        if (BODY_WEIGHT_ENABLED && hasBodyPair) setWeight(v);
                      }}
                    />

                    {/* Quick Weight Preset Buttons */}
                    <div className="mt-1 flex items-center justify-between gap-1.5 text-[10px] font-mono leading-none">
                      <button
                        type="button"
                        disabled={!BODY_WEIGHT_ENABLED}
                        onClick={() => setWeight(0)}
                        className={cn(
                          'flex-1 rounded-[2px] border py-1 tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed min-h-[26px]',
                          weight === 0
                            ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                            : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
                        )}
                      >
                        SLIM [0%]
                      </button>
                      <button
                        type="button"
                        disabled={!BODY_WEIGHT_ENABLED}
                        onClick={() => setWeight(0.5)}
                        className={cn(
                          'flex-1 rounded-[2px] border py-1 tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed min-h-[26px]',
                          Math.abs(weight - 0.5) < 0.02
                            ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                            : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
                        )}
                      >
                        MEDIUM [50%]
                      </button>
                      <button
                        type="button"
                        disabled={!BODY_WEIGHT_ENABLED}
                        onClick={() => setWeight(1)}
                        className={cn(
                          'flex-1 rounded-[2px] border py-1 tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed min-h-[26px]',
                          weight === 1
                            ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                            : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
                        )}
                      >
                        FULL [100%]
                      </button>
                    </div>

                    {/* Link Face to Weight */}
                    <button
                      type="button"
                      onClick={() => setLinkFaceToWeight(!linkFaceToWeight)}
                      title="FaceGen fullness and neck perimeter scale with body weight (Skyrim Creation Engine parity)"
                      className={cn(
                        'mt-1 flex w-full items-center justify-between border px-2 py-1.5 text-[10px] font-mono tracking-wider leading-tight transition-colors min-h-[26px]',
                        linkFaceToWeight
                          ? 'border-[#eac87f] bg-[#d4b483]/16 text-[#f2dfbe] font-medium shadow-[0_0_8px_rgba(212,180,131,0.2)]'
                          : 'border-[#8c8477]/30 bg-black/30 text-[#a8a294]/70 hover:border-[#d4b483]/50 hover:text-[#d5cdbd]',
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-block h-1.5 w-1.5 rounded-full transition-colors',
                            linkFaceToWeight ? 'bg-[#eac87f] shadow-[0_0_5px_#eac87f]' : 'bg-[#8c8477]/40',
                          )}
                        />
                        LINK FACE TO WEIGHT
                      </span>
                      <span className="text-[10px] font-medium uppercase text-[#c9b184] leading-tight">
                        {linkFaceToWeight ? 'ACTIVE' : 'OFF'}
                      </span>
                    </button>
                  </div>

                  {/* Master Height Slider */}
                  <div className="flex flex-col gap-1 border-b border-[#d4b483]/14 pb-2.5">
                    <BodyShapeSlider id="body.heightCm" customLabel="OVERALL HEIGHT" />
                  </div>

                  {/* Garment Layer Toggle */}
                  <div className="flex items-center justify-between border-b border-[#d4b483]/10 pb-2.5">
                    <div className="flex flex-col">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
                        GARMENT LAYER
                      </span>
                      <span className="text-[10px] text-[#a49a88] leading-tight">
                        {garmentVisible ? 'Outfits visible on model' : 'Hiding clothes for anatomy inspection'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setGarmentVisible(!garmentVisible)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-[10px] font-mono tracking-wider leading-tight transition-all',
                        garmentVisible
                          ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                          : 'border-[#d09e88]/50 bg-[#d09e88]/15 text-[#e0a898]',
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          garmentVisible ? 'bg-[#eac87f] shadow-[0_0_4px_#eac87f]' : 'bg-[#e0a898]',
                        )}
                      />
                      <span>{garmentVisible ? 'OUTFIT ON' : 'ANATOMY ONLY'}</span>
                    </button>
                  </div>

                  {/* Skin Shader Metrics */}
                  <div className="flex flex-col gap-2 border-b border-[#d4b483]/10 pb-2.5">
                    <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
                        SKIN SHADER METRICS
                      </span>
                      <span className="font-mono text-[10px] text-[#a49a88] leading-tight">SSS / GLOSS</span>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div>
                        <div className="mb-0.5 flex justify-between text-[10px] font-mono leading-tight">
                          <span className="text-[#a9a192]">SKIN GLOSS</span>
                          <span className="text-[#eac87f]">{Math.round(skinGloss * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={skinGloss}
                          onChange={(e) => setSkinGloss(parseFloat(e.target.value))}
                          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#201d18] accent-[#eac87f]"
                        />
                      </div>

                      <div>
                        <div className="mb-0.5 flex justify-between text-[10px] font-mono leading-tight">
                          <span className="text-[#a9a192]">SUBSURFACE SCATTERING</span>
                          <span className="text-[#eac87f]">{Math.round(skinSss * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={skinSss}
                          onChange={(e) => setSkinSss(parseFloat(e.target.value))}
                          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#201d18] accent-[#eac87f]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* CBPC Physics Controls */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
                        CBPC SOFT-BODY PHYSICS
                      </span>
                      <span className={cn('font-mono text-[10px] leading-tight', bodyPhysicsEnabled ? 'text-[#eac87f]' : 'text-[#8f8778]')}>
                        {bodyPhysicsEnabled ? 'ENABLED' : 'OFF'}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={triggerPhysicsImpulse}
                        title="Trigger a momentary impulse to preview physics bounce"
                        className="flex-1 rounded-[2px] border border-[#d4b483]/30 bg-black/40 py-1.5 font-mono text-[10px] tracking-wider leading-tight text-[#d8c9ad] transition-all hover:border-[#eac87f] hover:text-[#fff0d4]"
                      >
                        TEST BOUNCE
                      </button>

                      <button
                        type="button"
                        onClick={() => setWorkspace(workspace === 'physics' ? 'edit' : 'physics')}
                        className={cn(
                          'flex-1 rounded-[2px] border py-1.5 font-mono text-[10px] tracking-wider leading-tight transition-all',
                          workspace === 'physics'
                            ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.35)]'
                            : 'border-[#d4b483]/35 bg-[#d4b483]/12 text-[#e8c98e] hover:border-[#eac87f] hover:bg-[#d4b483]/22 hover:text-[#fff0d4]',
                        )}
                      >
                        <span>{workspace === 'physics' ? 'CLOSE [ESC]' : 'PHYSICS STUDIO →'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 2: TORSO & CHEST (0Necoco)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'torso_chest' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) =>
                      cat.name.includes('Boob') ||
                      cat.name.includes('Overall') ||
                      cat.name.includes('Customizing')
                    }
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 3: WAIST & HIPS (0Necoco)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'waist_hips' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) =>
                      cat.name.includes('Addons') ||
                      cat.name.includes('Other') ||
                      cat.name.includes('Xtrem')
                    }
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 4: LEGS & BUTT (0Necoco)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'legs_butt' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) =>
                      cat.name.includes('Addons') ||
                      cat.name.includes('Burger') ||
                      cat.name.includes('Other') ||
                      cat.name.includes('Hide Thigh')
                    }
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 5: HANDS & ARMS (43 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'hands_arms' && (
                <div className="flex flex-col gap-2">
                  <HandsPanel />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 6: FEET (69 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'feet' && (
                <div className="flex flex-col gap-2">
                  <FeetPanel />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 7: SKELETON SCALE (RaceMenu Bone Scaling)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'skeleton_scale' && (
                <div className="flex flex-col gap-3">
                  {/* Proportions & Stature */}
                  <div className="flex flex-col gap-1 border-b border-[#d4b483]/10 pb-2.5">
                    <div className="mb-1 flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
                        PROPORTIONS &amp; STATURE
                      </span>
                      <span className="font-mono text-[10px] text-[#a49a88] leading-tight">SKELETON SCALE</span>
                    </div>
                    {PROPORTION_SLIDERS.map((s) => (
                      <BodyShapeSlider key={s.id} id={s.id} customLabel={s.customLabel} />
                    ))}
                  </div>

                  {/* Curvature & Silhouette */}
                  <div className="flex flex-col gap-1 border-b border-[#d4b483]/10 pb-2.5">
                    <div className="mb-1 flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
                        CURVATURE &amp; SILHOUETTE
                      </span>
                      <span className="font-mono text-[10px] text-[#a49a88] leading-tight">VOLUME &amp; PROFILE</span>
                    </div>
                    {SILHOUETTE_SLIDERS.map((s) => (
                      <BodyShapeSlider key={s.id} id={s.id} customLabel={s.customLabel} />
                    ))}
                    <p className="mt-1 text-[10px] leading-relaxed text-[#a49a88]">
                      Bone-transform scaling (RaceMenu parity). 50 = baseline unchanged.
                    </p>
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
