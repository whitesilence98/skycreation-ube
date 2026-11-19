/**
 * lib/rigger/weightTransfer.ts
 *
 * Skin Weight Transfer — Phase 3 of the CC-Kit Auto-Rigger pipeline.
 *
 * For every vertex of the input mesh, computes which bones influence it
 * and by how much, producing the `skinIndex` and `skinWeight` buffer
 * attributes required by glTF 2.0 / Three.js SkinnedMesh.
 *
 * ─── Algorithm ───────────────────────────────────────────────────────────────
 *
 *  Stage A  Pre-compute
 *    For each bone: cache its world-space segment (start → end),
 *    its anatomical region, and bilateral side (left / right / centre).
 *
 *  Stage B  Per-vertex scoring
 *    For each vertex:
 *      1. Transform vertex to world space (via mesh.matrixWorld).
 *      2. For each bone compute the distance from the vertex to the
 *         closest point on the bone's segment.
 *      3. Apply a soft inverse-distance score:
 *           score = 1 / (d^falloff + ε)
 *      4. Multiply by a bilateral mask:
 *           left bones are penalised when the vertex is on the right side,
 *           right bones when on the left — prevents cross-contamination.
 *      5. Multiply by a region-affinity mask:
 *           spine bones shrink when far from the spine axis;
 *           arm/leg bones shrink when far from their own chain.
 *
 *  Stage C  Selection & normalisation
 *    1. Keep the top `maxInfluences` (≤ 4) bones by score.
 *    2. Zero-out any weight below `minWeight`.
 *    3. Normalise so the remaining weights sum to 1.0.
 *    4. Pack into interleaved Uint16Array (indices) + Float32Array (weights).
 *
 * ─── Performance ─────────────────────────────────────────────────────────────
 *
 *  O(V × B) where V = vertex count, B = bone count (max 54).
 *  For a typical 15k-vertex body mesh: ~810k operations → < 50 ms in browser.
 *  For 100k-vertex dense meshes the caller should run this in a Web Worker;
 *  a helper `transferWeightsAsync` is provided for that path.
 *
 * ─── Legal ───────────────────────────────────────────────────────────────────
 *
 *  Pure geometric algorithm — no ML model weights, no proprietary data.
 *  Distance-to-segment and inverse-distance falloff are public-domain maths.
 *  Bilateral masking concept is standard industry practice, not patented.
 *
 * Usage:
 *   import { transferWeights } from '@/lib/rigger/weightTransfer';
 */

import * as THREE from 'three';
import { VRM_BONE_DEFS, type VrmBoneDef, type VrmBoneName } from '@/lib/rigger/vrmSkeleton';
import type { FitResult } from '@/lib/rigger/templateFitter';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface WeightTransferOptions {
  /**
   * Maximum bone influences per vertex (1–4).
   * glTF 2.0 hard limit is 4; using fewer speeds up skinning on GPU.
   * Default: 4.
   */
  maxInfluences?: number;

  /**
   * Distance falloff exponent. Higher = sharper weight boundaries.
   * 1 = linear, 2 = quadratic (recommended), 3+ = very sharp.
   * Default: 2.
   */
  falloffExponent?: number;

  /**
   * Weights below this threshold are zeroed out before normalisation.
   * Keeps the weight map sparse and prevents ghost influences.
   * Default: 0.001.
   */
  minWeight?: number;

  /**
   * Bilateral symmetry enforcement strength [0–1].
   * 1.0 = hard mirror: left bones get zero influence on right-side vertices.
   * 0.0 = disabled (pure distance weights).
   * Default: 0.85.
   */
  bilateralStrength?: number;

  /**
   * Region-affinity strength [0–1].
   * Controls how much bones penalise vertices that are anatomically
   * in a different region (e.g. leg bone near spine).
   * 0.0 = disabled, 1.0 = strong regional isolation.
   * Default: 0.6.
   */
  regionAffinityStrength?: number;

  /**
   * Progress callback — called after each batch of vertices.
   * `progress` is 0–1. Useful for updating a UI progress bar.
   */
  onProgress?: (progress: number) => void;

  /**
   * Internal batch size for progress reporting. Default: 2000 vertices.
   */
  batchSize?: number;
}

