import type { Mo2Manifest, Mo2MeshOption } from '@/lib/head/faceTexture';
import type { MeshData } from '@/components/scene/useMeshGeometry';
import { CANONICAL_HEAD_URL, CANONICAL_HEAD_VERTICES, CANONICAL_HEAD_TOPOLOGY,
  validateSculptPayload, type SculptPayload } from '@/lib/head/sculptPayload';
import { NECK_SEAM_HEAD_INDICES } from '@/lib/head/neckDeltas';
import {
  loadPersistedHeadOptions,
  savePersistedHeadOptions,
  persistDynamicMesh,
  retrieveAllDynamicMeshes,
} from '@/lib/head/dynamicStorage';

export interface SculptBlock {
  host?: string;
  vertices?: number;
  data?: Array<[number, number, number, number]>;
}

// In-memory registry for dynamic head options and mesh data (restored from persistent storage on startup)
const DYNAMIC_HEAD_OPTIONS: Mo2MeshOption[] = loadPersistedHeadOptions();
const DYNAMIC_MESH_CACHE = new Map<string, MeshData>();
const BASE_MESH_CACHE = new Map<string, MeshData>();
const TRANSIENT_HEAD_IDS = new Set<string>();

export function getDynamicSculptHeads(): Mo2MeshOption[] {
  return DYNAMIC_HEAD_OPTIONS;
}

export function addDynamicHeadOption(option: Mo2MeshOption): void {
  // Prevent duplicate additions
  const idx = DYNAMIC_HEAD_OPTIONS.findIndex((h) => h.id === option.id);
  if (idx !== -1) {
    DYNAMIC_HEAD_OPTIONS.splice(idx, 1);
  }
  DYNAMIC_HEAD_OPTIONS.unshift(option);
  savePersistedHeadOptions(DYNAMIC_HEAD_OPTIONS.filter(head => !TRANSIENT_HEAD_IDS.has(head.id)));
}

export function registerDynamicMesh(url: string, data: MeshData): void {
  DYNAMIC_MESH_CACHE.set(url, data);
  void persistDynamicMesh(url, data);
}

export function getDynamicMesh(url: string): MeshData | undefined {
  return DYNAMIC_MESH_CACHE.get(url);
}

/** Preload all dynamic meshes from IndexedDB into memory on startup. */
export async function preloadDynamicMeshes(): Promise<void> {
  const loaded = await retrieveAllDynamicMeshes();
  for (const [url, data] of loaded) {
    if (!DYNAMIC_MESH_CACHE.has(url)) {
      DYNAMIC_MESH_CACHE.set(url, data);
    }
  }
}

export function registerBaseMesh(url: string, data: MeshData): void {
  BASE_MESH_CACHE.set(url, data);
}

export function clearDynamicSculptCache(): void {
  DYNAMIC_HEAD_OPTIONS.length = 0;
  TRANSIENT_HEAD_IDS.clear();
  DYNAMIC_MESH_CACHE.clear();
  savePersistedHeadOptions([]);
}

/**
 * Normal calculation from indexed triangles with normalized face normals.
 * Matches Skyrim CharGen and the Python sync pipeline.
 */
function computeVertexNormals(positions: Float32Array, indices: number[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];

    const v0x = positions[i0 * 3], v0y = positions[i0 * 3 + 1], v0z = positions[i0 * 3 + 2];
    const v1x = positions[i1 * 3], v1y = positions[i1 * 3 + 1], v1z = positions[i1 * 3 + 2];
    const v2x = positions[i2 * 3], v2y = positions[i2 * 3 + 1], v2z = positions[i2 * 3 + 2];

    const ax = v1x - v0x, ay = v1y - v0y, az = v1z - v0z;
    const bx = v2x - v0x, by = v2y - v0y, bz = v2z - v0z;

    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;

    const fnLen = Math.hypot(nx, ny, nz) || 1.0;
    nx /= fnLen;
    ny /= fnLen;
    nz /= fnLen;

    normals[i0 * 3] += nx; normals[i0 * 3 + 1] += ny; normals[i0 * 3 + 2] += nz;
    normals[i1 * 3] += nx; normals[i1 * 3 + 1] += ny; normals[i1 * 3 + 2] += nz;
    normals[i2 * 3] += nx; normals[i2 * 3 + 1] += ny; normals[i2 * 3 + 2] += nz;
  }

  for (let i = 0; i < normals.length; i += 3) {
    const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
    const len = Math.hypot(nx, ny, nz) || 1.0;
    normals[i] = Math.round((nx / len) * 10000) / 10000;
    normals[i + 1] = Math.round((ny / len) * 10000) / 10000;
    normals[i + 2] = Math.round((nz / len) * 10000) / 10000;
  }

  return normals;
}

