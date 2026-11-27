'use client';

import React, { useEffect } from 'react';
import {
  useBuilderStore,
  type BuilderCategory,
} from '@/lib/builderStore';
import {
  BUILDER_CATEGORY_META,
  INTERACT_LABELS,
  getCatalogByCategory,
} from '@/lib/builderCatalog';
import { BlueprintMinimap } from '@/components/builder/BlueprintMinimap';
import { ItemTile } from '@/components/hud/common/ItemTile';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { cn } from '@/lib/cn';

function CategoryGlyph({ id }: { id: BuilderCategory }) {
  switch (id) {
    case 'walls':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 5v14M12 5v14M4 10h8M12 14h8M20 5v14" />
        </svg>
      );
    case 'floors':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <path d="M4 12h16M12 4v16" />
        </svg>
      );
    case 'windows':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <path d="M12 4v16M4 12h16" />
        </svg>
      );
    case 'furniture':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M3 13a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4H3v-4zM5 17v2M19 17v2" />
        </svg>
      );
    case 'decor':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 20v-7M12 13c-3 0-5-2.5-5-5.5 2.5 0 4.5 1.5 5 4M12 13c3 0 5-2.5 5-5.5-2.5 0-4.5 1.5-5 4M8 20h8" />
        </svg>
      );
    case 'lighting':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M8 10h8l-1.5-5h-5L8 10zM12 10v9M9 19h6" />
        </svg>
      );
  }
}

/**
 * Left Room Builder catalog panel:
 * - Top: Blueprint Minimap
 * - Middle: Category Icon Tabs (`WALLS / FLOORS / WINDOWS / FURNITURE / DECOR / LIGHTS`)
 * - Two-level hierarchical browse (Root sub-group strip or drilled-down Breadcrumb + Ribbon Pill)
 * - 3-column `ItemTile` grid with authentic Kenney isometric thumbnails
 */
