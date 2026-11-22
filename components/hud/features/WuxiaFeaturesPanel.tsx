'use client';

import React, { useState, useEffect } from 'react';
import { useCharacter } from '@/lib/store';
import { WuxiaSubCategoryRail } from '@/components/hud/common/WuxiaSubCategoryRail';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { FACE_SECTIONS, type FaceSectionId } from '@/lib/faceControls';
import { ControlColumn } from '@/components/hud/shell/ControlColumn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

export interface WuxiaFeaturesPanelProps {
  manifest?: Mo2Manifest | null;
}

/**
 * WuxiaFeaturesPanel implements the canonical Wuxia Two-Level Hierarchical Standard:
 * - View 1: Root Menu showing category title "Features" and vertical stack of 8 sub-category cards:
 *   Face Shape, Eyes, Nose, Lips, Ears, Brows, Cheeks, Jaw & chin.
 * - View 2: Drill-Down Sub-Screen with WuxiaBreadcrumbs, WuxiaRibbonPill, and ControlColumn sliders/3D handles.
 * - Escape key, breadcrumb button, and Left Rail tab return to View 1.
 * - Zero visible scrollbars (scrollbar-none).
 */
export function WuxiaFeaturesPanel({ manifest: _manifest }: WuxiaFeaturesPanelProps) {
  const [activeSection, setActiveSection] = useState<FaceSectionId | null>(null);

  // Global Escape key handler to return to View 1
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

  const handleSelectSection = (sectionId: FaceSectionId) => {
    const sec = FACE_SECTIONS.find((s) => s.id === sectionId);
    if (!sec) return;
    const state = useCharacter.getState();
    state.endFaceEdit();
    if (sec.region) {
      state.setActiveRegion(sec.region);
    }
    setActiveSection(sectionId);
  };

  const currentSection = activeSection
    ? FACE_SECTIONS.find((s) => s.id === activeSection)
    : null;

  return (
    <div className="flex items-start gap-4 md:gap-5 select-none text-white pointer-events-auto">
      {/* 1. Left Sub-Category Rail (72px) */}
      <WuxiaSubCategoryRail
        activeTab="features"
        onSelectTab={() => setActiveSection(null)}
      />

      {/* ─────────────────────────────────────────────────────────────────────────────
          MAIN CONTENT AREA: Root Menu (View 1) OR Drill-Down (View 2)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col w-[300px] md:w-[330px] shrink-0">
        {activeSection === null ? (
          /* ─────────────────────────────────────────────────────────────────────────
             VIEW 1: FEATURES ROOT MENU (8 Facial Feature Cards)
             ───────────────────────────────────────────────────────────────────────── */
          <div className="flex flex-col">
            <h1 className="text-base font-normal tracking-wide text-white mb-3">Features</h1>

            <div
              className="flex flex-col gap-1.5"
              role="menu"
              aria-label="Facial Feature Categories"
            >
              {FACE_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => handleSelectSection(sec.id)}
                  className="group flex h-11 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73] cursor-pointer pointer-events-auto"
                  role="menuitem"
                >
                  <span className="text-xs tracking-wide text-[#d4d3d9] transition-colors group-hover:text-white">
                    {sec.label}
                  </span>
                  <span
                    className="text-sm font-light text-[#75737d] transition-colors group-hover:text-white"
                    aria-hidden
                  >
                    ›
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ─────────────────────────────────────────────────────────────────────────
             VIEW 2: FEATURES DRILL-DOWN SUB-SCREEN
             ───────────────────────────────────────────────────────────────────────── */
          <div className="flex flex-col">
            {/* Breadcrumb Header */}
            <WuxiaBreadcrumbs
              category="Features"
              subCategory={currentSection?.label}
              onBack={() => setActiveSection(null)}
            />

            {/* Sub-Category Ribbon Pill */}
            <div className="mt-2.5 flex items-center">
              <WuxiaRibbonPill
                label={currentSection?.label ?? ''}
                icon={
                  <svg viewBox="0 0 24 10" className="h-2.5 w-6 fill-current text-neutral-800" aria-hidden>
                    <path d="M1 8 C6 2 16 1 23 4 C18 5 9 6 1 8 Z" />
                  </svg>
                }
              />
            </div>

            {/* Sliders & 3D Gizmo Controls */}
            <div className="mt-3 flex flex-col max-h-[calc(100vh-210px)] overflow-y-auto scrollbar-none pr-1">
              <ControlColumn section={activeSection} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
