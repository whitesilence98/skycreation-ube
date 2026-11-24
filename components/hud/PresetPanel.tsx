'use client';

import { useState } from 'react';
import { PresetLibrary } from '@/components/hud/PresetLibrary';
import { useBodySlideStore } from '@/lib/bodyslide/store';
import { WuxiaSubCategoryRail } from '@/components/hud/common/WuxiaSubCategoryRail';
import { usePresetUiStore, type PresetSlot } from '@/lib/presets/presetUiStore';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

interface PresetPanelProps {
  manifest?: Mo2Manifest | null;
}

interface BodyPresetCard {
  id: string;
  label: string;
  subtitle: string;
  description: string;
}

const BODY_PRESET_CARDS: BodyPresetCard[] = [
  {
    id: 'default-slim',
    label: 'SLIM _0 BASE',
    subtitle: 'Neutral Body',
    description: 'Authentic slim Skyrim _0 mesh with zero morphs',
  },
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

/** Traditional topknot bun character bust silhouette SVG matching target Image 2 */
export function IconWuxiaBustSilhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 120" fill="currentColor" className={className} aria-hidden="true">
      {/* Topknot bun */}
      <ellipse cx="50" cy="18" rx="9" ry="8" />
      {/* Hair knot cinch */}
      <rect x="46" y="24" width="8" height="3" rx="1.5" />
      {/* Head & Hair */}
      <path d="M50 26 C36 26 31 36 31 48 C31 60 41 71 50 74 C59 71 69 60 69 48 C69 36 64 26 50 26 Z" />
      {/* Slender neck & sweeping shoulders */}
      <path d="M44 72 L44 82 C32 86 18 92 12 102 C10 105 10 110 10 114 L90 114 C90 110 90 105 88 102 C82 92 68 86 56 82 L56 72 Z" />
    </svg>
  );
}

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

  // Shared Wuxia Preset UI Store
  const selectedIndex = usePresetUiStore((s) => s.selectedIndex);
  const slots = usePresetUiStore((s) => s.slots);
  const isRenaming = usePresetUiStore((s) => s.isRenaming);
  const renameValue = usePresetUiStore((s) => s.renameValue);
  const statusMessage = usePresetUiStore((s) => s.statusMessage);
  const selectSlot = usePresetUiStore((s) => s.selectSlot);
  const setRenameValue = usePresetUiStore((s) => s.setRenameValue);
  const confirmRename = usePresetUiStore((s) => s.confirmRename);
  const cancelRename = usePresetUiStore((s) => s.cancelRename);
  const applySelectedSlot = usePresetUiStore((s) => s.applySelectedSlot);

  // Body preset state
  const activeBodyPresetId = useBodySlideStore((s) => s.activePresetId);
  const [status, setStatus] = useState<Status>(null);
  const [showAdvancedLibrary, setShowAdvancedLibrary] = useState(false);

  const flash = (s: Status) => {
    setStatus(s);
    window.setTimeout(() => setStatus(null), 3500);
  };

  const handleSelectSlot = (slot: PresetSlot, index: number) => {
    selectSlot(index);
    if (selectedIndex === index && !slot.isEmpty) {
      applySelectedSlot();
    }
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
      <div className="flex flex-col w-[275px] md:w-[285px] max-h-[calc(100vh-160px)] overflow-y-auto scrollbar-none pr-1">
        <div className="flex flex-col gap-2.5">
          {/* Top Header: PRESETS */}
          <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6]">
              PRESETS
            </span>
            <span className="font-mono text-[10px] text-[#a49a88]">
              {activeTab === 'face' ? `${slots.length} SLOTS` : `${BODY_PRESET_CARDS.length} CANONICAL`}
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
              {/* ── SINGLE-COLUMN VERTICAL STACK OF WIDE BANNER CARDS (~260px wide, ~64px tall, ~4:1 ratio) ── */}
              <div className="flex flex-col gap-2 w-full max-w-[260px]" role="listbox" aria-label="Face Presets">
                {slots.map((slot, index) => {
                  const isSelected = selectedIndex === index;
                  const isPopulated = !slot.isEmpty && Boolean(slot.thumb);

                  return (
                    <div
                      key={slot.id}
                      className="relative w-full"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectSlot(slot, index)}
                        aria-label={`Select ${slot.label}`}
                        aria-selected={isSelected}
                        className={cn(
                          'group relative flex h-[64px] w-full items-center overflow-hidden rounded-[2px] transition-all duration-150 text-left',
                          // Active selection: crisp solid 2px white border matching Image 2
                          isSelected
                            ? 'border-2 border-white shadow-[0_0_10px_rgba(255,255,255,0.25)] z-10'
                            : 'border border-[#23252d] bg-[#15161b] hover:border-white/70',
                        )}
                      >
                        {isPopulated ? (
                          /* Populated preset cards (1..5): Wide banner thumbnails with bottom-left overlay */
                          <>
                            <img
                              src={slot.thumb!}
                              alt={slot.label}
                              className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-200 group-hover:scale-105"
                            />
                            {/* Dark gradient overlay for typography readability */}
                            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                          </>
                        ) : (
                          /* Empty/unassigned slots (6..8): Dark slate background (#15161b) + centered white bust silhouette SVG */
                          <div className="absolute inset-0 flex items-center justify-center bg-[#15161b]">
                            <IconWuxiaBustSilhouette className="h-[42px] w-auto text-white opacity-95 transition-transform duration-150 group-hover:scale-105" />
                          </div>
                        )}

                        {/* Bottom-left overlay label ('Face Preset N') matching Image 2 */}
                        <span
                          className={cn(
                            'absolute bottom-2 left-2.5 text-[12px] font-sans font-medium text-white tracking-wide truncate max-w-[220px]',
                            isPopulated && 'drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]',
                          )}
                        >
                          {slot.label}
                        </span>
                      </button>

                      {/* Inline Rename Form on Active Card */}
                      {isSelected && isRenaming && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            confirmRename();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute inset-x-1 bottom-1 z-20 flex items-center gap-1 rounded-[2px] border border-white/40 bg-[#16171d]/95 p-1 shadow-lg backdrop-blur-md"
                        >
                          <input
                            type="text"
                            value={renameValue}
                            autoFocus
                            maxLength={32}
                            aria-label="Preset name"
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.stopPropagation();
                                cancelRename();
                              }
                            }}
                            className="min-w-0 flex-1 rounded-[1px] border border-white/20 bg-black/60 px-1.5 py-0.5 text-[11px] text-white outline-none focus:border-[#dfba73]"
                          />
                          <button
                            type="submit"
                            className="rounded-[2px] bg-[#dfba73] px-2 py-0.5 text-[10px] font-semibold text-black hover:bg-[#eac87f]"
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelRename()}
                            className="rounded-[2px] px-1 py-0.5 text-[11px] text-[#a49a88] hover:text-white"
                          >
                            ✕
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Collapsible Storage & Library */}
              <div className="mt-1 border-t border-[#d4b483]/14 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedLibrary(!showAdvancedLibrary)}
                  className="flex items-center justify-between w-full text-[10px] font-mono tracking-wider text-[#a49a88] hover:text-[#d4b483] py-1 transition-colors"
                >
                  <span>STORAGE & EXPORT OPTIONS</span>
                  <span>{showAdvancedLibrary ? '▲' : '▼'}</span>
                </button>
                {showAdvancedLibrary && (
                  <div className="mt-1.5">
                    <PresetLibrary />
                  </div>
                )}
              </div>
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

          {/* Toast / Status messages */}
          {(status || statusMessage) && (
            <div
              role="status"
              className={cn(
                'mt-1 text-center font-mono text-[10px] tracking-wide',
                status?.kind === 'error'
                  ? 'text-[#e0967c]'
                  : status?.kind === 'warn'
                    ? 'text-[#e0c48d]'
                    : 'text-[#a9c9b6]',
              )}
            >
              {status?.text ?? statusMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
