import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { CatalogueEntry, CatalogueIndex, ConvertMode } from '@/lib/mo2/types';
import { CONVERT_MODES, KIND_TO_CATALOGUE } from '@/lib/mo2/types';
import { ASSET_SOURCE } from '@/lib/mo2/assetSource';

/**
 * Server-side catalogue + converter. Never imported by a client component.
 *
 * The archive is the user's live MO2 install: read-only, ~81 GB, and full of
 * paths with `[ ] ' ! # ( )` and one Korean filename. Nothing is copied out of
 * it except the single file a request asks for, transcoded into `cache/`.
 */

const PROJECT_ROOT = process.cwd();
const MODS_ROOT = ASSET_SOURCE.root;
const PUBLIC = ASSET_SOURCE.output;
const CATALOGUE_DIR = path.join(PUBLIC, 'catalogue');
const CACHE_DIR = path.join(PUBLIC, 'cache');
const WORKER = path.join(PROJECT_ROOT, 'scripts', 'convert_worker.py');

/** Conversions in flight, keyed by cache path, so a thumbnail burst that hits
 *  the same file 20 times runs the decoder once. */
const inflight = new Map<string, Promise<ConvertResult>>();

/** Python decodes are CPU-bound and disk-heavy; two at a time keeps the UI
 *  responsive while a list of thumbnails loads. */
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<() => void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return () => {
      running -= 1;
      waiting.shift()?.();
    };
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  return () => {
    running -= 1;
    waiting.shift()?.();
  };
}

export interface ConvertResult {
  bytes: Buffer;
  mime: string;
  iris?: { cx: number; cy: number; r: number; measured: boolean };
  vertexCount?: number;
  triangleCount?: number;
}

interface CatalogueRoot {
  available: boolean;
  source: string;
  sourceId?: string;
  sourceKey?: string;
  sourceLayout?: 'pack' | 'mo2';
  diagnostics?: string[];
  generatedAt?: string;
  kinds: Record<string, { count: number; file: string }>;
}

function sourceMatches(doc: { sourceId?: string; sourceLayout?: string; sourceKey?: string }): boolean {
  return ASSET_SOURCE.layout === 'mo2'
    ? !doc.sourceId || doc.sourceId === ASSET_SOURCE.id
    : doc.sourceId === ASSET_SOURCE.id && doc.sourceLayout === 'pack' && doc.sourceKey === ASSET_SOURCE.key;
}

export async function readManifest(): Promise<unknown> {
  const doc = JSON.parse(await fs.readFile(path.join(PUBLIC, 'manifest.json'), 'utf8'));
  if (!sourceMatches(doc)) throw new Error('Manifest source mismatch; regenerate assets');
  return { ...doc, source: ASSET_SOURCE.label, sourceId: ASSET_SOURCE.id,
    sourceLayout: ASSET_SOURCE.layout, sourceKey: ASSET_SOURCE.key };
}

/* ── catalogue ─────────────────────────────────────────────────────────── */

const listCache = new Map<string, { mtimeMs: number; entries: CatalogueEntry[] }>();

export async function readCatalogueIndex(): Promise<CatalogueIndex> {
  const p = path.join(PUBLIC, 'catalogue.json');
  try {
    const doc = JSON.parse(await fs.readFile(p, 'utf8')) as CatalogueRoot;
    if (!sourceMatches(doc)) throw new Error('Catalogue source mismatch; regenerate assets');
    return {
      available: Boolean(doc.available),
      source: ASSET_SOURCE.label,
      sourceId: ASSET_SOURCE.id,
      sourceLayout: ASSET_SOURCE.layout,
      diagnostics: doc.diagnostics,
      generatedAt: doc.generatedAt,
      kinds: Object.fromEntries(
        Object.entries(doc.kinds ?? {}).map(([k, v]) => [k, v.count]),
      ),
    };
  } catch {
    return { available: false, source: ASSET_SOURCE.label, sourceId: ASSET_SOURCE.id, sourceLayout: ASSET_SOURCE.layout, kinds: {} };
  }
}

/** One category's entries, cached until the file's mtime changes. */
export async function readCatalogue(kind: string): Promise<CatalogueEntry[]> {
  const file = KIND_TO_CATALOGUE[kind];
  if (!file || !(await readCatalogueIndex()).available) return [];
  const p = path.join(CATALOGUE_DIR, `${file}.json`);
  let st;
  try {
    st = await fs.stat(p);
  } catch {
    return [];
  }
  const hit = listCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.entries;
  try {
    const entries = JSON.parse(await fs.readFile(p, 'utf8')) as CatalogueEntry[];
    listCache.set(file, { mtimeMs: st.mtimeMs, entries });
    return entries;
  } catch {
    return [];
  }
}

