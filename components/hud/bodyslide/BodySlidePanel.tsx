'use client';

import { useState, useMemo, useCallback } from 'react';
import { useCharacter } from '@/lib/store';
import { ANATOMY_BY_ID, type AnatomyParamId } from '@/lib/anatomy/params';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { HudSlider } from '@/components/hud/HudSlider';
import { useBodySlideStore } from '@/lib/bodyslide/store';
import { NECOCO_CATEGORIES, type BodySlideCategory, type BodySlideSliderDef } from '@/lib/bodyslide/categories';
import { runWardrobeBatchBuild, type BatchBuildProgress } from '@/lib/bodyslide/batchBuilder';
import { BatchBuildModal } from './BatchBuildModal';
import { cn } from '@/lib/cn';

/** Skeleton scale sliders preserved at the top of BodySlide (RaceMenu / bodyScale parity). */
const SKELETON_PROPORTIONS: { id: AnatomyParamId; label: string }[] = [
  { id: 'body.heightCm', label: 'HEIGHT' },
  { id: 'body.headScale', label: 'HEAD SCALE' },
  { id: 'body.armLength', label: 'ARM LENGTH' },
  { id: 'body.legLength', label: 'LEG LENGTH' },
  { id: 'body.shoulderWidth', label: 'SHOULDER WIDTH' },
];

export interface BodySlidePanelProps {
  categoryFilter?: (cat: BodySlideCategory) => boolean;
  hideSkeletonHeader?: boolean;
}

