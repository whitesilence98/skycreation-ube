'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { convertUrl, fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { isRenderableMeshRow } from '@/lib/manifestSelect';
import { cn } from '@/lib/cn';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { SearchInput } from '@/components/hud/common/SearchInput';
import { SegmentedControl } from '@/components/hud/common/SegmentedControl';

type Mode = 'mesh' | 'texture';

const MODES = [
  { id: 'mesh', label: 'MESH' },
  { id: 'texture', label: 'TEX' },
] as const satisfies ReadonlyArray<{ id: Mode; label: string }>;

/** `.nif` beats its `.tri` twin when both carry the same label. */
function extensionOf(file: string): 'nif' | 'tri' | 'other' {
  const lower = file.toLowerCase();
  if (lower.endsWith('.nif')) return 'nif';
  if (lower.endsWith('.tri')) return 'tri';
  return 'other';
}

/**
 * One option per case-insensitive label, keeping the `.nif`.
 *
 * The pack ships the base set twice — `EyeFemaleLashes.nif` and the same shape
 * re-exported as `EyeFemaleLashes.tri` — so the catalogue offers 19 decodable
 * rows for 18 choices. Undecodable stubs keep a label of their own and survive
 * as disabled cards, so their reason stays visible.
 */
function dedupeByLabel(rows: CatalogueEntry[]): CatalogueEntry[] {
  const byLabel = new Map<string, CatalogueEntry>();
  for (const row of rows) {
    const key = (row.label || row.file).toLowerCase();
    const previous = byLabel.get(key);
    if (!previous) {
      byLabel.set(key, row);
      continue;
    }
    if (extensionOf(previous.file) !== 'nif' && extensionOf(row.file) === 'nif') {
      byLabel.set(key, row);
    }
  }
  return [...byLabel.values()];
}

const labelOf = (entry: CatalogueEntry) =>
  (entry.label || entry.file).replace(/\.(nif|tri|dds)$/i, '');

