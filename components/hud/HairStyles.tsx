'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { assetOptions, isRenderableMeshRow } from '@/lib/manifestSelect';
import { convertUrl, fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { cn } from '@/lib/cn';
import { IconSparkle } from '@/components/hud/Icons';

/** Below this, the shipped head hides the mesh — see `visibility`. */
const VISIBLE_MIN = 0.55;

type HairBrandFilter = 'ALL' | 'BDOR' | 'KSHAIR' | 'OTHER';

export function HairStyles({ manifest }: { manifest: Mo2Manifest | null }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HairBrandFilter>('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCatalogue('hairMesh'), fetchCatalogue('hair')]).then(([meshes, textures]) => {
      if (cancelled) return;
      setCatalogue('hairMesh', meshes);
      setCatalogue('hair', textures);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  const curated = assetOptions(manifest, 'hairMesh');
  const archive = catalogues.hairMesh ?? [];

  // A hairstyle authored for another head sits inside this one and renders as
  // nothing. The indexer measures how much of each mesh clears the shipped head
  // (visibility); below the cutoff the tile would be a blank button, so it is
  // dropped rather than offered. Unmeasured entries stay.
  const visible = (e: { visibility?: number }) =>
    e.visibility === undefined || e.visibility >= VISIBLE_MIN;

  const options = useMemo(() => {
    return [
      ...curated.map((m) => ({
        ...m,
        pairedTextureId:
          m.pairedTextureId ?? archive.find((e) => e.rel === m.rel)?.pairedTextureId,
      })),
      ...archive.filter(
        (m) => isRenderableMeshRow(m) && visible(m) && !curated.some((c) => c.rel === m.rel),
      ),
    ];
  }, [curated, archive]);

  // Deduplicate byte-identical meshes or repeated manifest IDs
  const unique = useMemo(() => {
    const fingerprint = (m: (typeof options)[number]) =>
      'bytes' in m && m.bytes !== undefined ? `${m.bytes}/${m.mtime}` : `id:${m.id}`;
    return options.filter(
      (m, i) => options.findIndex((o) => fingerprint(o) === fingerprint(m)) === i,
    );
  }, [options]);

  const selected =
    selection.hairMesh ??
    (unique.find((m) => isRenderableMeshRow(m) && m.untextured !== true) ?? unique[0])?.id;

  const untextured = (m: (typeof options)[number]) => m.untextured === true;

  // Classify each style by source pack
  const getBrand = (m: (typeof unique)[number]): 'BDOR' | 'KSHAIR' | 'OTHER' => {
    const rel = (m.rel || m.file || '').toLowerCase();
    const mod = (m.mod || '').toLowerCase();
    if (rel.includes('bdor') || rel.includes('dint') || mod.includes('bdor')) return 'BDOR';
    if (rel.includes('ks hair') || rel.includes('kash') || mod.includes('ks hair')) return 'KSHAIR';
    return 'OTHER';
  };

  const bdorCount = useMemo(() => unique.filter((m) => getBrand(m) === 'BDOR').length, [unique]);
  const ksCount = useMemo(() => unique.filter((m) => getBrand(m) === 'KSHAIR').length, [unique]);
  const otherCount = unique.length - bdorCount - ksCount;

  // Filtered by sub-brand tab and search query
  const filtered = useMemo(() => {
    return unique.filter((m) => {
      const brand = getBrand(m);
      if (filter === 'BDOR' && brand !== 'BDOR') return false;
      if (filter === 'KSHAIR' && brand !== 'KSHAIR') return false;
      if (filter === 'OTHER' && brand !== 'OTHER') return false;

      if (!query.trim()) return true;
      return matchesQuery(m as Parameters<typeof matchesQuery>[0], query);
    });
  }, [unique, filter, query]);

  return (
    <div className="select-none">
      {/* ── Title & Total Counter ──────────────────────────────────── */}
      <div className="mb-[7px] flex items-baseline justify-between">
        <h2 className="text-[11px] font-normal tracking-[0.02em] text-[#e2d8c6]/92">
          HAIRSTYLES
        </h2>
        <span className="text-[10px] tracking-[0.06em] text-[#b6ad9c]/70">
          {loading ? 'LOADING…' : `${unique.length} PRESETS`}
        </span>
      </div>

      {/* ── Sub-brand Segmented Filters ────────────────────────────── */}
      <div className="mb-[8px] flex items-stretch border border-[#d4b483]/22 bg-black/40 text-[10px] tracking-[0.08em]">
        <button
          type="button"
          onClick={() => setFilter('ALL')}
          className={cn(
            'flex-1 py-[4px] text-center transition-colors',
            filter === 'ALL'
              ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
              : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
          )}
        >
          ALL ({unique.length})
        </button>
        {bdorCount > 0 && (
          <button
            type="button"
            onClick={() => setFilter('BDOR')}
            className={cn(
              'flex-1 border-l border-[#d4b483]/22 py-[4px] text-center transition-colors',
              filter === 'BDOR'
                ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
            )}
          >
            BDOR ({bdorCount})
          </button>
        )}
        {ksCount > 0 && (
          <button
            type="button"
            onClick={() => setFilter('KSHAIR')}
            className={cn(
              'flex-1 border-l border-[#d4b483]/22 py-[4px] text-center transition-colors',
              filter === 'KSHAIR'
                ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
            )}
          >
            KS HAIR ({ksCount})
          </button>
        )}
        {otherCount > 0 && (
          <button
            type="button"
            onClick={() => setFilter('OTHER')}
            className={cn(
              'flex-1 border-l border-[#d4b483]/22 py-[4px] text-center transition-colors',
              filter === 'OTHER'
                ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
            )}
          >
            UBE ({otherCount})
          </button>
        )}
      </div>

      {/* ── Search Input with Clear Button ──────────────────────────── */}
      <div className="relative mb-[8px]">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search hair by name or mod…"
          aria-label="Search hairstyles"
          className="w-full border border-[#d4b483]/26 bg-black/48 px-[7px] py-[4px] text-[10px] tracking-[0.06em] text-[#e2d8c6] placeholder-[#8f8778]/55 outline-none transition-colors focus:border-[#d4b483]/60"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-[6px] top-1/2 -translate-y-1/2 text-[10px] text-[#8f8778] hover:text-[#e2d8c6]"
          >
            ×
          </button>
        )}
      </div>

      {/* ── Hairstyle Grid ─────────────────────────────────────────── */}
      <div className="thin-scroll grid max-h-[320px] grid-cols-4 gap-[7px] overflow-y-auto pr-[2px]">
        {filtered.map((m, i) => {
          const isSelected = selected === m.id;
          const isUnt = untextured(m);

          return (
            <button
              key={m.id}
              type="button"
              aria-label={`${m.label} — ${m.mod}${isUnt ? ' (untextured)' : ''}`}
              aria-pressed={isSelected}
              title={`${m.label}\nMod: ${m.mod}\nPath: ${m.rel}${isUnt ? `\n${m.reason ?? 'No atlas — drawn flat grey'}` : ''}`}
              onClick={() =>
                setAssets({
                  hairMesh: m.id,
                  ...(m.pairedTextureId ? { hair: m.pairedTextureId } : {}),
                })
              }
              className="group relative flex min-w-0 flex-col items-center text-left"
            >
              {/* 4:5 Portrait Card */}
              <span
                className={cn(
                  'relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden border p-[2px] transition-all duration-200',
                  isSelected
                    ? 'border-[#eac87f] bg-[#eac87f]/16 shadow-[0_0_12px_rgba(234,200,127,0.45)]'
                    : 'border-[#d4b483]/25 bg-[#0b0a08]/80 group-hover:border-[#d4b483]/60 group-hover:bg-[#16120e]',
                )}
              >
                {m.pairedTextureId ? (
                  <img
                    src={convertUrl({ kind: 'hair', id: m.pairedTextureId, mode: 'thumb' })}
                    alt=""
                    loading="lazy"
                    className={cn(
                      'h-full w-full object-cover transition-transform duration-200 group-hover:scale-105',
                      isSelected ? 'opacity-100' : 'opacity-85 group-hover:opacity-100',
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      'text-[9px] tracking-[0.06em] text-center px-1 font-mono uppercase',
                      isUnt ? 'text-[#c9b184]/80' : 'text-[#b6ad9c]/60',
                    )}
                  >
                    {isUnt ? 'NO ATLAS' : 'MESH'}
                  </span>
                )}

                {/* Monospace Number Badge */}
                <span className="pointer-events-none absolute bottom-[1px] right-[2px] text-[9.5px] font-mono tracking-tight text-[#eadcc0]/75">
                  {String(i + 1).padStart(2, '0')}
                </span>

                {/* Selected active glow pip */}
                {isSelected && (
                  <span className="pointer-events-none absolute -top-[1px] h-[3px] w-[3px] rounded-full bg-[#f2dfbe] shadow-[0_0_5px_rgba(242,223,190,0.9)]" />
                )}
              </span>

              {/* Title Label */}
              <span
                className={cn(
                  'mt-[3px] w-full truncate text-center text-[10px] tracking-[0.05em] transition-colors',
                  isSelected
                    ? 'font-medium text-[#f0e2ca]'
                    : 'text-[#a9a192]/70 group-hover:text-[#d5ccbb]',
                )}
              >
                {m.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Status Footer ─────────────────────────────────────────── */}
      <div className="mt-[8px] flex items-center justify-between text-[10px] tracking-[0.11em] text-[#8b8375]/50">
        <div className="flex items-center gap-[4px]">
          <IconSparkle className="h-[6px] w-[6px] text-[#c9b184]/50" />
          <span>BDOR · DINT999 · KS · UBE</span>
        </div>
        <span>{filtered.length} SHOWN</span>
      </div>
    </div>
  );
}
