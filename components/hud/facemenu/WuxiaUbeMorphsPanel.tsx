'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { SearchInput } from '@/components/hud/common/SearchInput';
import {
  loadUbeCategory,
  loadUbeMorphIndex,
  type UbeMorphCategoryId,
  type UbeMorphIndex,
} from '@/lib/morphs/ubeMorphLoader';

export function WuxiaUbeMorphsPanel() {
  const [index, setIndex] = useState<UbeMorphIndex | null>(null);
  const [activeCat, setActiveCat] = useState<UbeMorphCategoryId | null>(null);
  const [loadingCat, setLoadingCat] = useState(false);
  const [query, setQuery] = useState('');

  const ubeMorphs = useCharacter((s) => s.ubeMorphs);
  const setUbeMorph = useCharacter((s) => s.setUbeMorph);
  const resetUbeMorphCategory = useCharacter((s) => s.resetUbeMorphCategory);
  const resetUbeMorphs = useCharacter((s) => s.resetUbeMorphs);

  useEffect(() => {
    let cancelled = false;
    void loadUbeMorphIndex().then((res) => {
      if (!cancelled && res) setIndex(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeCat !== null) {
        e.preventDefault();
        setActiveCat(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeCat]);

  const handleOpenCategory = (catId: UbeMorphCategoryId) => {
    setActiveCat(catId);
    setQuery('');
    setLoadingCat(true);
    void loadUbeCategory(catId).finally(() => setLoadingCat(false));
  };

  const currentCategory = useMemo(
    () => (activeCat ? index?.categories.find((c) => c.id === activeCat) ?? null : null),
    [index, activeCat],
  );

  const filteredSliders = useMemo(() => {
    if (!currentCategory) return [];
    const q = query.trim().toLowerCase();
    if (!q) return currentCategory.sliders;
    return currentCategory.sliders.filter(
      (s) => s.label.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );
  }, [currentCategory, query]);

  return (
    <div className="flex flex-col w-[calc(100vw-108px)] sm:w-[310px] md:w-[330px] max-w-[330px] shrink-0 select-none text-white pointer-events-auto">
      {activeCat === null ? (
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base md:text-lg font-normal tracking-wide text-white">
              UBE Morphs
            </h1>
            <button
              type="button"
              onClick={resetUbeMorphs}
              className="flex min-h-[28px] items-center gap-1 rounded-sm border border-white/10 bg-[#1f2026]/80 px-2.5 text-[10px] tracking-wider uppercase text-[#c4bcae] hover:border-[#dfba73]/50 hover:text-[#eac87f] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]"
            >
              <span aria-hidden>↺</span>
              <span>Reset All</span>
            </button>
          </div>

          <div
            className="flex flex-col gap-1.5 max-h-[calc(100vh-195px)] overflow-y-auto scrollbar-none pr-0.5"
            role="menu"
            aria-label="UBE Morph Categories"
          >
            {!index ? (
              <div className="rounded-sm border border-white/8 bg-[#181920]/70 px-3 py-4 text-[11px] text-[#9b968e]">
                Loading UBE morph directory…
              </div>
            ) : (
              index.categories.map((cat) => {
                const activeCount = cat.sliders.filter(
                  (sl) => Math.abs(ubeMorphs[sl.name] ?? 0) > 0.001,
                ).length;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    role="menuitem"
                    onClick={() => handleOpenCategory(cat.id)}
                    className="group flex h-11 min-h-[44px] shrink-0 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]"
                  >
                    <span className="flex items-center gap-2 text-xs tracking-wide text-[#d4d3d9] group-hover:text-white">
                      <span>{cat.label}</span>
                      {activeCount > 0 && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#eac87f] shadow-[0_0_6px_rgba(234,200,127,0.75)]" />
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] tracking-wider text-[#8c8891] uppercase">
                        {activeCount > 0 ? `${activeCount} ACTIVE` : `${cat.count}`}
                      </span>
                      <span className="text-sm font-light text-[#75737d] group-hover:text-white" aria-hidden>
                        ›
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <WuxiaBreadcrumbs
            category="UBE Morphs"
            subCategory={currentCategory?.label}
            onBack={() => setActiveCat(null)}
          />
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <WuxiaRibbonPill label={currentCategory?.label ?? ''} />
            <button
              type="button"
              onClick={() => {
                if (currentCategory) {
                  resetUbeMorphCategory(currentCategory.sliders.map((s) => s.name));
                }
              }}
              className="flex h-7 min-h-[28px] items-center gap-1 rounded-sm border border-white/10 bg-[#1f2026]/80 px-2.5 text-[10px] tracking-wider uppercase text-[#c4bcae] hover:border-[#dfba73]/50 hover:text-[#eac87f]"
            >
              <span aria-hidden>↺</span>
              <span>Reset</span>
            </button>
          </div>

          <div className="mt-2.5">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Filter morphs (e.g. Elf Ear, Iced Coffee)…"
            />
          </div>

          <div className="mt-2.5 flex flex-col gap-2.5 max-h-[calc(100vh-260px)] overflow-y-auto scrollbar-none pr-1 pb-2">
            {loadingCat ? (
              <div className="rounded-sm border border-white/8 bg-[#181920]/70 px-3 py-4 text-[11px] text-[#a7a29b]">
                Loading binary TRI morph targets…
              </div>
            ) : (
              <div className="rounded-sm border border-white/8 bg-[#181920]/70 p-3 flex flex-col gap-2.5">
                {filteredSliders.map((sl) => {
                  const val = ubeMorphs[sl.name] ?? 0;
                  const pct = Math.round(val * 100);
                  return (
                    <div
                      key={sl.name}
                      onDoubleClick={() => setUbeMorph(sl.name, 0)}
                      className="cursor-pointer py-0.5"
                      title={`Double-click to reset ${sl.label} (${sl.name})`}
                    >
                      <BracketSlider
                        label={sl.label}
                        value={val}
                        min={-1}
                        max={1.5}
                        step={0.01}
                        display={pct > 0 ? `+${pct}%` : `${pct}%`}
                        onChange={(next) => setUbeMorph(sl.name, next)}
                      />
                    </div>
                  );
                })}
                {filteredSliders.length === 0 && (
                  <p className="py-2 text-center text-[11px] text-[#8d8882]">
                    No morphs match “{query}”.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
