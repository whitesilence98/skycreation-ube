'use client';

import { useEffect, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { assetOptions, isRenderableMeshRow } from '@/lib/manifestSelect';
import { convertUrl, fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { cn } from '@/lib/cn';

/** Below this, the shipped head hides the mesh — see `visibility`. */
const VISIBLE_MIN = 0.55;

export function HairStyles({ manifest }: { manifest: Mo2Manifest | null }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);
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
    return () => { cancelled = true; };
  }, [setCatalogue]);
  const curated = assetOptions(manifest, 'hairMesh');
  const archive = catalogues.hairMesh ?? [];
  // A hairstyle authored for another head sits *inside* this one and renders as
  // nothing. The indexer measures how much of each mesh clears the shipped head
  // (`visibility`); below the cutoff the tile would be a blank button, so it is
  // dropped rather than offered. Unmeasured entries stay — absence of a
  // measurement is not evidence of a bad fit.
  const visible = (e: { visibility?: number }) =>
    e.visibility === undefined || e.visibility >= VISIBLE_MIN;
  const options = [
    ...curated.map((m) => ({ ...m, pairedTextureId: m.pairedTextureId ?? archive.find((e) => e.rel === m.rel)?.pairedTextureId })),
    ...archive.filter((m) => isRenderableMeshRow(m) && visible(m) && !curated.some((c) => c.rel === m.rel)),
  ];
  // The archive ships the same mesh under two names often enough to matter
  // (00hairline02 / 00hairline_himeji are byte-identical, as are
  // hairline04 / hairline05). Two tiles that render the same hair are two
  // opportunities to pick the wrong one, so keep the first of each copy.
  // Curated rows carry no size, so they key on id and never collide.
  const fingerprint = (m: (typeof options)[number]) =>
    'bytes' in m && m.bytes !== undefined ? `${m.bytes}/${m.mtime}` : `id:${m.id}`;
  const unique = options.filter((m, i) =>
    options.findIndex((o) => fingerprint(o) === fingerprint(m)) === i);
  /* Mirrors `resolveManifest`: a textured style wins, grey is the fallback when
     nothing textured renders (this pack's state), and the implicit choice is
     always a row the viewport can actually draw. */
  const selected =
    selection.hairMesh ??
    (unique.find((m) => isRenderableMeshRow(m) && m.untextured !== true) ?? unique[0])?.id;
  const filtered = unique.filter((m) => matchesQuery(m as Parameters<typeof matchesQuery>[0], query));
  const untextured = (m: (typeof options)[number]) => m.untextured === true;
  return (
    <div>
      <div className="mb-[7px] flex justify-between">
        <h2 className="text-[11px] tracking-[0.02em] text-[#e2d8c6]">HAIR STYLES</h2>
        <span className="text-[7px] text-[#b6ad9c]">MO2 · {unique.length}</span>
      </div>
      <input aria-label="Search MO2 hair" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search hair / mod…" className="mb-[8px] w-full border border-[#d4b483]/30 bg-black/50 p-[5px] text-[8px] text-[#e2d8c6]" />
      <div className="thin-scroll grid max-h-[320px] grid-cols-4 gap-[9px] overflow-y-auto pr-[3px]">
        {filtered.map((m, i) => (
          <button key={m.id} type="button" aria-label={`${m.label} — ${m.mod}${untextured(m) ? ' (untextured)' : ''}`} aria-pressed={selected === m.id} title={`${m.mod}\n${m.rel}${untextured(m) ? `\n${m.reason ?? 'no atlas — drawn flat grey'}` : ''}`} onClick={() => setAssets({ hairMesh: m.id, ...(m.pairedTextureId ? { hair: m.pairedTextureId } : {}) })} className="group min-w-0 text-left">
            <span className={cn('relative flex aspect-[4/5] items-center justify-center overflow-hidden border bg-[#19130f]', selected === m.id ? 'border-[#eac87f] shadow-[0_0_10px_#d4b48344]' : 'border-[#d4b483]/25 group-hover:border-[#d4b483]/65')}>
              {m.pairedTextureId ? <img src={convertUrl({ kind: 'hair', id: m.pairedTextureId, mode: 'thumb' })} alt="" loading="lazy" className="h-full w-full object-cover opacity-70" /> : <span className={cn('text-[8px]', untextured(m) ? 'text-[#c9b184]' : 'text-[#b6ad9c]')}>{untextured(m) ? 'UNTEXTURED' : 'MESH'}</span>}
              <span className="absolute left-[2px] top-[1px] text-[6px] text-[#eadcc0]">{String(i + 1).padStart(2, '0')}</span>
            </span>
            <span className="mt-[3px] block truncate text-[7px] text-[#d5ccbb]">{m.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-[8px] text-[6px] leading-[1.5] text-[#a9a192]">{loading ? 'Loading MO2 archive…' : !filtered.length ? 'No supported hair meshes found.' : 'Premade MO2 meshes · paired atlas previews. Shape stays as authored.'}</p>    </div>
  );
}