/** Find one entry, refusing anything the catalogue did not record. This is the
 *  whitelist: an id that is not in the index cannot name a path at all. */
export async function findEntry(
  kind: string,
  id: string,
  mapRole?: string | null,
): Promise<CatalogueEntry | null> {
  const entries = await readCatalogue(kind);
  const matches = entries.filter((e) => e.id === id);
  if (!matches.length) return null;
  if (mapRole) {
    const exact = matches.find((e) => (e.mapRole ?? 'albedo') === mapRole);
    if (exact) return exact;
  }
  return matches[0];
}

/* ── path containment ──────────────────────────────────────────────────── */

/**
 * Resolve a catalogue `rel` under the source (MO2 includes its mod folder;
 * pack paths start at the Data-like root) and prove it did not leave.
 *
 * `path.resolve` normalises `..`, but a junction or symlink planted inside the
 * archive still escapes; `realpath` is what catches that. Both the resolved and
 * the real path must sit under the real archive root.
 */
export async function resolveArchivePath(entry: CatalogueEntry): Promise<string | null> {
  const rootReal = await fs.realpath(MODS_ROOT).catch(() => null);
  if (!rootReal) return null;

  const candidate = path.resolve(rootReal, entry.rel.replace(/\\/g, '/'));
  const rel = path.relative(rootReal, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  const real = await fs.realpath(candidate).catch(() => null);
  if (!real) return null;
  const realRel = path.relative(rootReal, real);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) return null;

  const stat = await fs.stat(real).catch(() => null);
  if (!stat?.isFile()) return null;
  return real;
}

/* ── conversion ────────────────────────────────────────────────────────── */

function cachePath(kind: string, id: string, mode: ConvertMode, role?: string | null): string {
  const ext = mode === 'alpha' || mode === 'normal' ? 'png' : mode === 'mesh' ? 'json' : 'webp';
  // One id can carry several `mapRole` rows (a DDS and its `_n` companion share
  // a stem-derived id family); the role belongs in the key or they overwrite
  // each other. The frame too: the same tri in a different frame is different
  // geometry.
  const suffix = role ? `-${role}` : '';
  return path.join(CACHE_DIR, kind, `${id}${suffix}-${mode}.${ext}`);
}

/** Pack NIFs the producer decoded as an authored mesh (groups + materials). */
function wantsAuthored(entry: CatalogueEntry, mode: ConvertMode): boolean {
  return (
    ASSET_SOURCE.layout === 'pack' &&
    mode === 'mesh' &&
    entry.authored === true &&
    /\.nif$/i.test(entry.file)
  );
}

function mimeFor(mode: ConvertMode): string {
  if (mode === 'mesh') return 'application/json';
  if (mode === 'alpha' || mode === 'normal') return 'image/png';
  return 'image/webp';
}

/** Cache is valid while the source and the converter are both older than it. */
async function cachedIsFresh(cacheFile: string, sourceFile: string): Promise<boolean> {
  try {
    const [c, s, w, catalogue] = await Promise.all([
      fs.stat(cacheFile),
      fs.stat(sourceFile),
      fs.stat(WORKER),
      ASSET_SOURCE.layout === 'pack' ? fs.stat(path.join(PUBLIC, 'catalogue.json')) : Promise.resolve(null),
    ]);
    return c.mtimeMs >= s.mtimeMs && c.mtimeMs >= w.mtimeMs && (!catalogue || c.mtimeMs >= catalogue.mtimeMs);
  } catch {
    return false;
  }
}