export function BodySlidePanel({ categoryFilter, hideSkeletonHeader }: BodySlidePanelProps = {}) {
  // BodySlide store
  const sliders = useBodySlideStore((s) => s.sliders);
  const userSliders = useBodySlideStore((s) => s.userSliders);
  const setSlider = useBodySlideStore((s) => s.setSlider);
  const resetSlider = useBodySlideStore((s) => s.resetSlider);
  const resetToDefaults = useBodySlideStore((s) => s.resetToDefaults);
  const clearAllSliders = useBodySlideStore((s) => s.clearAllSliders);
  const saveBodyConfig = useBodySlideStore((s) => s.saveBodyConfig);

  // Search query & batch building state
  const [searchQuery, setSearchQuery] = useState('');
  const [batchProgress, setBatchProgress] = useState<BatchBuildProgress | null>(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isBatchBuilding, setIsBatchBuilding] = useState(false);

  // 1-Click Save Body Config & Fit All Outfits
  const handleSaveAndFitAll = useCallback(async () => {
    setIsBatchBuilding(true);
    setIsBatchModalOpen(true);
    try {
      const { clothedSliders } = saveBodyConfig();
      await runWardrobeBatchBuild({
        sliders: clothedSliders,
        onProgress: (p) => setBatchProgress(p),
      });
    } catch (err) {
      console.error('[BodySlidePanel] Batch build failed:', err);
    } finally {
      setIsBatchBuilding(false);
    }
  }, [saveBodyConfig]);

  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const cat of NECOCO_CATEGORIES) {
      if (cat.defaultHidden) continue;
      // Keep first 2 open by default, collapse others for cleanliness
      initial[cat.name] = cat.name.startsWith('1 -') || cat.name.startsWith('2 -');
    }
    return initial;
  });

  // Filter out defaultHidden (e.g. Hide Thigh) to leave the core categories, applied with categoryFilter if provided
  const categories = useMemo(() => {
    const base = NECOCO_CATEGORIES.filter((c) => !c.defaultHidden);
    return categoryFilter ? base.filter(categoryFilter) : base;
  }, [categoryFilter]);

  // Filtered categories based on search
  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return categories;

    return categories
      .map((cat) => {
        const matchingSliders = cat.sliders.filter(
          (s) =>
            s.displayName.toLowerCase().includes(query) ||
            s.name.toLowerCase().includes(query),
        );
        return {
          ...cat,
          sliders: matchingSliders,
        };
      })
      .filter((cat) => cat.sliders.length > 0);
  }, [categories, searchQuery]);

  // Count active (non-zero) morphs
  const modifiedCount = useMemo(() => {
    return Object.keys(userSliders).length;
  }, [userSliders]);

  const toggleCategory = useCallback((catName: string) => {
    setExpandedCats((prev) => ({
      ...prev,
      [catName]: !prev[catName],
    }));
  }, []);

  const expandAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const c of categories) next[c.name] = true;
    setExpandedCats(next);
  }, [categories]);

  const collapseAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const c of categories) next[c.name] = false;
    setExpandedCats(next);
  }, [categories]);

  const resetCategorySliders = useCallback(
    (category: BodySlideCategory) => {
      for (const s of category.sliders) {
        resetSlider(s.name);
      }
    },
    [resetSlider],
  );

  return (
    <div className="flex flex-col gap-3 text-[#efece6]">
      {/* ── 1. Body Config Header & Save Action ────────────────── */}
      <div className="flex flex-col gap-2 border-b border-[#d4b483]/14 pb-2.5 font-mono">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#efece6] leading-tight">
            BODY SHAPE
          </span>
          <span className="text-[10px] text-[#a49a88] leading-tight">
            {modifiedCount > 0 ? (
              <span className="text-[#eac87f]">CUSTOM ({modifiedCount} MODIFIED)</span>
            ) : (
              'DEFAULT'
            )}
          </span>
        </div>

        {/* Primary Save & Batch Build Button */}
        <button
          type="button"
          onClick={handleSaveAndFitAll}
          disabled={isBatchBuilding}
          className="group relative flex flex-col items-center justify-center gap-0.5 rounded-[2px] border border-[#eac87f] bg-[#d4b483]/20 py-2 px-3 text-center transition-all hover:bg-[#d4b483]/30 hover:border-[#f2dfbe] shadow-[0_0_12px_rgba(234,200,127,0.25)] min-h-[38px] disabled:opacity-50"
          title="Save your body configuration and automatically fit femalebody + all 51 wardrobe outfits"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[#f2dfbe]">
            <span className="text-[#eac87f]">✦</span>
            <span>SAVE BODY CONFIG</span>
          </div>
          <span className="text-[9.5px] text-[#d4b483]/80 tracking-normal font-sans">
            Fits femalebody + 51 wardrobe outfits
          </span>
        </button>

        {/* Utility row: Reset */}
        <div className="flex items-center justify-between gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={resetToDefaults}
            className="flex-1 rounded-[2px] border border-[#d4b483]/20 bg-black/30 py-1 text-[10px] tracking-wider text-[#b8ad9b] transition-all hover:border-[#d4b483]/40 hover:text-[#efece6] min-h-[24px]"
            title="Reset all body sliders to default baseline"
          >
            RESET TO DEFAULTS
          </button>
          <button
            type="button"
            onClick={clearAllSliders}
            className="flex-1 rounded-[2px] border border-[#d4b483]/20 bg-black/30 py-1 text-[10px] tracking-wider text-[#b8ad9b] transition-all hover:border-[#d09e88]/50 hover:text-[#e0a898] min-h-[24px]"
            title="Zero all sliders"
          >
            ZERO ALL (0%)
          </button>
        </div>
      </div>

      <BatchBuildModal
        isOpen={isBatchModalOpen}
        progress={batchProgress}
        onClose={() => setIsBatchModalOpen(false)}
      />

      {/* ── 2. Proportions & Stature (Skeleton Scale) ────────────── */}
      {!hideSkeletonHeader && (
        <div className="flex flex-col gap-1 border-b border-[#d4b483]/14 pb-2.5">
          <div className="mb-1 flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#d4b483]">
              PROPORTIONS & STATURE
            </span>
            <span className="font-mono text-[9px] text-[#8f8778]">SKELETON SCALE</span>
          </div>
          <div className="flex flex-col gap-1">
            {SKELETON_PROPORTIONS.map((p) => (
              <SkeletonSlider key={p.id} id={p.id} label={p.label} />
            ))}
          </div>
        </div>
      )}

      {/* ── 3. High-Poly Vertex Morph Sliders ─────────────────────── */}
      <div className="flex flex-col gap-2">
        {/* Search & Collapse Controls */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 150+ body morphs..."
              className="w-full rounded-[2px] border border-[#d4b483]/20 bg-black/40 px-2 py-1 pl-6 font-mono text-[10px] text-[#efece6] placeholder:text-[#8f8778] transition-all focus:border-[#d4b483]/60 focus:bg-black/60 focus:outline-none min-h-[26px]"
            />
            <span className="absolute left-2 top-1.5 text-[10px] text-[#8f8778]">⌕</span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1 text-[11px] text-[#8f8778] hover:text-[#efece6]"
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 font-mono text-[9px]">
            <button
              type="button"
              onClick={expandAll}
              className="rounded-[2px] border border-[#d4b483]/15 bg-black/30 px-1.5 py-1 text-[#a49a88] transition-all hover:border-[#d4b483]/35 hover:text-[#efece6] min-h-[26px]"
              title="Expand all categories"
            >
              EXPAND
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="rounded-[2px] border border-[#d4b483]/15 bg-black/30 px-1.5 py-1 text-[#a49a88] transition-all hover:border-[#d4b483]/35 hover:text-[#efece6] min-h-[26px]"
              title="Collapse all categories"
            >
              COLLAPSE
            </button>
          </div>
        </div>

        {/* Categories Accordion */}
        <div className="flex flex-col gap-1.5">
          {filteredCategories.length === 0 ? (
            <div className="rounded-[2px] border border-[#d4b483]/10 bg-black/30 p-3 text-center font-mono text-[10px] text-[#8f8778]">
              No morph sliders matching &quot;{searchQuery}&quot;
            </div>
          ) : (
            filteredCategories.map((cat) => {
              const isExpanded = expandedCats[cat.name] ?? false;
              // Check how many sliders in this category are non-zero
              const catActiveCount = cat.sliders.filter(
                (s) => Math.abs(sliders[s.name] ?? 0) > 0.001,
              ).length;

              return (
                <div
                  key={cat.name}
                  className="rounded-[2px] border border-[#d4b483]/15 bg-black/25 overflow-hidden transition-all"
                >
                  {/* Category Header */}
                  <div
                    onClick={() => toggleCategory(cat.name)}
                    className="flex cursor-pointer items-center justify-between px-2.5 py-1.5 font-mono text-[10px] transition-all hover:bg-[#d4b483]/10 select-none min-h-[28px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] text-[#d4b483] transition-transform">
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      <span className="font-semibold uppercase tracking-wider text-[#e6decb]">
                        {formatCategoryName(cat.name)}
                      </span>
                      <span className="text-[9px] text-[#8f8778]">({cat.sliders.length})</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {catActiveCount > 0 && (
                        <span className="rounded-[2px] bg-[#d4b483]/20 px-1 py-0.2 text-[9px] font-bold text-[#eac87f]">
                          {catActiveCount} active
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          resetCategorySliders(cat);
                        }}
                        className="text-[9px] text-[#8f8778] transition-colors hover:text-[#d09e88]"
                        title={`Reset ${cat.name} sliders`}
                      >
                        RESET
                      </button>
                    </div>
                  </div>

                  {/* Category Sliders List */}
                  {isExpanded && (
                    <div className="flex flex-col gap-1 border-t border-[#d4b483]/10 bg-black/40 p-2">
                      {cat.sliders.map((s) => (
                        <MorphSliderRow key={s.name} slider={s} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** Individual BodySlide Morph Slider Row */
function MorphSliderRow({ slider }: { slider: BodySlideSliderDef }) {
  const value = useBodySlideStore((s) => s.sliders[slider.name] ?? slider.defaultValue ?? 0);
  const setSlider = useBodySlideStore((s) => s.setSlider);
  const resetSlider = useBodySlideStore((s) => s.resetSlider);

  const min = slider.min ?? 0;
  const max = slider.max ?? 100;
  const display = `${Math.round(value)}%`;

  return (
    <div onDoubleClick={() => resetSlider(slider.name)} className="cursor-pointer mb-1.5">
      <BracketSlider
        label={slider.displayName}
        min={min}
        max={max}
        step={1}
        value={value}
        display={display}
        onChange={(v) => setSlider(slider.name, v)}
      />
    </div>
  );
}

/** Individual Skeleton Scale Slider Row (Height, Head Scale, etc.) */
function SkeletonSlider({ id, label }: { id: AnatomyParamId; label: string }) {
  const p = ANATOMY_BY_ID[id];
  const value = useCharacter((st) => st.anatomy[id] ?? p?.default ?? 0);
  if (!p) return null;
  const isHeight = id === 'body.heightCm';

  return (
    <div
      onDoubleClick={() => useCharacter.getState().setAnatomy(id, p.default)}
      className="cursor-pointer mb-1.5"
    >
      <BracketSlider
        label={label}
        min={p.min}
        max={p.max}
        step={p.step}
        value={value}
        display={isHeight ? `${Math.round(value)} cm` : `${Math.round(value)}%`}
        onChange={(v) => {
          useCharacter.getState().beginAnatomyEdit();
          useCharacter.getState().setAnatomy(id, v);
        }}
      />
    </div>
  );
}

/** Human-friendly format for category names */
function formatCategoryName(raw: string): string {
  return raw
    .replace(/\s*\(Use this for Customizing\)/i, '')
    .replace(/\s*\(Use with Necoco Body\)/i, '')
    .trim();
}
