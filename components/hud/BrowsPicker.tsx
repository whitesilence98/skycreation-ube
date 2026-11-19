'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { convertUrl, fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { cn } from '@/lib/cn';
import { SearchInput } from '@/components/hud/common/SearchInput';

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
    <div className="flex flex-col gap-2.5">
      {/* ── Top Header ── */}
      <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6]">
          BROWS &amp; ARCH
        </span>
        <span className="font-mono text-[10px] text-[#a49a88]">
          {loading ? 'LOADING…' : `${allBrows.length} STYLES`}
        </span>
      </div>

      <div className="flex flex-col gap-2 pt-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#baab94]">
              BROW SHAPES
            </span>
            <button
              type="button"
              onClick={() => setShowMeshOptions(!showMeshOptions)}
              className="text-[10px] font-mono tracking-wider text-[#d4b483] hover:text-[#fff0d4] transition-colors leading-tight"
            >
              {showMeshOptions ? '▲ HIDE 3D MESH' : '▲ 3D MESH SHAPES'}
            </button>
          </div>

          {/* 3D Brow Mesh Selector (Optional toggle) */}
          {showMeshOptions && browMeshes.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-[2px] border border-[#463a2e] bg-[#1a1512]/95 p-2 transition-all">
              <span className="text-[10px] font-mono tracking-wider text-[#d4b483]/90 uppercase leading-tight">
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
                        'flex items-center justify-between rounded-[2px] border px-2 py-1 text-[10px] font-mono leading-tight transition-all',
                        isSelected
                          ? 'border-[#b89552] bg-[#4a3d2a]/95 text-[#f2dfbe] font-bold shadow-[0_0_8px_rgba(184,149,82,0.35)]'
                          : 'border-[#382d22] bg-[#16120f]/90 text-[#8f8576] hover:border-[#6a553c] hover:text-[#e8ded0]',
                      )}
                    >
                      <span className="truncate">{label}</span>
                      {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-[#f5cf73]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Series Pills (3 individual pills) */}
          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={cn(
                'flex-1 rounded-[3px] border py-[3px] text-center text-[10px] font-mono tracking-wider leading-tight transition-all',
                filter === 'ALL'
                  ? 'border-[#7a6952] bg-[#645644] font-medium text-[#f2e8dc] shadow-[0_1px_4px_rgba(0,0,0,0.5)]'
                  : 'border-[#382d22] bg-[#201a16]/90 text-[#8f8576] hover:border-[#524332] hover:text-[#c4b9a3]',
              )}
            >
              ALL ({allBrows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('CLASSIC')}
              className={cn(
                'flex-1 rounded-[3px] border py-[3px] text-center text-[10px] font-mono tracking-wider leading-tight transition-all',
                filter === 'CLASSIC'
                  ? 'border-[#7a6952] bg-[#645644] font-medium text-[#f2e8dc] shadow-[0_1px_4px_rgba(0,0,0,0.5)]'
                  : 'border-[#382d22] bg-[#201a16]/90 text-[#8f8576] hover:border-[#524332] hover:text-[#c4b9a3]',
              )}
            >
              CLASSIC ({classicCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('ILV')}
              className={cn(
                'flex-1 rounded-[3px] border py-[3px] text-center text-[10px] font-mono tracking-wider leading-tight transition-all',
                filter === 'ILV'
                  ? 'border-[#7a6952] bg-[#645644] font-medium text-[#f2e8dc] shadow-[0_1px_4px_rgba(0,0,0,0.5)]'
                  : 'border-[#382d22] bg-[#201a16]/90 text-[#8f8576] hover:border-[#524332] hover:text-[#c4b9a3]',
              )}
            >
              ILV ({ilvCount})
            </button>
          </div>

          {/* ── Search Input ───────────────────────────────────────────── */}
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search brows by style or morph…"
          />

          {/* ── Eyebrows Grid (2 columns of 2.1:1 horizontal cards) ──────── */}
          <div className="thin-scroll grid max-h-[268px] grid-cols-2 gap-1.5 overflow-y-auto pr-[2px]">
            {filteredBrows.map((brow) => {
              const isSelected = brow.id === activeId;
              const isFavorite = favoriteBrows.includes(brow.id);
              const cleanLabel = formatBrowLabel(brow);

              return (
                <div
                  key={brow.id}
                  onClick={() => setAssets({ brows: brow.id })}
                  className={cn(
                    'group relative flex aspect-[2.1/1] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[2px] border p-[3px] transition-all duration-150 select-none',
                    isSelected
                      ? 'border-[#b89552] bg-[#4a3d2a]/95 shadow-[0_0_12px_rgba(184,149,82,0.35)] ring-1 ring-[#b89552]/70'
                      : 'border-[#382d22] bg-[#1a1512]/92 hover:border-[#6a553c] hover:bg-[#251e19]',
                  )}
                  title={cleanLabel}
                >
                  {/* Eyebrow Arch Texture Preview */}
                  <img
                    src={convertUrl({ kind: 'brows', id: brow.id, mode: 'thumb' })}
                    alt=""
                    loading="lazy"
                    className={cn(
                      'h-full w-full object-contain filter drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)] transition-transform duration-150 group-hover:scale-105',
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
                    className="absolute top-[2px] right-[3px] z-10 text-[10px] leading-none transition-transform hover:scale-125 focus:outline-none"
                  >
                    {isFavorite || isSelected ? (
                      <span className="text-[#f5cf73] drop-shadow-[0_0_6px_rgba(245,207,115,0.8)]">★</span>
                    ) : (
                      <span className="text-[#6b5d4e] hover:text-[#d4b483]">☆</span>
                    )}
                  </button>

                  {/* Brow Title Pill at Bottom */}
                  <span
                    className={cn(
                      'absolute bottom-[2px] inset-x-[3px] truncate rounded-[1px] px-1 py-[2px] text-center text-[10px] font-mono tracking-tight leading-tight transition-colors',
                      isSelected
                        ? 'bg-black/85 font-medium text-[#f4e6cf]'
                        : 'bg-black/80 text-[#a49a88] group-hover:text-[#d4cbb8]',
                    )}
                  >
                    {cleanLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
    </div>
  );
}