async function mapAuthoredTextures(file: string, skinOnly = false): Promise<void> {
  const mesh = JSON.parse(await fs.readFile(file, 'utf8'));
  if (mesh.authored !== true || !Array.isArray(mesh.materials)) throw new Error('Invalid authored mesh');
  if (skinOnly) {
    const skinIndices = mesh.materials.flatMap((material: { role?: string }, i: number) => material.role === 'skin' ? [i] : []);
    if (skinIndices.length !== 1) throw new Error('Outfit body shape is ambiguous');
    const index = skinIndices[0];
    const indices: number[] = [];
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
    const skinIndex: number[] = [], skinWeight: number[] = [];
    const remap = new Map<number, number>();
    for (const group of mesh.groups ?? []) {
      if (group.materialIndex !== index) continue;
      for (const vertex of mesh.indices.slice(group.start, group.start + group.count)) {
        if (!remap.has(vertex)) {
          remap.set(vertex, remap.size);
          positions.push(...mesh.positions.slice(vertex * 3, vertex * 3 + 3));
          normals.push(...mesh.normals.slice(vertex * 3, vertex * 3 + 3));
          uvs.push(...mesh.uvs.slice(vertex * 2, vertex * 2 + 2));
          /* The body is skinned like the rest of the outfit; the re-index
             must carry each copied vertex's four bone indices/weights with
             it or the extracted body renders in bind pose while the garment
             follows the skeleton. */
          if (Array.isArray(mesh.skinIndex) && Array.isArray(mesh.skinWeight)) {
            skinIndex.push(...mesh.skinIndex.slice(vertex * 4, vertex * 4 + 4));
            skinWeight.push(...mesh.skinWeight.slice(vertex * 4, vertex * 4 + 4));
          }
        }
        indices.push(remap.get(vertex)!);
      }
    }
    if (!indices.length) throw new Error('Outfit body shape is empty');
    Object.assign(mesh, { positions, normals, uvs, indices, vertexCount: remap.size, triangleCount: indices.length / 3,
      materials: [mesh.materials[index]], groups: [{ start: 0, count: indices.length, materialIndex: 0 }] });
    if (skinIndex.length === remap.size * 4) {
      Object.assign(mesh, { skinIndex, skinWeight });
    } else if (mesh.bones) {
      // A skeleton with no weights would make `SkinnedPart` bind garbage; drop
      // both so the body draws as a plain mesh instead.
      delete mesh.bones;
      delete mesh.skinIndex;
      delete mesh.skinWeight;
    }
  }
  const entries = (await Promise.all(Object.keys(KIND_TO_CATALOGUE).map(readCatalogue))).flat();
  const byRel = new Map<string, CatalogueEntry | null>();
  for (const entry of entries) {
    const rel = entry.rel.replace(/\\/g, '/').toLowerCase();
    byRel.set(rel, entry);
    // NIF refs stay Data-relative; category folders are storage, not shader paths.
    const virtual = rel.replace(/^[^/]+\/(?=textures\/)/, '');
    if (virtual !== rel) byRel.set(virtual, byRel.has(virtual) ? null : entry);
  }
  for (const material of mesh.materials) {
    for (const [slot, field] of [['albedo', 'texture'], ['normal', 'normalTexture']] as const) {
      delete material[field];
      const ref = material.textureRefs?.[slot];
      if (ref == null) continue;
      if (typeof ref !== 'string') throw new Error('Invalid authored texture reference');
      const entry = byRel.get(ref.replace(/\\/g, '/').toLowerCase());
      /* Resolve only refs the pack actually supplied. A missing/already
         refused ref is dropped from the JSON; the renderer draws that shape
         flat grey. Valid refs (e.g. an outfit's embedded body skin) survive. */
      if (!entry || entry.decodable === false || entry.untextured === true || entry.unavailable || entry.available === false || !(await resolveArchivePath(entry))) continue;
      const mode = slot === 'normal' ? 'normal' : 'atlas';
      material[field] = `/api/mo2/convert?${new URLSearchParams({ kind: entry.kind, id: entry.id, mode, role: slot })}`;
    }
  }
  await fs.writeFile(file, JSON.stringify(mesh));
}

