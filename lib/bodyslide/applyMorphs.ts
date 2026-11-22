import * as THREE from 'three';
import {
  OsdData,
  OsdDiffBlock,
  DEFAULT_UBE_BODY_VERTEX_COUNT,
  DEFAULT_NIF_TO_RENDER_SCALE,
  unpackDenseDeltas,
} from './osdParser';

export interface MorphTargetSetupOptions {
  /** Target coordinate frame: 'render' (Three.js Y-up, Z-forward, scaled) or 'nif' (Skyrim coordinates). Default: 'render' */
  frame?: 'render' | 'nif';
  /** Scale factor from Skyrim cm units to Three.js units. Default: 0.01288 */
  scale?: number;
  /** Total vertex count of the base body mesh. Default: 32512 */
  vertexCount?: number;
  /**
   * List of slider names to include as active morph targets in geometry.morphAttributes.position.
   * If omitted or 'all', all available unique blocks from the OSD file are registered.
   */
  sliderNames?: string[] | 'all';
}

export interface MorphTargetSetupResult {
  /** Number of morph target attributes attached to geometry.morphAttributes.position */
  attributeCount: number;
  /** Mapping from slider names (both clean and raw) to attribute index */
  dictionary: Record<string, number>;
  /** Ordered list of slider names corresponding to the attribute indices */
  sliderList: string[];
}

export interface MorphInfluenceOptions {
  /**
   * Whether to normalize slider values from percentage (0..100) to fraction (0..1).
   * - true: always divides by 100
   * - false: keeps raw number
   * - undefined (default): automatically normalizes values with absolute magnitude > 1.05
   */
  normalizePercent?: boolean;
  /**
   * If true, resets any morph target in the dictionary not present in sliderValues to 0.
   * Default: false (only modifies specified sliders).
   */
  resetOmitted?: boolean;
}

export interface MorphApplyOptions {
  /** Target coordinate frame: 'render' (Three.js space) or 'nif' (Skyrim space). Default: 'render' */
  frame?: 'render' | 'nif';
  /** Scale factor from Skyrim cm units to Three.js units. Default: 0.01288 */
  scale?: number;
  /** Whether to normalize percentage values (0..100) to (0..1). Default: auto */
  normalizePercent?: boolean;
  /** Whether to recompute vertex normals after deforming positions. Default: true */
  recomputeNormals?: boolean;
}

/**
 * Sets up or replaces `geometry.morphAttributes.position` on a Three.js SkinnedMesh or BufferGeometry.
 *
 * Configures:
 * 1. `geometry.morphAttributes.position`: Array of `THREE.Float32BufferAttribute` (deltas)
 * 2. `geometry.morphTargetsRelative = true`
 * 3. On SkinnedMesh: `mesh.morphTargetDictionary` and `mesh.morphTargetInfluences` initialized to 0
 */
export function setupMorphTargets(
  target: THREE.SkinnedMesh | THREE.BufferGeometry,
  osd: OsdData | Map<string, OsdDiffBlock>,
  options?: MorphTargetSetupOptions
): MorphTargetSetupResult {
  const isMesh = Boolean((target as THREE.SkinnedMesh).isSkinnedMesh);
  const mesh = isMesh ? (target as THREE.SkinnedMesh) : null;
  const geometry = mesh ? mesh.geometry : (target as THREE.BufferGeometry);

  const posAttr = geometry.getAttribute('position');
  const vertexCount = options?.vertexCount ?? (posAttr ? posAttr.count : DEFAULT_UBE_BODY_VERTEX_COUNT);
  const frame = options?.frame ?? 'render';
  const scale = options?.scale ?? DEFAULT_NIF_TO_RENDER_SCALE;

  // Resolve unique block list to register
  let blocksToRegister: OsdDiffBlock[] = [];
  if (options?.sliderNames && options.sliderNames !== 'all') {
    const requested = options.sliderNames;
    const seen = new Set<string>();
    for (const name of requested) {
      const block = 'getBlock' in osd ? osd.getBlock(name) : (osd.get(name) ?? osd.get(`BaseShape${name}`));
      if (block && !seen.has(block.rawName)) {
        seen.add(block.rawName);
        blocksToRegister.push(block);
      }
    }
  } else {
    if ('blockList' in osd) {
      blocksToRegister = osd.blockList;
    } else {
      const seen = new Set<string>();
      for (const block of osd.values()) {
        if (!seen.has(block.rawName)) {
          seen.add(block.rawName);
          blocksToRegister.push(block);
        }
      }
    }
  }

  // Initialize morphAttributes.position array
  const morphAttrs: THREE.BufferAttribute[] = [];
  const dictionary: Record<string, number> = {};
  const sliderList: string[] = [];

  for (let i = 0; i < blocksToRegister.length; i++) {
    const block = blocksToRegister[i];
    const denseDeltas = unpackDenseDeltas(block, vertexCount, frame, scale);
    const attr = new THREE.Float32BufferAttribute(denseDeltas, 3);
    attr.name = block.name;

    morphAttrs.push(attr);
    dictionary[block.name] = i;
    dictionary[block.rawName] = i;
    sliderList.push(block.name);
  }

  geometry.morphAttributes.position = morphAttrs;
  geometry.morphTargetsRelative = true;

  if (mesh) {
    if (typeof mesh.updateMorphTargets === 'function') {
      mesh.updateMorphTargets();
    }
    mesh.morphTargetDictionary = mesh.morphTargetDictionary || {};
    mesh.morphTargetInfluences = mesh.morphTargetInfluences || [];

    // Ensure aliases for both clean slider names and raw BaseShape names are registered
    for (let i = 0; i < blocksToRegister.length; i++) {
      const block = blocksToRegister[i];
      mesh.morphTargetDictionary[block.name] = i;
      mesh.morphTargetDictionary[block.rawName] = i;
    }

    if (mesh.morphTargetInfluences.length !== morphAttrs.length) {
      mesh.morphTargetInfluences = new Array(morphAttrs.length).fill(0);
    }
  }

  return {
    attributeCount: morphAttrs.length,
    dictionary,
    sliderList,
  };
}

