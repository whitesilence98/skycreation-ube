import type { Mo2Manifest, Mo2MeshOption } from '@/lib/head/faceTexture';
import type { MeshData } from '@/components/scene/useMeshGeometry';

export interface SculptBlock {
  host?: string;
  vertices?: number;
  data?: Array<[number, number, number, number]>;
}

// In-memory registry for dynamic head options and mesh data
const DYNAMIC_HEAD_OPTIONS: Mo2MeshOption[] = [];
const DYNAMIC_MESH_CACHE = new Map<string, MeshData>();
const BASE_MESH_CACHE = new Map<string, MeshData>();

export function getDynamicSculptHeads(): Mo2MeshOption[] {
  return DYNAMIC_HEAD_OPTIONS;
}

export function registerDynamicMesh(url: string, data: MeshData): void {
  DYNAMIC_MESH_CACHE.set(url, data);
}

export function getDynamicMesh(url: string): MeshData | undefined {
  return DYNAMIC_MESH_CACHE.get(url);
}

export function registerBaseMesh(url: string, data: MeshData): void {
  BASE_MESH_CACHE.set(url, data);
}

export function clearDynamicSculptCache(): void {
  DYNAMIC_HEAD_OPTIONS.length = 0;
  DYNAMIC_MESH_CACHE.clear();
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

  // Add to in-memory heads list so manifest lookups find it
  DYNAMIC_HEAD_OPTIONS.unshift(dynamicOption);

  return dynamicOption;
}
