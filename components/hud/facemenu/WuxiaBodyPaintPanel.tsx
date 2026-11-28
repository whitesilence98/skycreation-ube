'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { ItemTile } from '@/components/hud/common/ItemTile';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { SearchInput } from '@/components/hud/common/SearchInput';
import { convertUrl, fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { TATTOO_INK_SWATCHES, tattooLabel } from '@/components/hud/TattooPicker';
import type { BodyPaintSlot } from '@/lib/head/bodyPaintTypes';

const BODY_PAINT_SLOTS: ReadonlyArray<{ id: BodyPaintSlot; label: string; badge: string }> = [
  { id: 'body', label: 'Body Paint', badge: 'TORSO / SKIN' },
  { id: 'hands', label: 'Hand Paint', badge: 'ARMS / PALMS' },
  { id: 'feet', label: 'Foot Paint', badge: 'ANKLES / SOLES' },
];

export function WuxiaBodyPaintPanel() {
  const [activeSlot, setActiveSlot] = useState<BodyPaintSlot | null>(null);
  const [query, setQuery] = useState('');
  const bodyOverlays = useCharacter((s) => s.bodyOverlays);
  const setBodyPaint = useCharacter((s) => s.setBodyPaint);
  const resetBodyPaint = useCharacter((s) => s.resetBodyPaint);
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);

  useEffect(() => {
    if (!catalogues.tattoo?.length) {
      void fetchCatalogue('tattoo').then((rows) => {
        if (rows.length) setCatalogue('tattoo', rows);
      });
    }
    if (!catalogues.makeup?.length) {
      void fetchCatalogue('makeup').then((rows) => {
        if (rows.length) setCatalogue('makeup', rows);
      });
    }
  }, [catalogues.tattoo, catalogues.makeup, setCatalogue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeSlot !== null) {
        e.preventDefault();
        setActiveSlot(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSlot]);

  const paintEntries = useMemo(() => {
    const raw = [
      ...((catalogues.tattoo ?? []) as CatalogueEntry[]),
      ...((catalogues.makeup ?? []) as CatalogueEntry[]),
    ].filter((e) => !e.file.endsWith('_n.dds'));
    if (!query.trim()) return raw;
    return raw.filter((e) => matchesQuery(e, query));
  }, [catalogues.tattoo, catalogues.makeup, query]);

  const currentMeta = activeSlot ? BODY_PAINT_SLOTS.find((s) => s.id === activeSlot) ?? null : null;
  const activeLayer = activeSlot ? bodyOverlays[activeSlot] : null;

  return (
    <div className="flex flex-col w-[calc(100vw-108px)] sm:w-[310px] md:w-[330px] max-w-[330px] shrink-0 select-none text-white pointer-events-auto">
      {activeSlot === null ? (
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base md:text-lg font-normal tracking-wide text-white">
              Body Paint
            </h1>
            <button
              type="button"
              onClick={() => resetBodyPaint()}
              className="flex min-h-[28px] items-center gap-1 rounded-sm border border-white/10 bg-[#1f2026]/80 px-2.5 text-[10px] tracking-wider uppercase text-[#c4bcae] hover:border-[#dfba73]/50 hover:text-[#eac87f] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]"
            >
              <span aria-hidden>↺</span>
              <span>Clear All</span>
            </button>
          </div>

          <div
            className="flex flex-col gap-1.5 max-h-[calc(100vh-195px)] overflow-y-auto scrollbar-none pr-0.5"
            role="menu"
            aria-label="Body, Hand, and Foot Paint Slots"
          >
            {BODY_PAINT_SLOTS.map((slot) => {
              const layer = bodyOverlays[slot.id];
              const hasPaint = Boolean(layer?.textureUrl);
              return (
                <button
                  key={slot.id}
                  type="button"
                  role="menuitem"
                  onClick={() => setActiveSlot(slot.id)}
                  className="group flex h-11 min-h-[44px] shrink-0 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]"
                >
                  <span className="flex items-center gap-2 text-xs tracking-wide text-[#d4d3d9] group-hover:text-white">
                    <span>{slot.label}</span>
                    {hasPaint && (
                      <span
                        className="h-2 w-2 rounded-full border border-white/30"
                        style={{ backgroundColor: layer.color }}
                      />
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[10px] tracking-wider text-[#8c8891] uppercase">
                      {hasPaint ? 'ACTIVE' : slot.badge}
                    </span>
                    <span className="text-sm font-light text-[#75737d] group-hover:text-white" aria-hidden>
                      ›
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <WuxiaBreadcrumbs
            category="Body Paint"
            subCategory={currentMeta?.label}
            onBack={() => setActiveSlot(null)}
          />
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <WuxiaRibbonPill label={currentMeta?.label ?? ''} />
            <button
              type="button"
              onClick={() => resetBodyPaint(activeSlot)}
              className="flex h-7 min-h-[28px] items-center gap-1 rounded-sm border border-white/10 bg-[#1f2026]/80 px-2.5 text-[10px] tracking-wider uppercase text-[#c4bcae] hover:border-[#dfba73]/50 hover:text-[#eac87f]"
            >
              <span aria-hidden>↺</span>
              <span>Clear</span>
            </button>
          </div>

          <div className="mt-2.5">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search ink / overlay patterns…"
            />
          </div>

          <div className="mt-2.5 flex flex-col gap-3 max-h-[calc(100vh-260px)] overflow-y-auto scrollbar-none pr-1 pb-2">
            {activeLayer && (
              <div className="rounded-sm border border-white/8 bg-[#181920]/75 p-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#c9b796]">
                    Ink Tint &amp; Opacity
                  </span>
                  <input
                    type="color"
                    value={activeLayer.color}
                    onChange={(e) => setBodyPaint(activeSlot, { color: e.target.value })}
                    aria-label="Custom body paint color"
                    className="h-6 w-8 cursor-pointer rounded border border-white/20 bg-transparent"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TATTOO_INK_SWATCHES.map((sw) => (
                    <button
                      key={sw.hex}
                      type="button"
                      title={sw.name}
                      onClick={() => setBodyPaint(activeSlot, { color: sw.hex })}
                      className="h-6 w-6 rounded-full border border-white/25 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: sw.hex,
                        outline: activeLayer.color.toLowerCase() === sw.hex.toLowerCase() ? '2px solid #eac87f' : undefined,
                      }}
                    />
                  ))}
                </div>
                <BracketSlider
                  label="Opacity"
                  value={activeLayer.opacity}
                  min={0}
                  max={1}
                  step={0.02}
                  display={`${Math.round(activeLayer.opacity * 100)}%`}
                  onChange={(opacity) => setBodyPaint(activeSlot, { opacity })}
                />
              </div>
            )}

            <div className="grid grid-cols-4 gap-2">
              <ItemTile
                id="body-paint-none"
                isSelected={!activeLayer?.textureId}
                onClick={() => setBodyPaint(activeSlot, { textureId: null, textureUrl: null })}
                title="None"
                thumbnail={
                  <div className="flex h-full w-full items-center justify-center rounded-[2px] bg-[#1a1b20] text-sm text-[#8e8c95]">
                    ⊘
                  </div>
                }
              />
              {paintEntries.slice(0, 48).map((entry) => {
                const kind = (entry.kind === 'makeup' ? 'makeup' : 'tattoo') as 'makeup' | 'tattoo';
                const thumb = entry.urls?.thumb ?? convertUrl({ kind, id: entry.id, mode: 'thumb' });
                const atlas = entry.urls?.atlas ?? convertUrl({ kind, id: entry.id, mode: 'atlas' });
                const label = tattooLabel(entry);
                return (
                  <ItemTile
                    key={entry.id}
                    id={entry.id}
                    isSelected={activeLayer?.textureId === entry.id}
                    onClick={() =>
                      setBodyPaint(activeSlot, { textureId: entry.id, textureUrl: atlas })
                    }
                    title={label}
                    thumbnail={
                      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[2px] bg-[#1a1b20]">
                        <img
                          src={thumb}
                          alt={label}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      </div>
                    }
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
