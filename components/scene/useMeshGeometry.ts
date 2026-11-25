'use client';

/**
 * Shared loading for the MO2 part meshes and their textures.
 *
 * Every part (head, eyes, lashes, brows, mouth, body, authored hair) used to
 * repeat the same fetch → `BufferGeometry` → dispose block. Centralising it
 * here is what keeps the new URL-driven parts from re-introducing the leak the
 * old guard prevented: a geometry/texture state is tagged with the URL it came
 * from, so the moment the selection changes the previous resource is neither
 * shown nor kept, and it is disposed when it is replaced.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { getDynamicMesh, registerDynamicMesh } from '@/lib/head/dynamicSculpt';
import { retrieveDynamicMesh } from '@/lib/head/dynamicStorage';
import { BODY_WEIGHT_ENABLED } from '@/lib/store';

export interface MeshGroup {
  start: number;
  count: number;
  /** Index into `MeshData.materials`. */
  materialIndex: number;
}

export type MaterialRole = 'skin' | 'hair' | 'clothing' | 'accessory';

const MATERIAL_ROLES: readonly MaterialRole[] = ['skin', 'hair', 'clothing', 'accessory'];

/**
 * One bone of a pack mesh's embedded skeleton, in NIF space.
 *
 * `world` is the bone's rest matrix as a row-major 3×4 — world, not local,
 * because the NIFs disagree about hierarchy (an outfit ships the body chain, a
 * hairstyle ships the NPC bones flat under `Scene Root`). World rest is the one
 * representation every mesh in the pack agrees on, so it is what crosses the
 * wire; the renderer rebuilds whatever hierarchy it likes from it.
 */
export interface MeshBone {
  name: string;
  /** Parent node name, or null for a root. */
  parent: string | null;
  /** Row-major 3×4 world rest matrix. */
  world: number[];
}

/**
 * One authored material slot. The producer resolves a shape's trusted shader
 * texture references into `texture`/`normalTexture` URLs; an absent albedo
 * means that shape is unavailable and its group is hidden.
 */
export interface MeshMaterialSpec {
  name: string;
  role: MaterialRole;
  texture?: string;
  normalTexture?: string;
  /** Authored cutout threshold; absent means the role's default. */
  alphaTest?: number;
  /** Authored two-sided flag; absent means the role's default. */
  doubleSided?: boolean;
}

export interface MeshData {
  positions: number[] | Float32Array;
  normals: number[] | Float32Array;
  uvs: number[] | Float32Array;
  indices: number[];
  /** Authored draw ranges. Absent on the single-material TRI JSON. */
  groups?: MeshGroup[];
  /** Authored material descriptors, required when `groups` is present. */
  materials?: MeshMaterialSpec[];
  /** The NIF's embedded skeleton. Present with `skinIndex`/`skinWeight`. */
  bones?: MeshBone[];
  /** Four bone indices per vertex. */
  skinIndex?: number[] | Float32Array;
  /** Four bone weights per vertex, summing to 1. */
  skinWeight?: number[] | Float32Array;
}

export interface LoadedMesh {
  geometry: THREE.BufferGeometry;
  /** The same vertices as the attribute, for the head's sculpt/pose code. */
  positions: Float32Array;
  groups?: MeshGroup[];
  materials?: MeshMaterialSpec[];
  /** Present when the producer decoded the mesh's skinning data. */
  bones?: MeshBone[];
}

const isNumbers = (v: unknown): v is ArrayLike<number> =>
  Array.isArray(v) || v instanceof Float32Array;

function allNumbers(values: ArrayLike<number>, valid: (value: number) => boolean): boolean {
  for (let i = 0; i < values.length; i++) {
    if (!valid(values[i])) return false;
  }
  return true;
}


/** The producer emits local, catalogue-resolved URLs only. Anything else in a
 *  mesh payload is either a corrupt file or an attempt to widen the renderer's
 *  network reach, and is rejected rather than fetched. */
function isLocalAssetUrl(v: unknown): v is string {
  return typeof v === 'string' && (v.startsWith('/assets/') || v.startsWith('/api/mo2/convert?') || v.startsWith('dynamic://'));
}

function isOptionalUrl(v: unknown): boolean {
  return v === undefined || isLocalAssetUrl(v);
}

