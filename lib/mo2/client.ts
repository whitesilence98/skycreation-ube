'use client';

/**
 * Browser side of the MO2 catalogue.
 *
 * Three jobs: list a category once and cache it for the session, build URLs for
 * the convert route, and give the picker a cheap predicate for "this is a
 * texture a human can judge from a thumbnail".
 *
 * Every request goes through `/api/mo2/*` rather than `public/` so the archive
 * can be absent (a different machine, a fresh clone) and the UI says so instead
 * of 404-ing one broken image at a time.
 */

import type { CatalogueEntry, CatalogueIndex, ConvertMode } from '@/lib/mo2/types';

const listCache = new Map<string, Promise<CatalogueEntry[]>>();
let indexCache: Promise<CatalogueIndex> | null = null;

/** Drop every cached list when the active source changes: ids and counts from
 *  the previous source must never resolve against the new one. */
export function resetAssetCatalogues(): void {
  listCache.clear();
  indexCache = null;
}

export function fetchCatalogueIndex(): Promise<CatalogueIndex> {
  if (!indexCache) {
    indexCache = fetch('/api/mo2/catalogue')
      .then((r) => (r.ok ? (r.json() as Promise<CatalogueIndex>) : null))
      .catch(() => null)
      .then((v) => v ?? { available: false, source: '', kinds: {} })
      .then((v) => {
        // A failed read should not be pinned for the whole session; a present
        // archive should.
        if (!v.available) indexCache = null;
        return v;
      });
  }
  return indexCache;
}

export function fetchCatalogue(kind: string): Promise<CatalogueEntry[]> {
  const hit = listCache.get(kind);
  if (hit) return hit;

  const job = fetch(`/api/mo2/catalogue?kind=${encodeURIComponent(kind)}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ entries: CatalogueEntry[] }>) : null))
    .catch(() => null)
    .then((v) => v?.entries ?? [])
    .then((entries) => {
      if (!entries.length) listCache.delete(kind);
      return entries;
    });

  listCache.set(kind, job);
  return job;
}

export interface ConvertUrlOptions {
  kind: string;
  id: string;
  mode: ConvertMode;
  role?: string | null;
}

export function convertUrl({ kind, id, mode, role }: ConvertUrlOptions): string {
  const q = new URLSearchParams({ kind, id, mode });
  if (role) q.set('role', role);
  return `/api/mo2/convert?${q.toString()}`;
}

/** Stable key for the entry a pick resolves to, so a `<img>` only reloads when
 *  the underlying file changes rather than on every render. */
export function entryKey(e: CatalogueEntry, mode: ConvertMode): string {
  return `${e.id}-${mode}`;
}

/**
 * Which entries in a category deserve a thumbnail.
 *
 * Hair atlases are 1,138 files and most of the category's siblings are `_n` /
 * `_sk` companions of an albedo that is already listed. Requesting a thumbnail
 * for every row would fire a decode per row on open; this keeps it to the
 * entries the picker actually offers as a choice.
 */
export function isPresentable(e: CatalogueEntry, kind: string): boolean {
  if (kind.endsWith('Mesh')) return true;
  const role = e.mapRole ?? 'albedo';
  if (kind === 'skin' || kind === 'eyes' || kind === 'hair') {
    return role === 'albedo';
  }
  if (kind === 'skeleton' || kind === 'preset') return true;
  return role === 'albedo';
}

/** Human-facing grouping: the mod folder, newest-looking files first is
 *  meaningless here, so the archive's own folder order stands. */
export function groupByMod(entries: CatalogueEntry[]): Array<{ mod: string; entries: CatalogueEntry[] }> {
  const out: Array<{ mod: string; entries: CatalogueEntry[] }> = [];
  let current: { mod: string; entries: CatalogueEntry[] } | null = null;
  for (const e of entries) {
    if (!current || current.mod !== e.mod) {
      current = { mod: e.mod, entries: [] };
      out.push(current);
    }
    current.entries.push(e);
  }
  return out;
}

/** Case-insensitive match over every field a user might type. */
export function matchesQuery(e: CatalogueEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    e.label.toLowerCase().includes(q) ||
    e.file.toLowerCase().includes(q) ||
    e.mod.toLowerCase().includes(q) ||
    e.rel.toLowerCase().includes(q)
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
