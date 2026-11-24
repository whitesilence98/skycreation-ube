'use client';

import { useMemo, type MouseEvent } from 'react';
import { useCharacter } from '@/lib/store';
import { EQUIP_SLOTS, EQUIP_SLOT_LABEL, type EquipSlot } from '@/lib/equipment';
import { assetOptions } from '@/lib/manifestSelect';
import { convertUrl } from '@/lib/mo2/client';
import { navigateCategory } from '@/lib/editorNav';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { GarmentThumbnail } from '@/components/hud/GarmentThumbnail';
import {
  IconWuxiaRobe,
  IconWuxiaHat,
  IconWuxiaScarf,
  IconWuxiaMask,
  IconWuxiaShoulder,
  IconWuxiaEarring,
  IconWuxiaTalisman,
  IconWuxiaRing,
  IconWuxiaSword,
  IconWuxiaFan,
  IconYinYang,
} from '@/components/hud/outfit/WuxiaSlotIcons';

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
  meshUrl?: string;
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

interface GridSlotDef {
  id: string;
  equipSlot?: EquipSlot;
  label: string;
  iconType: 'head' | 'robe' | 'hat' | 'scarf' | 'mask' | 'shoulder' | 'earring' | 'talisman' | 'ring';
  isNew?: boolean;
}

const GRID_SLOTS: GridSlotDef[] = [
  // Row 1
  { id: 'head', label: 'Face / Head', iconType: 'head' },
  { id: 'top', equipSlot: 'top', label: 'Upper Robe', iconType: 'robe' },
  { id: 'hat', equipSlot: 'accessories', label: 'Headwear', iconType: 'hat' },
  { id: 'scarf', equipSlot: 'bra', label: 'Neckwear', iconType: 'scarf' },

  // Row 2
  { id: 'mask', equipSlot: 'panties', label: 'Mask', iconType: 'mask' },
  { id: 'shoulder', equipSlot: 'bottom', label: 'Shoulders', iconType: 'shoulder', isNew: true },
  { id: 'earring', equipSlot: 'hands', label: 'Earrings', iconType: 'earring', isNew: true },
  { id: 'talisman', equipSlot: 'stockings', label: 'Talisman', iconType: 'talisman' },

  // Row 3
  { id: 'ring1', equipSlot: 'feet', label: 'Footwear / Ring', iconType: 'ring' },
  { id: 'ring2', label: 'Accessory I', iconType: 'ring' },
  { id: 'ring3', label: 'Accessory II', iconType: 'ring' },
  { id: 'ring4', label: 'Accessory III', iconType: 'ring' },
];

