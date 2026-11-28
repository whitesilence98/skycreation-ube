/**
 * lib/morphs/ubeMorphLoader.ts
 *
 * Lazy-loading manager and CPU delta accumulator for all 407 extended UBE 2.0
 * `John/*.tri` sculpt sliders (`pers`, `face`, `brow`, `eyes`, `nose`, `lip`, `ear`)
 * plus paired `Wick/*` companion `.tri` meshes (`eyes`, `lashes`, `brows`, `mouth`).
 */

import { parseTri, type TriData } from '@/lib/morphs/triParser';

export type UbeMorphCategoryId = 'pers' | 'face' | 'brow' | 'eyes' | 'nose' | 'lip' | 'ear';
export type UbeTriPartKey = 'head' | 'eyes' | 'lashes' | 'brows' | 'mouth';

export interface UbeSliderMeta {
  name: string;
  label: string;
}

export interface UbeCategoryIndex {
  id: UbeMorphCategoryId;
  label: string;
  count: number;
  files: Partial<Record<UbeTriPartKey, string>>;
  sliders: UbeSliderMeta[];
}

export interface UbeMorphIndex {
  version: number;
  headSeamMap11761: number[];
  categories: UbeCategoryIndex[];
  morphToCategory: Record<string, UbeMorphCategoryId>;
  iniSliders?: Record<string, [string, string]>;
}

export type LoadedUbeCategory = Partial<Record<UbeTriPartKey, TriData>>;

const INDEX_URL = '/assets/morphs/ube/index.json';
let indexPromise: Promise<UbeMorphIndex | null> | null = null;
let indexCache: UbeMorphIndex | null = null;
const categoryCache = new Map<UbeMorphCategoryId, Promise<LoadedUbeCategory>>();
const loadedCategories = new Map<UbeMorphCategoryId, LoadedUbeCategory>();

export async function loadUbeMorphIndex(): Promise<UbeMorphIndex | null> {
  if (indexCache) return indexCache;
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    try {
      const res = await fetch(INDEX_URL);
      if (!res.ok) return null;
      const parsed = (await res.json()) as UbeMorphIndex;
      if (!parsed?.categories?.length) return null;
      indexCache = parsed;
      return parsed;
    } catch {
      return null;
    }
  })();
  return indexPromise;
}

export function getCachedUbeMorphIndex(): UbeMorphIndex | null {
  return indexCache;
}

async function fetchTriFile(url: string): Promise<TriData | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return parseTri(buf);
  } catch {
    return null;
  }
}

export async function loadUbeCategory(catId: UbeMorphCategoryId): Promise<LoadedUbeCategory> {
  const existing = loadedCategories.get(catId);
  if (existing) return existing;
  const inflight = categoryCache.get(catId);
  if (inflight) return inflight;

  const p = (async () => {
    const index = await loadUbeMorphIndex();
    const cat = index?.categories.find((c) => c.id === catId);
    if (!cat) return {};

    const entries = Object.entries(cat.files) as Array<[UbeTriPartKey, string]>;
    const results = await Promise.all(entries.map(async ([part, url]) => [part, await fetchTriFile(url)] as const));
    const loaded: LoadedUbeCategory = {};
    for (const [part, data] of results) {
      if (data) loaded[part] = data;
    }
    loadedCategories.set(catId, loaded);
    return loaded;
  })();

  categoryCache.set(catId, p);
  return p;
}

export function getLoadedUbeCategory(catId: UbeMorphCategoryId): LoadedUbeCategory | undefined {
  return loadedCategories.get(catId);
}

/**
 * Ensures every category referenced by non-zero entries in `ubeMorphs` is fetched and cached.
 * Returns `true` if any new category finished loading.
 */
export async function ensureActiveUbeCategories(ubeMorphs: Record<string, number>): Promise<boolean> {
  const activeNames = Object.entries(ubeMorphs)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > 0.001)
    .map(([k]) => k);
  if (activeNames.length === 0) return false;

  const index = await loadUbeMorphIndex();
  if (!index) return false;

  const needed = new Set<UbeMorphCategoryId>();
  for (const name of activeNames) {
    const cat = index.morphToCategory[name];
    if (cat && !loadedCategories.has(cat)) {
      needed.add(cat);
    }
  }
  if (needed.size === 0) return false;

  await Promise.all(Array.from(needed, (cat) => loadUbeCategory(cat)));
  return true;
}

/**
 * Adds weighted UBE `John/*.tri` + `Wick/*.tri` morph deltas into `target` positions.
 * Handles both native `11498`-vertex sculpt heads and UV-split `11761`-vertex pack heads.
 */
export function accumulateUbeMorphDeltas(
  target: Float32Array,
  vertCount: number,
  part: UbeTriPartKey,
  ubeMorphs: Record<string, number>,
): void {
  const index = indexCache;
  if (!index) return;

  const seamMap = part === 'head' && vertCount === 11761 ? index.headSeamMap11761 : null;
  const active = Object.entries(ubeMorphs);

  for (let i = 0; i < active.length; i++) {
    const [name, weight] = active[i];
    if (!weight || !Number.isFinite(weight) || Math.abs(weight) <= 0.001) continue;

    const catId = index.morphToCategory[name];
    if (!catId) continue;
    const loadedCat = loadedCategories.get(catId);
    const tri = loadedCat?.[part];
    if (!tri) continue;

    const morph = tri.morphs.get(name);
    if (!morph) continue;

    const deltas = morph.deltas;
    if (seamMap && tri.header.numVerts === 11498 && seamMap.length === vertCount) {
      for (let v = 0; v < vertCount; v++) {
        const src = seamMap[v] * 3;
        const dst = v * 3;
        target[dst] += deltas[src] * weight;
        target[dst + 1] += deltas[src + 1] * weight;
        target[dst + 2] += deltas[src + 2] * weight;
      }
    } else if (tri.header.numVerts === vertCount) {
      const coordCount = vertCount * 3;
      for (let c = 0; c < coordCount; c++) {
        target[c] += deltas[c] * weight;
      }
    }
  }
}
