'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { assetOptions, isRenderableMeshRow } from '@/lib/manifestSelect';
import { convertUrl, fetchCatalogue } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { cn } from '@/lib/cn';
import { buildHairGroups, findHairGroupForPartId, type HairBrand, type HairGroup } from '@/lib/hair';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { SearchInput } from '@/components/hud/common/SearchInput';

/** Below this, the shipped head hides the mesh — see `visibility`. */
const VISIBLE_MIN = 0.55;

type HairCategoryFilter = 'ALL' | 'HAIR' | 'HL';
type HairBrandFilter = 'ALL' | 'BDOR' | 'KSHAIR' | 'OTHER';

export function HairStyles({ manifest }: { manifest: Mo2Manifest | null }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);
  const hair = useCharacter((s) => s.hair);
  const setHair = useCharacter((s) => s.setHair);

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<HairCategoryFilter>('ALL');
  const [brandFilter, setBrandFilter] = useState<HairBrandFilter>('ALL');
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

  const visible = (e: { visibility?: number }) =>
    e.visibility === undefined || e.visibility >= VISIBLE_MIN;

  const rawOptions = useMemo(() => {
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

  // Group raw fragmented NIF files into consolidated multi-part hairstyles
  const hairGroups = useMemo(() => {
    return buildHairGroups(rawOptions);
  }, [rawOptions]);

  const totalCount = hairGroups.length;
  const hairCount = useMemo(() => hairGroups.filter((g) => !g.isHL).length, [hairGroups]);
  const hlCount = useMemo(() => hairGroups.filter((g) => g.isHL).length, [hairGroups]);

  const bdorCount = useMemo(() => hairGroups.filter((g) => g.brand === 'BDOR').length, [hairGroups]);
  const ksCount = useMemo(() => hairGroups.filter((g) => g.brand === 'KSHAIR').length, [hairGroups]);
  const otherCount = useMemo(() => hairGroups.filter((g) => g.brand === 'OTHER').length, [hairGroups]);

  const filtered = useMemo(() => {
    return hairGroups.filter((g) => {
      if (categoryFilter === 'HAIR' && g.isHL) return false;
      if (categoryFilter === 'HL' && !g.isHL) return false;

      if (brandFilter === 'BDOR' && g.brand !== 'BDOR') return false;
      if (brandFilter === 'KSHAIR' && g.brand !== 'KSHAIR') return false;
      if (brandFilter === 'OTHER' && g.brand !== 'OTHER') return false;

      if (!query.trim()) return true;
      const q = query.toLowerCase().trim();
      return (
        g.label.toLowerCase().includes(q) ||
        g.groupKey.toLowerCase().includes(q) ||
        (g.mod && g.mod.toLowerCase().includes(q)) ||
        g.parts.some((p) => p.label.toLowerCase().includes(q))
      );
    });
  }, [hairGroups, categoryFilter, brandFilter, query]);

  const activeGroup = useMemo(() => {
    return findHairGroupForPartId(hairGroups, selection.hairMesh) ?? hairGroups[0];
  }, [hairGroups, selection.hairMesh]);

  const selectedGroupId = activeGroup?.id;
  const activeLabel = activeGroup ? activeGroup.label : 'Default Hair';

  return (
    <StudioCard
      title="HAIR & STYLE"
      badge={loading ? 'LOADING…' : `${hairGroups.length} STYLES`}
      footerLeading={<span>+ COR · UBE · 3D SCULPT</span>}
      footerTrailing={<span>{filtered.length} SHOWN</span>}
    >
      {/* ── 1. HAIRSTYLES SELECTOR ─────────────────────────────────── */}
      <div className="flex flex-col gap-2 pt-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
              HAIRSTYLE
            </span>
            <span className="text-[9.5px] font-mono tracking-tight text-[#8f8778]">
              {loading ? 'LOADING…' : `${hairGroups.length} STYLES (${filtered.length} SHOWN)`}
            </span>
          </div>

          {/* Row 1: Category Filter (ALL / HAIR / HAIRLINE) */}
          <div className="flex items-stretch border border-[#d4b483]/22 bg-black/40 text-[9.5px] tracking-[0.08em]">
            <button
              type="button"
              onClick={() => setCategoryFilter('ALL')}
              className={cn(
                'flex-1 py-[3px] text-center transition-colors',
                categoryFilter === 'ALL'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              ALL ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('HAIR')}
              className={cn(
                'flex-1 border-l border-[#d4b483]/22 py-[3px] text-center transition-colors',
                categoryFilter === 'HAIR'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              HAIR ({hairCount})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('HL')}
              className={cn(
                'flex-1 border-l border-[#d4b483]/22 py-[3px] text-center transition-colors',
                categoryFilter === 'HL'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              HAIRLINE ({hlCount})
            </button>
          </div>

          {/* Row 2: Sub-brand Segmented Filters */}
          <div className="flex items-stretch border border-[#d4b483]/16 bg-black/30 text-[9px] tracking-[0.06em]">
            <button
              type="button"
              onClick={() => setBrandFilter('ALL')}
              className={cn(
                'flex-1 py-[2px] text-center transition-colors',
                brandFilter === 'ALL'
                  ? 'bg-[#d4b483]/16 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/60 hover:text-[#c4b9a3]',
              )}
            >
              ALL
            </button>
            {bdorCount > 0 && (
              <button
                type="button"
                onClick={() => setBrandFilter('BDOR')}
                className={cn(
                  'flex-1 border-l border-[#d4b483]/16 py-[2px] text-center transition-colors',
                  brandFilter === 'BDOR'
                    ? 'bg-[#d4b483]/16 font-medium text-[#f0dfbe]'
                    : 'text-[#8f8778]/60 hover:text-[#c4b9a3]',
                )}
              >
                BDOR ({bdorCount})
              </button>
            )}
            {ksCount > 0 && (
              <button
                type="button"
                onClick={() => setBrandFilter('KSHAIR')}
                className={cn(
                  'flex-1 border-l border-[#d4b483]/16 py-[2px] text-center transition-colors',
                  brandFilter === 'KSHAIR'
                    ? 'bg-[#d4b483]/16 font-medium text-[#f0dfbe]'
                    : 'text-[#8f8778]/60 hover:text-[#c4b9a3]',
                )}
              >
                KS HAIR ({ksCount})
              </button>
            )}
            {otherCount > 0 && (
              <button
                type="button"
                onClick={() => setBrandFilter('OTHER')}
                className={cn(
                  'flex-1 border-l border-[#d4b483]/16 py-[2px] text-center transition-colors',
                  brandFilter === 'OTHER'
                    ? 'bg-[#d4b483]/16 font-medium text-[#f0dfbe]'
                    : 'text-[#8f8778]/60 hover:text-[#c4b9a3]',
                )}
              >
                UBE ({otherCount})
              </button>
            )}
          </div>

          {/* Search Input with Clear Button */}
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search hairstyles…"
          />

          {/* Hairstyle List */}
          <div className="thin-scroll flex max-h-[220px] flex-col gap-1 overflow-y-auto pr-[2px]">
            {filtered.map((g, i) => {
              const isSelected = selectedGroupId === g.id;

              return (
                <button
                  key={g.id}
                  type="button"
                  aria-label={`${g.label} — ${g.mod || g.brand}${g.partCount > 1 ? ` (${g.partCount} Parts)` : ''}`}
                  aria-pressed={isSelected}
                  title={`${g.label}\nBrand: ${g.brand}\nParts: ${g.partCount} (${g.parts.map((p) => p.label).join(', ')})\nMod: ${g.mod || 'preset-pack'}`}
                  onClick={() =>
                    setAssets({
                      hairMesh: g.id,
                      ...(g.pairedTextureId ? { hair: g.pairedTextureId } : {}),
                    })
                  }
                  className={cn(
                    'group flex w-full items-center justify-between border px-2.5 py-1.5 text-left transition-colors duration-100',
                    isSelected
                      ? 'border-[#eac87f] bg-[#eac87f]/15 text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.25)]'
                      : 'border-[#d4b483]/20 bg-black/40 text-[#c5baa6] hover:border-[#d4b483]/50 hover:bg-[#16130e] hover:text-[#f0e4cc]',
                  )}
                >
                  {/* Left: Index + Hair Name */}
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[8px] text-[#eadcc0]/40 shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="truncate text-[9.5px] font-mono tracking-wide">
                      {g.label}
                    </span>
                  </div>

                  {/* Right: Badges & Selected Indicator */}
                  <div className="flex shrink-0 items-center gap-1.5 ml-2">
                    <span className="rounded-[1px] border border-[#d4b483]/25 bg-black/60 px-1 py-0.2 font-mono text-[7.5px] uppercase text-[#a9a192]">
                      {g.brand}
                    </span>

                    {g.partCount > 1 && (
                      <span className="rounded-[1px] border border-[#eac87f]/40 bg-[#d4b483]/20 px-1 py-0.2 font-mono text-[7px] font-medium text-[#f2dfbe]">
                        {g.partCount}P
                      </span>
                    )}

                    {g.isHL && (
                      <span className="rounded-[1px] border border-[#7fb0ea]/40 bg-[#7fb0ea]/20 px-1 py-0.2 font-mono text-[7px] font-medium text-[#bfdbfe]">
                        HL
                      </span>
                    )}

                    {isSelected ? (
                      <span className="flex items-center gap-1 rounded-xs bg-[#eac87f] px-1.5 py-0.5 font-mono text-[8px] font-bold text-black shadow-[0_0_6px_rgba(234,200,127,0.7)]">
                        ACTIVE
                      </span>
                    ) : (
                      <span className="opacity-0 group-hover:opacity-100 font-mono text-[8px] text-[#eac87f]/80 transition-opacity">
                        SELECT
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active selection footer */}
          <div className="flex items-center justify-between px-1 text-[9px] font-mono tracking-tight text-[#8f8778]">
            <span className="truncate max-w-[200px] text-[#e2d8c6]">
              [{activeLabel}]
            </span>
            <span className="shrink-0 text-[#c4b595]">
              {activeGroup ? `${activeGroup.partCount} ${activeGroup.partCount === 1 ? 'Part' : 'Parts'}` : ''}
              {activeGroup?.isHL ? ' • HL' : ''}
            </span>
          </div>
        </div>
    </StudioCard>
  );
}