/**
 * High-speed method to update `mesh.morphTargetInfluences` from a dictionary of slider values.
 *
 * Designed for 60fps UI slider drags:
 * - O(k) where k is the number of entries in `sliderValues`
 * - Resolves both clean slider names ("BreastsBigger") and raw names ("BaseShapeBreastsBigger")
 * - Handles negative values correctly (e.g. p|n sliders)
 * - Auto-detects 0..100 percentage values vs 0..1 fractions
 */
export function updateMorphInfluences(
  mesh: THREE.SkinnedMesh,
  sliderValues: Record<string, number>,
  options?: MorphInfluenceOptions
): void {
  const dict = mesh.morphTargetDictionary;
  const influences = mesh.morphTargetInfluences;
  if (!dict || !influences) return;

  if (options?.resetOmitted) {
    influences.fill(0);
  }

  const normalizeMode = options?.normalizePercent;

  for (const key of Object.keys(sliderValues)) {
    const rawVal = sliderValues[key];
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) continue;

    const idx =
      dict[key] ??
      dict[`BaseShape${key}`] ??
      (key.startsWith('BaseShape') ? dict[key.slice(9)] : undefined);
    if (idx !== undefined && idx < influences.length) {
      let val = rawVal;
      if (normalizeMode === true || (normalizeMode === undefined && Math.abs(rawVal) > 1.05)) {
        val = rawVal * 0.01;
      }
      influences[idx] = val;
    }
  }
}

/**
 * Direct CPU deformation of vertex positions (useful for offline baking, GLB export,
 * or devices without WebGL2 morph target texture support).
 *
 * Uses sparse block iteration: only loops through vertices altered by active sliders!
 */
export function applyMorphsToPositions(
  targetPositions: Float32Array,
  basePositions: Float32Array,
  osd: OsdData | Map<string, OsdDiffBlock>,
  sliderValues: Record<string, number>,
  options?: Omit<MorphApplyOptions, 'recomputeNormals'>
): void {
  // Reset target to base rest positions
  targetPositions.set(basePositions);

  const totalVertices = Math.floor(basePositions.length / 3);
  const frame = options?.frame ?? 'render';
  const scale = options?.scale ?? DEFAULT_NIF_TO_RENDER_SCALE;
  const normalizeMode = options?.normalizePercent;

  for (const key of Object.keys(sliderValues)) {
    const rawVal = sliderValues[key];
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || rawVal === 0) continue;

    let weight = rawVal;
    if (normalizeMode === true || (normalizeMode === undefined && Math.abs(rawVal) > 1.05)) {
      weight = rawVal * 0.01;
    }

    const block = 'getBlock' in osd ? osd.getBlock(key) : (osd.get(key) ?? osd.get(`BaseShape${key}`));
    if (!block || block.diffCount === 0) continue;

    const { diffCount, indices, deltas } = block;

    if (frame === 'render') {
      const s = scale * weight;
      for (let i = 0; i < diffCount; i++) {
        const vIdx = indices[i];
        if (vIdx < totalVertices) {
          const outBase = vIdx * 3;
          const inBase = i * 3;
          targetPositions[outBase]     += deltas[inBase] * s;
          targetPositions[outBase + 1] += deltas[inBase + 2] * s; // NIF Z -> Three.js Y
          targetPositions[outBase + 2] += deltas[inBase + 1] * s; // NIF Y -> Three.js Z
        }
      }
    } else {
      for (let i = 0; i < diffCount; i++) {
        const vIdx = indices[i];
        if (vIdx < totalVertices) {
          const outBase = vIdx * 3;
          const inBase = i * 3;
          targetPositions[outBase]     += deltas[inBase] * weight;
          targetPositions[outBase + 1] += deltas[inBase + 1] * weight;
          targetPositions[outBase + 2] += deltas[inBase + 2] * weight;
        }
      }
    }
  }
}

/**
 * Directly deforms a BufferGeometry on the CPU and flags `position.needsUpdate = true`.
 */
export function applyMorphsToGeometry(
  geometry: THREE.BufferGeometry,
  basePositions: Float32Array,
  osd: OsdData | Map<string, OsdDiffBlock>,
  sliderValues: Record<string, number>,
  options?: MorphApplyOptions
): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  if (!posAttr) return;

  applyMorphsToPositions(posAttr.array as Float32Array, basePositions, osd, sliderValues, options);
  posAttr.needsUpdate = true;

  if (options?.recomputeNormals !== false) {
    geometry.computeVertexNormals();
  }
}
