import { EQUIP_SLOTS, normalizeEquipSlot, type EquipSelection } from '@/lib/equipment';
import { newRecordId, normalizeLabel, PRESET_LABEL_MAX, THUMBNAIL_MAX_CHARS } from '@/lib/presets/records';

export const OUTFIT_SET_SCHEMA = 1;
export const OUTFIT_SET_FORMAT = 'lyra-outfit';
export const OUTFIT_SET_LIMIT = 50;
export const OUTFIT_SET_LABEL_MAX = PRESET_LABEL_MAX;
export const OUTFIT_SET_JSON_MAX_CHARS = 32_768;
export const OUTFIT_SET_ID_MAX_CHARS = 1024;
const RECORD_MAX_CHARS = OUTFIT_SET_JSON_MAX_CHARS + THUMBNAIL_MAX_CHARS;

export interface OutfitSetRecord {
  schema: typeof OUTFIT_SET_SCHEMA;
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  thumbnail?: string;
  equipment: EquipSelection;
  /** Independent legacy whole-outfit selection; never inferred from equipment.outfit. */
  clothingMesh?: string;
}

export interface OutfitSetFile {
  format: typeof OUTFIT_SET_FORMAT;
  version: typeof OUTFIT_SET_SCHEMA;
  label: string;
  equipment: EquipSelection;
  clothingMesh?: string;
}

function object(raw: unknown): raw is Record<string, unknown> {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const prototype = Object.getPrototypeOf(raw);
    // Accept plain objects across realms, never inherited payloads or class instances.
    if (prototype !== null && (Object.getPrototypeOf(prototype) !== null ||
      Function.prototype.toString.call(Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value) !==
        Function.prototype.toString.call(Object))) return false;
    return Reflect.ownKeys(raw).every((key) => {
      const property = Object.getOwnPropertyDescriptor(raw, key);
      return typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key) &&
        !!property?.enumerable && Object.hasOwn(property, 'value');
    });
  } catch { return false; }
}

function boundedJson(raw: unknown, max: number): boolean {
  try {
    const text = JSON.stringify(raw);
    return typeof text === 'string' && text.length <= max;
  } catch { return false; }
}

function validId(raw: unknown, max = OUTFIT_SET_ID_MAX_CHARS): raw is string {
  return typeof raw === 'string' && raw.length <= max && !!raw.trim() && !/[\p{Cc}\p{Cf}]/u.test(raw);
}

function equipmentOf(raw: unknown): EquipSelection | null {
  if (!object(raw) || Object.keys(raw).length > EQUIP_SLOTS.length * 2) return null;
  const equipment: EquipSelection = {};
  for (const [key, id] of Object.entries(raw)) {
    const slot = normalizeEquipSlot(key);
    if (!slot || !validId(id)) return null;
    // An alias and its canonical key may agree, never silently overwrite each other.
    if (equipment[slot] !== undefined && equipment[slot] !== id) return null;
    equipment[slot] = id;
  }
  return equipment;
}

function validDate(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length <= 64 && Number.isFinite(Date.parse(raw));
}

export function normalizeOutfitRecord(raw: unknown): OutfitSetRecord | null {
  if (!object(raw) || !boundedJson(raw, RECORD_MAX_CHARS) || raw.schema !== OUTFIT_SET_SCHEMA) return null;
  if (Object.keys(raw).some((key) => !['schema', 'id', 'label', 'createdAt', 'updatedAt', 'thumbnail', 'equipment', 'clothingMesh'].includes(key))) return null;
  if (!validId(raw.id, 128) || !validDate(raw.createdAt) || !validDate(raw.updatedAt)) return null;
  const equipment = equipmentOf(raw.equipment);
  if (!equipment || (raw.clothingMesh !== undefined && !validId(raw.clothingMesh))) return null;
  if (!Object.keys(equipment).length && raw.clothingMesh === undefined) return null;
  if (raw.thumbnail !== undefined && raw.thumbnail !== null && (
    typeof raw.thumbnail !== 'string' || raw.thumbnail.length > THUMBNAIL_MAX_CHARS ||
    !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(raw.thumbnail)
  )) return null;
  const record: OutfitSetRecord = {
    schema: OUTFIT_SET_SCHEMA, id: raw.id, label: normalizeLabel(raw.label),
    createdAt: raw.createdAt, updatedAt: raw.updatedAt, equipment,
  };
  if (typeof raw.clothingMesh === 'string') record.clothingMesh = raw.clothingMesh;
  if (typeof raw.thumbnail === 'string') record.thumbnail = raw.thumbnail;
  return record;
}