export function EquipmentPanel({ manifest }: { manifest: Mo2Manifest | null }) {
  const equipment = useCharacter(s => s.equipment);
  const equipSlot = useCharacter(s => s.equipSlot);
  const catalogues = useCharacter(s => s.assetCatalogues);
  const showGroundMeshes = useCharacter(s => s.showGroundMeshes);
  const workspace = useCharacter(s => s.workspace);
  const setWorkspace = useCharacter(s => s.setWorkspace);
  const curated = useMemo(() => assetOptions(manifest, 'clothingMesh') as ClothingItem[], [manifest]);
  const archive = useMemo(() => (catalogues.clothingMesh ?? []) as ClothingItem[], [catalogues.clothingMesh]);

  const allClothing = useMemo(() => {
    const seen = new Set<string>();
    const seenWeightKeys = new Set<string>();
    const list: ClothingItem[] = [];
    const add = (item: ClothingItem) => {
      if (!showGroundMeshes && /_gnd\.nif$/i.test(item.file)) return;
      if (item.weightVariants && item.weightVariants.w0 === item.id && item.weightVariants.w1 !== item.id) return;
      if (item.weightKey && !item.weightDefault) return;
      if (/_0\.nif$/i.test(item.file)) return;
      const pairKey = item.weightVariants?.w1 ?? item.weightKey ?? item.id;
      if (seenWeightKeys.has(pairKey) || seen.has(item.id)) return;
      seenWeightKeys.add(pairKey);
      seen.add(item.id);
      list.push(item);
    };
    for (const item of curated) add(item);
    for (const item of archive) add(item);
    return list;
  }, [curated, archive, showGroundMeshes]);

  const itemFor = (id: string | undefined) =>
    id
      ? allClothing.find(
          item =>
            item.id === id ||
            item.weightVariants?.w0 === id ||
            item.weightVariants?.w1 === id
        )
      : undefined;

  const nameFor = (id: string | undefined) => {
    const item = itemFor(id);
    return item ? cleanGarmentName(item.label || item.file) : id ? 'Equipped item' : undefined;
  };

  const selectSlot = (slot: EquipSlot) => {
    useCharacter.getState().setEquipSlot(slot);
    setWorkspace('wardrobe');
  };

  const unequipSlot = (slot: EquipSlot, event?: MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    const state = useCharacter.getState();
    state.setEquip({ [slot]: null });
    if (slot === 'outfit') state.setAssets({ clothingMesh: null });
  };

  const fullOutfitItem = equipment.outfit ? itemFor(equipment.outfit) : undefined;
  const fullOutfitName = nameFor(equipment.outfit);

  return (
    <section className="creator-wardrobe-panel w-[275px] select-none text-[#e6e1d8]" aria-label="Wardrobe Equipment">
      {/* ─────────────────────────────────────────────────────────────────────────────
          CALLOUT 1: Sets Card
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="mb-2">
        <div className="mb-1 text-[11px] font-sans text-[#8f8d95]">Sets</div>
        <button
          type="button"
          onClick={() => selectSlot('outfit')}
          onContextMenu={e => unequipSlot('outfit', e)}
          aria-pressed={equipSlot === 'outfit'}
          aria-label={`Sets slot: ${fullOutfitName ?? 'Empty'}`}
          title={`Sets: ${fullOutfitName ?? 'Empty'}\nClick to browse full outfits; right-click to unequip`}
          className={cn(
            'group relative flex h-[68px] w-full items-center justify-center rounded-[2px] border bg-[#202126]/90 backdrop-blur-md transition-all',
            equipSlot === 'outfit'
              ? 'border-[#e4cca8] ring-1 ring-[#e4cca8]/60 bg-[#e4cca8]/10'
              : 'border-white/[0.08] hover:border-[#d4b483]/50 hover:bg-[#282930]'
          )}
        >
          {equipment.outfit ? (
            <div className="flex h-full w-full items-center justify-center p-2">
              <GarmentThumbnail
                id={fullOutfitItem?.weightVariants?.w0 ?? fullOutfitItem?.id ?? equipment.outfit}
                meshUrl={
                  fullOutfitItem?.weightVariants
                    ? convertUrl({ kind: 'clothingMesh', id: fullOutfitItem.weightVariants.w0, mode: 'mesh' })
                    : fullOutfitItem?.meshUrl
                }
                slot="outfit"
                label={fullOutfitName}
                className="h-full w-full p-0.5"
                iconClassName="h-8 w-8 text-[#e0cfab]"
                imgClassName="scale-95"
              />
            </div>
          ) : (
            <IconWuxiaRobe className="h-7 w-7 text-[#7a7882] transition-colors group-hover:text-[#c4b595]" />
          )}
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          CALLOUT 2: 4-Column Equipment Matrix (12 Slots)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-[3px] rounded-[2px] border border-white/[0.08] bg-black/40 p-[3px]">
        {GRID_SLOTS.map(def => {
          const equippedId = def.equipSlot ? equipment[def.equipSlot] : undefined;
          const item = itemFor(equippedId);
          const itemName = nameFor(equippedId);
          const isActive = def.equipSlot ? equipSlot === def.equipSlot : false;

          return (
            <SlotCell
              key={def.id}
              def={def}
              equippedId={equippedId}
              item={item}
              itemName={itemName}
              isActive={isActive}
              onSelect={() => {
                if (def.equipSlot) {
                  selectSlot(def.equipSlot);
                } else if (def.id === 'head') {
                  navigateCategory('styling');
                }
              }}
              onUnequip={e => {
                if (def.equipSlot) unequipSlot(def.equipSlot, e);
              }}
            />
          );
        })}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          CALLOUT 3: Weapon Slots (Sword & Fan)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="mt-[3px] grid grid-cols-2 gap-[3px]">
        {/* Main Weapon Slot (Sword) */}
        <button
          type="button"
          onClick={() => {
            useCharacter.getState().showToast('Main Weapon: Jian Sword equipped');
          }}
          aria-label="Main Weapon: Sword"
          title="Main Weapon: Sword"
          className="group relative flex h-[64px] w-full items-center justify-center rounded-[2px] border border-white/[0.08] bg-[#202126]/90 backdrop-blur-md transition-all hover:border-[#d4b483]/50 hover:bg-[#282930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
        >
          <IconWuxiaSword className="h-9 w-14 text-[#9f9da6] transition-colors group-hover:text-[#e4cca8]" />
        </button>

        {/* Off-hand Weapon Slot (Fan) */}
        <button
          type="button"
          onClick={() => {
            useCharacter.getState().showToast('Off-hand Weapon: Folding Fan equipped');
          }}
          aria-label="Off-hand Weapon: Fan"
          title="Off-hand Weapon: Fan"
          className="group relative flex h-[64px] w-full items-center justify-center rounded-[2px] border border-white/[0.08] bg-[#202126]/90 backdrop-blur-md transition-all hover:border-[#d4b483]/50 hover:bg-[#282930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
        >
          <IconWuxiaFan className="h-9 w-14 text-[#9f9da6] transition-colors group-hover:text-[#e4cca8]" />
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          CALLOUT 4: Appearance Switcher Bar
          ───────────────────────────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => navigateCategory('styling')}
        aria-label="Go to Appearance and Facial Sculpting"
        className="mt-2.5 flex h-[38px] w-full items-center gap-2.5 rounded-[2px] border border-white/[0.08] bg-[#202126]/90 px-3 text-[#e6e1d8] backdrop-blur-md transition-all hover:border-[#d4b483]/50 hover:bg-[#282930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white p-0.5 text-black">
          <IconYinYang className="h-full w-full" />
        </span>
        <span className="flex-1 text-left text-xs font-normal tracking-wide text-[#e6e1d8]">Appearance</span>
        <span className="font-mono text-sm text-[#8a8793]" aria-hidden>
          ›
        </span>
      </button>
    </section>
  );
}

