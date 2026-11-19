'use client';

import { useMemo, type MouseEvent } from 'react';
import { useCharacter } from '@/lib/store';
import { EQUIP_SLOTS, EQUIP_SLOT_LABEL, type EquipSlot } from '@/lib/equipment';
import { assetOptions } from '@/lib/manifestSelect';
import { convertUrl } from '@/lib/mo2/client';
import { exitWardrobe, navigateCategory } from '@/lib/editorNav';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { IconHanger, IconSparkle } from '@/components/hud/Icons';
import { SlotIcon } from '@/components/hud/SlotIcon';
import { GarmentThumbnail } from '@/components/hud/GarmentThumbnail';
import { OutfitSets } from '@/components/hud/outfit/OutfitSets';

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
  return name.replace(/\.nif$/i, '').replace(/_[01]$/, '')
    .replace(/^\[UBE 2\.0\]\s*/i, '').replace(/^FB_/i, '').replace(/_/g, ' ').trim();
}

const WARDROBE_TABS = [
  ['outfit', 'Wardrobe'], ['styling', 'Appearance'], ['body', 'Body Shape'],
  ['hair', 'Hair'], ['preset', 'Presets'],
] as const;

export function EquipmentPanel({ manifest }: { manifest: Mo2Manifest | null }) {
  const name = useCharacter(s => s.name);
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
      if (/_0\.nif$/i.test(item.file) && (item.weightVariants || item.weightKey)) return;
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

  const itemFor = (id: string | undefined) => id ? allClothing.find(item => item.id === id ||
    item.weightVariants?.w0 === id || item.weightVariants?.w1 === id) : undefined;
  const nameFor = (id: string | undefined) => {
    const item = itemFor(id);
    return item ? cleanGarmentName(item.label || item.file) : id ? 'Unavailable garment' : undefined;
  };
  const currentSlot = equipSlot ?? 'top';
  const wornCount = EQUIP_SLOTS.filter(slot => equipment[slot]).length;
  const activeWornId = equipment[currentSlot];
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

  return <section className="creator-wardrobe-panel" aria-label="Wardrobe">
    <nav className="creator-wardrobe-tabs" aria-label="Wardrobe categories">
      {WARDROBE_TABS.map(([id, label]) => <button key={id} type="button" aria-pressed={id === 'outfit'}
        onClick={() => { if (id !== 'outfit') navigateCategory(id); }}>{label}</button>)}
    </nav>
    <header className="creator-wardrobe-heading">
      <div><h2>WARDROBE</h2><span>{name || 'Character'} · {wornCount}/{EQUIP_SLOTS.length} worn</span></div>
      <button type="button" onClick={exitWardrobe} aria-label="Exit wardrobe">Exit <span aria-hidden="true">×</span></button>
    </header>
    <div className="min-w-0 select-none text-[#e6e1d8]">
      <OutfitSets />
      <h3 className="my-2 font-mono text-[10px] tracking-widest text-[#c4b595]">SLOTS</h3>
      <div className="creator-wardrobe-slots grid grid-cols-3 gap-2">
        {EQUIP_SLOTS.map(slot => <SlotCard key={slot} slot={slot} isActive={currentSlot === slot}
          equippedId={equipment[slot]} item={itemFor(equipment[slot])} itemName={nameFor(equipment[slot])}
          onSelect={() => selectSlot(slot)} onUnequip={event => unequipSlot(slot, event)} />)}
      </div>
      <div className="my-2 rounded-xs border border-[#d4b483]/22 bg-black/40 p-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[10px]">
          <SlotIcon slot={currentSlot} className="h-3.5 w-3.5 shrink-0 text-[#eac87f]" />
          <span className="shrink-0 font-mono text-[#eac87f]">{EQUIP_SLOT_LABEL[currentSlot]}</span>
          <span className="min-w-0 flex-1 truncate" title={nameFor(activeWornId)}>{nameFor(activeWornId) ?? 'Empty'}</span>
          <button type="button" onClick={event => unequipSlot(currentSlot, event)} disabled={!activeWornId}
            className="shrink-0 text-[#e0a898] hover:text-[#f0b8a8] disabled:opacity-30">UNEQUIP</button>
        </div>
        <button type="button" onClick={() => setWorkspace(workspace === 'wardrobe' ? 'edit' : 'wardrobe')}
          aria-expanded={workspace === 'wardrobe'}
          className="mt-2 flex w-full items-center justify-center gap-1.5 border border-[#d4b483]/40 bg-[#d4b483]/12 py-2 font-mono text-[10px] tracking-wider text-[#e8c98e] hover:bg-[#d4b483]/22">
          <IconHanger className="h-3.5 w-3.5" />{workspace === 'wardrobe' ? 'CLOSE WARDROBE [ESC]' : 'BROWSE WARDROBE →'}
        </button>
      </div>
      <button type="button" onClick={() => navigateCategory('styling')}
        className="creator-wardrobe-next flex w-full items-center gap-2 border border-[#eac87f]/45 bg-[#d4b483]/15 px-3 py-2 text-[#f2dfbe] hover:bg-[#d4b483]/25">
        <IconSparkle className="h-4 w-4" /><span className="flex-1 text-left text-xs">Appearance</span><span aria-hidden="true">›</span>
      </button>
    </div>
  </section>;
}

