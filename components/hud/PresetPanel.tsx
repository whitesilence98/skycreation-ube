'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { payloadFromMorphs, presetFileName } from '@/lib/presetIO';
import { exportCharacterGlb } from '@/lib/exportGlb';
import { assetOptions, sculptHeadFor } from '@/lib/manifestSelect';
import { importPresetFromFiles } from '@/lib/head/nifImport';
import { fetchCatalogue } from '@/lib/mo2/client';
import { cn } from '@/lib/cn';
import type { Mo2Manifest, Mo2PresetOption } from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { IconChevronLeft } from '@/components/hud/Icons';

interface PresetPanelProps {
  manifest: Mo2Manifest | null;
}

interface PresetCard {
  id: string;
  label: string;
  thumb: string;
}

const PRESET_CARDS: PresetCard[] = [
  { id: 'lyra', label: 'Default', thumb: '/assets/preset-pack/textures/presets/lyra.webp' },
  { id: 'seraphine', label: 'Frau', thumb: '/assets/preset-pack/textures/presets/seraphine.webp' },
  { id: 'isolde', label: 'Iced Coffee', thumb: '/assets/preset-pack/textures/presets/isolde.webp' },
  { id: 'miren', label: 'Lan Xin', thumb: '/assets/preset-pack/textures/presets/miren.webp' },
];

type Status = { kind: 'ok' | 'warn' | 'error'; text: string } | null;

interface ArchivePresetItem {
  id: string;
  label: string;
  file: string;
  mod: string;
  morphs: Array<{ name: string; value: number }>;
  actor?: Record<string, unknown>;
  bytes?: number;
}