interface SlotCellProps {
  def: GridSlotDef;
  equippedId?: string;
  item?: ClothingItem;
  itemName?: string;
  isActive: boolean;
  onSelect: () => void;
  onUnequip: (event: MouseEvent) => void;
}

function SlotCell({ def, equippedId, item, itemName, isActive, onSelect, onUnequip }: SlotCellProps) {
  return (
    <div className="relative aspect-square w-full min-w-0">
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={e => {
          if (equippedId) onUnequip(e);
        }}
        aria-pressed={isActive}
        aria-label={`${def.label}: ${itemName ?? 'Empty'}`}
        title={`${def.label}: ${itemName ?? 'Empty'}\nClick to browse; right-click to unequip`}
        className={cn(
          'group relative flex h-full w-full items-center justify-center overflow-hidden rounded-[1px] border transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]',
          isActive
            ? 'border-[#e4cca8] bg-[#e4cca8]/15 ring-1 ring-[#e4cca8]/60 text-[#f2dfbe]'
            : equippedId
              ? 'border-white/[0.12] bg-[#1a1b20]/95 hover:border-[#eac87f]/70'
              : 'border-white/[0.06] bg-[#202126]/90 hover:border-[#d4b483]/50 hover:bg-[#282930]'
        )}
      >
        {/* NEW badge */}
        {def.isNew && !equippedId && (
          <span className="absolute top-0 right-0 z-10 bg-[#c8b8a9] px-1 py-[0.5px] text-[10px] font-bold leading-tight text-[#1c1b1d] select-none">
            NEW
          </span>
        )}

        {/* Equipped Graphic or Default Slot Icon */}
        {equippedId ? (
          <div className="relative flex h-full w-full items-center justify-center p-1">
            <GarmentThumbnail
              id={item?.weightVariants?.w0 ?? item?.id ?? equippedId}
              meshUrl={
                item?.weightVariants
                  ? convertUrl({ kind: 'clothingMesh', id: item.weightVariants.w0, mode: 'mesh' })
                  : item?.meshUrl
              }
              slot={def.equipSlot ?? 'accessories'}
              label={itemName}
              className="h-full w-full p-0.5"
              iconClassName="h-6 w-6 text-[#e0cfab]"
              imgClassName="scale-95"
            />
            <span aria-hidden="true" className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-[#eac87f]" />
          </div>
        ) : (
          <RenderSlotIcon type={def.iconType} />
        )}
      </button>

      {/* Unequip quick button */}
      {equippedId && (
        <button
          type="button"
          onClick={onUnequip}
          aria-label={`Unequip ${def.label}`}
          title={`Unequip ${def.label}`}
          className="absolute right-0.5 bottom-0.5 z-10 flex h-4.5 w-4.5 items-center justify-center rounded-[1px] border border-white/20 bg-black/80 font-mono text-[10px] text-[#e0a898] hover:border-[#e0a898] hover:text-white"
        >
          ×
        </button>
      )}
    </div>
  );
}

function RenderSlotIcon({ type }: { type: GridSlotDef['iconType'] }) {
  const iconCls = 'h-6 w-6 text-[#7a7882] transition-colors group-hover:text-[#c4b595]';
  switch (type) {
    case 'head':
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-[#9a98a0] transition-colors group-hover:text-white" fill="none" stroke="currentColor" strokeWidth="1.2">
          <circle cx="12" cy="10" r="5" />
          <path d="M12 15 C8 15 5 18 5 21 L19 21 C19 18 16 15 12 15 Z" />
        </svg>
      );
    case 'robe':
      return <IconWuxiaRobe className={iconCls} />;
    case 'hat':
      return <IconWuxiaHat className={iconCls} />;
    case 'scarf':
      return <IconWuxiaScarf className={iconCls} />;
    case 'mask':
      return <IconWuxiaMask className={iconCls} />;
    case 'shoulder':
      return <IconWuxiaShoulder className={iconCls} />;
    case 'earring':
      return <IconWuxiaEarring className={iconCls} />;
    case 'talisman':
      return <IconWuxiaTalisman className={iconCls} />;
    case 'ring':
      return <IconWuxiaRing className={iconCls} />;
  }
}
