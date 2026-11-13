/**
 * The modular equipment paper-doll vocabulary:
 * outfit, top, bottom, bra, panties, stockings, hands, feet, accessories.
 */
export const EQUIP_SLOTS = [
  'outfit',
  'top',
  'bottom',
  'bra',
  'panties',
  'stockings',
  'hands',
  'feet',
  'accessories',
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];
export type EquipSelection = Partial<Record<EquipSlot, string>>;

/** The whole-outfit pseudo-slot / primary outfit slot. */
export const FULL_OUTFIT_SLOT = 'outfit' as const;

export const EQUIP_SLOT_LABEL: Record<EquipSlot, string> = {
  outfit: 'OUTFIT',
  top: 'TOP',
  bottom: 'BOTTOM',
  bra: 'BRA',
  panties: 'PANTIES',
  stockings: 'STOCKINGS',
  hands: 'HANDS',
  feet: 'FEET',
  accessories: 'ACCESSORIES',
};

export const EQUIP_SLOT_SIDE: Record<EquipSlot, 'left' | 'right' | 'center'> = {
  outfit: 'center',
  top: 'left',
  bottom: 'center',
  bra: 'right',
  panties: 'left',
  stockings: 'right',
  hands: 'left',
  feet: 'center',
  accessories: 'right',
};

const SLOT_SET = new Set<string>(EQUIP_SLOTS);

export function isEquipSlot(v: unknown): v is EquipSlot {
  return typeof v === 'string' && (SLOT_SET.has(v) || v === 'full');
}

/** A hand-edited payload: bounded vocabulary, string ids, at most one per slot. */
export function isEquipSelection(v: unknown): v is EquipSelection {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v as Record<string, unknown>).every(
    ([slot, id]) => isEquipSlot(slot) && typeof id === 'string',
  );
}

/** The slot a manifest/catalogue clothing row belongs to, if it names one. */
export function equipSlotOf(row: { equipSlot?: string } | undefined | null): EquipSlot | undefined {
  if (!row?.equipSlot) return undefined;
  if (row.equipSlot === 'full') return 'outfit';
  return isEquipSlot(row.equipSlot) ? (row.equipSlot as EquipSlot) : undefined;
}

/** Rows that belong to the whole-outfit slot rather than any worn slot. */
export function isWholeOutfit(row: { equipSlot?: string; hasBodyShape?: boolean }): boolean {
  return row.equipSlot === 'outfit' || row.equipSlot === 'full';
}
