'use client';

import { useState } from 'react';
import { PresetLibrary } from '@/components/hud/PresetLibrary';
import { useCharacter } from '@/lib/store';
import { useBodySlideStore } from '@/lib/bodyslide/store';
import { WuxiaSubCategoryRail } from '@/components/hud/common/WuxiaSubCategoryRail';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

interface PresetPanelProps {
  manifest?: Mo2Manifest | null;
}

interface PresetCard {
  id: string;
  label: string;
  thumb: string;
}

interface BodyPresetCard {
  id: string;
  label: string;
  subtitle: string;
  description: string;
}

const PRESET_CARDS: PresetCard[] = [
  { id: 'lyra', label: 'Default', thumb: '/assets/preset-pack/textures/presets/lyra.webp?v=20261117' },
  { id: 'seraphine', label: 'Frau', thumb: '/assets/preset-pack/textures/presets/seraphine.webp' },
  { id: 'isolde', label: 'Iced Coffee', thumb: '/assets/preset-pack/textures/presets/isolde.webp?v=20261117' },
  { id: 'miren', label: 'Lan Xin', thumb: '/assets/preset-pack/textures/presets/miren.webp' },
];

const BODY_PRESET_CARDS: BodyPresetCard[] = [
  {
    id: 'necoco-v1',
    label: 'UBE NECOCO V1',
    subtitle: 'Base Curves',
    description: 'Classic Necoco Body v1 base curves',
  },
  {
    id: 'necoco-v2',
    label: 'UBE NECOCO V2',
    subtitle: 'Bom39 Boost',
    description: 'Enhanced Necoco Body v2 with Bom39 boob addon',
  },
  {
    id: 'necoco-converting-outfits',
    label: 'CONVERTING OUTFITS',
    subtitle: '150+ Morphs',
    description: '150+ Morphs outfit conversion preset',
  },
];

type Status = { kind: 'ok' | 'warn' | 'error'; text: string } | null;

/** Athletic silhouette icon for Body presets */
function IconBodySilhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden="true">
      <path
        d="M7 4 C9 4 10 5.5 12 5.5 C14 5.5 15 4 17 4 C18.5 4 20 5.5 19 8 C18 10.5 16 12 16 14 C16 16 18.5 18.5 18 21 C17.8 22 16 22 12 22 C8 22 6.2 22 6 21 C5.5 18.5 8 16 8 14 C8 12 6 10.5 5 8 C4 5.5 5.5 4 7 4 Z"
        strokeLinejoin="round"
      />
      <path d="M9 10 C10.5 11 13.5 11 15 10" strokeLinecap="round" opacity="0.6" />
      <path d="M10 14 C11 14.5 13 14.5 14 14" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