export function PresetPanel({ manifest }: PresetPanelProps) {
  const currentPreset = useCharacter((s) => s.preset);
  const applyPreset = useCharacter((s) => s.applyPreset);
  const setName = useCharacter((s) => s.setName);
  const characterName = useCharacter((s) => s.name);
  const loadPreset = useCharacter((s) => s.loadPreset);
  const snapshotPreset = useCharacter((s) => s.snapshotPreset);

  const assetSelection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const assetCatalogues = useCharacter((s) => s.assetCatalogues);
  const setAssetCatalogue = useCharacter((s) => s.setAssetCatalogue);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [exportingGlb, setExportingGlb] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(true);
  const [query, setQuery] = useState('');

  const activeArchiveId = assetSelection.preset;

  const flash = (s: Status) => {
    setStatus(s);
    window.setTimeout(() => setStatus(null), 3500);
  };

  // Fetch preset catalogue lazily if not already cached
  useEffect(() => {
    if (!assetCatalogues.preset?.length) {
      fetchCatalogue('preset').then((list) => {
        if (list?.length) setAssetCatalogue('preset', list);
      });
    }
  }, [assetCatalogues.preset, setAssetCatalogue]);

  // Combine curated manifest presets with catalogue entries (deduped)
  const curated = useMemo(() => {
    return assetOptions(manifest, 'preset') as Mo2PresetOption[];
  }, [manifest]);

  const catalogue = useMemo(() => {
    return (assetCatalogues.preset ?? []) as (CatalogueEntry & {
      morphs?: Array<{ name: string; value: number }>;
      actor?: Record<string, unknown>;
      sculpt?: { vertexCount?: number; pointCount?: number };
    })[];
  }, [assetCatalogues.preset]);

  const allPresets = useMemo<ArchivePresetItem[]>(() => {
    const list: ArchivePresetItem[] = [];
    const seen = new Set<string>();

    for (const opt of curated) {
      const key = (opt.rel || opt.file || opt.id).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          id: opt.id,
          label: opt.label || opt.file.replace(/\.jslot$/i, ''),
          file: opt.file,
          mod: opt.mod,
          morphs: opt.morphs || [],
          actor: opt.actor,
        });
      }
    }

    for (const e of catalogue) {
      const key = (e.rel || e.file || e.id).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          id: e.id,
          label: e.label || e.file.replace(/\.jslot$/i, ''),
          file: e.file,
          mod: e.mod,
          morphs: e.morphs || [],
          actor: e.actor,
          bytes: e.bytes,
        });
      }
    }
    return list;
  }, [curated, catalogue]);

  const filteredPresets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allPresets;
    return allPresets.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.file.toLowerCase().includes(q) ||
        p.mod.toLowerCase().includes(q),
    );
  }, [allPresets, query]);

  const activeArchivePreset = useMemo(() => {
    if (!activeArchiveId) return null;
    return allPresets.find((p) => p.id === activeArchiveId) ?? null;
  }, [allPresets, activeArchiveId]);

  const handleSelectPreset = (p: PresetCard) => {
    setAssets({ preset: undefined });
    applyPreset(p.id);
    setName(p.label);
    flash({ kind: 'ok', text: `APPLIED ${p.label}` });
  };

  const handleSelectArchivePreset = (p: ArchivePresetItem) => {
    setAssets({ preset: p.id });
    const head = sculptHeadFor(manifest, p.file);
    const morphs = head?.origin === 'racemenu-export' ? [] : (p.morphs ?? []);
    loadPreset(
      payloadFromMorphs(morphs, {
        name: p.label || p.file,
        baked: head?.origin === 'racemenu-export',
        actorWeight: (p.actor as { weight?: number } | undefined)?.weight,
      }),
      head?.id,
    );
    setName(p.label.toUpperCase().slice(0, 14));
    flash({ kind: 'ok', text: `LOADED ${p.label}` });
  };

  const onExportJson = () => {
    const file = snapshotPreset();
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = presetFileName(file.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    flash({ kind: 'ok', text: `EXPORTED ${presetFileName(file.name)}` });
  };

  const onExportGlb = async () => {
    setExportingGlb(true);
    flash({ kind: 'ok', text: 'EXPORTING MODEL & RIG (.GLB)...' });
    try {
      await exportCharacterGlb(characterName);
      const safeName = (characterName || 'Character').trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
      flash({ kind: 'ok', text: `EXPORTED ${safeName}.glb` });
    } catch (err) {
      flash({ kind: 'error', text: err instanceof Error ? err.message : 'GLB export failed' });
    } finally {
      setExportingGlb(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files || !files.length) return;

    setBusy(true);
    try {
      const result = await importPresetFromFiles(files, manifest);
      loadPreset(result.payload, result.headOption?.id);

      if (result.characterName) {
        setName(result.characterName.toUpperCase().slice(0, 14));
      }

      flash({ kind: result.kind, text: result.summary });
    } catch (err) {
      flash({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to import preset' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative select-none text-[#e6e1d8]">
      {/* Hidden File Input for Import */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".json,.jslot,.nif,application/json"
        onChange={onFileChange}
        className="hidden"
      />

      <div className="flex flex-col gap-3 rounded-xs border border-[#d4b483]/22 bg-black/45 p-3.5 backdrop-blur-md">
        {/* Top Header: PRESETS */}
        <h2 className="text-[11px] font-medium tracking-[0.05em] text-[#efece6] uppercase">
          PRESETS
        </h2>

        {/* ── Section 1: CHARACTER PRESETS (4 Portrait Cards) ─────────────────────────── */}
        <div className="flex flex-col gap-2 pt-0.5">
          <span className="text-center text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
            CHARACTER PRESETS
          </span>

          {/* 2×2 Grid of 4 Character Cards */}
          <div className="grid grid-cols-2 gap-2.5">
            {PRESET_CARDS.map((card) => {
              const isSelected = currentPreset === card.id && !activeArchiveId;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => handleSelectPreset(card)}
                  className="group flex flex-col items-center gap-1.5 text-center"
                >
                  <div
                    className={cn(
                      'relative aspect-square w-full overflow-hidden rounded-xs border transition-all duration-150',
                      isSelected
                        ? 'border-2 border-[#eac87f] shadow-[0_0_12px_rgba(234,200,127,0.45)] ring-1 ring-[#eac87f]/60'
                        : 'border-[#d4b483]/25 bg-black/50 hover:border-[#d4b483]/60 hover:scale-[1.03]',
                    )}
                  >
                    <img
                      src={card.thumb}
                      alt={card.label}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                    <span className="pointer-events-none absolute inset-0 border border-black/25" />
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-mono tracking-wider transition-colors',
                      isSelected
                        ? 'font-bold text-[#f2dfbe] drop-shadow-[0_0_6px_rgba(234,200,127,0.5)]'
                        : 'text-[#8f8778] group-hover:text-[#c4b9a3]',
                    )}
                  >
                    {card.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Section 2: ARCHIVE PRESETS (.JSLOT) ───────────────────────── */}
        <div className="flex flex-col gap-2 pt-2 border-t border-[#d4b483]/18">
          <button
            type="button"
            onClick={() => setArchiveOpen(!archiveOpen)}
            className="group flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595] transition-colors group-hover:text-[#f2dfbe]">
                ARCHIVE PRESETS (.JSLOT)
              </span>
              <span className="rounded-xs border border-[#d4b483]/30 bg-[#d4b483]/10 px-1 py-0.2 text-[8.5px] font-mono text-[#eac87f]">
                {allPresets.length}
              </span>
            </div>
            <span
              className={cn(
                'text-[10px] text-[#c4b595] transition-transform duration-200',
                archiveOpen ? '-rotate-90' : 'rotate-180',
              )}
            >
              <IconChevronLeft className="h-3 w-3" />
            </span>
          </button>

          {archiveOpen && (
            <div className="flex flex-col gap-2">
              {/* Search Filter */}
              <div className="relative">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="FILTER .JSLOT PRESETS..."
                  className="w-full border border-[#d4b483]/25 bg-black/40 px-2 py-1 pr-5 text-[9.5px] font-mono tracking-wider text-[#e8ddc8] uppercase placeholder:text-[#7d6f5e]/70 focus:border-[#d4b483]/60 focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#8f8778] hover:text-[#e8ddc8]"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Scrollable List of .Jslot Presets */}
              <div className="flex max-h-[175px] flex-col gap-1 overflow-y-auto pr-1 thin-scroll">
                {filteredPresets.map((p) => {
                  const isSelected = activeArchiveId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectArchivePreset(p)}
                      title={`${p.file} (${p.mod})`}
                      className={cn(
                        'flex items-center justify-between gap-2 border px-2 py-1 text-left transition-all duration-150',
                        isSelected
                          ? 'border-[#eac87f] bg-[#d4b483]/15 text-[#f2e4c8] shadow-[0_0_8px_rgba(234,200,127,0.25)]'
                          : 'border-[#d4b483]/20 bg-black/30 text-[#cdc2ac]/85 hover:border-[#d4b483]/50 hover:bg-[#d4b483]/8 hover:text-[#f0e6d4]',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            isSelected
                              ? 'bg-[#eac87f] shadow-[0_0_6px_rgba(234,200,127,0.8)]'
                              : 'bg-[#8f8778]/50',
                          )}
                        />
                        <span className="truncate text-[10px] font-mono tracking-wide">
                          {p.label}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {p.morphs.length > 0 ? (
                          <span className="border border-[#d4b483]/30 bg-black/40 px-1 py-0.2 text-[8px] font-mono text-[#d8c39c]/90">
                            {p.morphs.length}M
                          </span>
                        ) : (
                          <span className="border border-[#8f8778]/30 bg-black/40 px-1 py-0.2 text-[8px] font-mono text-[#8f8778]">
                            JSLOT
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {!filteredPresets.length && (
                  <div className="py-2 text-center text-[9.5px] font-mono text-[#8f8778]/70">
                    NO PRESETS FOUND
                  </div>
                )}
              </div>

              {/* Active Preset Morph Details */}
              {activeArchivePreset && activeArchivePreset.morphs.length > 0 && (
                <div className="mt-0.5 flex flex-col gap-1 rounded-xs border border-[#d4b483]/16 bg-black/35 p-1.5 font-mono text-[9px] text-[#c4b595]">
                  <div className="flex items-center justify-between text-[#eac87f]">
                    <span className="tracking-wide">RACEMENU MORPHS</span>
                    <span>{activeArchivePreset.morphs.length}</span>
                  </div>
                  <div className="flex max-h-[48px] flex-wrap gap-1 overflow-y-auto thin-scroll">
                    {activeArchivePreset.morphs.slice(0, 10).map((m) => (
                      <span
                        key={m.name}
                        className="truncate border border-[#d4b483]/20 bg-[#d4b483]/5 px-1 py-0.2 text-[8px] text-[#cdc2ac]"
                        title={`${m.name}: ${m.value.toFixed(2)}`}
                      >
                        {m.name}
                      </span>
                    ))}
                    {activeArchivePreset.morphs.length > 10 && (
                      <span className="px-0.5 text-[8px] text-[#8f8778]">
                        +{activeArchivePreset.morphs.length - 10} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Section 3: PRESET I/O ───────────────────────────────────── */}
        <div className="flex flex-col gap-2 pt-2 border-t border-[#d4b483]/18">
          <span className="text-center text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
            PRESET I/O
          </span>

          {/* Row 1: IMPORT & EXPORT side-by-side */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 rounded-xs border border-[#d4b483]/30 bg-black/40 py-1.5 px-2 text-[10px] font-mono tracking-wider text-[#d8c39c] transition-all hover:border-[#eac87f] hover:bg-[#d4b483]/10 hover:shadow-[0_0_8px_rgba(212,180,131,0.25)] disabled:opacity-40"
            >
              <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-[#d4b483]" stroke="currentColor" strokeWidth="1.2">
                <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 12h11" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{busy ? 'IMPORTING...' : 'IMPORT'}</span>
            </button>

            <button
              type="button"
              onClick={onExportJson}
              className="flex items-center justify-center gap-1.5 rounded-xs border border-[#d4b483]/30 bg-black/40 py-1.5 px-2 text-[10px] font-mono tracking-wider text-[#d8c39c] transition-all hover:border-[#eac87f] hover:bg-[#d4b483]/10 hover:shadow-[0_0_8px_rgba(212,180,131,0.25)]"
            >
              <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-[#d4b483]" stroke="currentColor" strokeWidth="1.2">
                <path d="M8 10V2M4.5 5.5 8 2l3.5 3.5M2.5 12h11" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>EXPORT</span>
            </button>
          </div>

          {/* Row 2: EXPORT .GLB full-width */}
          <button
            type="button"
            disabled={exportingGlb}
            onClick={onExportGlb}
            title="Export complete 3D model with skeletal rig (.glb)"
            className="flex items-center justify-center gap-2 rounded-xs border border-[#d4b483]/30 bg-black/40 py-1.5 px-3 text-[10px] font-mono tracking-wider text-[#d8c39c] transition-all hover:border-[#eac87f] hover:bg-[#d4b483]/10 hover:shadow-[0_0_8px_rgba(212,180,131,0.25)] disabled:opacity-40"
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-[#d4b483]" stroke="currentColor" strokeWidth="1.2">
              <path d="M8 1.5 13.5 4.5v7L8 14.5 2.5 11.5v-7L8 1.5Z" strokeLinejoin="round" />
              <path d="M8 8v6.5M8 8 2.5 4.5M8 8l5.5-3.5" strokeLinejoin="round" />
            </svg>
            <span>{exportingGlb ? 'EXPORTING...' : 'EXPORT .GLB'}</span>
          </button>

          {/* Row 3: Format Compatibility Tagline */}
          <div className="flex items-center justify-center gap-1.5 pt-0.5 text-[8.5px] font-mono tracking-[0.12em] text-[#8b8375]/70">
            <span className="text-[#d4b483]/70">+</span>
            <span>SKYRIM SE · RACEMENU (.JSLOT & .NIF) · XPMSE</span>
          </div>

          {/* Status Message Toast */}
          {status && (
            <div
              role="status"
              className={cn(
                'mt-1 text-center font-mono text-[9.5px] tracking-wide uppercase',
                status.kind === 'error'
                  ? 'text-[#e0967c]'
                  : status.kind === 'warn'
                    ? 'text-[#e0c48d]'
                    : 'text-[#a9c9b6]',
              )}
            >
              {status.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
