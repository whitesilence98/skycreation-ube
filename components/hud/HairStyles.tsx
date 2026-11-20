'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { assetOptions, isRenderableMeshRow } from '@/lib/manifestSelect';
import { convertUrl, fetchCatalogue } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { buildHairGroups, findHairGroupForPartId } from '@/lib/hair';
import { HairThumbnail } from '@/components/hud/HairThumbnail';
import { ItemTile } from '@/components/hud/common/ItemTile';
import {
  IconSubFace,
  IconSubMakeup,
  IconSubHair,
} from '@/components/hud/outfit/WuxiaSlotIcons';
import { navigateCategory } from '@/lib/editorNav';

/** Below this, the shipped head hides the mesh — see `visibility`. */
const VISIBLE_MIN = 0.55;

export function HairStyles({ manifest }: { manifest: Mo2Manifest | null }) {
  const catalogues = useCharacter(s => s.assetCatalogues);
  const selection = useCharacter(s => s.assetSelection);
  const setAssets = useCharacter(s => s.setAssets);
  const setCatalogue = useCharacter(s => s.setAssetCatalogue);
  const hair = useCharacter(s => s.hair);

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
      ...curated.map(m => ({
        ...m,
        pairedTextureId:
          m.pairedTextureId ?? archive.find(e => e.rel === m.rel)?.pairedTextureId,
      })),
      ...archive.filter(
        m => isRenderableMeshRow(m) && visible(m) && !curated.some(c => c.rel === m.rel)
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
      g =>
        g.label.toLowerCase().includes(q) ||
        g.groupKey.toLowerCase().includes(q) ||
        (g.mod && g.mod.toLowerCase().includes(q)) ||
        g.parts.some(p => p.label.toLowerCase().includes(q))
    );
  }, [hairGroups, query]);

  const activeGroup = useMemo(() => {
    return findHairGroupForPartId(hairGroups, selection.hairMesh) ?? hairGroups[0];
  }, [hairGroups, selection.hairMesh]);

  const selectedGroupId = activeGroup?.id;

  return (
    <div className="flex items-start gap-4 select-none">
      {/* ─────────────────────────────────────────────────────────────────────────────
          LEFT SUB-CATEGORY RAIL (Customization, Makeup, Hairstyle)
          ───────────────────────────────────────────────────────────────────────────── */}
      <nav
        className="flex w-[72px] shrink-0 flex-col items-center gap-5 pt-1"
        aria-label="Character Customization Sub-categories"
      >
        {/* Customization (Face Sculpt) */}
        <button
          type="button"
          onClick={() => navigateCategory('face')}
          className="group flex flex-col items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          aria-label="Customization — Face Sculpting"
          title="Face Customization"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/80 text-[#9f9da6] backdrop-blur-md transition-all group-hover:border-white/30 group-hover:text-white">
            <IconSubFace className="h-6 w-6" />
          </span>
          <span className="text-[10px] tracking-tight whitespace-nowrap text-[#9f9da6] transition-colors group-hover:text-white">
            Customization
          </span>
        </button>

        {/* Makeup */}
        <button
          type="button"
          onClick={() => navigateCategory('styling')}
          className="group flex flex-col items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          aria-label="Makeup & Styling"
          title="Makeup & Styling"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/80 text-[#9f9da6] backdrop-blur-md transition-all group-hover:border-white/30 group-hover:text-white">
            <IconSubMakeup className="h-6 w-6" />
          </span>
          <span className="text-[10px] tracking-tight whitespace-nowrap text-[#9f9da6] transition-colors group-hover:text-white">
            Makeup
          </span>
        </button>

        {/* Hairstyle (Active) */}
        <div className="flex flex-col items-center gap-1" aria-current="page">
          <div className="flex h-11 w-11 items-center justify-center rounded-[2px] bg-white text-black shadow-lg">
            <IconSubHair className="h-6 w-6" />
          </div>
          <span className="text-[10px] font-medium tracking-tight whitespace-nowrap text-white">
            Hairstyle
          </span>
        </div>
      </nav>

      {/* ─────────────────────────────────────────────────────────────────────────────
          HAIRSTYLE SELECTION AREA (Header + 3-Column ItemTile Grid)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Section Header */}
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[13px] font-medium tracking-wide text-[#e6e1d8]">Hairstyle</h2>
          <span className="font-mono text-[10px] text-[#8a8793]">
            {loading ? 'LOADING…' : `${hairGroups.length} STYLES`}
          </span>
        </div>

        {/* Optional Search input if filtering */}
        {hairGroups.length > 15 && (
          <div className="mb-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search hairstyle…"
              aria-label="Search hairstyle"
              className="h-7 w-full rounded-[2px] border border-white/10 bg-[#1e1e23]/90 px-2 font-mono text-[11px] text-[#e6e1d8] placeholder-[#7a7882] backdrop-blur-md transition-colors focus:border-[#eac87f] focus:outline-none"
            />
          </div>
        )}

        {/* 3-Column ItemTile Grid matching Image 2 */}
        <div className="grid max-h-[460px] grid-cols-3 gap-2 overflow-y-auto">
          {filtered.map(g => {
            const isSelected = selectedGroupId === g.id;

            return (
              <ItemTile
                key={g.id}
                id={g.id}
                title={g.label}
                subtitle={`${g.brand}${g.partCount > 1 ? ` (${g.partCount} Parts)` : ''}`}
                isSelected={isSelected}
                showCheckmark={true}
                onClick={() =>
                  setAssets({
                    hairMesh: g.id,
                    ...(g.pairedTextureId ? { hair: g.pairedTextureId } : {}),
                  })
                }
                thumbnail={
                  <HairThumbnail
                    id={g.id}
                    label={g.label}
                    hairTone={hair.tone}
                    meshUrls={g.parts.map(
                      part =>
                        (part.raw as { meshUrl?: string }).meshUrl ??
                        convertUrl({ kind: 'hairMesh', id: part.id, mode: 'mesh' })
                    )}
                    className="h-full w-full object-cover"
                  />
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
