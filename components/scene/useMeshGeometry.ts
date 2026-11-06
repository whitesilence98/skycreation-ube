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

import { useEffect, useState } from 'react';
import * as THREE from 'three';

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


/** The producer emits local, catalogue-resolved URLs only. Anything else in a
 *  mesh payload is either a corrupt file or an attempt to widen the renderer's
 *  network reach, and is rejected rather than fetched. */
function isLocalAssetUrl(v: unknown): v is string {
  return typeof v === 'string' && (v.startsWith('/assets/') || v.startsWith('/api/mo2/convert?'));
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
    !Array.from(data.positions).every(Number.isFinite) ||
    !Array.from(data.normals).every(Number.isFinite) ||
    !Array.from(data.uvs).every(Number.isFinite) ||
    !data.indices.every((i) => Number.isInteger(i) && i >= 0 && i < data.positions.length / 3) ||
    (data.groups !== undefined && !validGroups(data)) ||
    (data.bones !== undefined && !validBones(data.bones))
  ) {
    throw new Error('malformed mesh data');
  }
  const positions = new Float32Array(data.positions);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(data.normals), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(data.uvs), 2));
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
      Array.from(data.skinIndex).every(
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
 * Per-vertex blend between the two weight variants of a body.
 *
 * Skyrim ships `femalebody_0.nif` and `femalebody_1.nif`: same topology, same
 * UVs, one atlas, different positions. Measured on CBBE 3BA — 20,542 vertices,
 * 39,842 triangles both sides, `indices` and `uvs` identical, every vertex
 * moved by 1.4–22.4 mm (mean 8.2 mm). So weight is a straight lerp of the
 * position attribute and nothing else; there is no skinning to do.
 *
 * `out` is written in place when supplied, so a slider drag does not allocate
 * 250 KB per frame. Returns the array it wrote (or a new one).
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

/**
 * Fetch a part's geometry. Returns `null` immediately when `url` is absent or
 * differs from the loaded one, so a selection change never keeps painting the
 * previous part's vertices.
 */
export interface MeshResource {
  mesh: LoadedMesh | null;
  /** The fetch/decode failure, so a caller can settle instead of spinning. */
  error: string | null;
  /** True once this URL has resolved or failed (or there was no URL). */
  settled: boolean;
}

export function useMeshResource(url: string | undefined, label: string): MeshResource {
  const [entry, setEntry] = useState<{
    url?: string;
    mesh: LoadedMesh | null;
    error: string | null;
    settled: boolean;
  }>({ settled: true, mesh: null, error: null });

  useEffect(() => {
    if (!url) {
      setEntry({ url: undefined, mesh: null, error: null, settled: true });
      return;
    }
    let cancelled = false;
    setEntry({ url, mesh: null, error: null, settled: false });
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: MeshData) => {
        if (cancelled) return;
        try {
          setEntry({ url, mesh: meshDataToGeometry(data), error: null, settled: true });
        } catch (err) {
          setEntry({
            url,
            mesh: null,
            error: `${label}: ${err instanceof Error ? err.message : 'malformed mesh data'}`,
            settled: true,
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = `${label}: ${err instanceof Error ? err.message : 'failed to load mesh'}`;
        console.error(`[HeadModel] ${message}`);
        setEntry({ url, mesh: null, error: message, settled: true });
      });
    return () => {
      cancelled = true;
    };
  }, [url, label]);

  // Release a superseded result as soon as its URL stops being selected.
  useEffect(() => {
    if (entry.mesh && entry.url !== url) setEntry({ url: undefined, mesh: null, error: null, settled: true });
  }, [entry, url]);

  useEffect(() => {
    const mesh = entry.mesh;
    return () => disposeMesh(mesh ?? null);
  }, [entry]);

  if (entry.url !== url) return { mesh: null, error: null, settled: false };
  return { mesh: entry.mesh, error: entry.error, settled: entry.settled };
}

export function useMeshGeometry(url: string | undefined, label: string): LoadedMesh | null {
  return useMeshResource(url, label).mesh;
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
  slot: 'map' | 'normalMap',
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
    const tex = new THREE.TextureLoader().load(
      src,
      () => {
        if (!cancelled && material[slot] === tex) setState('loaded');
      },
      undefined,
      (err) => {
        console.error(`[HeadModel] Failed to load texture ${src}:`, err);
        if (cancelled || material[slot] !== tex) return;
        clear();
        setState('failed');
      },
    );
    if (colorSpace) tex.colorSpace = colorSpace;
    tex.flipY = true;
    if (wrap) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
    material[slot] = tex;
    material.needsUpdate = true;

    return () => {
      cancelled = true;
      if (material[slot] === tex) clear();
      tex.dispose();
    };
  }, [material, slot, src, colorSpace, wrap]);

  return state;
}