function validMaterial(m: unknown): m is MeshMaterialSpec {
  if (!m || typeof m !== 'object') return false;
  const spec = m as Partial<MeshMaterialSpec>;
  if (typeof spec.name !== 'string' || !spec.name) return false;
  if (typeof spec.role !== 'string' || !MATERIAL_ROLES.includes(spec.role as MaterialRole)) return false;
  if (!isOptionalUrl(spec.texture) || !isOptionalUrl(spec.normalTexture)) return false;
  if (spec.alphaTest !== undefined &&
      (typeof spec.alphaTest !== 'number' || !Number.isFinite(spec.alphaTest) ||
       spec.alphaTest < 0 || spec.alphaTest > 1)) return false;
  if (spec.doubleSided !== undefined && typeof spec.doubleSided !== 'boolean') return false;
  return true;
}

function validGroups(data: MeshData): data is MeshData & { materials: MeshMaterialSpec[] } {
  if (data.groups === undefined) return true;
  if (!Array.isArray(data.groups) || !data.groups.length) return false;
  if (!Array.isArray(data.materials) || !data.materials.length) return false;
  if (!data.materials.every(validMaterial)) return false;
  const indexCount = data.indices.length;
  let cursor = 0;
  const used = new Set<number>();
  for (const g of data.groups) {
    if (!g || !Number.isInteger(g.start) || !Number.isInteger(g.count) || !Number.isInteger(g.materialIndex)) return false;
    if (g.start < 0 || g.count <= 0 || g.start + g.count > indexCount) return false;
    /* Draw ranges are triangles, never stray indices. */
    if (g.start % 3 !== 0 || g.count % 3 !== 0) return false;
    if (g.materialIndex < 0 || g.materialIndex >= data.materials.length) return false;
    /* Groups must partition the index buffer in order: a gap renders as an
       untextured hole, an overlap z-fights two materials. */
    if (g.start !== cursor) return false;
    cursor += g.count;
  }
  return cursor === indexCount;
}

function validBones(bones: unknown): bones is MeshBone[] {
  if (!Array.isArray(bones) || !bones.length) return false;
  const names = new Set<string>();
  for (const b of bones) {
    if (!b || typeof b !== 'object') return false;
    const bone = b as Partial<MeshBone>;
    if (typeof bone.name !== 'string' || !bone.name || names.has(bone.name)) return false;
    names.add(bone.name);
    if (!Array.isArray(bone.world) || bone.world.length !== 12) return false;
    if (!bone.world.every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  }
  /* Every named parent must resolve inside this same list, or the bone would
     silently detach and its vertices would fall back to the root. */
  return bones.every((b) => {
    const parent = (b as Partial<MeshBone>).parent;
    return parent === null || parent === undefined || names.has(parent);
  });
}

/** Pure decode step, exported so the lifecycle check can run it headlessly. */
export function meshDataToGeometry(data: MeshData): LoadedMesh {
  if (
    !data ||
    !isNumbers(data.positions) ||
    !isNumbers(data.normals) ||
    !isNumbers(data.uvs) ||
    !Array.isArray(data.indices) ||
    data.positions.length === 0 ||
    data.positions.length % 3 !== 0 ||
    data.normals.length !== data.positions.length ||
    data.uvs.length !== (data.positions.length / 3) * 2 ||
    data.indices.length === 0 || data.indices.length % 3 !== 0 ||
    !allNumbers(data.positions, Number.isFinite) ||
    !allNumbers(data.normals, Number.isFinite) ||
    !allNumbers(data.uvs, Number.isFinite) ||
    !data.indices.every((i) => Number.isInteger(i) && i >= 0 && i < data.positions.length / 3) ||
    (data.groups !== undefined && !validGroups(data)) ||
    (data.bones !== undefined && !validBones(data.bones))
  ) {
    throw new Error('malformed mesh data');
  }
  const positions = new Float32Array(data.positions);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(data.normals), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(data.uvs), 2));
  geometry.setIndex(data.indices);
  if (data.groups) {
    for (const g of data.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
  }

  /* Skinning attributes are all-or-nothing: a mesh with bones but no weights
     would render rigid in bind pose, silently ignoring every preset. Drop an
     incomplete set rather than half-arm a `SkinnedMesh`. */
  const vertexCount = positions.length / 3;
  let bones: MeshBone[] | undefined;
  if (data.bones && isNumbers(data.skinIndex) && isNumbers(data.skinWeight)) {
    if (
      data.skinIndex.length === vertexCount * 4 &&
      data.skinWeight.length === vertexCount * 4 &&
      allNumbers(data.skinIndex,
        (i) => Number.isInteger(i) && i >= 0 && i < data.bones!.length,
      )
    ) {
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.skinIndex, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(data.skinWeight, 4));
      bones = data.bones;
    }
  }

  return { geometry, positions, groups: data.groups, materials: data.materials, bones };
}