async function runWorker(
  kind: string,
  entry: CatalogueEntry,
  mode: ConvertMode,
  dst: string,
  role?: string | null,
): Promise<ConvertResult> {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  const tmp = `${dst}.${process.pid}.${Date.now()}.tmp`;

  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      process.env.MO2_PYTHON ?? 'python',
      [
        '-I',
        WORKER,
        '--kind', kind,
        '--mode', mode,
        '--rel', entry.rel,
        '--mods', MODS_ROOT,
        '--out', tmp,
        // The frame is an authored fact from the catalogue, never inferred.
        ...(mode === 'mesh' ? ['--frame', entry.meshFrame ?? 'head'] : []),
        // `--authored` is for the NIFs the pack producer validated with its
        // own decoder — authored hair and the outfit. The canonical Skyrim
        // parts (`femalebody_0/1.nif`, the faceparts) decode with the FLAT
        // decoder and fail under `--authored`, so the producer's flag is the
        // only safe signal. Guessing by extension served 500s.
        ...(wantsAuthored(entry, mode) ? ['--authored'] : []),
      ],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, out, errOut) => {
        if (err) {
          reject(new Error(`converter failed: ${String(errOut).slice(0, 500) || err.message}`));
          return;
        }
        resolve(String(out));
      },
    );
  }).catch(async (error) => {
    await fs.unlink(tmp).catch(() => {});
    throw error;
  });

  let meta: { ok?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    meta = JSON.parse(stdout.trim().split('\n').pop() ?? '{}');
  } catch {
    /* the worker always prints one JSON line, but a crash should not throw here */
  }
  if (!meta.ok) {
    await fs.unlink(tmp).catch(() => {});
    throw new Error(meta.error ? String(meta.error) : 'converter returned no result');
  }

  // Atomic publish: a reader never sees a half-written file, and a concurrent
  // request either hits the finished cache or waits on the inflight map.
  try {
    if (wantsAuthored(entry, mode)) {
      await mapAuthoredTextures(tmp, entry.geometryRole === 'skin');
    }
    await fs.rename(tmp, dst);
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
  const bytes = await fs.readFile(dst);

  return {
    bytes,
    mime: mimeFor(mode),
    iris: meta.iris as ConvertResult['iris'],
    vertexCount: meta.vertexCount as number | undefined,
    triangleCount: meta.triangleCount as number | undefined,
  };
}

export async function convert(
  kind: string,
  entry: CatalogueEntry,
  mode: ConvertMode,
  role?: string | null,
): Promise<ConvertResult> {
  if (!CONVERT_MODES.includes(mode)) throw new Error(`unsupported mode: ${mode}`);
  if (!KIND_TO_CATALOGUE[kind] || !/^[a-zA-Z0-9_-]+$/.test(entry.id)) throw new Error('invalid cache identity');
  if (role && !/^[a-z]+$/.test(role)) throw new Error('invalid map role');

  const source = await resolveArchivePath(entry);
  if (!source) throw new Error('source file is outside the archive or missing');

  const dst = cachePath(kind, entry.id, mode, role);

  if (await cachedIsFresh(dst, source)) {
    return { bytes: await fs.readFile(dst), mime: mimeFor(mode) };
  }

  const key = dst;
  const existing = inflight.get(key);
  if (existing) return existing;

  const job = (async () => {
    const release = await acquire();
    try {
      return await runWorker(kind, entry, mode, dst, role);
    } finally {
      release();
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

/* ── mesh resolution ───────────────────────────────────────────────────── */

/** Find the decodable geometry behind a mesh entry, by authored convention.
 *
 *  A `.nif` cannot be decoded, so a mesh row that names one is served from a
 *  `.tri`/`.obj` that belongs to it: the same stem, then the same directory and
 *  kind, then the mod's single decodable peer. Anything else returns null —
 *  never a sibling from a different mod, which would render another part.
 */
export async function companionGeometry(
  entry: CatalogueEntry,
  kind: string,
): Promise<CatalogueEntry | null> {
  if (entry.decodable !== false && /\.(tri|obj|nif)$/i.test(entry.file)) return entry;

  const peers = (await readCatalogue(kind)).filter(
    (e) => e.mod === entry.mod && e.decodable !== false && /\.(tri|obj|nif)$/i.test(e.file),
  );
  if (!peers.length) return null;
  if (peers.length === 1) return peers[0];

  const dir = path.posix.dirname(entry.rel.replace(/\\/g, '/'));
  const stem = path.posix.basename(entry.rel, path.posix.extname(entry.rel)).toLowerCase();

  const sameStem = peers.find(
    (t) => path.posix.basename(t.rel.replace(/\\/g, '/'), path.posix.extname(t.rel)).toLowerCase() === stem,
  );
  if (sameStem) return sameStem;

  const sameDir = peers.find((t) => path.posix.dirname(t.rel.replace(/\\/g, '/')) === dir);
  if (sameDir) return sameDir;

  return peers[0];
}

/** Back-compat wrapper for the head picker's original naming. */
export async function companionTri(entry: CatalogueEntry): Promise<CatalogueEntry | null> {
  return companionGeometry(entry, 'headMesh');
}

export function hashId(parts: string[]): string {
  return createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 16);
}

export const PATHS = { PROJECT_ROOT, MODS_ROOT, PUBLIC, CACHE_DIR, WORKER };

export function archivePresent(): boolean {
  return existsSync(MODS_ROOT);
}