interface SlotCardProps {
  slot: EquipSlot;
  isActive: boolean;
  equippedId?: string;
  item?: ClothingItem;
  itemName?: string;
  onSelect: () => void;
  onUnequip: (event: MouseEvent) => void;
}

function SlotCard({ slot, isActive, equippedId, item, itemName, onSelect, onUnequip }: SlotCardProps) {
  return <div className="creator-wardrobe-slot relative min-w-0">
    <button type="button" onClick={onSelect} onContextMenu={event => { if (equippedId) onUnequip(event); }}
      aria-pressed={isActive} aria-label={`Browse ${EQUIP_SLOT_LABEL[slot]}: ${itemName ?? 'Empty'}`}
      title={`${EQUIP_SLOT_LABEL[slot]}: ${itemName ?? 'Empty'}\nClick to browse; right-click to unequip`}
      className={cn('group flex w-full min-w-0 flex-col items-center gap-1 rounded-xs border p-1 text-[10px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]',
        isActive ? 'border-[#eac87f] bg-[#eac87f]/15 text-[#f2dfbe] ring-1 ring-[#eac87f]/40'
          : equippedId ? 'border-[#d4b483]/55 bg-[#16130e]/90 text-[#d4b483] hover:border-[#eac87f]'
            : 'border-[#d4b483]/24 bg-black/40 text-[#8f8778] hover:border-[#d4b483]/50')}>
      <span className="block w-full truncate font-mono uppercase">{EQUIP_SLOT_LABEL[slot]}</span>
      <span className="relative flex aspect-square w-full items-center justify-center">
        {equippedId ? <>
          <GarmentThumbnail id={item?.weightVariants?.w1 ?? item?.id ?? equippedId}
            meshUrl={item?.weightVariants ? convertUrl({ kind: 'clothingMesh', id: item.weightVariants.w1, mode: 'mesh' }) : item?.meshUrl}
            slot={slot} label={itemName} className="h-full w-full p-0.5" iconClassName="h-6 w-6 text-[#e0cfab]" imgClassName="scale-95" />
          <span aria-hidden="true" className="absolute bottom-0 left-0 h-1.5 w-1.5 rounded-full bg-[#eac87f]" />
        </> : <SlotIcon slot={slot} className="h-6 w-6 opacity-50" />}
      </span>
      <span className="block w-full truncate text-[9px]">{itemName ?? 'Empty'}</span>
    </button>
    {equippedId && <button type="button" onClick={onUnequip} aria-label={`Unequip ${EQUIP_SLOT_LABEL[slot]}`}
      title={`Unequip ${EQUIP_SLOT_LABEL[slot]}`}
      className="absolute right-0 bottom-5 flex h-5 w-5 items-center justify-center rounded-xs border border-[#d4b483]/35 bg-black/90 text-xs text-[#e0a898] hover:border-[#e0a898] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]">×</button>}
  </div>;
}
