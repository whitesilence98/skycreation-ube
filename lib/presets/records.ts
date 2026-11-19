import { PRESET_FORMAT, parsePreset, type PresetFile } from '@/lib/presetIO';

/**
 * The pure record layer of the named preset library.
 *
 * Nothing here touches the DOM, IndexedDB or three.js: it is the vocabulary
 * (constants and types), the validation boundary, and the small pure helpers
 * the UI uses to reason about labels, collisions, capacity and ordering.
 *
 * The library itself lives in `lib/presets/library.ts`; validation happens on
 * both sides of the IndexedDB boundary there, but the rules are defined once,
 * here, so a record is judged the same whether it came from a save, a read or
 * a hand-edited database.
 */

export const PRESET_LIBRARY_SCHEMA = 1;
export const PRESET_LIBRARY_LIMIT = 50;
export const PRESET_LABEL_MAX = 32;
/** ~120 KB of base64 data URL; a 256² WebP preview is far below this. */
export const THUMBNAIL_MAX_CHARS = 160_000;

const FALLBACK_LABEL = 'Untitled';
const THUMBNAIL_RE = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i;

export interface PresetLibraryRecord {
  schema: typeof PRESET_LIBRARY_SCHEMA;
  id: string;
  label: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
  /** Optional `data:image/...` preview of the viewport at save time. */
  thumbnail?: string;
  /** The whole character look, exactly as `buildPresetFile` wrote it. */
  preset: PresetFile;
}

function cleanLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const stripped = raw
    /* Control characters would render as boxes in the list and are never a
       deliberate part of a label a human typed. Collapse them to one space so
       `"a\nb"` becomes `"a b"` rather than `"ab"`. */
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  /* Truncate by code point, not UTF-16 unit: `Array.from` keeps an astral
     character (an emoji) whole instead of slicing its surrogate pair in half. */
  return Array.from(stripped).slice(0, PRESET_LABEL_MAX).join('').trim();
}

/**
 * A display label: control characters stripped, whitespace collapsed and
 * trimmed, truncated to `PRESET_LABEL_MAX` code points. Anything that normalizes
 * to nothing falls back to the supplied label (default `'Untitled'`).
 */
export function normalizeLabel(raw: unknown, fallback = FALLBACK_LABEL): string {
  return cleanLabel(raw) || cleanLabel(fallback) || FALLBACK_LABEL;
}

/**
 * A fresh record id.
 *
 * `crypto.randomUUID` when the environment has it (every browser this app
 * targets, and Node 19+); otherwise a timestamp plus randomness is plenty for
 * a local, single-user library.
 */
export function newRecordId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    try {
      return cryptoObj.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoNow(now: Date | undefined): string {
  /* Duck-typed rather than `instanceof Date`: callers (and tests) may hand in a
     Date from another realm, where `instanceof` is false despite a real time. */
  const candidate = now as { getTime?: () => number } | undefined;
  const ms = candidate && typeof candidate.getTime === 'function' ? candidate.getTime() : NaN;
  const date = Number.isFinite(ms) ? (now as Date) : new Date();
  return date.toISOString();
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v));
}

/** A stored thumbnail is valid only when it is a bounded base64 image data URL. */
function isValidThumbnail(v: unknown): v is string {
  return typeof v === 'string' && v.length <= THUMBNAIL_MAX_CHARS && THUMBNAIL_RE.test(v);
}

/**
 * Builds a record from the live character.
 *
 * `label` is normalized here so callers can hand in raw input. The preset is
 * stored verbatim: it is the same `PresetFile` `snapshotPreset()` produces, and
 * `parsePreset` is what validates it later. `now` (a clock) and `id` are
 * injectable so tests are deterministic and overwrites can keep their id.
 */
export function makeRecord(input: {
  label: unknown;
  preset: PresetFile;
  thumbnail?: string | null;
  now?: Date;
  id?: string;
}): PresetLibraryRecord {
  const iso = isoNow(input.now);
  const record: PresetLibraryRecord = {
    schema: PRESET_LIBRARY_SCHEMA,
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : newRecordId(),
    label: normalizeLabel(input.label),
    createdAt: iso,
    updatedAt: iso,
    preset: input.preset,
  };
  if (typeof input.thumbnail === 'string' && input.thumbnail) {
    record.thumbnail = input.thumbnail;
  }
  return record;
}

/**
 * The first record whose label collides with `label`, case-insensitively on
 * the *normalized* label. `excludeId` exempts the record being updated, so a
 * rename that only changes capitalization does not collide with itself.
 */
