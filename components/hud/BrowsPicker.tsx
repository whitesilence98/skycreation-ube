'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { convertUrl, fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { cn } from '@/lib/cn';
import { IconSparkle } from '@/components/hud/Icons';

type FilterTab = 'ALL' | 'CLASSIC' | 'ILV';

function formatBrowLabel(entry: CatalogueEntry): string {
  const isIlv = (entry.rel || '').includes('Brows_ILV');
  const numMatch = entry.file.match(/(\d+)/);
  const num = numMatch ? numMatch[1] : '';
  if (isIlv && num) return `ILV Brow ${num}`;
  if (num) return `Classic Brow ${num.padStart(2, '0')}`;
  return (entry.label || entry.file.replace(/\.dds$/i, '')).replace(/_/g, ' ');
}

export function BrowsPicker({ manifest }: { manifest: Mo2Manifest | null }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);
  const favoriteBrows = useCharacter((s) => s.favoriteBrows);
  const toggleFavoriteBrow = useCharacter((s) => s.toggleFavoriteBrow);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [loading, setLoading] = useState(true);
  const [showMeshOptions, setShowMeshOptions] = useState(false);

  // Fetch full brows & browsMesh catalogues on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCatalogue('brows'),
      fetchCatalogue('browsMesh'),
    ]).then(([browEntries, meshEntries]) => {
      if (cancelled) return;
      if (browEntries.length) setCatalogue('brows', browEntries);
      if (meshEntries.length) setCatalogue('browsMesh', meshEntries);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  // Albedo brow entries from catalogue (filter out normal maps ending in _n.dds)
  const browEntries = useMemo(() => {
    const raw = (catalogues.brows ?? []) as CatalogueEntry[];
    return raw.filter(
      (e) =>
        (e.mapRole ?? 'albedo') === 'albedo' &&
        !e.file.toLowerCase().endsWith('_n.dds') &&
        e.available !== false &&
        !e.unavailable,
    );
  }, [catalogues.brows]);

  // Manifest curated brows
  const curated = useMemo(() => {
    return ((manifest?.assets?.brows ?? []) as unknown) as CatalogueEntry[];
  }, [manifest]);

  // Combined options, deduped by relative path or file
  const allBrows = useMemo(() => {
    const seen = new Set<string>();
    const list: CatalogueEntry[] = [];

    // Curated default first
    for (const c of curated) {
      const key = (c.rel || c.file).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(c);
      }
    }

    // Then all catalogued entries
    for (const e of browEntries) {
      const key = (e.rel || e.file).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(e);
      }
    }

    return list;
  }, [curated, browEntries]);

  // 3D Brow Meshes available
  const browMeshes = useMemo(() => {
    const raw = (catalogues.browsMesh ?? []) as CatalogueEntry[];
    return raw.filter((m) => m.mapRole === 'mesh' || !m.mapRole);
  }, [catalogues.browsMesh]);

  // Active selected Brow Texture ID
  const defaultId = curated[0]?.id ?? allBrows[0]?.id;
  const activeId = selection.brows ?? defaultId;

  // Active selected Brow Mesh ID
  const activeMeshId = selection.browsMesh ?? (manifest?.assets?.browsMesh?.[0] as { id?: string })?.id ?? browMeshes[0]?.id;

  // Filtered by series (Classic vs ILV) and search query
  const filteredBrows = useMemo(() => {
    return allBrows.filter((b) => {
      const isIlv = (b.rel || '').includes('Brows_ILV');

      if (filter === 'CLASSIC' && isIlv) return false;
      if (filter === 'ILV' && !isIlv) return false;

      if (!query.trim()) return true;
      const cleanLabel = formatBrowLabel(b);
      return matchesQuery(b, query) || cleanLabel.toLowerCase().includes(query.toLowerCase());
    });
  }, [allBrows, filter, query]);

  // Counts for tabs
  const ilvCount = useMemo(
    () => allBrows.filter((b) => (b.rel || '').includes('Brows_ILV')).length,
    [allBrows],
  );
  const classicCount = allBrows.length - ilvCount;

  const activeEntry = allBrows.find((b) => b.id === activeId);
  const activeLabel = activeEntry ? formatBrowLabel(activeEntry) : 'Default Brows';
  const activeSeries = activeEntry && (activeEntry.rel || '').includes('Brows_ILV') ? 'ILV Series' : 'COR Classic';

  const activeMeshEntry = browMeshes.find((m) => m.id === activeMeshId);
  const activeMeshLabel = activeMeshEntry?.label || (activeMeshEntry?.file?.replace(/\.(nif|tri)$/i, '')) || 'FemaleBrows';

  return (
    <div className="relative flex w-full flex-col select-none text-[#e6e1d8]">
      <div className="flex flex-col gap-3 rounded-xs border border-[#d4b483]/22 bg-black/45 p-3.5 backdrop-blur-md">
        {/* Top Header: BROWS & ARCH */}
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-medium tracking-[0.05em] text-[#efece6] uppercase">
            BROWS &amp; ARCH
          </h2>
          <span className="text-[9.5px] font-mono tracking-tight text-[#8f8778]">
            {loading ? 'LOADING…' : `${allBrows.length} STYLES`}
          </span>
        </div>

        {/* ── Sub-brand / Series Filters ────────────────────────────── */}
        <div className="flex flex-col gap-2 pt-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
              BROW SHAPES
            </span>
            <button
              type="button"
              onClick={() => setShowMeshOptions(!showMeshOptions)}
              className="text-[9px] font-mono tracking-tight text-[#d4b483] hover:text-[#fff0d4] transition-colors"
            >
              {showMeshOptions ? '▲ HIDE 3D MESH' : '▼ 3D MESH SHAPES'}
            </button>
          </div>

          {/* 3D Brow Mesh Selector (Optional toggle) */}
          {showMeshOptions && browMeshes.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-xs border border-[#d4b483]/25 bg-black/55 p-2 transition-all">
              <span className="text-[9px] font-mono tracking-wider text-[#d4b483]/90 uppercase">
                3D BROW SKELETAL MESH
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {browMeshes.map((mesh) => {
                  const isSelected = mesh.id === activeMeshId;
                  const label = mesh.label || mesh.file.replace(/\.(nif|tri)$/i, '');
                  return (
                    <button
                      key={mesh.id}
                      type="button"
                      onClick={() => setAssets({ browsMesh: mesh.id })}
                      className={cn(
                        'flex items-center justify-between rounded-xs border px-2 py-1 text-[9px] font-mono transition-all',
                        isSelected
                          ? 'border-[#eac87f] bg-[#d4b483]/22 text-[#f2dfbe] font-bold shadow-[0_0_8px_rgba(234,200,127,0.3)]'
                          : 'border-[#d4b483]/20 bg-black/40 text-[#a9a192] hover:border-[#d4b483]/50 hover:text-[#e8ded0]',
                      )}
                    >
                      <span className="truncate">{label}</span>
                      {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-[#eac87f]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Series Tabs */}
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
              ALL ({allBrows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('CLASSIC')}
              className={cn(
                'flex-1 border-l border-[#d4b483]/22 py-[3px] text-center transition-colors',
                filter === 'CLASSIC'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              CLASSIC ({classicCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('ILV')}
              className={cn(
                'flex-1 border-l border-[#d4b483]/22 py-[3px] text-center transition-colors',
                filter === 'ILV'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              ILV ({ilvCount})
            </button>
          </div>

          {/* ── Search Input ───────────────────────────────────────────── */}
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-[8px] text-[10px] text-[#8f8778]">
              🔍
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search brows by style or number…"
              aria-label="Search brows"
              className="w-full rounded-xs border border-[#d4b483]/26 bg-black/48 pl-[24px] pr-[22px] py-[4px] text-[10px] tracking-[0.06em] text-[#e2d8c6] placeholder-[#8f8778]/55 outline-none transition-colors focus:border-[#d4b483]/60"
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

          {/* ── Eyebrows Grid (2 columns of 2.1:1 horizontal cards) ──────── */}
          <div className="thin-scroll grid max-h-[268px] grid-cols-2 gap-2 overflow-y-auto pr-[2px]">
            {filteredBrows.map((brow) => {
              const isSelected = brow.id === activeId;
              const isFavorite = favoriteBrows.includes(brow.id);
              const isIlv = (brow.rel || '').includes('Brows_ILV');
              const cleanLabel = formatBrowLabel(brow);

              return (
                <div
                  key={brow.id}
                  onClick={() => setAssets({ brows: brow.id })}
                  className={cn(
                    'group relative flex aspect-[2.1/1] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xs border p-[4px] transition-all duration-200 select-none',
                    isSelected
                      ? 'border-[#eac87f] bg-[#eac87f]/14 shadow-[0_0_12px_rgba(234,200,127,0.35)] ring-1 ring-[#eac87f]/60'
                      : 'border-[#d4b483]/25 bg-[#161311]/90 hover:border-[#d4b483]/60 hover:bg-[#201a16]',
                  )}
                  title={`${cleanLabel}\nSeries: ${isIlv ? 'ILV Series' : 'COR Classic'}\nFile: ${brow.file}`}
                >
                  {/* Eyebrow Arch Texture Preview */}
                  <img
                    src={convertUrl({ kind: 'brows', id: brow.id, mode: 'thumb' })}
                    alt=""
                    loading="lazy"
                    className={cn(
                      'h-full w-full object-contain filter drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)] transition-transform duration-200 group-hover:scale-105',
                      isSelected ? 'opacity-100' : 'opacity-85 group-hover:opacity-100',
                    )}
                    onError={(e) => {
                      const target = e.currentTarget;
                      const atlasUrl = convertUrl({ kind: 'brows', id: brow.id, mode: 'atlas' });
                      if (target.src !== atlasUrl) {
                        target.src = atlasUrl;
                      }
                    }}
                  />

                  {/* Favorite Star Icon on Top-Right */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavoriteBrow(brow.id);
                    }}
                    title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-label={isFavorite ? 'Unfavorite brow' : 'Favorite brow'}
                    className="absolute top-[3px] right-[4px] z-10 text-[11px] leading-none transition-transform hover:scale-125 focus:outline-none"
                  >
                    {isFavorite || isSelected ? (
                      <span className="text-[#eac87f] drop-shadow-[0_0_4px_rgba(234,200,127,0.8)]">★</span>
                    ) : (
                      <span className="text-[#8f8778]/60 hover:text-[#eac87f]">☆</span>
                    )}
                  </button>

                  {/* Brow Title Pill at Bottom */}
                  <span
                    className={cn(
                      'absolute bottom-[3px] inset-x-[4px] truncate rounded-[2px] px-1 py-[1.5px] text-center text-[8.5px] tracking-[0.03em] backdrop-blur-xs transition-colors',
                      isSelected
                        ? 'bg-black/75 font-medium text-[#f0e2ca]'
                        : 'bg-black/55 text-[#a9a192] group-hover:text-[#e2d8c6] group-hover:bg-black/70',
                    )}
                  >
                    {cleanLabel}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Active Preset Readout */}
          <div className="text-center pt-1 border-t border-[#d4b483]/14">
            <span className="text-[9.5px] font-mono tracking-tight text-[#eac87f]">
              [{activeLabel} · {activeSeries} · {activeMeshLabel}]
            </span>
          </div>
        </div>

        {/* ── Status Footer ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-t border-[#d4b483]/18 pt-2 text-[9.5px] tracking-[0.11em] text-[#8b8375]/60">
          <div className="flex items-center gap-[4px]">
            <IconSparkle className="h-[6px] w-[6px] text-[#c9b184]/50" />
            <span>+ COR · UBE · 3D SCULPT</span>
          </div>
          <span>{filteredBrows.length} SHOWN</span>
        </div>

        {/* ── Bottom Decorative Arc ─────────────────────────────────── */}
        <div className="flex justify-center pt-1">
          <svg className="h-5 w-14 text-[#d4b483]/30" viewBox="0 0 100 40" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M 10 38 Q 50 5 90 38" />
            <path d="M 50 5 L 50 0" />
          </svg>
        </div>
      </div>
    </div>
  );
}