export function PresetPanel({ manifest: _manifest }: PresetPanelProps) {
  const [activeTab, setActiveTab] = useState<'face' | 'body'>('face');

  // Face preset state
  const currentPreset = useCharacter((s) => s.preset);
  const applyPreset = useCharacter((s) => s.applyPreset);
  const setName = useCharacter((s) => s.setName);
  const setAssets = useCharacter((s) => s.setAssets);

  // Body preset state
  const activeBodyPresetId = useBodySlideStore((s) => s.activePresetId);

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

  const handleSelectBodyPreset = async (card: BodyPresetCard) => {
    try {
      await useBodySlideStore.getState().applyPreset(card.id);
      flash({ kind: 'ok', text: `Applied Body Preset: ${card.label}` });
    } catch {
      flash({ kind: 'error', text: `Failed to apply ${card.label}` });
    }
  };

  return (
    <div className="flex items-start gap-5 select-none text-white pointer-events-auto">
      {/* 1. Left Sub-Category Rail (Wuxia match: Presets active) */}
      <WuxiaSubCategoryRail activeTab="preset" />

      {/* 2. Main Preset Content Area */}
      <div className="flex flex-col w-[300px] md:w-[330px] max-h-[calc(100vh-160px)] overflow-y-auto scrollbar-none pr-1">
        <div className="flex flex-col gap-3">
          {/* Top Header: PRESETS */}
          <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6]">
              PRESETS
            </span>
            <span className="font-mono text-[10px] text-[#a49a88]">
              {activeTab === 'face' ? '4 BUILT-IN' : '3 CANONICAL'}
            </span>
          </div>

          {/* ── Sub-navigation: [FACE PRESETS] vs [BODY PRESETS] ── */}
          <div className="flex items-center gap-1 border-b border-[#d4b483]/20 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab('face')}
              aria-label="Face Presets"
              aria-pressed={activeTab === 'face'}
              className={cn(
                'flex-1 min-h-[26px] rounded-[3px] border px-2 py-1 text-center font-mono text-[10px] tracking-wider uppercase transition-all',
                activeTab === 'face'
                  ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.25)]'
                  : 'border-[#d4b483]/20 bg-black/40 text-[#a9a192] hover:border-[#d4b483]/40 hover:text-[#d5ccbb]',
              )}
            >
              [FACE PRESETS]
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('body')}
              aria-label="Body Presets"
              aria-pressed={activeTab === 'body'}
              className={cn(
                'flex-1 min-h-[26px] rounded-[3px] border px-2 py-1 text-center font-mono text-[10px] tracking-wider uppercase transition-all',
                activeTab === 'body'
                  ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.25)]'
                  : 'border-[#d4b483]/20 bg-black/40 text-[#a9a192] hover:border-[#d4b483]/40 hover:text-[#d5ccbb]',
              )}
            >
              [BODY PRESETS]
            </button>
          </div>

          {activeTab === 'face' ? (
            <>
              {/* ── CHARACTER PRESETS (4 Portrait Cards) ─────────────────────────── */}
              <div className="flex flex-col gap-2 pt-0.5">
                <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
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
                        aria-label={`Select face preset ${card.label}`}
                        aria-pressed={isSelected}
                        className="group flex flex-col items-center gap-1.5 text-center min-h-[24px]"
                      >
                        <div
                          className={cn(
                            'relative aspect-square w-full overflow-hidden rounded-xs border transition-all duration-150',
                            isSelected
                              ? 'border-2 border-[#eac87f] shadow-[0_0_12px_rgba(234,200,127,0.45)] ring-1 ring-[#eac87f]/60'
                              : 'border-[#d4b483]/25 bg-black/50 hover:border-[#d4b483]/60 hover:scale-[1.03]',
                          )}
                        >
                          {missingThumbs[card.id] ? (
                            <span className="flex h-full items-center justify-center p-3 text-[12px] text-[#b8b0a0]">
                              Preview unavailable
                            </span>
                          ) : (
                            <img
                              src={card.thumb}
                              alt={card.label}
                              onError={() => setMissingThumbs((previous) => ({ ...previous, [card.id]: true }))}
                              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                            />
                          )}
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

              <PresetLibrary />
            </>
          ) : (
            /* ── BODY PRESETS (Canonical 0Necoco / BodySlide Presets) ─────────────── */
            <div className="flex flex-col gap-2 pt-0.5">
              <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
                CANONICAL BODY PRESETS
              </span>

              <div className="flex flex-col gap-2">
                {BODY_PRESET_CARDS.map((card) => {
                  const isSelected = activeBodyPresetId === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => void handleSelectBodyPreset(card)}
                      aria-pressed={isSelected}
                      aria-label={`Apply Body Preset ${card.label} (${card.subtitle})`}
                      className={cn(
                        'group flex min-h-[52px] w-full items-center gap-2.5 rounded-[3px] border p-2 text-left transition-all duration-150',
                        isSelected
                          ? 'border-2 border-[#eac87f] bg-[#d4b483]/15 shadow-[0_0_12px_rgba(234,200,127,0.4)] ring-1 ring-[#eac87f]/60'
                          : 'border-[#d4b483]/25 bg-black/45 hover:border-[#d4b483]/60 hover:bg-[#d4b483]/10 hover:scale-[1.01]',
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border transition-colors',
                          isSelected
                            ? 'border-[#eac87f] bg-[#d4b483]/25 text-[#f2dfbe]'
                            : 'border-[#d4b483]/20 bg-black/60 text-[#a49a88] group-hover:border-[#d4b483]/50 group-hover:text-[#e8dcce]',
                        )}
                      >
                        <IconBodySilhouette className="h-5 w-5" />
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                        <div className="flex items-center justify-between gap-1.5">
                          <span
                            className={cn(
                              'truncate font-mono text-[10.5px] font-semibold tracking-wider transition-colors',
                              isSelected
                                ? 'text-[#f2dfbe] drop-shadow-[0_0_6px_rgba(234,200,127,0.5)]'
                                : 'text-[#efece6] group-hover:text-[#fff0d4]',
                            )}
                          >
                            {card.label}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase',
                              isSelected
                                ? 'border-[#eac87f]/60 bg-[#d4b483]/25 font-bold text-[#f2dfbe]'
                                : 'border-[#d4b483]/20 bg-black/40 text-[#c4b595]',
                            )}
                          >
                            {card.subtitle}
                          </span>
                        </div>
                        <span className="truncate text-[10px] text-[#a49a88] group-hover:text-[#c4b9a3]">
                          {card.description}
                        </span>
                      </div>

                      {isSelected && (
                        <span
                          aria-hidden="true"
                          className="shrink-0 font-bold text-[13px] text-[#eac87f] drop-shadow-[0_0_4px_rgba(234,200,127,0.8)]"
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-1 flex items-start gap-1.5 rounded-[2px] border border-[#d4b483]/15 bg-black/30 p-2">
                <span className="text-[10px] font-mono leading-relaxed text-[#8f8778]">
                  Presets configure 0Necoco vertex morph deltas across Body, Hands, and Feet geometry in real time.
                </span>
              </div>
            </div>
          )}

          {/* Status Message Toast */}
          {status && (
            <div
              role="status"
              className={cn(
                'mt-1 text-center font-mono text-[10px] tracking-wide',
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
