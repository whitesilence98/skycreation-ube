'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { convertUrl, fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { cn } from '@/lib/cn';
import { IconSparkle } from '@/components/hud/Icons';

type FilterTab = 'ALL' | 'ZHIZHEN' | 'UBE';

export function EyePicker({ manifest }: { manifest: Mo2Manifest | null }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [loading, setLoading] = useState(true);

  // Fetch full eyes catalogue on mount and register in store
  useEffect(() => {
    let cancelled = false;
    fetchCatalogue('eyes').then((entries) => {
      if (cancelled) return;
      setCatalogue('eyes', entries);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  // Albedo eye entries from catalogue (discard normal maps / masks)
  const eyeEntries = useMemo(() => {
    const raw = (catalogues.eyes ?? []) as CatalogueEntry[];
    return raw.filter(
      (e) =>
        (e.mapRole ?? 'albedo') === 'albedo' &&
        e.available !== false &&
        !e.unavailable,
    );
  }, [catalogues.eyes]);

  // Manifest curated eyes
  const curated = useMemo(() => {
    return ((manifest?.assets?.eyes ?? []) as unknown) as Array<CatalogueEntry & { iris?: string }>;
  }, [manifest]);

  // Combined options, deduped by relative path
  const allEyes = useMemo(() => {
    const seen = new Set<string>();
    const list: CatalogueEntry[] = [];

    // Curated default first
    for (const c of curated) {
      const key = (c.rel || c.file).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(c as CatalogueEntry);
      }
    }

    // Then all catalogued entries
    for (const e of eyeEntries) {
      const key = (e.rel || e.file).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(e);
      }
    }

    return list;
  }, [curated, eyeEntries]);

  // Active selected ID
  const defaultId = curated[0]?.id ?? allEyes[0]?.id;
  const activeId = selection.eyes ?? defaultId;

  // Filtered by sub-brand (Zhizhen vs UBE) and search query
  const filteredEyes = useMemo(() => {
    return allEyes.filter((e) => {
      const isZhizhen =
        e.file.toLowerCase().includes('zhizhen') ||
        (e.rel && e.rel.toLowerCase().includes('ddseyes'));

      if (filter === 'ZHIZHEN' && !isZhizhen) return false;
      if (filter === 'UBE' && isZhizhen) return false;

      if (!query.trim()) return true;
      return matchesQuery(e, query);
    });
  }, [allEyes, filter, query]);

  // Counts for tabs
  const zhizhenCount = useMemo(
    () =>
      allEyes.filter(
        (e) =>
          e.file.toLowerCase().includes('zhizhen') ||
          (e.rel && e.rel.toLowerCase().includes('ddseyes')),
      ).length,
    [allEyes],
  );
  const ubeCount = allEyes.length - zhizhenCount;

  const activeEntry = allEyes.find((e) => e.id === activeId);
  const activeLabel = activeEntry ? (activeEntry.label || activeEntry.file.replace(/\.dds$/i, '')) : 'Default Eyes';

  return (
    <StudioCard
      title="EYES & GAZE"
      badge={loading ? 'LOADING…' : `${allEyes.length} PRESETS`}
      footerLeading={<span>+ ZHIZHEN · UBE · KORALINA</span>}
      footerTrailing={<span>{filteredEyes.length} SHOWN</span>}
      showSparkle
    >
      <div className="flex flex-col gap-2.5">
        {/* ── Sub-brand Filters ─────────────────────────────────────── */}
        <div className="flex flex-col gap-2 pt-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
              IRIS PRESETS
            </span>
            <span className="text-[9.5px] font-mono tracking-tight text-[#8f8778]">
              {loading ? 'LOADING…' : `${allEyes.length} PRESETS`}
            </span>
          </div>

          <div className="flex items-stretch border border-[#d4b483]/22 bg-black/40 text-[9.5px] tracking-[0.08em]">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={cn(
                'flex-1 py-[3px] text-center transition-colors',
                filter === 'ALL'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              ALL
            </button>
            <button
              type="button"
              onClick={() => setFilter('ZHIZHEN')}
              className={cn(
                'flex-1 border-l border-[#d4b483]/22 py-[3px] text-center transition-colors',
                filter === 'ZHIZHEN'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              ZHIZHEN ({zhizhenCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('UBE')}
              className={cn(
                'flex-1 border-l border-[#d4b483]/22 py-[3px] text-center transition-colors',
                filter === 'UBE'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              UBE ({ubeCount})
            </button>
          </div>

          {/* ── Search Input ───────────────────────────────────────────── */}
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search eyes by color or mod…"
              aria-label="Search eyes"
              className="w-full border border-[#d4b483]/26 bg-black/48 px-[7px] py-[3px] text-[10px] tracking-[0.06em] text-[#e2d8c6] placeholder-[#8f8778]/55 outline-none transition-colors focus:border-[#d4b483]/60"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-[6px] top-1/2 -translate-y-1/2 text-[10px] text-[#8f8778] hover:text-[#e2d8c6]"
              >
                ×
              </button>
            )}
          </div>

          {/* ── Eyes Grid ──────────────────────────────────────────────── */}
          <div className="thin-scroll grid max-h-[220px] grid-cols-4 gap-[6px] overflow-y-auto pr-[2px]">
            {filteredEyes.map((eye, i) => {
              const isSelected = eye.id === activeId;
              const isZhizhen =
                eye.file.toLowerCase().includes('zhizhen') ||
                (eye.rel && eye.rel.toLowerCase().includes('ddseyes'));
              const isKoralina = !!eye.rel && eye.rel.toLowerCase().includes('koralina');
              const sourceLabel = isKoralina
                ? 'Even More Eyes by Koralina'
                : isZhizhen
                  ? 'Zhizhen Eyes'
                  : 'UBE / !COR';
              const cleanLabel = eye.label || eye.file.replace(/\.dds$/i, '');

              return (
                <button
                  key={eye.id}
                  type="button"
                  onClick={() => setAssets({ eyes: eye.id })}
                  aria-label={cleanLabel}
                  aria-pressed={isSelected}
                  title={`${cleanLabel}\nMod: ${sourceLabel}\nFile: ${eye.file}`}
                  className="group relative flex min-w-0 flex-col items-center text-left"
                >
                  {/* Circular Iris Disc Preview */}
                  <span
                    className={cn(
                      'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-full border p-[2px] transition-all duration-200',
                      isSelected
                        ? 'border-[#eac87f] bg-[#eac87f]/16 shadow-[0_0_12px_rgba(234,200,127,0.45)]'
                        : 'border-[#d4b483]/25 bg-[#0b0a08]/80 group-hover:border-[#d4b483]/60 group-hover:bg-[#16120e]',
                    )}
                  >
                    <img
                      src={convertUrl({ kind: 'eyes', id: eye.id, mode: 'disc' })}
                      alt=""
                      loading="lazy"
                      className={cn(
                        'h-full w-full rounded-full object-cover transition-transform duration-200 group-hover:scale-105',
                        isSelected ? 'opacity-100' : 'opacity-85 group-hover:opacity-100',
                      )}
                      onError={(e) => {
                        const target = e.currentTarget;
                        const thumbUrl = convertUrl({ kind: 'eyes', id: eye.id, mode: 'thumb' });
                        if (target.src !== thumbUrl) {
                          target.src = thumbUrl;
                        }
                      }}
                    />

                    <span className="pointer-events-none absolute bottom-[1px] right-[2px] text-[8.5px] font-mono tracking-tight text-[#eadcc0]/75">
                      {String(i + 1).padStart(2, '0')}
                    </span>

                    {isSelected && (
                      <span className="pointer-events-none absolute -top-[1px] h-[3px] w-[3px] rounded-full bg-[#f2dfbe] shadow-[0_0_5px_rgba(242,223,190,0.9)]" />
                    )}
                  </span>

                  <span
                    className={cn(
                      'mt-[2px] w-full truncate text-center text-[9.5px] tracking-[0.04em] transition-colors',
                      isSelected ? 'font-medium text-[#f0e2ca]' : 'text-[#a9a192]/70 group-hover:text-[#d5ccbb]',
                    )}
                  >
                    {cleanLabel}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="text-center pt-1">
            <span className="text-[9.5px] font-mono tracking-tight text-[#8f8778]">
              [{activeLabel}]
            </span>
          </div>
        </div>
      </div>
    </StudioCard>
  );
}