export function makeOutfitRecord(input: {
  label: unknown;
  equipment: EquipSelection;
  clothingMesh?: string;
  thumbnail?: string | null;
  now?: Date;
  id?: string;
}): OutfitSetRecord {
  const ms = input.now?.getTime();
  const iso = new Date(ms !== undefined && Number.isFinite(ms) ? ms : Date.now()).toISOString();
  const record = normalizeOutfitRecord({
    schema: OUTFIT_SET_SCHEMA, id: input.id ?? newRecordId(), label: normalizeLabel(input.label),
    createdAt: iso, updatedAt: iso, equipment: input.equipment,
    clothingMesh: input.clothingMesh, thumbnail: input.thumbnail,
  });
  if (!record) throw new TypeError('That saved outfit is not valid.');
  return record;
}

export function findOutfitLabelCollision(
  records: readonly OutfitSetRecord[], label: unknown, excludeId?: string,
): OutfitSetRecord | undefined {
  const key = normalizeLabel(label).toLowerCase();
  return records.find((record) => record.id !== excludeId && normalizeLabel(record.label).toLowerCase() === key);
}

export function isOutfitLibraryFull(records: readonly OutfitSetRecord[], overwriteId?: string): boolean {
  return records.length >= OUTFIT_SET_LIMIT && !records.some((record) => record.id === overwriteId);
}

export function sortOutfitRecords(records: readonly OutfitSetRecord[]): OutfitSetRecord[] {
  return [...records].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
    normalizeLabel(a.label).toLowerCase().localeCompare(normalizeLabel(b.label).toLowerCase()) ||
    a.label.localeCompare(b.label));
}

export function upsertOutfitRecord(records: readonly OutfitSetRecord[], record: OutfitSetRecord): OutfitSetRecord[] {
  return records.some((row) => row.id === record.id)
    ? records.map((row) => row.id === record.id ? record : row) : [...records, record];
}

export function sameOutfit(
  a: EquipSelection, b: EquipSelection, aClothingMesh?: string, bClothingMesh?: string,
): boolean {
  return aClothingMesh === bClothingMesh && EQUIP_SLOTS.every((slot) => a[slot] === b[slot]);
}

export function buildOutfitSetFile(record: OutfitSetRecord): OutfitSetFile {
  const normalized = normalizeOutfitRecord(record);
  if (!normalized) throw new TypeError('That saved outfit is not valid.');
  const file: OutfitSetFile = {
    format: OUTFIT_SET_FORMAT, version: OUTFIT_SET_SCHEMA,
    label: normalized.label, equipment: normalized.equipment,
  };
  if (normalized.clothingMesh !== undefined) file.clothingMesh = normalized.clothingMesh;
  return file;
}

/** Accept JSON text or a decoded object. No storage or character changes occur here. */
export function parseOutfitSetFile(json: unknown): OutfitSetFile | null {
  try {
    if (typeof json === 'string') {
      if (json.length > OUTFIT_SET_JSON_MAX_CHARS) return null;
      json = JSON.parse(json);
    }
    if (!object(json) || !boundedJson(json, OUTFIT_SET_JSON_MAX_CHARS)) return null;
    if (json.format !== OUTFIT_SET_FORMAT || json.version !== OUTFIT_SET_SCHEMA) return null;
    if (Object.keys(json).some((key) => !['format', 'version', 'label', 'equipment', 'clothingMesh'].includes(key))) return null;
    if (typeof json.label !== 'string') return null;
    const equipment = equipmentOf(json.equipment);
    if (!equipment || (json.clothingMesh !== undefined && !validId(json.clothingMesh))) return null;
    if (!Object.keys(equipment).length && json.clothingMesh === undefined) return null;
    const file: OutfitSetFile = {
      format: OUTFIT_SET_FORMAT, version: OUTFIT_SET_SCHEMA,
      label: normalizeLabel(json.label), equipment,
    };
    if (typeof json.clothingMesh === 'string') file.clothingMesh = json.clothingMesh;
    return file;
  } catch { return null; }
}
