'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import {
  EQUIP_SLOTS,
  EQUIP_SLOT_LABEL,
  equipSlotOf,
  type EquipSlot,
} from '@/lib/equipment';
import { assetOptions } from '@/lib/manifestSelect';
import { matchesQuery } from '@/lib/mo2/client';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { IconCheck, IconHanger, IconSparkle } from '@/components/hud/Icons';
import type { CatalogueEntry } from '@/lib/mo2/types';

interface ClothingItem {
  id: string;
  label?: string;
  file: string;
  rel?: string;
  mod?: string;
  equipSlot?: string;
  pairedTextureId?: string;
  available?: boolean;
  weightVariants?: { w0: string; w1: string };
  weightKey?: string;
  weightDefault?: number;
}

function cleanGarmentName(name: string): string {
  return name
    .replace(/\.nif$/i, '')
    .replace(/_[01]$/, '')
    .replace(/^\[UBE 2\.0\]\s*/i, '')
    .replace(/^FB_/i, '')
    .replace(/_/g, ' ')
    .trim();
}

function SlotIcon({ slot, className }: { slot: EquipSlot; className?: string }) {
  const cls = cn('h-4 w-4 fill-none stroke-current stroke-[1.2]', className);
  switch (slot) {
    case 'outfit':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M8 3 L12 6 L16 3 L19 7 L16 9 L17 21 L7 21 L8 9 L5 7 Z" />
        </svg>
      );
    case 'top':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M8 4 L12 6 L16 4 L20 8 L17 11 L16 19 L8 19 L7 11 L4 8 Z" />
        </svg>
      );
    case 'bottom':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M7 4 L17 4 L18 13 L14 13 L12 8 L10 13 L6 13 Z" />
          <path d="M7 4 L6 20 L10.5 20 L12 11 L13.5 20 L18 20 L17 4" />
        </svg>
      );
    case 'bra':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <circle cx="8" cy="13" r="3.5" />
          <circle cx="16" cy="13" r="3.5" />
          <path d="M11.5 13 L12.5 13 M4.5 12 L2 10 M19.5 12 L22 10 M8 9.5 L8 5 M16 9.5 L16 5" />
        </svg>
      );
    case 'panties':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M5 8 L19 8 L17 17 C15 19, 13 19, 12 19 C11 19, 9 19, 7 17 Z" />
          <path d="M7 8 C8 12, 10 15, 12 15 C14 15, 16 12, 17 8" strokeDasharray="1.5 1.5" />
        </svg>
      );
    case 'stockings':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M8 4 L11 4 L10 18 L12 20 L9 20 L7 16 Z" />
          <path d="M16 4 L13 4 L14 18 L12 20 L15 20 L17 16 Z" />
          <line x1="8" y1="7" x2="11" y2="7" />
          <line x1="16" y1="7" x2="13" y2="7" />
        </svg>
      );
    case 'hands':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M7 19 L7 12 C7 10, 8 10, 9 10 L9 7 C9 6, 10 6, 11 6 L11 5 C11 4, 12 4, 13 5 L13 10 C14 10, 15 11, 15 12 L17 14 C17 17, 16 19, 14 19 Z" />
        </svg>
      );
    case 'feet':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M8 4 L13 4 L12 14 L17 16 L17 20 L7 20 L7 14 Z" />
        </svg>
      );
    case 'accessories':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M6 7 C5 4, 8 3, 10 6 C9 8, 8 10, 8 12" />
          <path d="M18 7 C19 4, 16 3, 14 6 C15 8, 16 10, 16 12" />
          <circle cx="12" cy="15" r="4.5" />
        </svg>
      );
  }
}