export interface WeightTransferResult {
  /**
   * Interleaved bone indices: 4 Uint16 per vertex, in skeleton.bones[] order.
   * Compatible with Three.js `BufferAttribute(skinIndex, 4)`.
   */
  skinIndex: Uint16Array;

  /**
   * Interleaved bone weights: 4 Float32 per vertex, normalised to sum ≤ 1.0.
   * Compatible with Three.js `BufferAttribute(skinWeight, 4)`.
   */
  skinWeight: Float32Array;

  /** Number of vertices processed. */
  vertexCount: number;

  /** Number of bones in the skeleton that received at least one non-zero weight. */
  activeBoneCount: number;

  /**
   * Per-bone vertex count (how many vertices each bone is the primary
   * influence for). Useful for diagnosing dead bones.
   */
  boneVertexCounts: Uint32Array;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

/** Bilateral side of a bone. */
type BoneSide = 'left' | 'right' | 'centre';

/** Pre-computed per-bone data used during weight scoring. */
interface BoneCache {
  index: number;           // position in skeleton.bones[]
  name: VrmBoneName;
  side: BoneSide;
  region: VrmBoneDef['region'];
  /** World-space segment start (usually the bone's own world position). */
  segStart: THREE.Vector3;
  /** World-space segment end (child centroid or stub tip). */
  segEnd:   THREE.Vector3;
  /** Precomputed segment direction and length for fast projection. */
  segDir:   THREE.Vector3;  // normalised
  segLen:   number;         // metres
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Bone cache builder
// ─────────────────────────────────────────────────────────────────────────────

/** Determine which side of the body a bone belongs to from its name. */
function getBoneSide(name: VrmBoneName): BoneSide {
  if (name.startsWith('left'))  return 'left';
  if (name.startsWith('right')) return 'right';
  return 'centre';
}

/**
 * Builds per-bone segment cache from the fitted skeleton's world positions.
 * Segments run from each bone's world position to the centroid of its children.
 */
function buildBoneCache(fitResult: FitResult): BoneCache[] {
  const { built, worldPositions } = fitResult;
  const cache: BoneCache[] = [];

  for (let i = 0; i < built.bones.length; i++) {
    const bone = built.bones[i];
    const name  = bone.name as VrmBoneName;
    const def   = VRM_BONE_DEFS.find((d) => d.name === name);
    if (!def) continue;

    const segStart = worldPositions.get(name) ?? bone.getWorldPosition(new THREE.Vector3());

    // Segment end: centroid of children's world positions
    const childBones = built.bones.filter((b) => {
      const childDef = VRM_BONE_DEFS.find((d) => d.name === b.name);
      return childDef?.parent === name;
    });

    let segEnd: THREE.Vector3;
    if (childBones.length > 0) {
      segEnd = new THREE.Vector3();
      for (const child of childBones) {
        const childPos = worldPositions.get(child.name as VrmBoneName)
          ?? child.getWorldPosition(new THREE.Vector3());
        segEnd.add(childPos);
      }
      segEnd.divideScalar(childBones.length);
    } else {
      // Leaf bone: tiny stub (3 cm) so it still has a segment length > 0
      segEnd = segStart.clone().add(new THREE.Vector3(0, 0.03, 0));
    }

    const segVec = new THREE.Vector3().subVectors(segEnd, segStart);
    const segLen = segVec.length();
    const segDir = segLen > 1e-6 ? segVec.clone().divideScalar(segLen) : new THREE.Vector3(0, 1, 0);

    cache.push({
      index: i,
      name,
      side: getBoneSide(name),
      region: def.region,
      segStart: segStart.clone(),
      segEnd:   segEnd.clone(),
      segDir,
      segLen,
    });
  }

  return cache;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Distance to bone segment (core geometry)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the squared distance from point `p` to the closest point on the
 * segment defined by `bc.segStart` → `bc.segEnd`.
 *
 * Squared distance avoids a sqrt for the intermediate comparisons — the
 * final score uses the actual distance, computed once after selection.
 */
function distSqToSegment(
  px: number, py: number, pz: number,
  bc: BoneCache,
): number {
  // t = project (p - segStart) onto segDir, clamped to [0, segLen]
  const dx = px - bc.segStart.x;
  const dy = py - bc.segStart.y;
  const dz = pz - bc.segStart.z;
  const t  = Math.max(0, Math.min(bc.segLen, dx * bc.segDir.x + dy * bc.segDir.y + dz * bc.segDir.z));

  // Closest point on segment
  const cx = bc.segStart.x + t * bc.segDir.x;
  const cy = bc.segStart.y + t * bc.segDir.y;
  const cz = bc.segStart.z + t * bc.segDir.z;

  const ex = px - cx;
  const ey = py - cy;
  const ez = pz - cz;
  return ex * ex + ey * ey + ez * ez;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Bilateral mask
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a multiplier [0, 1] that penalises a bone for influencing a vertex
 * that is on the wrong side of the body's midplane.
 *
 * Uses a smooth step across a transition band of `bandWidth` metres
 * centred on X = 0 (the sagittal plane). This avoids a hard cutoff and
 * keeps weights clean near the midline (spine, sternum).
 *
 * @param vertexX     The vertex's X coordinate in world space.
 * @param side        Which side the bone belongs to.
 * @param strength    How strongly to enforce bilateral symmetry [0–1].
 * @param hipWidth    Used to derive a sensible transition band width.
 */
function bilateralMask(
  vertexX: number,
  side: BoneSide,
  strength: number,
  hipWidth: number,
): number {
  if (side === 'centre' || strength <= 0) return 1.0;

  // Transition band: 20% of half-hip-width (empirically good)
  const band = Math.max(0.02, hipWidth * 0.1);

  // smoothstep: 0 at the wrong side, 1 well into the correct side
  const signed = side === 'left' ? vertexX : -vertexX; // positive = correct side
  const t = Math.max(0, Math.min(1, (signed + band) / (2 * band)));
  const smooth = t * t * (3 - 2 * t);       // classic smoothstep

  // Lerp between no-penalty (1.0) and full-bilateral (smooth) based on strength
  return 1.0 - strength * (1.0 - smooth);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Region-affinity mask
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approximate anatomical region of a vertex, inferred from its world position
 * relative to the skeleton's key measurements.
 */
type VertexRegion = 'spine' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

function classifyVertexRegion(
  px: number, py: number,
  hipY: number,
  neckY: number,
  headY: number,
  shoulderWidth: number,
): VertexRegion {
  // Above neck → head
  if (py > neckY + (headY - neckY) * 0.3) return 'head';

  // Below hips → leg (determine side by X)
  if (py < hipY) {
    return px >= 0 ? 'leftLeg' : 'rightLeg';
  }

  // Torso height band: check if vertex is laterally outside shoulder width / 2
  const halfShoulder = shoulderWidth * 0.55;
  if (px >  halfShoulder) return 'leftArm';
  if (px < -halfShoulder) return 'rightArm';

  return 'spine';
}

/** Affinity table: bone region → compatible vertex regions → weight multiplier */
const REGION_AFFINITY: Record<VrmBoneDef['region'], Partial<Record<VertexRegion, number>>> = {
  spine:        { spine: 1.0,  head: 0.4,  leftArm: 0.3,  rightArm: 0.3,  leftLeg: 0.3, rightLeg: 0.3 },
  head:         { head:  1.0,  spine: 0.2 },
  leftArm:      { leftArm: 1.0,  spine: 0.4 },
  rightArm:     { rightArm: 1.0, spine: 0.4 },
  leftLeg:      { leftLeg: 1.0,  spine: 0.3 },
  rightLeg:     { rightLeg: 1.0, spine: 0.3 },
  leftFinger:   { leftArm: 1.0 },
  rightFinger:  { rightArm: 1.0 },
};

function regionAffinityMask(
  boneRegion: VrmBoneDef['region'],
  vertexRegion: VertexRegion,
  strength: number,
): number {
  if (strength <= 0) return 1.0;
  const affinity = (REGION_AFFINITY[boneRegion]?.[vertexRegion] ?? 0.05);
  // Lerp between full influence (1.0) and table value based on strength
  return 1.0 - strength * (1.0 - affinity);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Per-vertex weight scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scores every bone for a single vertex, returning an array of
 * `[boneIndex, score]` sorted descending by score.
 */
function scoreBonesForVertex(
  px: number, py: number, pz: number,
  boneCache: BoneCache[],
  falloffExp: number,
  bilateralStrength: number,
  regionAffinityStrength: number,
  hipWidth: number,
  hipY: number,
  neckY: number,
  headY: number,
  shoulderWidth: number,
): Array<[index: number, score: number]> {
  const EPS = 1e-6;

  const vertexRegion = classifyVertexRegion(px, py, hipY, neckY, headY, shoulderWidth);

  const scores: Array<[number, number]> = [];

  for (const bc of boneCache) {
    const distSq = distSqToSegment(px, py, pz, bc);
    const dist   = Math.sqrt(distSq);

    // Inverse-distance score with configurable exponent
    let score = 1.0 / (Math.pow(dist, falloffExp) + EPS);

    // Bilateral mask
    score *= bilateralMask(px, bc.side, bilateralStrength, hipWidth);

    // Region-affinity mask
    score *= regionAffinityMask(bc.region, vertexRegion, regionAffinityStrength);

    if (score > EPS) {
      scores.push([bc.index, score]);
    }
  }

  // Sort descending by score (best bones first)
  scores.sort((a, b) => b[1] - a[1]);
  return scores;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Main weight transfer function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes skin weights for every vertex in a mesh geometry relative to
 * the fitted skeleton from `fitSkeletonToLandmarks()`.
 *
 * The input geometry must have its `position` attribute populated.
 * If the mesh has a `matrixWorld` applied, pass it via `meshWorldMatrix`
 * so vertex positions are evaluated in the same space as the skeleton.
 *
 * @param geometry        The source mesh geometry (positions read-only).
 * @param fitResult       The fitted skeleton from `templateFitter.ts`.
 * @param meshWorldMatrix World matrix of the mesh (default: identity).
 * @param options         Tuning options.
 */
export function transferWeights(
  geometry: THREE.BufferGeometry,
  fitResult: FitResult,
  meshWorldMatrix: THREE.Matrix4 = new THREE.Matrix4(),
  options: WeightTransferOptions = {},
): WeightTransferResult {
  const maxInfluences        = Math.min(4, Math.max(1, options.maxInfluences ?? 4));
  const falloffExp           = Math.max(0.5, options.falloffExponent ?? 2);
  const minWeight            = options.minWeight ?? 0.001;
  const bilateralStrength    = Math.max(0, Math.min(1, options.bilateralStrength ?? 0.85));
  const regionStrength       = Math.max(0, Math.min(1, options.regionAffinityStrength ?? 0.6));
  const batchSize            = options.batchSize ?? 2000;
  const onProgress           = options.onProgress;

  // ── Pre-compute bone cache ─────────────────────────────────────────────────
  const boneCache = buildBoneCache(fitResult);
  const boneCount = fitResult.built.bones.length;

  // ── Derive skeleton measurements for region classification ─────────────────
  const hipPos  = fitResult.worldPositions.get('hips');
  const neckPos = fitResult.worldPositions.get('neck');
  const headPos = fitResult.worldPositions.get('head');

  const hipY          = hipPos?.y  ?? 0.9;
  const neckY         = neckPos?.y ?? 1.4;
  const headY         = headPos?.y ?? 1.6;
  const shoulderWidth = fitResult.shoulderWidth;
  const hipWidth      = fitResult.hipWidth;

  // ── Vertex buffer ──────────────────────────────────────────────────────────
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('[weightTransfer] Geometry has no position attribute.');
  }
  const vertexCount = posAttr.count;

  // Output buffers: 4 slots per vertex
  const skinIndex  = new Uint16Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);

  // Per-bone stat: how many vertices is each bone the primary influence for
  const boneVertexCounts = new Uint32Array(boneCount);

  // Reusable vertex transform
  const vWorld = new THREE.Vector3();

  // ── Main loop ──────────────────────────────────────────────────────────────
  for (let vi = 0; vi < vertexCount; vi++) {
    // Transform vertex to world space
    vWorld.fromBufferAttribute(posAttr, vi).applyMatrix4(meshWorldMatrix);

    // Score all bones for this vertex
    const scores = scoreBonesForVertex(
      vWorld.x, vWorld.y, vWorld.z,
      boneCache,
      falloffExp,
      bilateralStrength,
      regionStrength,
      hipWidth,
      hipY, neckY, headY,
      shoulderWidth,
    );

    // Keep top maxInfluences
    const topN = scores.slice(0, maxInfluences);

    // Raw weight sum for normalisation
    let weightSum = 0;
    for (const [, score] of topN) {
      weightSum += score;
    }

    // Write to output buffers
    const base = vi * 4;
    let primaryBone = 0;
    let primaryWeight = 0;
    let slot = 0;

    for (const [boneIdx, score] of topN) {
      let w = weightSum > 0 ? score / weightSum : 0;
      if (w < minWeight) w = 0;

      skinIndex [base + slot] = boneIdx;
      skinWeight[base + slot] = w;

      if (w > primaryWeight) {
        primaryWeight = w;
        primaryBone   = boneIdx;
      }
      slot++;
    }

    // Fill unused slots with zeros
    for (let s = slot; s < 4; s++) {
      skinIndex [base + s] = 0;
      skinWeight[base + s] = 0;
    }

    // Re-normalise after minWeight zeroing (weights may no longer sum to 1)
    let finalSum = 0;
    for (let s = 0; s < 4; s++) finalSum += skinWeight[base + s];
    if (finalSum > 0) {
      for (let s = 0; s < 4; s++) skinWeight[base + s] /= finalSum;
    } else {
      // Degenerate vertex (completely outside skeleton bounds) → bind to hips
      skinIndex [base] = 0;
      skinWeight[base] = 1.0;
      primaryBone = 0;
    }

    // Track primary bone for diagnostics
    if (primaryBone < boneCount) {
      boneVertexCounts[primaryBone]++;
    }

    // Progress callback (every batchSize vertices)
    if (onProgress && (vi + 1) % batchSize === 0) {
      onProgress((vi + 1) / vertexCount);
    }
  }

  if (onProgress) onProgress(1.0);

  // Count how many bones have any weight at all
  const activeBoneCount = boneVertexCounts.reduce((acc, c) => acc + (c > 0 ? 1 : 0), 0);

  return { skinIndex, skinWeight, vertexCount, activeBoneCount, boneVertexCounts };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Apply weights to a Three.js geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convenience wrapper: runs `transferWeights` and writes the results directly
 * onto a `THREE.BufferGeometry` as `skinIndex` and `skinWeight` attributes.
 *
 * After calling this you can bind the geometry to a `THREE.SkinnedMesh`
 * and attach `fitResult.built.skeleton` to it.
 *
 * @returns The same geometry, mutated in-place.
 */
export function applyWeightsToGeometry(
  geometry: THREE.BufferGeometry,
  fitResult: FitResult,
  meshWorldMatrix?: THREE.Matrix4,
  options?: WeightTransferOptions,
): THREE.BufferGeometry {
  const result = transferWeights(geometry, fitResult, meshWorldMatrix, options);

  geometry.setAttribute(
    'skinIndex',
    new THREE.BufferAttribute(result.skinIndex, 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.BufferAttribute(result.skinWeight, 4),
  );

  return geometry;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Async wrapper (Web Worker-friendly)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async version of `transferWeights` that yields to the event loop between
 * batches so the UI stays responsive for large meshes (100k+ vertices).
 *
 * Uses `setTimeout(0)` between batches — no Web Worker required.
 * For true background processing, call the sync version inside a Worker.
 */
export async function transferWeightsAsync(
  geometry: THREE.BufferGeometry,
  fitResult: FitResult,
  meshWorldMatrix: THREE.Matrix4 = new THREE.Matrix4(),
  options: WeightTransferOptions = {},
): Promise<WeightTransferResult> {
  const batchSize  = options.batchSize ?? 2000;
  const onProgress = options.onProgress;

  const maxInfluences        = Math.min(4, Math.max(1, options.maxInfluences ?? 4));
  const falloffExp           = Math.max(0.5, options.falloffExponent ?? 2);
  const minWeight            = options.minWeight ?? 0.001;
  const bilateralStrength    = Math.max(0, Math.min(1, options.bilateralStrength ?? 0.85));
  const regionStrength       = Math.max(0, Math.min(1, options.regionAffinityStrength ?? 0.6));

  const boneCache = buildBoneCache(fitResult);
  const boneCount = fitResult.built.bones.length;

  const hipPos  = fitResult.worldPositions.get('hips');
  const neckPos = fitResult.worldPositions.get('neck');
  const headPos = fitResult.worldPositions.get('head');
  const hipY         = hipPos?.y  ?? 0.9;
  const neckY        = neckPos?.y ?? 1.4;
  const headY        = headPos?.y ?? 1.6;
  const shoulderWidth = fitResult.shoulderWidth;
  const hipWidth      = fitResult.hipWidth;

  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('[weightTransfer] Geometry has no position attribute.');
  }
  const vertexCount  = posAttr.count;
  const skinIndex    = new Uint16Array(vertexCount * 4);
  const skinWeight   = new Float32Array(vertexCount * 4);
  const boneVertexCounts = new Uint32Array(boneCount);
  const vWorld = new THREE.Vector3();

  let vi = 0;

  const processBatch = (): boolean => {
    const end = Math.min(vi + batchSize, vertexCount);
    for (; vi < end; vi++) {
      vWorld.fromBufferAttribute(posAttr, vi).applyMatrix4(meshWorldMatrix);

      const scores = scoreBonesForVertex(
        vWorld.x, vWorld.y, vWorld.z,
        boneCache, falloffExp, bilateralStrength, regionStrength,
        hipWidth, hipY, neckY, headY, shoulderWidth,
      );

      const topN = scores.slice(0, maxInfluences);
      let weightSum = 0;
      for (const [, s] of topN) weightSum += s;

      const base = vi * 4;
      let primaryBone = 0;
      let primaryWeight = 0;
      let slot = 0;

      for (const [boneIdx, score] of topN) {
        let w = weightSum > 0 ? score / weightSum : 0;
        if (w < minWeight) w = 0;
        skinIndex [base + slot] = boneIdx;
        skinWeight[base + slot] = w;
        if (w > primaryWeight) { primaryWeight = w; primaryBone = boneIdx; }
        slot++;
      }
      for (let s = slot; s < 4; s++) { skinIndex[base + s] = 0; skinWeight[base + s] = 0; }

      let finalSum = 0;
      for (let s = 0; s < 4; s++) finalSum += skinWeight[base + s];
      if (finalSum > 0) {
        for (let s = 0; s < 4; s++) skinWeight[base + s] /= finalSum;
      } else {
        skinIndex[base] = 0; skinWeight[base] = 1.0; primaryBone = 0;
      }

      if (primaryBone < boneCount) boneVertexCounts[primaryBone]++;
    }
    if (onProgress) onProgress(vi / vertexCount);
    return vi >= vertexCount;
  };

  // Yield to the event loop between batches
  await new Promise<void>((resolve) => {
    const tick = () => {
      const done = processBatch();
      if (done) { resolve(); } else { setTimeout(tick, 0); }
    };
    setTimeout(tick, 0);
  });

  if (onProgress) onProgress(1.0);

  const activeBoneCount = boneVertexCounts.reduce((acc, c) => acc + (c > 0 ? 1 : 0), 0);
  return { skinIndex, skinWeight, vertexCount, activeBoneCount, boneVertexCounts };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Diagnostic helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a vertex-colour buffer that visualises bone influence regions as
 * distinct RGB colours — useful for the WeightMapPreview component.
 *
 * Each vertex is coloured by its primary (highest-weight) bone.
 * The colour palette cycles through a hue wheel spread across all bones.
 */
export function buildWeightHeatmapColors(
  result: Pick<WeightTransferResult, 'skinIndex' | 'skinWeight' | 'vertexCount'>,
  boneCount: number,
): Float32Array {
  const colors = new Float32Array(result.vertexCount * 3);

  for (let vi = 0; vi < result.vertexCount; vi++) {
    const base = vi * 4;

    // Find the highest-weight influence
    let bestSlot = 0;
    let bestW    = skinWeightAt(result.skinWeight, base, 0);
    for (let s = 1; s < 4; s++) {
      const w = skinWeightAt(result.skinWeight, base, s);
      if (w > bestW) { bestW = w; bestSlot = s; }
    }

    const primaryBone = result.skinIndex[base + bestSlot];
    const hue = (primaryBone / Math.max(1, boneCount)) * 360;
    const [r, g, b] = hslToRgb(hue, 0.85, 0.55);

    colors[vi * 3 + 0] = r;
    colors[vi * 3 + 1] = g;
    colors[vi * 3 + 2] = b;
  }

  return colors;
}

function skinWeightAt(skinWeight: Float32Array, base: number, slot: number): number {
  return skinWeight[base + slot] ?? 0;
}

/** Converts HSL [0–360, 0–1, 0–1] to linear RGB [0–1, 0–1, 0–1]. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [r + m, g + m, b + m];
}

/**
 * Returns a human-readable diagnostic summary of a `WeightTransferResult`.
 *
 * Example output:
 *   Vertices:      15420
 *   Active bones:  43 / 54
 *   Avg influences: 3.7
 *   Dead bones:    spine (0 verts), leftEye (0 verts)
 */
export function weightTransferSummary(
  result: WeightTransferResult,
  boneNames: string[],
): string {
  const lines: string[] = [
    `Vertices:       ${result.vertexCount}`,
    `Active bones:   ${result.activeBoneCount} / ${boneNames.length}`,
  ];

  // Average number of real (non-zero) influences per vertex
  let totalInfluences = 0;
  for (let vi = 0; vi < result.vertexCount; vi++) {
    const base = vi * 4;
    for (let s = 0; s < 4; s++) {
      if (result.skinWeight[base + s] > 0) totalInfluences++;
    }
  }
  lines.push(`Avg influences: ${(totalInfluences / Math.max(1, result.vertexCount)).toFixed(1)}`);

  const dead = boneNames.filter((_, i) => (result.boneVertexCounts[i] ?? 0) === 0);
  if (dead.length > 0) {
    lines.push(`Dead bones (0 primary verts): ${dead.join(', ')}`);
  }

  return lines.join('\n');
}
