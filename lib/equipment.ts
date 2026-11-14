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
  return typeof v === 'string' && SLOT_SET.has(v);
}

export function normalizeEquipSlot(slot: string | undefined | null): EquipSlot | null {
  if (!slot || typeof slot !== 'string') return null;
  const s = slot.toLowerCase().trim();
  if (s === 'full') return 'outfit';
  if (s === 'chest') return 'top';
  if (s === 'legs') return 'bottom';
  if (SLOT_SET.has(s)) return s as EquipSlot;
  return null;
}

/** A hand-edited payload: bounded vocabulary, string ids, at most one per slot. */
export function isEquipSelection(v: unknown): v is EquipSelection {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v as Record<string, unknown>).every(
    ([slot, id]) => (isEquipSlot(slot) || normalizeEquipSlot(slot) !== null) && typeof id === 'string',
  );
}

/** Dynamically infer the equipment slot from metadata, filename, label, or path.
 * Precedence: valid explicit metadata first (aliases normalized), then filename inference. */
export function inferEquipSlot(
  row: { equipSlot?: string; file?: string; label?: string; rel?: string } | undefined | null,
): EquipSlot {
  if (!row) return 'top';

  // 1. Explicit metadata takes precedence when valid
  const explicit = normalizeEquipSlot(row.equipSlot);
  if (explicit) return explicit;

  // 2. Fallback to filename/label/rel inference for rows without valid metadata
  const str = `${row.label || ''} ${row.file || ''} ${row.rel || ''}`.toLowerCase();

  // Hands & arms
  if (/gauntlet|glove|bracer|vambrace|wristguard|wrist|hand|armguard/i.test(str)) return 'hands';
  // Feet & boots
  if (/sabaton|boot|shoe|greave|foot|feet|heel|sandal/i.test(str)) return 'feet';
  // Intimates & underwear
  if (/panties|panty|thong|brief|undies/i.test(str)) return 'panties';
  if (/bra|bikini|bustier/i.test(str)) return 'bra';
  if (/stocking|sock|tights|hose/i.test(str)) return 'stockings';
  // Bottom / skirts / pants / shorts
  if (/skirt|miniskirt|cuisses|bottom|pant|trouser|kilt|short|shorts|legging/i.test(str)) return 'bottom';
  // Torso / armor
  if (/cuirass|corset|top|shirt|vest|blouse|jacket|tunic|bodice|chest/i.test(str)) return 'top';
  // Accessories / jewelry / accents
  if (/crown|halo|necklace|choker|collar|cape|cloak|pauldron|spaulder|shoulder|gorget|ellbow|elbow|ring|amulet|belt|sash|ribbon|tiara|diadem|circlet|helmet|helm|mask|hood/i.test(str)) return 'accessories';
  // Full outfit / dress / robe
  if (/outfit|dress|robe|suit|full|gown|uniform/i.test(str)) return 'outfit';

  return 'top';
}

/** The slot a manifest/catalogue clothing row belongs to (explicit or inferred). */
export function equipSlotOf(
  row: { equipSlot?: string; file?: string; label?: string; rel?: string } | undefined | null,
): EquipSlot {
  return inferEquipSlot(row);
}

/** Rows that belong to the whole-outfit slot rather than any worn slot. */
export function isWholeOutfit(row: { equipSlot?: string; file?: string; label?: string; hasBodyShape?: boolean }): boolean {
  return equipSlotOf(row) === 'outfit';
}