export function disposeMesh(mesh: LoadedMesh | null): void {
  mesh?.geometry.dispose();
}

/**
 * Blend matching `_0`/`_1` positions; skinning remains on the rendered geometry.
 * ponytail: keep the `_1` UV layout; add UV interpolation if a pair needs it.
 * Writes `out` in place when supplied, otherwise allocates a new array.
 */
export function lerpPositions(
  a: Float32Array,
  b: Float32Array,
  w: number,
  out?: Float32Array,
): Float32Array {
  const n = Math.min(a.length, b.length);
  const dst = out && out.length === n ? out : new Float32Array(n);
  const t = Math.min(1, Math.max(0, w));
  if (t === 0) {
    dst.set(a.subarray(0, n));
    return dst;
  }
  if (t === 1) {
    dst.set(b.subarray(0, n));
    return dst;
  }
  for (let i = 0; i < n; i += 1) dst[i] = a[i] + (b[i] - a[i]) * t;
  return dst;
}

const MESH_DATA_CACHE = new Map<string, MeshData>();
const MESH_REQUESTS = new Map<string, Promise<MeshData>>();
const TEXTURE_PRELOAD_CACHE = new Map<string, Promise<void>>();

/** Share concurrent requests without sharing mutable/disposable geometry. */
function fetchMeshData(url: string): Promise<MeshData> {
  const pending = MESH_REQUESTS.get(url);
  if (pending) return pending;
  const request = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<MeshData>;
    })
    .finally(() => MESH_REQUESTS.delete(url));
  MESH_REQUESTS.set(url, request);
  return request;
}

/** Preload an image URL into browser cache so TextureLoader resolves seamlessly. */
export function preloadTexture(url: string | undefined): void {
  void preloadTextureAsync(url);
}

/** Concurrent consumers wait for the same image, not just a started request. */
export function preloadTextureAsync(url: string | undefined): Promise<void> {
  if (!url || typeof Image === 'undefined') return Promise.resolve();
  const cached = TEXTURE_PRELOAD_CACHE.get(url);
  if (cached) return cached;
  const pending = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => {
      TEXTURE_PRELOAD_CACHE.delete(url);
      resolve();
    };
    img.src = url;
  });
  TEXTURE_PRELOAD_CACHE.set(url, pending);
  return pending;
}

/**
 * Fetch a part's geometry. Seamlessly keeps the previous mesh active while
 * a newly selected mesh is fetching/decoding in the background, eliminating
 * blank/empty unmounts and preload glitches.
 */
export interface MeshResource {
  mesh: LoadedMesh | null;
  /** The fetch/decode failure, so a caller can settle instead of spinning. */
  error: string | null;
  /** True once this URL has resolved or failed (or there was no URL). */
  settled: boolean;
}