/** Displace base mesh positions by RaceMenu .jslot sculpt deltas. */
function applySculptDeltas(base: MeshData, block: SculptBlock, divisor: number): MeshData {
  if (!block.data || !block.data.length || !divisor) {
    return base;
  }

  const pos = new Float32Array(base.positions);
  const scale = 0.01288 / divisor;
  const numVertices = base.positions.length / 3;

  for (let i = 0; i < block.data.length; i++) {
    const pt = block.data[i];
    const vIdx = pt[0];
    if (vIdx >= 0 && vIdx < numVertices) {
      // Swizzle: in RaceMenu FaceGen, pt[1]=X, pt[2]=Y, pt[3]=Z
      // In Three.js / Web coordinate frame: X = pt[1], Y = pt[3], Z = pt[2]
      pos[vIdx * 3 + 0] += pt[1] * scale;
      pos[vIdx * 3 + 1] += pt[3] * scale;
      pos[vIdx * 3 + 2] += pt[2] * scale;
    }
  }

  const normals = computeVertexNormals(pos, base.indices);

  return {
    ...base,
    positions: pos,
    normals,
  };
}

async function fetchBaseMesh(url: string): Promise<MeshData | null> {
  const cached = BASE_MESH_CACHE.get(url);
  if (cached) return cached;

  if (typeof fetch !== 'undefined') {
    try {
      const res = await fetch(url);
      if (res && res.ok) {
        const data = (await res.json()) as MeshData;
        if (data && Array.isArray(data.positions) && Array.isArray(data.indices)) {
          BASE_MESH_CACHE.set(url, data);
          return data;
        }
      }
    } catch (err) {
      console.warn('[dynamicSculpt] failed to load base mesh from:', url, err);
    }
  }
  return null;
}

/** Session-only generated sculpt; never route this through permissive RaceMenu fallbacks. */
export async function replaySculptPayload(payload: SculptPayload, fileName: string): Promise<Mo2MeshOption> {
  const checked = validateSculptPayload(payload);
  if (!checked.ok) throw new Error(checked.reason);
  const base = await fetchBaseMesh(CANONICAL_HEAD_URL);
  if (!base || base.positions.length !== CANONICAL_HEAD_VERTICES * 3 ||
      base.indices.length !== 22044 * 3 || base.uvs.length !== CANONICAL_HEAD_VERTICES * 2 ||
      !Array.from(base.positions).every(Number.isFinite) || !Array.from(base.uvs).every(Number.isFinite) ||
      !base.indices.every(index => Number.isInteger(index) && index >= 0 && index < CANONICAL_HEAD_VERTICES)) {
    throw new Error('Canonical UBE base is missing or invalid; regenerate the preset pack');
  }
  const topology = new DataView(new ArrayBuffer(base.indices.length * 4));
  base.indices.forEach((index, i) => topology.setUint32(i * 4, index, true));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', topology.buffer);
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (fingerprint !== CANONICAL_HEAD_TOPOLOGY) throw new Error('Canonical UBE topology does not match the converter');
  const sculpted = applySculptDeltas(base, checked.payload.morphs.sculpt[0], 10000);
  const protectedIndices = new Set<number>(NECK_SEAM_HEAD_INDICES);
  for (let i = 0; i < CANONICAL_HEAD_VERTICES; i++) {
    if (base.positions[i * 3 + 1] <= -0.105 || base.positions[i * 3 + 2] <= -0.06) protectedIndices.add(i);
  }
  for (const index of protectedIndices) {
    for (let axis = 0; axis < 3; axis++) {
      // Compare as Float32: replay stores positions at the renderer's precision.
      if (Math.fround(base.positions[index * 3 + axis]) !== Math.fround(sculpted.positions[index * 3 + axis])) {
        throw new Error('Sculpt moved a protected neck vertex');
      }
    }
  }
  const normal = (positions: ArrayLike<number>, a: number, b: number, c: number) => {
    const ax = positions[b] - positions[a], ay = positions[b + 1] - positions[a + 1], az = positions[b + 2] - positions[a + 2];
    const bx = positions[c] - positions[a], by = positions[c + 1] - positions[a + 1], bz = positions[c + 2] - positions[a + 2];
    return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  };
  for (let i = 0; i < base.indices.length; i += 3) {
    const [a, b, c] = base.indices.slice(i, i + 3).map(index => index * 3);
    const before = normal(base.positions, a, b, c), after = normal(sculpted.positions, a, b, c);
    if (Math.hypot(...before) > 1e-12 && before.reduce((sum, value, axis) => sum + value * after[axis], 0) <= 0) {
      throw new Error('Sculpt replay contains folded or collapsed triangles');
    }
  }
  const id = `smart-sculpt-${globalThis.crypto.randomUUID()}`;
  const meshUrl = `dynamic://meshes/${id}.json`;
  const option: Mo2MeshOption = {
    id, meshUrl, mod: 'Smart Customization', rel: `Smart/${id}.jslot`, file: fileName,
    label: `${checked.payload.name} (Approximate UBE Sculpt)`, isRealMesh: true,
    origin: 'sculpt-replay', sculptSource: fileName, bytes: 0, version: '1.0', nodes: [],
    shapes: { vertexCount: CANONICAL_HEAD_VERTICES, triangleCount: 22044 },
  };
  // ponytail: core flow is session-only; persist original sculpt payload in Phase 4, not this cache.
  TRANSIENT_HEAD_IDS.add(id);
  DYNAMIC_MESH_CACHE.set(meshUrl, sculpted);
  DYNAMIC_HEAD_OPTIONS.unshift(option);
  return option;
}