export function findLabelCollision(
  records: readonly PresetLibraryRecord[],
  label: unknown,
  excludeId?: string,
): PresetLibraryRecord | undefined {
  const target = normalizeLabel(label).toLowerCase();
  for (const record of records) {
    if (excludeId !== undefined && record.id === excludeId) continue;
    if (normalizeLabel(record.label).toLowerCase() === target) return record;
  }
  return undefined;
}

/**
 * True when a *new* save must be refused. Updating an existing id is always
 * allowed (the library is full, not frozen), which is why `overwriteId` must
 * actually name a record already in the list.
 */
export function isAtCapacity(
  records: readonly PresetLibraryRecord[],
  overwriteId?: string,
): boolean {
  if (records.length < PRESET_LIBRARY_LIMIT) return false;
  return !(overwriteId !== undefined && records.some((r) => r.id === overwriteId));
}

function labelKey(record: PresetLibraryRecord): string {
  return normalizeLabel(record.label).toLowerCase();
}

/**
 * `updatedAt` desc, then `createdAt` desc, then label asc. Returns a new array;
 * the input order is never touched. Recency is the point of the list, and the
 * label tie-break keeps two saves in the same millisecond deterministic.
 */
export function sortRecords(records: readonly PresetLibraryRecord[]): PresetLibraryRecord[] {
  return [...records].sort((a, b) => {
    const updated = (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    if (updated !== 0) return updated;
    const created = (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    if (created !== 0) return created;
    const al = labelKey(a);
    const bl = labelKey(b);
    if (al !== bl) return al < bl ? -1 : 1;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

/** Replace-by-id or append, returning a new array. */
export function upsertRecord(
  records: readonly PresetLibraryRecord[],
  record: PresetLibraryRecord,
): PresetLibraryRecord[] {
  const index = records.findIndex((r) => r.id === record.id);
  if (index === -1) return [...records, record];
  const next = [...records];
  next[index] = record;
  return next;
}

/**
 * Validates an untrusted record (IndexedDB contents, or a save call) at the
 * trust boundary.
 *
 * Returns `null` — skip it, do not crash the whole list — for the wrong schema,
 * a missing id, unusable timestamps, a preset that is not this app's own
 * `lyra-preset` payload, or a thumbnail that is not a bounded image data URL.
 * A missing thumbnail is valid. Labels are normalized rather than rejected.
 */
export function normalizeRecord(raw: unknown): PresetLibraryRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.schema !== PRESET_LIBRARY_SCHEMA) return null;
  if (typeof o.id !== 'string' || !o.id.trim()) return null;
  if (!isIsoDate(o.createdAt) || !isIsoDate(o.updatedAt)) return null;
  if (!isLyraPreset(o.preset)) return null;

  let thumbnail: string | undefined;
  if (o.thumbnail !== undefined && o.thumbnail !== null) {
    if (!isValidThumbnail(o.thumbnail)) return null;
    thumbnail = o.thumbnail;
  }

  const record: PresetLibraryRecord = {
    schema: PRESET_LIBRARY_SCHEMA,
    id: o.id.trim(),
    label: normalizeLabel(o.label),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    preset: o.preset,
  };
  if (thumbnail) record.thumbnail = thumbnail;
  return record;
}

/**
 * True only for a payload `parsePreset` accepts as this app's export. A bare
 * `.jslot` is also parseable, but the library only stores `lyra-preset` files,
 * so a foreign payload is rejected here rather than half-restoring later.
 */
function isLyraPreset(raw: unknown): raw is PresetFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  if ((raw as { format?: unknown }).format !== PRESET_FORMAT) return false;
  try {
    const parsed = parsePreset(JSON.stringify(raw));
    return parsed.source === 'lyra';
  } catch {
    return false;
  }
}

/**
 * A short, fixed-clock-friendly age for the list rows: `just now`, `N min ago`,
 * `N h ago`, `N d ago`, then an ISO date once it is a week old.
 */
export function formatRelativeDate(iso: string, now?: Date): string {
  const then = Date.parse(iso);
  const candidate = now as { getTime?: () => number } | undefined;
  const nowMs = candidate && typeof candidate.getTime === 'function' ? candidate.getTime() : Date.now();
  if (!Number.isFinite(then) || !Number.isFinite(nowMs)) return '';
  const diffMs = Math.max(0, nowMs - then);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(then).toISOString().slice(0, 10);
}