export function useMeshResource(url: string | undefined, label: string): MeshResource {
  const [loaded, setLoaded] = useState<{
    url?: string;
    mesh: LoadedMesh | null;
  }>({ url: undefined, mesh: null });

  const [status, setStatus] = useState<{
    error: string | null;
    settled: boolean;
  }>({ error: null, settled: true });

  const activeMeshRef = useRef<LoadedMesh | null>(null);

  useEffect(() => {
    // Explicit removal / unequip: clear immediately so the part is removed as requested
    if (!url) {
      if (activeMeshRef.current) {
        disposeMesh(activeMeshRef.current);
        activeMeshRef.current = null;
      }
      setLoaded({ url: undefined, mesh: null });
      setStatus({ error: null, settled: true });
      return;
    }

    // Already showing this exact URL
    if (loaded.url === url && loaded.mesh) {
      return;
    }

    let cancelled = false;
    setStatus((prev) => ({ ...prev, settled: false }));

    const handleSuccess = async (data: MeshData) => {
      if (cancelled) return;

      // Pre-warm primary textures before swapping the active mesh so the character
      // never flashes as bald or flat grey while waiting for images to download.
      if (data.materials && typeof Image !== 'undefined') {
        const texUrls: string[] = [];
        for (const m of data.materials) {
          if (m.texture) texUrls.push(m.texture);
          if (m.normalTexture) texUrls.push(m.normalTexture);
        }
        if (texUrls.length > 0) {
          await Promise.all(texUrls.map(preloadTextureAsync));
        }
      }
      if (cancelled) return;

      const newMesh = meshDataToGeometry(data);
      MESH_DATA_CACHE.set(url, data);
      // Dispose old mesh now that the new one is built and ready
      if (activeMeshRef.current && activeMeshRef.current !== newMesh) {
        disposeMesh(activeMeshRef.current);
      }
      activeMeshRef.current = newMesh;
      setLoaded({ url, mesh: newMesh });
      setStatus({ error: null, settled: true });
    };

    const load = async () => {
      const cached = MESH_DATA_CACHE.get(url) ?? getDynamicMesh(url);
      if (cached) return handleSuccess(cached);
      if (url.startsWith('dynamic://')) {
        const data = await retrieveDynamicMesh(url);
        if (cancelled) return;
        if (!data) throw new Error(`dynamic mesh not found: ${url}`);
        registerDynamicMesh(url, data);
        return handleSuccess(data);
      }
      return handleSuccess(await fetchMeshData(url));
    };
    void load().catch((err) => {
      if (cancelled) return;
      const message = `${label}: ${err instanceof Error ? err.message : 'failed to load mesh'}`;
      console.error(`[HeadModel] ${message}`);
      setStatus({ error: message, settled: true });
    });

    return () => {
      cancelled = true;
    };
  }, [url, label]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (activeMeshRef.current) {
        disposeMesh(activeMeshRef.current);
        activeMeshRef.current = null;
      }
    };
  }, []);

  return {
    mesh: loaded.mesh,
    error: status.error,
    settled: status.settled,
  };
}

export function useMeshGeometry(url: string | undefined, label: string): LoadedMesh | null {
  return useMeshResource(url, label).mesh;
}

/**
 * Write the blended weight positions into a mesh's rendered attribute.
 *
 * Split out of the hook so the blend → bounds update can be exercised without
 * React. Returns false when the geometry carries no position attribute (a
 * malformed decode already rejected upstream, but the caller must not crash).
 */
export function applyWeightedPositions(
  geometry: THREE.BufferGeometry,
  w0: Float32Array,
  w1: Float32Array,
  weight: number,
  norm0?: Float32Array,
  norm1?: Float32Array,
): boolean {
  const attr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!attr) return false;
  /* The decoded attribute may share its storage with one of the source
     variants (three keeps the array it was constructed with). Blending into
     it would overwrite a source, so the next slider move would interpolate
     from already-blended vertices. Allocate once in that case; afterwards the
     attribute owns its own buffer and every move writes in place. */
  const out =
    attr.array === w0 || attr.array === w1 ? undefined : (attr.array as Float32Array);
  const blended = lerpPositions(w0, w1, weight, out);
  if (blended !== attr.array) attr.array = blended;
  attr.needsUpdate = true;

  if (norm0 && norm1) {
    const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (normAttr) {
      const outNorm = normAttr.array === norm0 || normAttr.array === norm1 ? undefined : (normAttr.array as Float32Array);
      const blendedNorm = lerpPositions(norm0, norm1, weight, outNorm);
      if (blendedNorm !== normAttr.array) normAttr.array = blendedNorm;
      normAttr.needsUpdate = true;
    }
  }

  /* Endpoints and every intermediate point move, so the bounds must follow. */
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return true;
}

/**
 * Fetch and blend one body part's `_0`/`_1` weight pair.
 *
 * Torso, hands and feet pairs have matching indices and skinning over one atlas.
 * Both halves are fetched; the single weight slider blends their positions.
 * A part with no pair keeps its single mesh unchanged.
 *
 * A pair stays hidden until both halves load. Loading settles once both requests
 * resolve or fail, with either failure exposed to the caller.
 */
