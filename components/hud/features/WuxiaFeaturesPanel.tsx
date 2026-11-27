'use client';

import React, { useEffect, useMemo } from 'react';
import { useCharacter } from '@/lib/store';
import { WuxiaSubCategoryRail } from '@/components/hud/common/WuxiaSubCategoryRail';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { SegmentedControl } from '@/components/hud/common/SegmentedControl';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { FACE_SECTIONS, faceControlIds, type FaceSectionId } from '@/lib/faceControls';
import { getFaceSlidersForSection } from '@/lib/morphs/faceMorphStore';
import { REGIONS_BY_ID, SLIDER_DEFS, type RegionId, type TransformMode } from '@/lib/regions';
import { ANATOMY_BY_ID } from '@/lib/anatomy/params';
import { ANATOMY_BINDINGS, anatomySliderBank } from '@/lib/anatomy/bind';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

export interface WuxiaFeaturesPanelProps {
  manifest?: Mo2Manifest | null;
}

const TRANSFORM_MODES: ReadonlyArray<{ id: TransformMode; label: string }> = [
  { id: 'translate', label: 'Move' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'scale', label: 'Scale' },
];

const FEATURE_MODES: ReadonlyArray<{ id: 'sculpt' | 'handle'; label: string }> = [
  { id: 'sculpt', label: 'Sculpt' },
  { id: 'handle', label: '3D Handle' },
];

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function isSectionModified(
  sectionId: FaceSectionId,
  regionId: RegionId | null,
  faceMorphs: Record<string, number>,
  sliders: ReturnType<typeof useCharacter.getState>['sliders'],
  poses: ReturnType<typeof useCharacter.getState>['poses'],
): boolean {
  const triDefs = getFaceSlidersForSection(sectionId);
  if (triDefs.some((d) => Math.abs(faceMorphs[d.name] ?? 0) > 0.001)) return true;
  if (!regionId) return false;
  const regDef = REGIONS_BY_ID[regionId];
  const vals = sliders[regionId];
  if (regDef && vals && SLIDER_DEFS.some((s) => Math.abs((vals[s.id] ?? 0) - (regDef.defaults[s.id] ?? 0)) > 1e-4)) {
    return true;
  }
  const pose = poses[regionId];
  if (pose && (pose.offset.some((v) => Math.abs(v) > 1e-4) || pose.rotation.some((v) => Math.abs(v) > 1e-4) || pose.scale.some((v) => Math.abs(v) > 1e-4))) {
    return true;
  }
  return false;
}

/**
 * WuxiaFeaturesPanel implements the canonical Wuxia Two-Level Hierarchical Standard:
 * - View 1: Category Root Menu of the 8 anatomical facial sections with edit badges.
 * - View 2: Drill-Down Sub-Screen combining CharGen `.tri` Vertex Morphs (`Sculpt`)
 *   and interactive bone handles (`3D Handle`) with clean Wuxia controls.
 */
