'use client';

import { useState } from 'react';
import { useCharacter } from '@/lib/store';
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
  { id: 'lyra', label: 'Default', thumb: '/assets/preset-pack/textures/presets/lyra.webp?v=20261117' },
  { id: 'seraphine', label: 'Frau', thumb: '/assets/preset-pack/textures/presets/seraphine.webp' },
  { id: 'isolde', label: 'Iced Coffee', thumb: '/assets/preset-pack/textures/presets/isolde.webp?v=20261117' },
  { id: 'miren', label: 'Lan Xin', thumb: '/assets/preset-pack/textures/presets/miren.webp' },
];

type Status = { kind: 'ok' | 'warn' | 'error'; text: string } | null;

export function PresetPanel({ manifest: _manifest }: PresetPanelProps) {
  const currentPreset = useCharacter((s) => s.preset);
  const applyPreset = useCharacter((s) => s.applyPreset);
  const setName = useCharacter((s) => s.setName);
  const setAssets = useCharacter((s) => s.setAssets);

  const [status, setStatus] = useState<Status>(null);
  const [missingThumbs, setMissingThumbs] = useState<Record<string, boolean>>({});

  const flash = (s: Status) => {
    setStatus(s);
    window.setTimeout(() => setStatus(null), 3500);
  };

  const handleSelectPreset = (card: PresetCard) => {
    if (currentPreset === card.id) return;
    /* Applying a preset replaces every face value and clears its history, so a
       stray click is unrecoverable. Ask once, and only when there is something
       to lose: a fresh visit to the same preset stays a single click. */
    if (!window.confirm(`Apply “${card.label}”? This replaces the current face and clears undo history.`)) return;
    applyPreset(card.id as any);
    setName(card.label.toUpperCase());
    setAssets({ preset: undefined });
    flash({ kind: 'ok', text: `APPLIED ${card.label}` });
  };

  return (
    <div className="relative select-none text-[#e6e1d8]">
      <div className="flex flex-col gap-3 rounded-xs border border-[#d4b483]/22 bg-black/45 p-3.5 backdrop-blur-md">
        {/* Top Header: PRESETS */}
        <h2 className="text-[11px] font-medium tracking-[0.05em] text-[#efece6] uppercase">
          PRESETS
        </h2>

        {/* ── CHARACTER PRESETS (4 Portrait Cards) ─────────────────────────── */}
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
                    {missingThumbs[card.id] ? <span className="flex h-full items-center justify-center p-3 text-[12px] text-[#b8b0a0]">Preview unavailable</span> : <img
                      src={card.thumb}
                      alt={card.label}
                      onError={() => setMissingThumbs(previous => ({ ...previous, [card.id]: true }))}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />}
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

        {/* Format Compatibility Tagline */}
        <div className="flex items-center justify-center gap-1.5 pt-1 text-[8.5px] font-mono tracking-[0.12em] text-[#8b8375]/70 border-t border-[#d4b483]/14">
          <span className="text-[#d4b483]/70">+</span>
          <span>SKYRIM SE · RACEMENU · XPMSE</span>
        </div>
      </div>
    </div>
  );
}