export function WardrobeDrawer({ manifest }: { manifest: Mo2Manifest | null }) {
  const equipment = useCharacter((s) => s.equipment);
  const equipSlot = useCharacter((s) => s.equipSlot);
  const setEquipSlot = useCharacter((s) => s.setEquipSlot);
  const setEquip = useCharacter((s) => s.setEquip);
  const setAssets = useCharacter((s) => s.setAssets);
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const unrestrictedSlots = useCharacter((s) => s.unrestrictedSlots);
  const toggleUnrestrictedSlots = useCharacter((s) => s.toggleUnrestrictedSlots);
  const showGroundMeshes = useCharacter((s) => s.showGroundMeshes);

  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const currentSlot: EquipSlot = equipSlot ?? 'top';

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentSlot]);

  const curated = useMemo(
    () => assetOptions(manifest, 'clothingMesh') as ClothingItem[],
    [manifest],
  );

  const archive = useMemo(
    () => (catalogues.clothingMesh ?? []) as ClothingItem[],
    [catalogues.clothingMesh],
  );

  const allClothing = useMemo(() => {
    const seen = new Set<string>();
    const seenWeightKeys = new Set<string>();
    const list: ClothingItem[] = [];

    const add = (item: ClothingItem) => {
      if (!showGroundMeshes && /_gnd\.nif$/i.test(item.file)) {
        return;
      }
      if (item.weightVariants && item.weightVariants.w0 === item.id && item.weightVariants.w1 !== item.id) {
        return;
      }
      if (item.weightKey && !item.weightDefault) {
        return;
      }
      if (/_0\.nif$/i.test(item.file) && (item.weightVariants || item.weightKey)) {
        return;
      }

      const pairKey = item.weightVariants?.w1 ?? item.weightKey ?? item.id;
      if (seenWeightKeys.has(pairKey) || seen.has(item.id)) {
        return;
      }
      seenWeightKeys.add(pairKey);
      seen.add(item.id);
      list.push(item);
    };

    for (const c of curated) add(c);
    for (const a of archive) add(a);

    return list;
  }, [curated, archive, showGroundMeshes]);

  const activeWornId = equipment[currentSlot];
  const activeWornItem = allClothing.find((r) => {
    if (r.id === activeWornId) return true;
    if (r.weightVariants && (r.weightVariants.w0 === activeWornId || r.weightVariants.w1 === activeWornId)) return true;
    return false;
  });
  const activeWornName = activeWornItem ? cleanGarmentName(activeWornItem.label || activeWornItem.file) : undefined;

  const slotGarments = useMemo(() => {
    return allClothing.filter((item) => {
      if (!unrestrictedSlots) {
        const itemSlot = equipSlotOf(item);
        if (itemSlot !== currentSlot) {
          return false;
        }
      }
      if (!query.trim()) return true;
      return matchesQuery(item as CatalogueEntry, query);
    });
  }, [allClothing, currentSlot, query, unrestrictedSlots]);

  const isEquipped = (item: ClothingItem) => {
    const worn = equipment[currentSlot];
    if (!worn) return false;
    if (worn === item.id) return true;
    if (item.weightVariants) {
      return worn === item.weightVariants.w0 || worn === item.weightVariants.w1;
    }
    return false;
  };

  const toggleGarment = (item: ClothingItem) => {
    const isWorn = isEquipped(item);
    if (isWorn) {
      setEquip({ [currentSlot]: null });
      if (currentSlot === 'outfit') setAssets({ clothingMesh: null });
    } else {
      const targetId = item.weightVariants?.w1 ?? item.id;
      setEquip({ [currentSlot]: targetId });
      if (currentSlot === 'outfit') setAssets({ clothingMesh: targetId });
    }
  };

  const unequipCurrent = () => {
    setEquip({ [currentSlot]: null });
    if (currentSlot === 'outfit') setAssets({ clothingMesh: null });
  };

  return (
    <div className="pointer-events-auto flex h-full w-full flex-col select-none p-3 font-mono hud-fade">
      {/* ── Slot Quick-Switcher Tabs ───────────────────────────────── */}
      <div className="mb-2.5 flex flex-wrap gap-1 border-b border-[#d4b483]/20 pb-2">
        {EQUIP_SLOTS.map((slot) => {
          const isActive = currentSlot === slot;
          const isFilled = Boolean(equipment[slot]);
          return (
            <button
              key={slot}
              type="button"
              onClick={() => setEquipSlot(slot)}
              className={cn(
                'flex items-center gap-1 rounded-xs border px-2 py-1 text-[9px] font-mono tracking-wider transition-all',
                isActive
                  ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.35)]'
                  : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
              )}
            >
              <SlotIcon slot={slot} className={cn('h-3 w-3', isActive ? 'text-[#f2dfbe]' : 'text-[#d4b483]/60')} />
              <span>{EQUIP_SLOT_LABEL[slot]}</span>
              {isFilled && (
                <span className="inline-block h-1 w-1 rounded-full bg-[#eac87f] shadow-[0_0_4px_rgba(234,200,127,0.9)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Active Slot Header Bar ──────────────────────────────────── */}
      <div className="mb-2 flex items-center justify-between border border-[#d4b483]/22 bg-black/45 p-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-[#eac87f] uppercase text-[10px]">
            [{EQUIP_SLOT_LABEL[currentSlot]}]
          </span>
          <span className="truncate text-[9.5px] text-[#cdc2ac]">
            {activeWornName ? `Worn: ${activeWornName}` : 'Slot is empty'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {activeWornId && (
            <button
              type="button"
              onClick={unequipCurrent}
              className="rounded-xs border border-[#d09e88]/40 bg-[#d09e88]/10 px-1.5 py-0.5 text-[8.5px] font-mono tracking-wider text-[#e0a898] hover:border-[#d09e88]/80 hover:text-[#f0b8a8]"
            >
              UNEQUIP
            </button>
          )}

          <button
            type="button"
            onClick={toggleUnrestrictedSlots}
            title={unrestrictedSlots ? 'Showing all garments. Click to filter by current slot only.' : 'Strict slots. Click to ignore naming and show all items.'}
            className={cn(
              'flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-[8.5px] font-mono tracking-wider transition-all',
              unrestrictedSlots
                ? 'border-[#eac87f] bg-[#d4b483]/25 text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/75 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
            )}
          >
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                unrestrictedSlots ? 'bg-[#eac87f] shadow-[0_0_5px_rgba(234,200,127,0.8)]' : 'bg-[#8f8778]/40',
              )}
            />
            <span>{unrestrictedSlots ? 'ALL ITEMS' : 'SLOT ONLY'}</span>
          </button>
        </div>
      </div>

      {/* ── Search Input ────────────────────────────────────────────── */}
      <div className="relative mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={unrestrictedSlots ? 'Search all clothing & accessories…' : `Search ${EQUIP_SLOT_LABEL[currentSlot].toLowerCase()} pieces…`}
          aria-label="Search garments"
          className="w-full border border-[#d4b483]/26 bg-black/48 px-2.5 py-1.5 text-[9.5px] tracking-[0.06em] text-[#e2d8c6] placeholder-[#8f8778]/55 outline-none transition-colors focus:border-[#d4b483]/60"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[#8f8778] hover:text-[#e2d8c6]"
          >
            ×
          </button>
        )}
      </div>

      {/* ── Spacious Garments Grid ─────────────────────────────────── */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-1 thin-scroll">
        {slotGarments.length === 0 ? (
          <div className="flex h-36 flex-col items-center justify-center border border-[#d4b483]/18 bg-black/30 p-4 text-center text-[10px] leading-relaxed text-[#c5b595]">
            <p>No {unrestrictedSlots ? 'clothing' : EQUIP_SLOT_LABEL[currentSlot].toLowerCase()} items found.</p>
            {!unrestrictedSlots && (
              <button
                type="button"
                onClick={toggleUnrestrictedSlots}
                className="mt-2 inline-flex items-center gap-1 rounded-xs border border-[#eac87f]/50 bg-[#d4b483]/15 px-2.5 py-1 text-[9px] font-mono text-[#eac87f] hover:bg-[#d4b483]/25"
              >
                <span>SWITCH TO [ALL ITEMS] MODE</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 pb-2">
            {slotGarments.map((item, i) => {
              const isWorn = isEquipped(item);
              const label = cleanGarmentName(item.label || item.file);
              const isWeightPaired = Boolean(item.weightVariants);
              const itemSlot = equipSlotOf(item);

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleGarment(item)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (isWorn) toggleGarment(item);
                  }}
                  aria-pressed={isWorn}
                  title={`${label}\nTarget: ${EQUIP_SLOT_LABEL[currentSlot]} (Inferred: ${EQUIP_SLOT_LABEL[itemSlot]})\n${isWeightPaired ? 'Weight Paired (_0 + _1 blended)' : 'Single Weight'}\nFile: ${item.file}`}
                  className={cn(
                    'group relative flex min-w-0 flex-col items-center border p-1 text-left transition-all duration-150',
                    isWorn
                      ? 'border-[#eac87f] bg-[#eac87f]/16 shadow-[0_0_12px_rgba(234,200,127,0.4)] ring-1 ring-[#eac87f]/50'
                      : 'border-[#d4b483]/22 bg-black/40 hover:border-[#d4b483]/60 hover:bg-[#14120e] hover:scale-[1.02]',
                  )}
                >
                  {/* Card Visual Icon */}
                  <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-black/50">
                    <SlotIcon
                      slot={unrestrictedSlots ? itemSlot : currentSlot}
                      className={cn(
                        'h-7 w-7 transition-transform group-hover:scale-110',
                        isWorn ? 'text-[#f2dfbe]' : 'text-[#d4b483]/60',
                      )}
                    />

                    {/* Unrestricted Inferred Slot Tag */}
                    {unrestrictedSlots && (
                      <span className="absolute top-1 right-1 rounded-[1px] border border-[#d4b483]/25 bg-black/80 px-1 py-0.2 text-[7.5px] font-mono text-[#e8c98e] uppercase">
                        {itemSlot.slice(0, 4)}
                      </span>
                    )}

                    {/* Weight pair badge */}
                    {isWeightPaired && (
                      <span className="absolute top-1 left-1 rounded-[1px] bg-[#d4b483]/25 px-1 py-0.2 font-mono text-[7px] text-[#f2dfbe]">
                        W0/W1
                      </span>
                    )}

                    {/* Equipped Checkmark */}
                    {isWorn && (
                      <span
                        className={cn(
                          'absolute flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#eac87f] text-black shadow-[0_0_6px_rgba(234,200,127,0.8)]',
                          unrestrictedSlots ? 'bottom-1 left-1' : 'top-1 right-1',
                        )}
                      >
                        <IconCheck className="h-2 w-2" />
                      </span>
                    )}

                    {/* Numerical Index */}
                    <span className="pointer-events-none absolute bottom-0.5 right-1 font-mono text-[8px] text-[#eadcc0]/45">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>

                  {/* Garment Title */}
                  <span
                    className={cn(
                      'mt-1 w-full truncate text-center text-[9px] tracking-wide transition-colors',
                      isWorn ? 'font-bold text-[#f2dfbe]' : 'text-[#a9a192] group-hover:text-[#e0d7c6]',
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

      {/* ── Footer Bar ─────────────────────────────────────────────── */}
      <div className="mt-2 flex shrink-0 items-center justify-between border-t border-[#d4b483]/18 pt-2 text-[9px] text-[#8b8375]">
        <div className="flex items-center gap-1.5">
          <IconSparkle className="h-2.5 w-2.5 text-[#c9b184]/60" />
          <span>LMB EQUIP · RMB UNEQUIP</span>
        </div>
        <span className="font-mono text-[#c9b184]">{slotGarments.length} OPTIONS</span>
      </div>
    </div>
  );
}