export function removeDynamicHeadOption(id: string): void {
  if (!TRANSIENT_HEAD_IDS.delete(id)) return;
  const index = DYNAMIC_HEAD_OPTIONS.findIndex(head => head.id === id);
  if (index < 0) return;
  const [option] = DYNAMIC_HEAD_OPTIONS.splice(index, 1);
  if (option.meshUrl) DYNAMIC_MESH_CACHE.delete(option.meshUrl);
}

/**
 * Resolves a pre-baked head from the manifest, or dynamically replays the
 * external .jslot's sculpt deltas against the neutral base UBE head.
 */
export async function resolveOrBuildSculptHead(
  manifest: Mo2Manifest | null,
  rawJsonText: string,
  fileName: string,
): Promise<Mo2MeshOption | undefined> {
  // 1. Check if an authored or pre-baked head already exists in manifest
  const heads = (manifest?.assets?.headMesh ?? []) as Mo2MeshOption[];
  const wanted = fileName.trim().toLowerCase();
  const existing = heads.find((h) => h.sculptSource?.toLowerCase() === wanted);
  if (existing) {
    return existing;
  }

  // 2. Parse external .jslot JSON
  let jslotData: {
    name?: string;
    morphs?: {
      sculptDivisor?: number;
      sculpt?: SculptBlock[];
      custom?: Array<{ name: string; value: number }>;
    };
  };

  try {
    jslotData = JSON.parse(rawJsonText);
  } catch {
    return undefined;
  }

  const sculptBlocks = jslotData.morphs?.sculpt ?? [];
  const divisor = jslotData.morphs?.sculptDivisor ?? 10000;

  // 3. Find base UBE head mesh URL
  const packMode = manifest?.sourceLayout === 'pack';
  const defaultHeadUrl = packMode
    ? '/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json'
    : '/assets/mo2/head/ube-2-0-u0-7-ube-femalehead-tangent.json';

  const baseHeadOption = heads.find(
    (h) => !h.sculptSource && (h.file.toLowerCase().includes('femalehead') || h.file.toLowerCase().endsWith('.tri'))
  );
  const headUrl = baseHeadOption?.meshUrl ?? defaultHeadUrl;

  // If no sculpt blocks exist at all, return the neutral UBE base head
  const headBlock = sculptBlocks.find(
    (b) => b.host && b.host.toLowerCase().includes('head') && !b.host.toLowerCase().includes('brow')
  );

  if (!headBlock || !headBlock.data?.length) {
    return baseHeadOption ?? {
      id: 'ube-base-neutral-head',
      mod: 'UBE',
      rel: 'UBE/FemaleHead.tri',
      file: 'FemaleHead.tri',
      label: 'UBE Neutral Default Head',
      meshUrl: headUrl,
      isRealMesh: true,
      bytes: 0,
      version: '1.0',
      nodes: [],
      shapes: { vertexCount: 11498, triangleCount: 22044 },
    };
  }

  // Check UBE compatibility: Vanilla/CBBE head has 996 vertices, High Poly Head has 3,832 vertices.
  // UBE has 11,498 vertices. Replaying Vanilla/HPH deltas on UBE geometry would distort vertex IDs.
  const isUbeCompatible =
    headBlock.host?.toLowerCase().includes('ube') ||
    headBlock.data.some((pt) => pt[0] > 4000);

  if (!isUbeCompatible) {
    return baseHeadOption ?? {
      id: 'ube-base-neutral-head',
      mod: 'UBE',
      rel: 'UBE/FemaleHead.tri',
      file: 'FemaleHead.tri',
      label: 'UBE Neutral Default Head',
      meshUrl: headUrl,
      isRealMesh: true,
      bytes: 0,
      version: '1.0',
      nodes: [],
      shapes: { vertexCount: 11498, triangleCount: 22044 },
    };
  }

  // 4. Load base UBE head geometry
  const baseHeadData = await fetchBaseMesh(headUrl);
  if (!baseHeadData) {
    console.error('[dynamicSculpt] Could not fetch base UBE head from', headUrl);
    return undefined;
  }

  // 5. Apply sculpt deltas to head
  const sculptedHead = applySculptDeltas(baseHeadData, headBlock, divisor);

  // Generate dynamic mesh URLs
  const safeStem = fileName.replace(/\.jslot$/i, '').trim();
  const timestamp = Date.now();
  const headMeshId = `dynamic-sculpt-${safeStem.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}-${timestamp}`;
  const dynamicHeadUrl = `dynamic://meshes/${headMeshId}.json`;

  registerDynamicMesh(dynamicHeadUrl, sculptedHead);

  // 6. Check companion parts (eyes, lashes, brows, mouth) and sculpt them if present
  let eyeMeshUrl: string | undefined;
  let lashesMeshUrl: string | undefined;
  let browsMeshUrl: string | undefined;
  let mouthMeshUrl: string | undefined;

  const companionSpecs: Array<{
    kind: 'eyeMesh' | 'lashesMesh' | 'browsMesh' | 'mouthMesh';
    pattern: RegExp;
    defaultUrl: string;
    assign: (url: string) => void;
  }> = [
    {
      kind: 'eyeMesh',
      pattern: /eyesfemalechargen|eye(?!.*(?:outer|shadow|lens|lash|brow))/i,
      defaultUrl: packMode
        ? '/assets/preset-pack/meshes/eyeMesh-3ae8c50ea0f8caad.json'
        : '/assets/mo2/eyes/ube-eyes.json',
      assign: (u) => { eyeMeshUrl = u; },
    },
    {
      kind: 'lashesMesh',
      pattern: /lash/i,
      defaultUrl: packMode
        ? '/assets/preset-pack/meshes/lashesMesh-1cb18e62265020cc.json'
        : '/assets/mo2/eyes/ube-lashes.json',
      assign: (u) => { lashesMeshUrl = u; },
    },
    {
      kind: 'browsMesh',
      pattern: /brow/i,
      defaultUrl: packMode
        ? '/assets/preset-pack/meshes/browsMesh-81d3235798cd7065.json'
        : '/assets/mo2/brows/ube-brows.json',
      assign: (u) => { browsMeshUrl = u; },
    },
    {
      kind: 'mouthMesh',
      pattern: /mouth/i,
      defaultUrl: packMode
        ? '/assets/preset-pack/meshes/mouthMesh-479b956af5879125.json'
        : '/assets/mo2/mouth/ube-mouth.json',
      assign: (u) => { mouthMeshUrl = u; },
    },
  ];

  for (const comp of companionSpecs) {
    const block = sculptBlocks.find((b) => b.host && comp.pattern.test(b.host));
    if (!block || !block.data?.length) continue;

    const compBase = await fetchBaseMesh(comp.defaultUrl);
    if (!compBase) continue;

    const sculptedComp = applySculptDeltas(compBase, block, divisor);
    const compUrl = `dynamic://meshes/${headMeshId}-${comp.kind}.json`;
    registerDynamicMesh(compUrl, sculptedComp);
    comp.assign(compUrl);
  }

  // 7. Register and return the dynamic head option
  const dynamicOption: Mo2MeshOption = {
    id: headMeshId,
    mod: 'RaceMenu',
    rel: `RaceMenu/${fileName}`,
    file: fileName,
    label: `${safeStem} (Custom Sculpt)`,
    meshUrl: dynamicHeadUrl,
    isRealMesh: true,
    sculptSource: fileName,
    origin: 'sculpt-replay',
    bytes: 0,
    version: '1.0',
    nodes: [],
    shapes: {
      vertexCount: sculptedHead.positions.length / 3,
      triangleCount: sculptedHead.indices.length / 3,
    },
    eyeMeshUrl,
    lashesMeshUrl,
    browsMeshUrl,
    mouthMeshUrl,
  };

  addDynamicHeadOption(dynamicOption);

  return dynamicOption;
}
