'use client';

import { useMemo } from 'react';
import { useCharacter } from '@/lib/store';
import {
  EQUIP_SLOTS,
  EQUIP_SLOT_LABEL,
  type EquipSlot,
} from '@/lib/equipment';
import { assetOptions } from '@/lib/manifestSelect';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { IconHanger, IconSparkle } from '@/components/hud/Icons';

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
  const unrestrictedSlots = useCharacter((s) => s.unrestrictedSlots);
  const toggleUnrestrictedSlots = useCharacter((s) => s.toggleUnrestrictedSlots);
  const showGroundMeshes = useCharacter((s) => s.showGroundMeshes);
  const workspace = useCharacter((s) => s.workspace);
  const setWorkspace = useCharacter((s) => s.setWorkspace);

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
      // Skip static ground meshes unless explicitly enabled in settings
      if (!showGroundMeshes && /_gnd\.nif$/i.test(item.file)) {
        return;
      }
      // If it is the non-default _0 half of a weight pair, drop it!
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

  const wornCount = EQUIP_SLOTS.filter((slot) => equipment[slot]).length;
  const currentSlot: EquipSlot = equipSlot ?? 'top';

  const selectSlot = (slot: EquipSlot) => {
    setEquipSlot(slot);
    setWorkspace('wardrobe');
  };

  const unequipSlot = (slot: EquipSlot, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setEquip({ [slot]: null });
    if (slot === 'outfit') {
      setAssets({ clothingMesh: null });
    }
  };

  const clearAllGear = () => {
    setEquip({
      outfit: null,
      top: null,
      bottom: null,
      bra: null,
      panties: null,
      stockings: null,
      hands: null,
      feet: null,
      accessories: null,
    });
    setAssets({ clothingMesh: null });
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
      <div className="relative mx-auto my-[1px] w-full max-w-[272px] rounded-xs border border-[#d4b483]/22 bg-black/45 p-[6px] backdrop-blur-md">
        {/* Subtle Anatomical Wireframe SVG */}
        <svg
          viewBox="0 0 260 255"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
          fill="none"
          stroke="#d4b483"
          strokeWidth="0.85"
        >
          {/* Head & Cranium */}
          <ellipse cx="130" cy="22" rx="12" ry="14" />
          <path d="M125 36 L125 43 M135 36 L135 43" />
          {/* Shoulders & Clavicle */}
          <path d="M96 46 L130 43 L164 46" />
          {/* Upper Arms to Forearms */}
          <path d="M96 46 L70 85 L58 135 L50 185" />
          <path d="M164 46 L190 85 L202 135 L210 185" />
          {/* Ribcage Contour */}
          <path d="M100 58 Q130 63 160 58" />
          <path d="M104 74 Q130 79 156 74" />
          <path d="M108 90 Q130 95 152 90" />
          {/* Spine Guide */}
          <line x1="130" y1="43" x2="130" y2="130" strokeDasharray="3 3" />
          {/* Pelvis & Hip Contour */}
          <path d="M110 105 Q130 108 150 105" />
          <path d="M102 120 C102 140 120 148 130 148 C140 148 158 140 158 120" />
          {/* Legs to Feet */}
          <path d="M116 148 L111 190 L109 222 L107 250" />
          <path d="M144 148 L149 190 L151 222 L153 250" />
        </svg>

        {/* 3-Column Slot Cards Grid */}
        <div className="relative z-10 grid grid-cols-3 gap-x-[8px] gap-y-[4px]">
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

      {/* ── Active Slot Status & Wardrobe Drawer Launcher Card ──────── */}
      <div className="my-[6px] rounded-xs border border-[#d4b483]/22 bg-black/45 p-[7px]">
        {/* Header row: slot name + equipped item name */}
        <div className="flex items-center justify-between border-b border-[#d4b483]/16 pb-[5px]">
          <div className="flex items-center gap-[5px]">
            <SlotIcon slot={currentSlot} className="h-3.5 w-3.5 text-[#eac87f]" />
            <span className="font-mono text-[10px] font-bold tracking-wider text-[#eac87f] uppercase">
              {EQUIP_SLOT_LABEL[currentSlot]}
            </span>
          </div>
          <span className="max-w-[130px] truncate text-[9px] font-medium text-[#e2d8c6]">
            {activeWornName ?? 'Empty'}
          </span>
        </div>

        {/* Primary Action Button: Open/Toggle Wardrobe Browser */}
        <button
          type="button"
          onClick={() => setWorkspace(workspace === 'wardrobe' ? 'edit' : 'wardrobe')}
          className={cn(
            'mt-[6px] flex w-full items-center justify-center gap-[5px] border py-[5px] text-[9.5px] font-mono tracking-widest transition-all duration-150',
            workspace === 'wardrobe'
              ? 'border-[#eac87f] bg-[#d4b483]/25 text-[#f2dfbe] shadow-[0_0_10px_rgba(234,200,127,0.3)]'
              : 'border-[#d4b483]/35 bg-[#d4b483]/12 text-[#e8c98e] hover:border-[#eac87f] hover:bg-[#d4b483]/22 hover:text-[#fff0d4]'
          )}
        >
          <IconHanger className="h-3 w-3" />
          <span>{workspace === 'wardrobe' ? 'CLOSE WARDROBE [ESC]' : 'BROWSE WARDROBE →'}</span>
        </button>

        {/* Action utility row: Unequip, Clear All, Unrestricted Toggle */}
        <div className="mt-[5px] flex items-center justify-between gap-1 text-[8.5px]">
          <div className="flex items-center gap-1.5">
            {activeWornId && (
              <button
                type="button"
                onClick={(e) => unequipSlot(currentSlot, e)}
                className="rounded-xs border border-[#d09e88]/40 bg-[#d09e88]/10 px-1.5 py-[1.5px] font-mono tracking-wider text-[#e0a898] hover:border-[#d09e88]/80 hover:text-[#f0b8a8]"
              >
                UNEQUIP
              </button>
            )}

            {wornCount > 0 && (
              <button
                type="button"
                onClick={clearAllGear}
                title="Unequip all worn garments and accessories"
                className="rounded-xs border border-[#8f8778]/30 bg-black/40 px-1.5 py-[1.5px] font-mono tracking-wider text-[#8f8778] hover:border-[#d09e88]/50 hover:text-[#e0a898]"
              >
                CLEAR ALL
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={toggleUnrestrictedSlots}
            title={unrestrictedSlots ? 'Unrestricted Slots: Showing all items. Click to filter by current slot only.' : 'Strict Slots: Showing items matching this slot. Click to ignore naming and equip anything.'}
            className={cn(
              'flex items-center gap-1 rounded-xs border px-1.5 py-[1.5px] font-mono tracking-wider transition-all',
              unrestrictedSlots
                ? 'border-[#eac87f] bg-[#d4b483]/22 text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/75 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]'
            )}
          >
            <span className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              unrestrictedSlots ? 'bg-[#eac87f] shadow-[0_0_5px_rgba(234,200,127,0.8)]' : 'bg-[#8f8778]/40'
            )} />
            <span>{unrestrictedSlots ? 'ALL ITEMS' : 'SLOT ONLY'}</span>
          </button>
        </div>
      </div>

      {/* ── Status Footer with Hotkey Hint ──────────────────────────── */}
      <div className="mt-[4px] flex items-center justify-between border-t border-[#d4b483]/14 pt-[3px] text-[8.5px] tracking-[0.08em] text-[#8b8375]/70">
        <div className="flex items-center gap-[4px]">
          <IconSparkle className="h-[6px] w-[6px] text-[#c9b184]/50" />
          <span>CLICK TO BROWSE · RMB UNEQUIP</span>
        </div>
        <span className="font-mono text-[#c9b184]/80">{allClothing.length} TOTAL ITEMS</span>
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
      title={`${EQUIP_SLOT_LABEL[slot]}: ${itemName ?? 'None'}\nClick to browse garments in Wardrobe Drawer\nRight-click to unequip`}
      className="group flex cursor-pointer flex-col items-center"
    >
      {/* Slot Label Above */}
      <span
        className={cn(
          'text-[8px] font-mono tracking-wider text-center uppercase transition-colors mb-[1px]',
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
          'relative flex aspect-square w-full max-w-[54px] items-center justify-center rounded-xs transition-all duration-150',
          isActive
            ? 'border-2 border-[#eac87f] bg-[#eac87f]/20 shadow-[0_0_10px_rgba(234,200,127,0.4)] ring-1 ring-[#eac87f]/70'
            : isFilled
              ? 'border border-[#d4b483]/60 bg-[#16130e]/90 shadow-[0_0_6px_rgba(0,0,0,0.6)] group-hover:border-[#eac87f]/80'
              : 'border border-[#d4b483]/24 bg-black/40 group-hover:border-[#d4b483]/50 group-hover:bg-black/60',
        )}
      >
        {/* Active Corner Accent Glow */}
        {isActive && (
          <span className="pointer-events-none absolute -top-[1.5px] -left-[1.5px] h-[3px] w-[3px] rounded-full bg-[#f2dfbe] shadow-[0_0_5px_#f2dfbe]" />
        )}

        {/* Filled amber indicator dot */}
        {isFilled && !isActive && (
          <span className="pointer-events-none absolute top-1 left-1 h-1 w-1 rounded-full bg-[#eac87f] shadow-[0_0_3px_rgba(234,200,127,0.8)]" />
        )}

        {/* Slot Icon inside Box */}
        <SlotIcon
          slot={slot}
          className={cn(
            'transition-all duration-150',
            isActive
              ? 'h-5 w-5 text-[#f2dfbe] drop-shadow-[0_0_6px_rgba(242,223,190,0.6)] scale-105'
              : isFilled
                ? 'h-4 w-4 text-[#e0cfab]'
                : 'h-3.5 w-3.5 text-[#8f8778]/40 group-hover:text-[#d4b483]/60',
          )}
        />

        {/* Quick Unequip "×" button on hover when equipped */}
        {isFilled && (
          <button
            type="button"
            onClick={onUnequip}
            title={`Unequip ${EQUIP_SLOT_LABEL[slot]}`}
            className="absolute -top-[4px] -right-[4px] flex h-[13px] w-[13px] items-center justify-center rounded-full border border-[#d4b483]/40 bg-black/90 text-[9px] leading-none text-[#a89e8c] opacity-0 transition-opacity hover:border-[#e0a898] hover:text-[#e0a898] group-hover:opacity-100"
          >
            ×
          </button>
        )}
      </div>

      {/* Item Name in Brackets Below */}
      <span
        className={cn(
          'mt-[1px] max-w-[62px] truncate text-center text-[7.5px] font-mono tracking-tight transition-colors',
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
