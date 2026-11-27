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
import { useBodySlideStore } from '@/lib/bodyslide/store';
import {
  beginPhysiqueEdit,
  endPhysiqueEdit,
  recordPhysiqueStep,
  revertPhysiqueToSaved,
  saveAndBatchBuildPhysique,
  usePhysiqueDirty,
} from '@/lib/bodyslide/physiqueHistory';

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
    <div
      onDoubleClick={() => recordPhysiqueStep(() => s().setAnatomy(id, p.default))}
      className="cursor-pointer"
      title={`Double-click to reset ${customLabel ?? p.label}`}
    >
      <BracketSlider
        label={customLabel ?? p.label}
        min={p.min}
        max={p.max}
        step={p.step}
        value={value}
        display={isHeight ? `${Math.round(value)} cm` : `${Math.round(value)}%`}
        onChangeStart={beginPhysiqueEdit}
        onChange={(v) => {
          s().setAnatomy(id, v);
        }}
        onChangeEnd={endPhysiqueEdit}
      />
    </div>
  );
}

export type PhysiqueSectionId =
  | 'weight_build'
  | 'boobs_breasts'
  | 'nipples'
  | 'upper_torso'
  | 'lower_torso'
  | 'hips_glutes'
  | 'legs_calves'
  | 'back_shoulders'
  | 'necoco_specials'
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
    badge: 'WEIGHT / CBPC',
  },
  {
    id: 'boobs_breasts',
    label: 'Breasts & Boobs (UBE)',
    badge: 'BREASTS',
    count: '21',
  },
  {
    id: 'nipples',
    label: 'Nipples & Areolae (UBE)',
    badge: 'NIPPLES',
    count: '26',
  },
  {
    id: 'upper_torso',
    label: 'Upper Torso & Chest (UBE)',
    badge: 'CHEST',
    count: '12',
  },
  {
    id: 'lower_torso',
    label: 'Lower Torso & Belly (UBE)',
    badge: 'BELLY',
    count: '26',
  },
  {
    id: 'hips_glutes',
    label: 'Hips & Glutes (UBE)',
    badge: 'HIPS / BUTT',
    count: '30',
  },
  {
    id: 'legs_calves',
    label: 'Legs & Calves (UBE)',
    badge: 'LEGS / FEET',
    count: '30',
  },
  {
    id: 'back_shoulders',
    label: 'Back & Shoulders (UBE)',
    badge: 'BACK / ARMS',
    count: '23',
  },
  {
    id: 'necoco_specials',
    label: 'Necoco & Lewd Specials',
    badge: 'SPECIALS',
    count: '47',
  },
  {
    id: 'hands_arms',
    label: 'Hands & Fingers (UBE)',
    badge: 'HANDS',
    count: '43',
  },
  {
    id: 'feet',
    label: 'Feet & Toes (UBE)',
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
  const setCameraFraming = useCharacter((s) => s.setCameraFraming);
  const cameraLockMode = useCharacter((s) => s.cameraLockMode);
  const activeSection = useCharacter((s) => s.physiqueSection) as PhysiqueSectionId | null;
  const setPhysiqueSection = useCharacter((s) => s.setPhysiqueSection);
  const isDirty = usePhysiqueDirty();
  const isBatchBuilding = useBodySlideStore((s) => s.isBatchBuilding);

  useEffect(() => {
    return () => {
      useCharacter.getState().setPhysiqueSection(null);
    };
  }, []);

  const handleSelectSection = (sectionId: PhysiqueSectionId) => {
    setPhysiqueSection(sectionId);
    if (cameraLockMode === 'locked') {
      setCameraFraming('auto');
      return;
    }
    // Free-cam framing fallback
    if (['boobs_breasts', 'nipples', 'upper_torso'].includes(sectionId)) {
      setCameraFraming('bust');
    } else if (['lower_torso', 'hips_glutes', 'back_shoulders', 'necoco_specials', 'hands_arms'].includes(sectionId)) {
      setCameraFraming('mid');
    } else if (['legs_calves', 'feet', 'weight_build', 'skeleton_scale'].includes(sectionId)) {
      setCameraFraming('body');
    }
  };

  const handleBack = () => {
    setPhysiqueSection(null);
    setCameraFraming(cameraLockMode === 'locked' ? 'auto' : 'mid');
  };

  // Global Escape key listener to return to View 1
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeSection !== null) {
        e.preventDefault();
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection, setCameraFraming]);

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
        onSelectTab={handleBack}
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
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-normal tracking-wide text-white">Physique</h1>
                <span
                  className={cn(
                    'rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] tracking-wider',
                    isDirty
                      ? 'bg-[#dfba73]/20 text-[#eac87f] border border-[#dfba73]/40'
                      : 'bg-white/5 text-[#8f8d97]',
                  )}
                >
                  {isDirty ? '● UNSAVED' : 'SAVED'}
                </span>
              </div>
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
              className="flex flex-col gap-1.5 max-h-[calc(100vh-245px)] overflow-y-auto scrollbar-none pr-1"
              role="menu"
              aria-label="Physique Sub-categories"
            >
              {PHYSIQUE_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => handleSelectSection(sec.id)}
                  className="group flex h-11 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73] min-h-[44px]"
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
                      <span className="rounded bg-[#dfba73]/15 px-1.5 py-0.5 text-[10px] font-mono text-[#dfba73]">
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

            {/* Single Physique Save & Revert Checkpoint Bar (Root Level) */}
            <div className="mt-2.5 flex items-center gap-2 border-t border-white/10 pt-2.5">
              <button
                type="button"
                onClick={() => void saveAndBatchBuildPhysique()}
                disabled={isBatchBuilding}
                title="Save body configuration & conform all 51 wardrobe outfits"
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 rounded-sm border px-3 py-2 font-mono text-[11px] font-semibold tracking-wider transition-all min-h-[38px] disabled:opacity-50',
                  isDirty
                    ? 'border-[#eac87f] bg-[#d4b483]/25 text-[#f5e6c8] shadow-[0_0_12px_rgba(234,200,127,0.28)] hover:bg-[#d4b483]/35'
                    : 'border-white/15 bg-[#1f2026]/85 text-[#cfced4] hover:border-[#dfba73]/50 hover:text-white',
                )}
              >
                <span className="text-[#eac87f]">✦</span>
                <span>{isDirty ? 'SAVE BODY CONFIG' : 'FIT & SAVE BODY'}</span>
              </button>
              {isDirty && (
                <button
                  type="button"
                  onClick={() => revertPhysiqueToSaved()}
                  title="Discard unsaved tweaks and restore last saved Physique"
                  className="rounded-sm border border-white/10 bg-[#1f2026]/85 px-3 py-2 font-mono text-[10px] tracking-wider text-[#cfc9bf] transition-colors hover:border-[#d09e88]/60 hover:text-[#e0a898] min-h-[38px]"
                >
                  REVERT
                </button>
              )}
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
              onBack={handleBack}
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
                  <div
                    className="flex flex-col gap-1.5 border-b border-[#d4b483]/14 pb-2.5"
                    title={!BODY_WEIGHT_ENABLED ? "Body weight temporarily locked to base _0 mesh for maximum stability" : undefined}
                  >
                    <BracketSlider
                      label="BODY WEIGHT"
                      min={0}
                      max={1}
                      step={0.01}
                      value={weight}
                      disabled={!BODY_WEIGHT_ENABLED || !hasBodyPair}
                      display={!BODY_WEIGHT_ENABLED ? '0% [LOCKED TO _0 BODY]' : `${Math.round(weight * 100)}%`}
                      title={!BODY_WEIGHT_ENABLED ? "Body weight temporarily locked to base _0 mesh for maximum stability" : undefined}
                      onChange={(v) => {
                        if (BODY_WEIGHT_ENABLED && hasBodyPair) setWeight(v);
                      }}
                    />

                    {/* Quick Weight Preset Buttons */}
                    <div
                      className="mt-1 flex items-center justify-between gap-1.5 text-[10px] font-mono leading-none"
                      title={!BODY_WEIGHT_ENABLED ? "Body weight temporarily locked to base _0 mesh for maximum stability" : undefined}
                    >
                      <button
                        type="button"
                        disabled={!BODY_WEIGHT_ENABLED}
                        title={!BODY_WEIGHT_ENABLED ? "Body weight temporarily locked to base _0 mesh for maximum stability" : "Set weight to 0% (Slim _0)"}
                        onClick={() => setWeight(0)}
                        className={cn(
                          'flex-1 rounded-[2px] border py-1 tracking-wider transition-all min-h-[26px]',
                          !BODY_WEIGHT_ENABLED
                            ? 'border-[#eac87f]/50 bg-[#d4b483]/15 font-bold text-[#f2dfbe] cursor-not-allowed shadow-[0_0_6px_rgba(234,200,127,0.2)]'
                            : weight === 0
                              ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                              : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
                        )}
                      >
                        {!BODY_WEIGHT_ENABLED ? 'SLIM [LOCKED]' : 'SLIM [0%]'}
                      </button>
                      <button
                        type="button"
                        disabled={!BODY_WEIGHT_ENABLED}
                        title={!BODY_WEIGHT_ENABLED ? "Body weight temporarily locked to base _0 mesh for maximum stability" : "Set weight to 50% (Medium)"}
                        onClick={() => setWeight(0.5)}
                        className={cn(
                          'flex-1 rounded-[2px] border py-1 tracking-wider transition-all min-h-[26px]',
                          !BODY_WEIGHT_ENABLED
                            ? 'border-white/5 bg-black/20 text-[#8c8477]/40 cursor-not-allowed opacity-35'
                            : Math.abs(weight - 0.5) < 0.02
                              ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                              : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
                        )}
                      >
                        MEDIUM [50%]
                      </button>
                      <button
                        type="button"
                        disabled={!BODY_WEIGHT_ENABLED}
                        title={!BODY_WEIGHT_ENABLED ? "Body weight temporarily locked to base _0 mesh for maximum stability" : "Set weight to 100% (Full _1)"}
                        onClick={() => setWeight(1)}
                        className={cn(
                          'flex-1 rounded-[2px] border py-1 tracking-wider transition-all min-h-[26px]',
                          !BODY_WEIGHT_ENABLED
                            ? 'border-white/5 bg-black/20 text-[#8c8477]/40 cursor-not-allowed opacity-35'
                            : weight === 1
                              ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                              : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
                        )}
                      >
                        FULL [100%]
                      </button>
                    </div>

                    {!BODY_WEIGHT_ENABLED && (
                      <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-[#a49a88] px-0.5 leading-tight">
                        <span className="text-[#eac87f]/90 flex items-center gap-1 font-medium">
                          <span className="inline-block h-1 w-1 rounded-full bg-[#eac87f]" />
                          [LOCKED TO _0 BODY]
                        </span>
                        <span className="text-[#8c8477]/80">STABILITY LOCK</span>
                      </div>
                    )}

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
                        className="flex-1 rounded-[2px] border border-[#d4b483]/30 bg-black/40 py-1.5 font-mono text-[10px] tracking-wider leading-tight text-[#d8c9ad] transition-all hover:border-[#eac87f] hover:text-[#fff0d4] min-h-[26px]"
                      >
                        TEST BOUNCE
                      </button>

                      <button
                        type="button"
                        onClick={() => setWorkspace(workspace === 'physics' ? 'edit' : 'physics')}
                        className={cn(
                          'flex-1 rounded-[2px] border py-1.5 font-mono text-[10px] tracking-wider leading-tight transition-all min-h-[26px]',
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
                  SUB-SECTION 2: BREASTS & BOOBS (UBE) (21 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'boobs_breasts' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) =>
                      cat.name.toLowerCase().includes('boobs') ||
                      (cat.name.toLowerCase().includes('boob') && !cat.name.toLowerCase().includes('necoco'))
                    }
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 3: NIPPLES & AREOLAE (UBE) (26 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'nipples' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) => cat.name.toLowerCase().includes('nipple')}
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 4: UPPER TORSO & CHEST (UBE) (12 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'upper_torso' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) => cat.name.toLowerCase().includes('upper torso')}
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 5: LOWER TORSO & BELLY (UBE) (26 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'lower_torso' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) => cat.name.toLowerCase().includes('lower torso')}
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 6: HIPS & GLUTES (UBE) (30 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'hips_glutes' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) =>
                      cat.name.toLowerCase().includes('hips') ||
                      cat.name.toLowerCase().includes('glutes')
                    }
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 7: LEGS & CALVES (UBE) (30 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'legs_calves' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) =>
                      cat.name.toLowerCase().includes('legs') ||
                      (cat.name.toLowerCase().includes('feet') && !cat.name.toLowerCase().includes('hands'))
                    }
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 8: BACK & SHOULDERS (UBE) (23 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'back_shoulders' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) =>
                      cat.name.toLowerCase().includes('back') ||
                      cat.name.toLowerCase().includes('shoulders') ||
                      cat.name.toLowerCase().includes('arms')
                    }
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 9: NECOCO & LEWD SPECIALS (47 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'necoco_specials' && (
                <div className="flex flex-col gap-2">
                  <BodySlidePanel
                    hideSkeletonHeader
                    categoryFilter={(cat) =>
                      cat.name.toLowerCase().includes('necoco') ||
                      cat.name.toLowerCase().includes('lewd') ||
                      cat.name.toLowerCase().includes('presets') ||
                      cat.name.toLowerCase().includes('xtrem') ||
                      cat.name.toLowerCase().includes('burger') ||
                      cat.name.toLowerCase().includes('outfit zip')
                    }
                  />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 10: HANDS & FINGERS (UBE) (43 Morphs)
                  ─────────────────────────────────────────────────────────── */}
              {activeSection === 'hands_arms' && (
                <div className="flex flex-col gap-2">
                  <HandsPanel />
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────
                  SUB-SECTION 11: FEET & TOES (UBE) (69 Morphs)
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