export function useWeightedMeshResource(
  variants: { w0: string; w1: string } | undefined,
  singleUrl: string | undefined,
  label: string,
  weight: number,
): MeshResource {
  const w0 = variants?.w0;
  const w1 = variants?.w1;
  const low = useMeshResource(w0, `${label} weight 0`);
  const high = useMeshResource(BODY_WEIGHT_ENABLED ? w1 : undefined, `${label} weight 1`);
  /* A pair's `_0` half is the default slim mesh when weight scaling is disabled.
     Fetching the single URL as well would download and decode the same mesh twice. */
  const single = useMeshResource(variants ? undefined : singleUrl, label);

  const activePairRef = useRef<LoadedMesh | null>(null);

  useEffect(() => {
    if (!BODY_WEIGHT_ENABLED) return;
    // Only blend when both halves have settled for the current variant pair
    if (!low.mesh || !high.mesh || !low.settled || !high.settled) return;
    const norm0 = low.mesh.geometry.getAttribute('normal')?.array as Float32Array | undefined;
    const norm1 = high.mesh.geometry.getAttribute('normal')?.array as Float32Array | undefined;
    applyWeightedPositions(high.mesh.geometry, low.mesh.positions, high.mesh.positions, weight, norm0, norm1);
    activePairRef.current = high.mesh;
  }, [low.mesh, high.mesh, low.settled, high.settled, weight]);

  if (!variants) {
    activePairRef.current = null;
    return single;
  }

  if (!BODY_WEIGHT_ENABLED) {
    activePairRef.current = null;
    // When weight scaling is disabled, both character body and outfits
    // consistently use the base slim _0 mesh (0% weight).
    return low;
  }

  const pairReady = Boolean(low.mesh && high.mesh && low.settled && high.settled);
  if (pairReady) {
    activePairRef.current = high.mesh;
  }

  return {
    mesh: pairReady ? high.mesh : activePairRef.current,
    error:
      low.error ??
      high.error ??
      (low.settled && high.settled && !pairReady ? `${label}: weight pair is incomplete` : null),
    settled: low.settled && high.settled,
  };
}

/**
 * Load `src` into a material slot with the wrap/colour-space the MO2 atlases
 * need, clearing the slot on removal or failure rather than leaving the
 * previous atlas on the mesh. Returns the load state so a caller can keep an
 * untextured part off screen instead of drawing a white placeholder.
 */
export type TextureState = 'idle' | 'pending' | 'loaded' | 'failed';

export function useMaterialTexture(
  material: THREE.MeshStandardMaterial,
  slot: 'map' | 'normalMap' | 'roughnessMap' | 'emissiveMap',
  src: string | undefined,
  opts: { colorSpace?: THREE.ColorSpace; wrap?: boolean } = {},
): TextureState {
  const { colorSpace, wrap } = opts;
  const [state, setState] = useState<TextureState>(src ? 'pending' : 'idle');

  useEffect(() => {
    const clear = () => {
      if (material[slot]) {
        material[slot] = null;
        material.needsUpdate = true;
      }
    };
    if (!src) {
      clear();
      setState('idle');
      return;
    }

    let cancelled = false;
    setState('pending');
    const prevTex = material[slot];
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const tex = loader.load(
      src,
      () => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        if (colorSpace) tex.colorSpace = colorSpace;
        tex.flipY = true;
        /* Atlas UVs run straight across the head, so at the grazing angles the
           cheeks and jaw are always seen at, isotropic filtering blurs the pores
           into a smear. 8 is what the generated canvases already use; the renderer
           clamps it to `capabilities.getMaxAnisotropy()`. */
        tex.anisotropy = 8;
        if (wrap) {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
        }
        if (prevTex && prevTex !== tex) {
          prevTex.dispose();
        }
        material[slot] = tex;
        material.needsUpdate = true;
        setState('loaded');
      },
      undefined,
      (err) => {
        console.error(`[HeadModel] Failed to load texture ${src}:`, err);
        if (cancelled) return;
        clear();
        setState('failed');
      },
    );

    return () => {
      cancelled = true;
    };
  }, [material, slot, src, colorSpace, wrap]);

  return state;
}