export function BuilderPanel() {
  const mode = useBuilderStore((s) => s.mode);
  const activeCategory = useBuilderStore((s) => s.activeCategory);
  const activeSubCategory = useBuilderStore((s) => s.activeSubCategory);
  const ghostCatalogId = useBuilderStore((s) => s.ghostCatalogId);
  const selectedItemId = useBuilderStore((s) => s.selectedItemId);
  const placedItems = useBuilderStore((s) => s.placedItems);

  const setCategory = useBuilderStore((s) => s.setCategory);
  const setSubCategory = useBuilderStore((s) => s.setSubCategory);
  const setGhost = useBuilderStore((s) => s.setGhost);
  const setMode = useBuilderStore((s) => s.setMode);
  const resetStarterRoom = useBuilderStore((s) => s.resetStarterRoom);
  const clearAll = useBuilderStore((s) => s.clearAll);

  const currentMeta =
    BUILDER_CATEGORY_META.find((m) => m.id === activeCategory) ?? BUILDER_CATEGORY_META[0];
  const items = getCatalogByCategory(activeCategory, activeSubCategory);

  if (mode === 'tour') {
    return null;
  }

  return (
    <aside
      aria-label="Room Builder Catalog"
      className="pointer-events-auto flex max-h-[calc(100dvh-118px)] w-[274px] sm:w-[322px] flex-col rounded-[4px] border border-[#d4b483]/35 bg-[#15161c]/90 p-2.5 sm:p-3 text-[#f2efe8] shadow-[0_14px_40px_rgba(0,0,0,0.65)] backdrop-blur-md select-none"
    >
      {/* Top 2D Blueprint Minimap */}
      <BlueprintMinimap />

      {/* Category Icon Strip (matches 5 canonical reference tabs: WALLS / FLOORS / WINDOWS / FURNITURE / DECOR) */}
      <div
        role="tablist"
        aria-label="Room Item Categories"
        className="mt-2.5 grid grid-cols-5 gap-1 border-b border-white/10 pb-2"
      >
        {BUILDER_CATEGORY_META.map((cat) => {
          const isActive = cat.id === activeCategory;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setCategory(cat.id)}
              title={cat.label}
              className={cn(
                'flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-[2px] border px-0.5 py-1 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]',
                isActive
                  ? 'border-[#dfba73] bg-[#dfba73]/18 text-[#f2dfbe] shadow-[0_0_8px_rgba(223,186,115,0.22)]'
                  : 'border-transparent bg-transparent text-[#8c8a92] hover:border-white/15 hover:bg-white/[0.04] hover:text-white',
              )}
            >
              <CategoryGlyph id={cat.id} />
              <span className="font-sans text-[10px] leading-none tracking-tight uppercase">
                {cat.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Wuxia 2-Level Navigation Header (Sub-group chips vs Drill-down Breadcrumb + Ribbon) */}
      <div className="mt-2.5 shrink-0">
        {activeSubCategory ? (
          <div className="flex flex-col gap-2 pb-1.5">
            <WuxiaBreadcrumbs
              category={currentMeta.label}
              subCategory={activeSubCategory}
              onBack={() => setSubCategory(null)}
            />
            <div className="flex items-center justify-between">
              <WuxiaRibbonPill label={activeSubCategory} />
              <button
                type="button"
                onClick={() => setSubCategory(null)}
                className="min-h-[24px] px-2 font-mono text-[10px] text-[#a7a29b] hover:text-white"
              >
                All ›
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 pb-2">
            {currentMeta.subcategories.map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setSubCategory(sub)}
                className="flex min-h-[26px] items-center gap-1 rounded-sm border border-white/10 bg-[#1f2026]/80 px-2.5 py-1 text-[10px] font-mono tracking-wide text-[#cbc6bd] transition-colors hover:border-[#dfba73]/50 hover:bg-[#272830] hover:text-white focus-visible:outline focus-visible:outline-[#eac87f]"
              >
                <span>{sub}</span>
                <span className="text-[#7e7b84]">›</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3-Column Asset Thumbnail Grid (zero visible scrollbars) */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 scrollbar-none">
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => {
            const isSelected = ghostCatalogId === item.id;
            const interactLabel = item.interactTag ? INTERACT_LABELS[item.interactTag].label : null;
            return (
              <ItemTile
                key={item.id}
                id={`builder-${item.id}`}
                title={item.label}
                subtitle={interactLabel ? `Interactive: ${interactLabel}` : item.subcategory}
                isSelected={isSelected}
                badge={item.interactTag ? '★ E' : undefined}
                onClick={() => {
                  if (isSelected) {
                    setGhost(null);
                  } else {
                    setGhost(item.id);
                    // Selecting a floor/furniture/decor automatically enters DECORATE placement
                    if (item.category === 'walls' && mode !== 'build') {
                      setMode('build');
                      setGhost(item.id);
                    } else if (item.category !== 'walls' && mode === 'build') {
                      setMode('decorate');
                      setGhost(item.id);
                    }
                  }
                }}
                thumbnail={
                  <div className="flex h-full w-full flex-col items-center justify-between px-1 py-1.5">
                    <img
                      src={item.thumbnail}
                      alt={item.label}
                      loading="lazy"
                      className="h-[44px] w-[44px] sm:h-[48px] sm:w-[48px] object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.6)] transition-transform duration-150 group-hover:scale-105"
                    />
                    <span className="w-full truncate text-center font-sans text-[10px] leading-tight text-[#d8d3cb]">
                      {item.label}
                    </span>
                  </div>
                }
              />
            );
          })}
        </div>
      </div>

      {/* Room Utilities Footer */}
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-[10px] font-mono">
        <span className="text-[#9f9aa2]">{placedItems.length} placed</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={resetStarterRoom}
            className="min-h-[26px] rounded-[2px] border border-white/15 bg-[#202128] px-2 text-[10px] tracking-wider text-[#d4cfc6] hover:border-[#dfba73]/50 hover:text-white"
          >
            Starter
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="min-h-[26px] rounded-[2px] border border-[#b56a5a]/35 bg-[#25181a]/70 px-2 text-[10px] tracking-wider text-[#e0a296] hover:border-[#d7443e] hover:text-white"
          >
            Clear
          </button>
        </div>
      </div>
    </aside>
  );
}