export function LashesPicker({ onDirty }: { onDirty?: () => void }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);

  const [mode, setMode] = useState<Mode>('mesh');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(!catalogues.lashes || !catalogues.lashesMesh);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCatalogue('lashes'), fetchCatalogue('lashesMesh')])
      .then(([textures, meshes]) => {
        if (cancelled) return;
        if (textures.length) setCatalogue('lashes', textures);
        if (meshes.length) setCatalogue('lashesMesh', meshes);
        if (!textures.length || !meshes.length) {
          setError('Lashes catalogue unavailable — try reloading.');
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Lashes catalogue request failed.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  /* Albedo atlases only: the `_n` companions and unavailable rows are not a
     choice, they are a decode input the resolver picks up from the albedo. */
  const textures = useMemo(
    () =>
      (catalogues.lashes ?? []).filter(
        (entry) =>
          (entry.mapRole ?? 'albedo') === 'albedo' &&
          !entry.file.toLowerCase().endsWith('_n.dds') &&
          entry.available !== false &&
          !entry.unavailable,
      ),
    [catalogues.lashes],
  );

  const meshes = useMemo(
    () => dedupeByLabel((catalogues.lashesMesh ?? []) as CatalogueEntry[]),
    [catalogues.lashesMesh],
  );

  /* Pairing target ids, so a mesh is only paired with an atlas this panel can
     actually show (and the resolver can resolve). */
  const textureIds = useMemo(() => new Set(textures.map((entry) => entry.id)), [textures]);

  const filteredMeshes = useMemo(
    () =>
      meshes.filter(
        (entry) => !query.trim() || matchesQuery(entry, query) || labelOf(entry).toLowerCase().includes(query.toLowerCase()),
      ),
    [meshes, query],
  );
  const filteredTextures = useMemo(
    () =>
      textures.filter(
        (entry) => !query.trim() || matchesQuery(entry, query) || labelOf(entry).toLowerCase().includes(query.toLowerCase()),
      ),
    [textures, query],
  );

  const activeMeshId = selection.lashesMesh;
  const activeTextureId = selection.lashes;
  const activeMesh = meshes.find((entry) => entry.id === activeMeshId);
  const activeTexture = textures.find((entry) => entry.id === activeTextureId);
  const renderableMeshes = meshes.filter((entry) => isRenderableMeshRow(entry)).length;

  const selectMesh = (entry: CatalogueEntry) => {
    if (!isRenderableMeshRow(entry)) return;
    const pair =
      entry.pairedTextureId && textureIds.has(entry.pairedTextureId) ? entry.pairedTextureId : null;
    setAssets(pair ? { lashesMesh: entry.id, lashes: pair } : { lashesMesh: entry.id });
    onDirty?.();
  };

  const selectTexture = (entry: CatalogueEntry) => {
    setAssets({ lashes: entry.id });
    onDirty?.();
  };

  const shown = mode === 'mesh' ? filteredMeshes.length : filteredTextures.length;

  return (
    <StudioCard
      title="LASHES & LINER"
      badge={loading ? 'LOADING…' : mode === 'mesh' ? `${renderableMeshes} SHAPES` : `${textures.length} ATLASES`}
      footerLeading={<span>+ UBE · COR LASH ATLAS</span>}
      footerTrailing={<span>{shown} SHOWN</span>}
      showSparkle
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
            LASH PRESETS
          </span>
          <span className="text-[9.5px] font-mono tracking-tight text-[#8f8778]">
            {loading ? 'LOADING…' : `${textures.length} ATLASES · ${meshes.length} MESHES`}
          </span>
        </div>

        <SegmentedControl
          segments={MODES}
          value={mode}
          onChange={setMode}
          ariaLabel="Lashes view: mesh or texture"
        />

        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search lashes by style…"
        />

        {error && (
          <p
            role="alert"
            className="border border-[#b56a5a]/40 bg-[#b56a5a]/10 px-2 py-1.5 text-[9.5px] font-mono leading-relaxed text-[#dda898]"
          >
            {error}
          </p>
        )}

        <div className="thin-scroll max-h-[248px] overflow-y-auto pr-[2px]">
          {loading ? (
            <div className={cn('grid gap-[6px]', mode === 'mesh' ? 'grid-cols-3' : 'grid-cols-2')}>
              {Array.from({ length: mode === 'mesh' ? 9 : 6 }, (_, i) => (
                <div
                  key={i}
                  className="aspect-[2.1/1] animate-pulse rounded-[2px] border border-[#d4b483]/15 bg-[#d4b483]/5 motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : mode === 'mesh' ? (
            filteredMeshes.length === 0 ? (
              <p className="border border-[#d4b483]/20 bg-black/30 px-[10px] py-[16px] text-center text-[10px] leading-relaxed text-[#c5b595]">
                {error ? 'No lash meshes could be listed.' : 'No matching lash shapes.'}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-[6px]">
                {filteredMeshes.map((entry) => {
                  const renderable = isRenderableMeshRow(entry);
                  const isSelected = entry.id === activeMeshId;
                  const pair =
                    entry.pairedTextureId && textureIds.has(entry.pairedTextureId)
                      ? entry.pairedTextureId
                      : null;
                  const label = labelOf(entry);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={!renderable}
                      aria-disabled={!renderable || undefined}
                      aria-pressed={isSelected}
                      aria-label={renderable ? `Select lash shape ${label}` : `${label} — ${entry.reason ?? 'not decodable'}`}
                      title={entry.reason ? `${label}\n${entry.reason}` : `${label}\n${entry.file}`}
                      onClick={() => selectMesh(entry)}
                      className={cn(
                        'group relative flex aspect-[2.1/1] min-w-0 flex-col items-center justify-center overflow-hidden rounded-[2px] border p-[3px] transition-all duration-150 select-none',
                        !renderable
                          ? 'cursor-default border-[#b56a5a]/30 bg-[#16120f]/70 opacity-45'
                          : isSelected
                            ? 'border-[#b89552] bg-[#4a3d2a]/95 shadow-[0_0_12px_rgba(184,149,82,0.35)] ring-1 ring-[#b89552]/70'
                            : 'border-[#382d22] bg-[#1a1512]/92 hover:border-[#6a553c] hover:bg-[#251e19]',
                      )}
                    >
                      {pair ? (
                        <img
                          src={convertUrl({ kind: 'lashes', id: pair, mode: 'thumb' })}
                          alt=""
                          loading="lazy"
                          className={cn(
                            'h-full w-full object-contain filter drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)] transition-transform duration-150 group-hover:scale-105',
                            isSelected ? 'opacity-100' : 'opacity-85 group-hover:opacity-100',
                          )}
                          onError={(event) => {
                            const target = event.currentTarget;
                            const atlas = convertUrl({ kind: 'lashes', id: pair, mode: 'atlas' });
                            if (target.getAttribute('src') !== atlas) target.src = atlas;
                          }}
                        />
                      ) : renderable ? (
                        <span className="text-[9px] font-mono tracking-[0.08em] text-[#c9b184]/70">NIF</span>
                      ) : (
                        <span className="px-1 text-center text-[8.5px] font-mono leading-tight tracking-[0.04em] text-[#dda898]/80">
                          {entry.reason ?? 'not decodable'}
                        </span>
                      )}

                      <span
                        className={cn(
                          'absolute bottom-[2px] inset-x-[3px] truncate rounded-[1px] px-1 py-[1px] text-center text-[8.5px] font-mono tracking-tight transition-colors',
                          isSelected
                            ? 'bg-black/85 font-medium text-[#f4e6cf]'
                            : 'bg-black/80 text-[#8e8576] group-hover:text-[#d4cbb8]',
                        )}
                      >
                        {label}
                      </span>

                      {isSelected && (
                        <span className="pointer-events-none absolute -top-[1px] h-[3px] w-[3px] rounded-full bg-[#f2dfbe] shadow-[0_0_5px_rgba(242,223,190,0.9)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            )
          ) : filteredTextures.length === 0 ? (
            <p className="border border-[#d4b483]/20 bg-black/30 px-[10px] py-[16px] text-center text-[10px] leading-relaxed text-[#c5b595]">
              {error ? 'No lash atlases could be listed.' : 'No matching lash atlases.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-[6px]">
              {filteredTextures.map((entry) => {
                const isSelected = entry.id === activeTextureId;
                const label = labelOf(entry);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Select lash atlas ${label}`}
                    title={`${label}\n${entry.file}`}
                    onClick={() => selectTexture(entry)}
                    className={cn(
                      'group relative flex aspect-[2.1/1] min-w-0 flex-col items-center justify-center overflow-hidden rounded-[2px] border p-[3px] transition-all duration-150 select-none',
                      isSelected
                        ? 'border-[#b89552] bg-[#4a3d2a]/95 shadow-[0_0_12px_rgba(184,149,82,0.35)] ring-1 ring-[#b89552]/70'
                        : 'border-[#382d22] bg-[#1a1512]/92 hover:border-[#6a553c] hover:bg-[#251e19]',
                    )}
                  >
                    <img
                      src={convertUrl({ kind: 'lashes', id: entry.id, mode: 'thumb' })}
                      alt=""
                      loading="lazy"
                      className={cn(
                        'h-full w-full object-contain filter drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)] transition-transform duration-150 group-hover:scale-105',
                        isSelected ? 'opacity-100' : 'opacity-85 group-hover:opacity-100',
                      )}
                      onError={(event) => {
                        const target = event.currentTarget;
                        const atlas = convertUrl({ kind: 'lashes', id: entry.id, mode: 'atlas' });
                        if (target.getAttribute('src') !== atlas) target.src = atlas;
                      }}
                    />
                    <span
                      className={cn(
                        'absolute bottom-[2px] inset-x-[3px] truncate rounded-[1px] px-1 py-[1px] text-center text-[8.5px] font-mono tracking-tight transition-colors',
                        isSelected
                          ? 'bg-black/85 font-medium text-[#f4e6cf]'
                          : 'bg-black/80 text-[#8e8576] group-hover:text-[#d4cbb8]',
                      )}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-[#463a2e]/50 pt-1 text-center">
          <span className="text-[9.5px] font-mono tracking-tight text-[#d4b483]">
            [{activeMesh ? labelOf(activeMesh) : 'PACK DEFAULT'} · {activeTexture ? labelOf(activeTexture) : 'HEAD ATLAS'}]
          </span>
        </div>
      </div>
    </StudioCard>
  );
}
