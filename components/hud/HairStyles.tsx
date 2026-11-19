'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { assetOptions, isRenderableMeshRow } from '@/lib/manifestSelect';
import { convertUrl, fetchCatalogue } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { cn } from '@/lib/cn';
import { buildHairGroups, findHairGroupForPartId } from '@/lib/hair';
import { SearchInput } from '@/components/hud/common/SearchInput';
import { HairThumbnail } from '@/components/hud/HairThumbnail';

/** Below this, the shipped head hides the mesh — see `visibility`. */
const VISIBLE_MIN = 0.55;

export function HairStyles({ manifest }: { manifest: Mo2Manifest | null }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);
  const hair = useCharacter((s) => s.hair);

  const [query, setQuery] = useState('');
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

  // Direct search filter over all hairstyles without category or brand restrictions
  const filtered = useMemo(() => {
    if (!query.trim()) return hairGroups;
    const q = query.toLowerCase().trim();
    return hairGroups.filter(
      (g) =>
        g.label.toLowerCase().includes(q) ||
        g.groupKey.toLowerCase().includes(q) ||
        (g.mod && g.mod.toLowerCase().includes(q)) ||
        g.parts.some((p) => p.label.toLowerCase().includes(q)),
    );
  }, [hairGroups, query]);

  const activeGroup = useMemo(() => {
    return findHairGroupForPartId(hairGroups, selection.hairMesh) ?? hairGroups[0];
  }, [hairGroups, selection.hairMesh]);

  const selectedGroupId = activeGroup?.id;

  return (
    <div className="flex flex-col gap-2.5">
      {/* ── Header: Section title & count (blends natively into panel) ── */}
      <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6]">
          HAIRSTYLES
        </span>
        <span className="font-mono text-[10px] text-[#a49a88]">
          {loading ? 'LOADING…' : `${hairGroups.length} STYLES`}
        </span>
      </div>

      {/* ── Search Input ── */}
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search hairstyles…"
      />

      {/* ── 4 items per line Grid (square thumbnails only) ── */}
      <div className="thin-scroll grid max-h-[480px] grid-cols-4 gap-1.5 overflow-y-auto pr-0.5">
        {filtered.map((g) => {
          const isSelected = selectedGroupId === g.id;

          return (
            <button
              key={g.id}
              type="button"
              aria-label={`${g.label} — ${g.brand}${g.partCount > 1 ? ` (${g.partCount} Parts)` : ''}`}
              aria-pressed={isSelected}
              title={`${g.label}\nBrand: ${g.brand}\nParts: ${g.partCount} (${g.parts.map((p) => p.label).join(', ')})\nMod: ${g.mod || 'preset-pack'}`}
              onClick={() =>
                setAssets({
                  hairMesh: g.id,
                  ...(g.pairedTextureId ? { hair: g.pairedTextureId } : {}),
                })
              }
              className={cn(
                'group relative flex aspect-square w-full min-w-0 items-center justify-center overflow-hidden rounded-[2px] border transition-all duration-150',
                isSelected
                  ? 'border-[#eac87f] bg-[#eac87f]/20 shadow-[0_0_8px_rgba(234,200,127,0.35)] ring-1 ring-[#eac87f]'
                  : 'border-[#d4b483]/20 bg-black/45 hover:border-[#d4b483]/60 hover:bg-[#16130e]',
              )}
            >
              <HairThumbnail
                id={g.id}
                label={g.label}
                hairTone={hair.tone}
                meshUrls={g.parts.map(
                  (part) =>
                    (part.raw as { meshUrl?: string }).meshUrl ??
                    convertUrl({ kind: 'hairMesh', id: part.id, mode: 'mesh' }),
                )}
                className="h-full w-full object-cover p-0.5"
              />
              {/* Active selection dot */}
              {isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-[#eac87f] shadow-[0_0_4px_#eac87f]"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
