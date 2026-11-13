'use client';

import { useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import {
  EQUIP_SLOTS,
  EQUIP_SLOT_LABEL,
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

/* ─────────────────────────────────────────────────────────────────────────────
   Slot Icons
   ───────────────────────────────────────────────────────────────────────────── */
function SlotIcon({ slot, className }: { slot: EquipSlot; className?: string }) {
  const cls = cn('h-5 w-5 fill-none stroke-current stroke-[1.2]', className);
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

export function EquipmentPanel({ manifest }: { manifest: Mo2Manifest | null }) {
  const equipment = useCharacter((s) => s.equipment);
  const equipSlot = useCharacter((s) => s.equipSlot);
  const setEquipSlot = useCharacter((s) => s.setEquipSlot);
  const setEquip = useCharacter((s) => s.setEquip);
  const setAssets = useCharacter((s) => s.setAssets);
  const catalogues = useCharacter((s) => s.assetCatalogues);

  const [query, setQuery] = useState('');

  const curated = useMemo(
    () => assetOptions(manifest, 'clothingMesh') as ClothingItem[],
    [manifest],
  );

  const archive = useMemo(
    () => (catalogues.clothingMesh ?? []) as ClothingItem[],
    [catalogues.clothingMesh],
  );

  // Combined options deduped by ID and weight pair
  const allClothing = useMemo(() => {
    const seen = new Set<string>();
    const seenWeightKeys = new Set<string>();
    const list: ClothingItem[] = [];

    const add = (item: ClothingItem) => {
      // If it is the non-default _0 half of a weight pair, drop it!
      // (The _1 half represents the pair in the UI, and both are blended internally)
      if (item.weightVariants && item.weightVariants.w0 === item.id && item.weightVariants.w1 !== item.id) {
        return;
      }
      if (item.weightKey && !item.weightDefault) {
        return;
      }
      if (/_0\.nif$/i.test(item.file) && (item.weightVariants || item.weightKey)) {
        return;
      }

      // Group by canonical w1 pair id or weightKey so only one card exists
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
  }, [curated, archive]);

  const nameFor = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    const found = allClothing.find((r) => {
      if (r.id === id) return true;
      if (r.weightVariants && (r.weightVariants.w0 === id || r.weightVariants.w1 === id)) return true;
      return false;
    });
    if (!found) return undefined;
    return cleanGarmentName(found.label || found.file);
  };

  const outfitId = equipment.outfit ?? useCharacter.getState().assetSelection.clothingMesh;

  const wornCount = EQUIP_SLOTS.filter((slot) => equipment[slot]).length;

  const currentSlot: EquipSlot = equipSlot ?? 'top';

  const selectSlot = (slot: EquipSlot) => {
    setEquipSlot(slot);
  };

  const unequipSlot = (slot: EquipSlot, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setEquip({ [slot]: null });
    if (slot === 'outfit') {
      setAssets({ clothingMesh: null });
    }
  };

  // Garments available for current slot
  const slotGarments = useMemo(() => {
    return allClothing.filter((item) => {
      const itemSlot = item.equipSlot?.toLowerCase();
      if (itemSlot !== currentSlot) {
        if (currentSlot === 'outfit' && (itemSlot === 'full' || !itemSlot)) {
          // match outfit
        } else {
          return false;
        }
      }
      if (!query.trim()) return true;
      return matchesQuery(item as CatalogueEntry, query);
    });
  }, [allClothing, currentSlot, query]);

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
      unequipSlot(currentSlot);
    } else {
      const targetId = item.weightVariants?.w1 ?? item.id;
      setEquip({ [currentSlot]: targetId });
      if (currentSlot === 'outfit') {
        setAssets({ clothingMesh: targetId });
      }
    }
  };

  const activeWornId = equipment[currentSlot];
  const activeWornName = nameFor(activeWornId);

  return (
    <div className="mt-[2px] select-none text-[#e6e1d8]">
      {/* ── Title & Total Counter ──────────────────────────────────── */}
      <div className="mb-[6px] flex items-baseline justify-between px-[2px]">
        <h2 className="text-[11px] font-medium tracking-[0.05em] text-[#efece6]">
          EQUIPPED GEAR
        </h2>
        <span className="num text-[10px] tracking-[0.1em] text-[#8f8778]/80 font-mono">
          {wornCount}/{EQUIP_SLOTS.length} EQUIPPED
        </span>
      </div>

      {/* ── Visual Paper-Doll 3x4 Layout with Silhouette ──────────── */}
      <div className="relative mx-auto my-[2px] w-full max-w-[276px] rounded-xs border border-[#d4b483]/22 bg-black/45 p-[9px] backdrop-blur-md">
        {/* Subtle Anatomical Wireframe SVG */}
        <svg
          viewBox="0 0 260 310"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
          fill="none"
          stroke="#d4b483"
          strokeWidth="0.85"
        >
          {/* Head & Cranium */}
          <ellipse cx="130" cy="24" rx="13" ry="16" />
          <path d="M125 40 L125 48 M135 40 L135 48" />
          {/* Shoulders & Clavicle */}
          <path d="M96 52 L130 48 L164 52" />
          {/* Upper Arms to Forearms */}
          <path d="M96 52 L68 100 L56 160 L48 220" />
          <path d="M164 52 L192 100 L204 160 L212 220" />
          {/* Ribcage Contour */}
          <path d="M100 66 Q130 72 160 66" />
          <path d="M104 84 Q130 90 156 84" />
          <path d="M108 102 Q130 108 152 102" />
          {/* Spine Guide */}
          <line x1="130" y1="48" x2="130" y2="155" strokeDasharray="3 3" />
          {/* Pelvis & Hip Contour */}
          <path d="M110 120 Q130 123 150 120" />
          <path d="M102 140 C102 165 120 175 130 175 C140 175 158 165 158 140" />
          {/* Legs to Feet */}
          <path d="M116 175 L110 225 L108 265 L106 300" />
          <path d="M144 175 L150 225 L152 265 L154 300" />
        </svg>

        {/* 3-Column Slot Cards Grid */}
        <div className="relative z-10 grid grid-cols-3 gap-x-[10px] gap-y-[7px]">
          {/* ── Row 1: OUTFIT in center col ──────────────────────────── */}
          <div className="col-start-2">
            <SlotCard
              slot="outfit"
              isActive={currentSlot === 'outfit'}
              equippedId={equipment.outfit}
              itemName={nameFor(equipment.outfit)}
              onSelect={() => selectSlot('outfit')}
              onUnequip={(e) => unequipSlot('outfit', e)}
            />
          </div>

          {/* ── Row 2: TOP | BOTTOM | BRA ────────────────────────────── */}
          <SlotCard
            slot="top"
            isActive={currentSlot === 'top'}
            equippedId={equipment.top}
            itemName={nameFor(equipment.top)}
            onSelect={() => selectSlot('top')}
            onUnequip={(e) => unequipSlot('top', e)}
          />
          <SlotCard
            slot="bottom"
            isActive={currentSlot === 'bottom'}
            equippedId={equipment.bottom}
            itemName={nameFor(equipment.bottom)}
            onSelect={() => selectSlot('bottom')}
            onUnequip={(e) => unequipSlot('bottom', e)}
          />
          <SlotCard
            slot="bra"
            isActive={currentSlot === 'bra'}
            equippedId={equipment.bra}
            itemName={nameFor(equipment.bra)}
            onSelect={() => selectSlot('bra')}
            onUnequip={(e) => unequipSlot('bra', e)}
          />

          {/* ── Row 3: PANTIES | (gap) | STOCKINGS ────────────────────── */}
          <SlotCard
            slot="panties"
            isActive={currentSlot === 'panties'}
            equippedId={equipment.panties}
            itemName={nameFor(equipment.panties)}
            onSelect={() => selectSlot('panties')}
            onUnequip={(e) => unequipSlot('panties', e)}
          />
          <div className="pointer-events-none flex items-center justify-center opacity-40">
            {/* Center silhouette pass-through */}
          </div>
          <SlotCard
            slot="stockings"
            isActive={currentSlot === 'stockings'}
            equippedId={equipment.stockings}
            itemName={nameFor(equipment.stockings)}
            onSelect={() => selectSlot('stockings')}
            onUnequip={(e) => unequipSlot('stockings', e)}
          />

          {/* ── Row 4: HANDS | FEET | ACCESSORIES ─────────────────────── */}
          <SlotCard
            slot="hands"
            isActive={currentSlot === 'hands'}
            equippedId={equipment.hands}
            itemName={nameFor(equipment.hands)}
            onSelect={() => selectSlot('hands')}
            onUnequip={(e) => unequipSlot('hands', e)}
          />
          <SlotCard
            slot="feet"
            isActive={currentSlot === 'feet'}
            equippedId={equipment.feet}
            itemName={nameFor(equipment.feet)}
            onSelect={() => selectSlot('feet')}
            onUnequip={(e) => unequipSlot('feet', e)}
          />
          <SlotCard
            slot="accessories"
            isActive={currentSlot === 'accessories'}
            equippedId={equipment.accessories}
            itemName={nameFor(equipment.accessories)}
            onSelect={() => selectSlot('accessories')}
            onUnequip={(e) => unequipSlot('accessories', e)}
          />
        </div>
      </div>

      {/* ── Active Slot Header Bar ──────────────────────────────────── */}
      <div className="my-[7px] flex items-center justify-between border-y border-[#d4b483]/18 bg-black/35 px-[7px] py-[4px]">
        <div className="flex items-center gap-[6px] text-[10px]">
          <span className="font-mono text-[#d4b483] tracking-widest font-semibold uppercase">
            {EQUIP_SLOT_LABEL[currentSlot]}
          </span>
          <span className="text-[#8f8778]/60">·</span>
          <span className="text-[#e2d8c6] truncate max-w-[130px] font-medium">
            {activeWornName ?? 'None equipped'}
          </span>
        </div>
        {activeWornId && (
          <button
            type="button"
            onClick={(e) => unequipSlot(currentSlot, e)}
            className="text-[9px] font-mono tracking-wider text-[#d09e88] hover:text-[#f0a898] transition-colors"
          >
            UNEQUIP
          </button>
        )}
      </div>

      {/* ── Search Input ────────────────────────────────────────────── */}
      <div className="relative mb-[6px]">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${EQUIP_SLOT_LABEL[currentSlot].toLowerCase()} pieces…`}
          aria-label="Search garments"
          className="w-full border border-[#d4b483]/26 bg-black/48 px-[7px] py-[3.5px] text-[9.5px] tracking-[0.06em] text-[#e2d8c6] placeholder-[#8f8778]/55 outline-none transition-colors focus:border-[#d4b483]/60"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-[6px] top-1/2 -translate-y-1/2 text-[10px] text-[#8f8778] hover:text-[#e2d8c6]"
          >
            ×
          </button>
        )}
      </div>

      {/* ── Garment Options Grid ────────────────────────────────────── */}
      <div className="thin-scroll grid max-h-[170px] grid-cols-2 gap-[6px] overflow-y-auto pr-[2px]">
        {slotGarments.length === 0 ? (
          <div className="col-span-2 border border-[#d4b483]/18 bg-black/30 px-[10px] py-[14px] text-center text-[10px] leading-relaxed text-[#c5b595]">
            <p>No {EQUIP_SLOT_LABEL[currentSlot].toLowerCase()} items available.</p>
            <p className="mt-[2px] text-[8.5px] text-[#8f8778]/60">
              Drop NIFs into <span className="font-mono text-[#d4b483]/80">clothing/{currentSlot}/meshes</span>
            </p>
          </div>
        ) : (
          slotGarments.map((item, i) => {
            const isWorn = isEquipped(item);
            const label = cleanGarmentName(item.label || item.file);
            const isWeightPaired = Boolean(item.weightVariants);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleGarment(item)}
                aria-pressed={isWorn}
                title={`${label}\nSlot: ${EQUIP_SLOT_LABEL[currentSlot]}\n${isWeightPaired ? 'Weight Paired (_0 + _1 blended)' : 'Single Weight'}\nFile: ${item.file}`}
                className={cn(
                  'group relative flex min-w-0 flex-col items-center border p-[4px] text-left transition-all duration-150',
                  isWorn
                    ? 'border-[#eac87f] bg-[#eac87f]/16 shadow-[0_0_10px_rgba(234,200,127,0.35)]'
                    : 'border-[#d4b483]/22 bg-black/35 hover:border-[#d4b483]/55 hover:bg-[#14120e]',
                )}
              >
                {/* 4:5 Card Visual */}
                <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-black/40">
                  <SlotIcon slot={currentSlot} className={cn('h-6 w-6 transition-transform group-hover:scale-110', isWorn ? 'text-[#f2dfbe]' : 'text-[#d4b483]/60')} />

                  {/* Weight pair badge */}
                  {isWeightPaired && (
                    <span className="absolute top-[2px] left-[2px] rounded-[1px] bg-[#d4b483]/25 px-[3px] py-[0.5px] font-mono text-[7px] tracking-tight text-[#f2dfbe]">
                      W0/W1
                    </span>
                  )}

                  {/* Equipped Check */}
                  {isWorn && (
                    <span className="absolute top-[2px] right-[2px] flex h-[12px] w-[12px] items-center justify-center rounded-full bg-[#eac87f] text-black">
                      <IconCheck className="h-2 w-2" />
                    </span>
                  )}

                  {/* Monospace index */}
                  <span className="pointer-events-none absolute bottom-[1px] right-[2px] font-mono text-[8.5px] tracking-tight text-[#eadcc0]/50">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>

                {/* Label */}
                <span
                  className={cn(
                    'mt-[3px] w-full truncate text-center text-[9.5px] tracking-[0.03em] transition-colors',
                    isWorn ? 'font-medium text-[#f0e2ca]' : 'text-[#a9a192]/80 group-hover:text-[#d5ccbb]',
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* ── Status Footer with Hotkey Hint ──────────────────────────── */}
      <div className="mt-[6px] flex items-center justify-between border-t border-[#d4b483]/14 pt-[4px] text-[9px] tracking-[0.08em] text-[#8b8375]/60">
        <div className="flex items-center gap-[4px]">
          <IconSparkle className="h-[6px] w-[6px] text-[#c9b184]/50" />
          <span>LMB EQUIP · RMB UNEQUIP</span>
        </div>
        <span className="font-mono text-[#c9b184]/70">{slotGarments.length} OPTIONS</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Individual Slot Box Card
   ───────────────────────────────────────────────────────────────────────────── */
interface SlotCardProps {
  slot: EquipSlot;
  isActive: boolean;
  equippedId?: string;
  itemName?: string;
  onSelect: () => void;
  onUnequip: (e: React.MouseEvent) => void;
}

function SlotCard({
  slot,
  isActive,
  equippedId,
  itemName,
  onSelect,
  onUnequip,
}: SlotCardProps) {
  const isFilled = Boolean(equippedId);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onContextMenu={(e) => {
        if (isFilled) onUnequip(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
      title={`${EQUIP_SLOT_LABEL[slot]}: ${itemName ?? 'None'}\nLeft-click to select, Right-click to unequip`}
      className="group flex cursor-pointer flex-col items-center"
    >
      {/* Slot Label Above */}
      <span
        className={cn(
          'text-[8.5px] font-mono tracking-[0.1em] text-center uppercase transition-colors mb-[2px]',
          isActive
            ? 'font-bold text-[#f2dfbe] drop-shadow-[0_0_5px_rgba(234,200,127,0.7)]'
            : isFilled
              ? 'text-[#d4b483]/90'
              : 'text-[#8f8778]/70 group-hover:text-[#c4b9a3]',
        )}
      >
        {EQUIP_SLOT_LABEL[slot]}
      </span>

      {/* Square Slot Box Card */}
      <div
        className={cn(
          'relative flex aspect-square w-full max-w-[66px] items-center justify-center rounded-xs transition-all duration-150',
          isActive
            ? 'border-2 border-[#eac87f] bg-[#eac87f]/18 shadow-[0_0_12px_rgba(234,200,127,0.4)] ring-1 ring-[#eac87f]/60'
            : isFilled
              ? 'border border-[#d4b483]/60 bg-[#14120e]/85 shadow-[0_0_6px_rgba(0,0,0,0.6)] group-hover:border-[#d4b483]/90'
              : 'border border-[#d4b483]/24 bg-black/40 group-hover:border-[#d4b483]/50 group-hover:bg-black/60',
        )}
      >
        {/* Active Corner Accent Glow */}
        {isActive && (
          <span className="pointer-events-none absolute -top-[1.5px] -left-[1.5px] h-[3.5px] w-[3.5px] rounded-full bg-[#f2dfbe] shadow-[0_0_5px_#f2dfbe]" />
        )}

        {/* Slot Icon inside Box */}
        <SlotIcon
          slot={slot}
          className={cn(
            'transition-all duration-150',
            isActive
              ? 'h-6 w-6 text-[#f2dfbe] drop-shadow-[0_0_6px_rgba(242,223,190,0.6)] scale-105'
              : isFilled
                ? 'h-5 w-5 text-[#e0cfab]'
                : 'h-4 w-4 text-[#8f8778]/40 group-hover:text-[#d4b483]/60',
          )}
        />

        {/* Quick Unequip "×" button on hover when equipped */}
        {isFilled && (
          <button
            type="button"
            onClick={onUnequip}
            title={`Unequip ${EQUIP_SLOT_LABEL[slot]}`}
            className="absolute -top-[5px] -right-[5px] flex h-[14px] w-[14px] items-center justify-center rounded-full border border-[#d4b483]/40 bg-black/90 text-[10px] leading-none text-[#a89e8c] opacity-0 transition-opacity hover:border-[#e0a898] hover:text-[#e0a898] group-hover:opacity-100"
          >
            ×
          </button>
        )}
      </div>

      {/* Item Name in Brackets Below */}
      <span
        className={cn(
          'mt-[2px] max-w-[70px] truncate text-center text-[8.5px] font-mono tracking-tight transition-colors',
          isFilled
            ? 'font-medium text-[#e8ddc8]'
            : 'text-[#8f8778]/50 group-hover:text-[#8f8778]/80',
        )}
      >
        [{itemName ?? 'None'}]
      </span>
    </div>
  );
}
