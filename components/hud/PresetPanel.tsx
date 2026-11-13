'use client';

import { useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { parsePreset, payloadFromMorphs, presetFileName } from '@/lib/presetIO';
import { exportCharacterGlb } from '@/lib/exportGlb';
import { sculptHeadFor } from '@/lib/manifestSelect';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

interface PresetPanelProps {
  manifest: Mo2Manifest | null;
}

interface PresetCard {
  id: string;
  label: string;
  thumb: string;
}

const PRESET_CARDS: PresetCard[] = [
  { id: 'lyra', label: 'LYRA', thumb: '/assets/preset-pack/textures/presets/lyra.webp' },
  { id: 'seraphine', label: 'SERAPHINE', thumb: '/assets/preset-pack/textures/presets/seraphine.webp' },
  { id: 'isolde', label: 'ISOLDE', thumb: '/assets/preset-pack/textures/presets/isolde.webp' },
  { id: 'miren', label: 'MIREN', thumb: '/assets/preset-pack/textures/presets/miren.webp' },
];

type Status = { kind: 'ok' | 'warn' | 'error'; text: string } | null;

export function PresetPanel({ manifest }: PresetPanelProps) {
  const currentPreset = useCharacter((s) => s.preset);
  const applyPreset = useCharacter((s) => s.applyPreset);
  const setName = useCharacter((s) => s.setName);
  const characterName = useCharacter((s) => s.name);
  const loadPreset = useCharacter((s) => s.loadPreset);
  const snapshotPreset = useCharacter((s) => s.snapshotPreset);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [exportingGlb, setExportingGlb] = useState(false);

  const flash = (s: Status) => {
    setStatus(s);
    window.setTimeout(() => setStatus(null), 3500);
  };

  const handleSelectPreset = (p: PresetCard) => {
    applyPreset(p.id);
    setName(p.label);
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
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const text = await file.text();
      const payload = parsePreset(text, file.name);
      const head = sculptHeadFor(manifest, payload.sourceFile);
      loadPreset(
        payload.source === 'racemenu' && head?.origin === 'racemenu-export'
          ? { ...payload, regions: payloadFromMorphs([], { baked: true }).regions }
          : payload,
        head?.id,
      );

      if (payload.name) {
        setName(payload.name.toUpperCase().slice(0, 14));
      }

      flash({ kind: 'ok', text: `IMPORTED ${file.name}` });
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
        accept=".json,.jslot,application/json"
        onChange={onFileChange}
        className="hidden"
      />

      <div className="flex flex-col gap-3 rounded-xs border border-[#d4b483]/22 bg-black/45 p-3.5 backdrop-blur-md">
        {/* Top Header: PRESETS */}
        <h2 className="text-[11px] font-medium tracking-[0.05em] text-[#efece6] uppercase">
          PRESETS
        </h2>

        {/* ── Section 1: CHARACTER PRESETS ─────────────────────────────── */}
        <div className="flex flex-col gap-2 pt-0.5">
          <span className="text-center text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
            CHARACTER PRESETS
          </span>

          {/* 2×2 Grid of 4 Character Cards */}
          <div className="grid grid-cols-2 gap-2.5">
            {PRESET_CARDS.map((card) => {
              const isSelected = currentPreset === card.id;
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

        {/* ── Section 2: PRESET I/O ───────────────────────────────────── */}
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
            <span>SKYRIM SE · RACEMENU · XPMSE</span>
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
