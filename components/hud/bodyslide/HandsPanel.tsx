'use client';

import React, { useMemo, useState } from 'react';
import { useBodySlideStore } from '@/lib/bodyslide/store';
import { NECOCO_HAND_CATEGORIES } from '@/lib/bodyslide/categories';
import { BracketSlider } from '@/components/hud/common/BracketSlider';

export function HandsPanel() {
  const sliders = useBodySlideStore((s) => s.sliders);
  const setSlider = useBodySlideStore((s) => s.setSlider);
  const resetSlider = useBodySlideStore((s) => s.resetSlider);

  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const cat of NECOCO_HAND_CATEGORIES) {
      initial[cat.name] = !cat.defaultHidden;
    }
    return initial;
  });

  const toggleCategory = (catName: string) => {
    setExpanded((prev) => ({
      ...prev,
      [catName]: !prev[catName],
    }));
  };

  const resetAllHands = () => {
    for (const cat of NECOCO_HAND_CATEGORIES) {
      for (const s of cat.sliders) {
        resetSlider(s.name);
      }
    }
  };

  const resetCategory = (catName: string) => {
    const cat = NECOCO_HAND_CATEGORIES.find((c) => c.name === catName);
    if (!cat) return;
    for (const s of cat.sliders) {
      resetSlider(s.name);
    }
  };

  // Filter categories and sliders by search term
  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return NECOCO_HAND_CATEGORIES;

    return NECOCO_HAND_CATEGORIES.map((cat) => {
      const matchingSliders = cat.sliders.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.displayName.toLowerCase().includes(q),
      );
      return {
        ...cat,
        sliders: matchingSliders,
      };
    }).filter((cat) => cat.sliders.length > 0);
  }, [searchQuery]);

  const totalSlidersCount = useMemo(() => {
    return filteredCategories.reduce((acc, c) => acc + c.sliders.length, 0);
  }, [filteredCategories]);

  return (
    <div className="flex flex-col gap-3">
      {/* ── Top Action Bar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-[4px] border border-[#d4b483]/20 bg-black/30 p-2 backdrop-blur-md">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#efece6]">
          HANDS &amp; CLAWS MORPHS
        </span>
        <button
          type="button"
          onClick={resetAllHands}
          className="min-h-[24px] rounded px-2 font-mono text-[10px] text-[#a49a88] transition-colors hover:bg-white/5 hover:text-[#d4b483]"
          title="Reset all hand sliders to 0"
        >
          [RESET HANDS]
        </button>
      </div>

      {/* ── Search Bar ─────────────────────────────────────────────── */}
      <div className="relative flex items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`Search ${totalSlidersCount} hand & finger sliders...`}
          className="min-h-[30px] w-full rounded border border-[#d4b483]/20 bg-black/40 px-2.5 font-mono text-[10px] text-[#efece6] placeholder-[#a49a88]/60 focus:border-[#eac87f] focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2 min-h-[24px] px-1 font-mono text-[10px] text-[#a49a88] hover:text-[#efece6]"
          >
            &times;
          </button>
        )}
      </div>

      {/* ── Accordion Category List ─────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {filteredCategories.map((cat) => {
          const isExpanded = expanded[cat.name] ?? true;
          const activeCount = cat.sliders.filter((s) => (sliders[s.name] ?? 0) !== 0).length;

          return (
            <div
              key={cat.name}
              className="flex flex-col rounded-[3px] border border-[#d4b483]/15 bg-black/20"
            >
              {/* Category Header Bar */}
              <div
                className="flex min-h-[28px] cursor-pointer items-center justify-between px-2.5 py-1.5 transition-colors hover:bg-white/5 select-none"
                onClick={() => toggleCategory(cat.name)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[#d4b483]">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#efece6]">
                    {cat.name}
                  </span>
                  {activeCount > 0 && (
                    <span className="rounded bg-[#d4b483]/20 px-1.5 py-0.2 font-mono text-[10px] text-[#eac87f]">
                      {activeCount} active
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[#a49a88]">
                    {cat.sliders.length} sliders
                  </span>
                  {activeCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        resetCategory(cat.name);
                      }}
                      className="min-h-[24px] px-1 font-mono text-[10px] text-[#a49a88] hover:text-[#eac87f]"
                      title="Reset this category"
                    >
                      [RESET]
                    </button>
                  )}
                </div>
              </div>

              {/* Collapsible Sliders List */}
              {isExpanded && (
                <div className="flex flex-col gap-1 border-t border-[#d4b483]/10 px-2.5 pt-2 pb-1">
                  {cat.sliders.map((s) => {
                    const val = sliders[s.name] ?? s.defaultValue ?? 0;
                    return (
                      <div key={s.name} className="group relative mb-1">
                        <BracketSlider
                          label={s.displayName.toUpperCase()}
                          min={s.min ?? 0}
                          max={s.max ?? 100}
                          step={1}
                          value={val}
                          display={`${Math.round(val)}%`}
                          onChange={(v) => setSlider(s.name, v)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