export function WuxiaFeaturesPanel({ manifest: _manifest }: WuxiaFeaturesPanelProps) {
  const activeSection = useCharacter((s) => s.featuresSection);
  const setFeaturesSection = useCharacter((s) => s.setFeaturesSection);
  const featuresMode = useCharacter((s) => s.featuresMode);
  const setFeaturesMode = useCharacter((s) => s.setFeaturesMode);
  const faceMorphs = useCharacter((s) => s.faceMorphs);
  const sliders = useCharacter((s) => s.sliders);
  const poses = useCharacter((s) => s.poses);
  const transformMode = useCharacter((s) => s.transformMode);
  const showMesh = useCharacter((s) => s.showMesh);
  const anatomy = useCharacter((s) => s.anatomy);
  const anatomyMode = useCharacter((s) => s.anatomyMode);
  const state = useCharacter.getState;

  // Clear section drill-down if leaving Features panel
  useEffect(() => {
    return () => {
      useCharacter.getState().setFeaturesSection(null);
    };
  }, []);

  // Global Escape key handler to return to View 1
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeSection !== null) {
        e.preventDefault();
        setFeaturesSection(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection, setFeaturesSection]);

  const handleSelectSection = (sectionId: FaceSectionId) => {
    state().endFaceEdit();
    setFeaturesSection(sectionId);
  };

  const currentSection = activeSection
    ? FACE_SECTIONS.find((s) => s.id === activeSection) ?? null
    : null;

  const regionId: RegionId | null = currentSection?.region ?? null;
  const triSliders = useMemo(
    () => (activeSection ? getFaceSlidersForSection(activeSection) : []),
    [activeSection],
  );
  const hasTriSculpt = triSliders.length > 0;
  const effectiveMode = hasTriSculpt ? featuresMode : 'handle';

  const effectiveBoneSliders = useMemo(() => {
    if (!regionId) return null;
    const base = sliders[regionId];
    return anatomyMode === 'advanced' ? anatomySliderBank(regionId, anatomy, base) : base;
  }, [regionId, sliders, anatomy, anatomyMode]);

  const shapingIds = useMemo(
    () => (regionId ? faceControlIds(regionId) : []),
    [regionId],
  );

  return (
    <div className="flex items-start gap-3 sm:gap-4 md:gap-5 select-none text-white pointer-events-auto">
      {/* 1. Left Sub-Category Rail (72px) */}
      <WuxiaSubCategoryRail
        activeTab="features"
        onSelectTab={() => setFeaturesSection(null)}
      />

      {/* 2. Main Panel Area: Root Menu (View 1) OR Drill-Down (View 2) */}
      <div className="flex flex-col w-[calc(100vw-108px)] sm:w-[310px] md:w-[330px] max-w-[330px] shrink-0">
        {activeSection === null ? (
          /* ─── VIEW 1: FEATURES ROOT MENU ─── */
          <div className="flex flex-col">
            <h1 className="text-base md:text-lg font-normal tracking-wide text-white mb-3">
              Features
            </h1>

            <div
              className="flex flex-col gap-1.5 max-h-[calc(100vh-195px)] overflow-y-auto scrollbar-none pr-0.5"
              role="menu"
              aria-label="Facial Feature Categories"
            >
              {FACE_SECTIONS.map((sec) => {
                const modified = isSectionModified(sec.id, sec.region, faceMorphs, sliders, poses);
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => handleSelectSection(sec.id)}
                    className="group flex h-11 min-h-[44px] shrink-0 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73] cursor-pointer pointer-events-auto"
                    role="menuitem"
                  >
                    <span className="flex items-center gap-2 text-xs tracking-wide text-[#d4d3d9] transition-colors group-hover:text-white">
                      <span>{sec.label}</span>
                      {modified && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-[#eac87f] shadow-[0_0_6px_rgba(234,200,127,0.75)]"
                          title="Modified"
                          aria-label="Modified"
                        />
                      )}
                    </span>
                    <span
                      className="text-sm font-light text-[#75737d] transition-colors group-hover:text-white"
                      aria-hidden
                    >
                      ›
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* ─── VIEW 2: FEATURES DRILL-DOWN SUB-SCREEN ─── */
          <div className="flex flex-col">
            {/* Breadcrumb Header */}
            <WuxiaBreadcrumbs
              category="Features"
              subCategory={currentSection?.label}
              onBack={() => setFeaturesSection(null)}
            />

            {/* Ribbon Pill + Mesh Toggle + Region Reset */}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <WuxiaRibbonPill
                label={currentSection?.label ?? ''}
                icon={
                  <svg viewBox="0 0 24 10" className="h-2.5 w-6 fill-current text-neutral-800" aria-hidden>
                    <path d="M1 8 C6 2 16 1 23 4 C18 5 9 6 1 8 Z" />
                  </svg>
                }
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={showMesh}
                  onClick={() => state().setShowMesh(!showMesh)}
                  className={`flex h-7 min-h-[28px] items-center gap-1.5 rounded-sm border px-2.5 text-[10px] font-medium tracking-wider uppercase transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f] ${
                    showMesh
                      ? 'border-[#63d9e2]/60 bg-[#63d9e2]/15 text-[#d9feff]'
                      : 'border-white/10 bg-[#1f2026]/80 text-[#c4bcae] hover:border-[#63d9e2]/40 hover:text-white'
                  }`}
                  title="Toggle interactive cyan wireframe net on the face"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      showMesh ? 'bg-[#63d9e2] shadow-[0_0_6px_#63d9e2]' : 'bg-[#686670]'
                    }`}
                    aria-hidden
                  />
                  <span>Mesh</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    state().resetFaceRegion();
                    state().showToast(`Reset ${currentSection?.label ?? 'region'}`);
                  }}
                  className="flex h-7 min-h-[28px] items-center gap-1 rounded-sm border border-white/10 bg-[#1f2026]/80 px-2.5 text-[10px] font-medium tracking-wider uppercase text-[#c4bcae] transition-colors hover:border-[#dfba73]/50 hover:text-[#eac87f] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]"
                  title="Reset current region sliders & sculpt"
                >
                  <span aria-hidden>↺</span>
                  <span>Reset</span>
                </button>
              </div>
            </div>

            {/* Sculpt vs 3D Handle Switch (shown when CharGen .tri morphs exist) */}
            {hasTriSculpt && (
              <div className="mt-2.5">
                <SegmentedControl
                  segments={FEATURE_MODES}
                  value={effectiveMode}
                  onChange={setFeaturesMode}
                  ariaLabel="Feature editing mode"
                  className="[&>button]:min-h-[28px]"
                />
              </div>
            )}

            {/* Scrollable Sculpt / Handle Content (Zero Visible Scrollbars) */}
            <div className="mt-3 flex flex-col gap-3 max-h-[calc(100vh-245px)] overflow-y-auto scrollbar-none pr-1 pb-2">
              <p className="text-[10px] tracking-wide text-[#95d6dc]/90 px-0.5">
                {showMesh
                  ? 'Mesh On: click any zone or drag directly on the cyan net to sculpt.'
                  : 'Turn on Mesh above to highlight and drag facial zones directly on the 3D face.'}
              </p>
              {effectiveMode === 'sculpt' && hasTriSculpt ? (
                <div className="rounded-sm border border-white/8 bg-[#181920]/70 p-3 flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-white/8 pb-1.5">
                    <span className="text-[10px] tracking-[0.14em] uppercase text-[#c9b796]">
                      CharGen Morph Sculpt
                    </span>
                    <span className="text-[10px] text-[#8d8882]">Double-click to reset</span>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {triSliders.map((def) => {
                      const val = faceMorphs[def.name] ?? def.defaultValue;
                      return (
                        <div
                          key={def.name}
                          onDoubleClick={() => {
                            state().beginFaceEdit();
                            state().setFaceMorph(def.name, def.defaultValue);
                            state().endFaceEdit();
                          }}
                          className="cursor-pointer py-0.5"
                          title="Double-click to reset slider"
                        >
                          <BracketSlider
                            label={def.label}
                            value={val}
                            min={def.min}
                            max={def.max}
                            step={def.step}
                            display={`[${signed(Math.round(val))}]`}
                            onChangeStart={() => state().beginFaceEdit()}
                            onChangeEnd={() => state().endFaceEdit()}
                            onChange={(nextVal) => state().setFaceMorph(def.name, nextVal)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  {/* 3D Gizmo Transform Toolbar */}
                  <div className="rounded-sm border border-white/8 bg-[#181920]/70 p-3 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] tracking-[0.14em] uppercase text-[#c9b796]">
                        3D Handle Mode
                      </span>
                      <span className="text-[10px] text-[#8d8882]">Drag arrows or net</span>
                    </div>
                    <SegmentedControl
                      segments={TRANSFORM_MODES}
                      value={transformMode}
                      onChange={(m) => state().setTransformMode(m)}
                      ariaLabel="3D handle transform mode"
                      className="[&>button]:min-h-[28px]"
                    />
                  </div>

                  {/* Region Bone Sliders */}
                  {regionId && effectiveBoneSliders && (
                    <div className="rounded-sm border border-white/8 bg-[#181920]/70 p-3 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between border-b border-white/8 pb-1.5">
                        <span className="text-[10px] tracking-[0.14em] uppercase text-[#c9b796]">
                          Region Bone Transform
                        </span>
                        <span className="text-[10px] text-[#8d8882]">Double-click to reset</span>
                      </div>
                      {SLIDER_DEFS.map((def) => {
                        const val = effectiveBoneSliders[def.id] ?? 0;
                        return (
                          <div
                            key={def.id}
                            onDoubleClick={() => {
                              state().beginFaceEdit();
                              state().setSlider(def.id, REGIONS_BY_ID[regionId].defaults[def.id] ?? 0);
                              state().endFaceEdit();
                            }}
                            className="cursor-pointer py-0.5"
                            title="Double-click to reset slider"
                          >
                            <BracketSlider
                              label={def.label}
                              value={val}
                              min={def.min}
                              max={def.max}
                              step={def.step}
                              display={def.format(val)}
                              onChangeStart={() => state().beginFaceEdit()}
                              onChangeEnd={() => state().endFaceEdit()}
                              onChange={(nextVal) => state().setSlider(def.id, nextVal)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Wired Fine-Tuning Anatomy Channels (if present for this region) */}
                  {shapingIds.length > 0 && (
                    <div className="rounded-sm border border-white/8 bg-[#181920]/70 p-3 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between border-b border-white/8 pb-1.5">
                        <span className="text-[10px] tracking-[0.14em] uppercase text-[#c9b796]">
                          Fine Bone Balance
                        </span>
                      </div>
                      {shapingIds.map((id) => {
                        const param = ANATOMY_BY_ID[id];
                        const binding = ANATOMY_BINDINGS[id as keyof typeof ANATOMY_BINDINGS];
                        const value = anatomy[id];
                        return (
                          <div
                            key={id}
                            onDoubleClick={() => {
                              state().beginFaceEdit();
                              state().setAnatomy(id, param.default);
                              state().endFaceEdit();
                            }}
                            className="cursor-pointer py-0.5"
                            title="Double-click to reset slider"
                          >
                            <BracketSlider
                              label={param.label}
                              value={value}
                              min={param.min}
                              max={param.max}
                              step={param.step}
                              display={
                                binding
                                  ? `${signed(Math.round(value - param.default))}`
                                  : `[${Math.round(value)}]`
                              }
                              onChangeStart={() => state().beginFaceEdit()}
                              onChangeEnd={() => state().endFaceEdit()}
                              onChange={(nextVal) => {
                                if (anatomyMode !== 'advanced') state().setAnatomyMode('advanced');
                                state().setAnatomy(id, nextVal);
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
