/**
 * lib/rigger/heatDiffusion.ts
 *
 * Laplacian Heat Diffusion — Phase 4 of the CC-Kit Auto-Rigger pipeline.
 *
 * Smooths the raw per-vertex skin weights produced by `weightTransfer.ts`
 * by propagating them along the mesh surface connectivity graph.
 *
 * Without smoothing, weight boundaries are hard — deformation looks faceted
 * and stiff at joint bends (elbow, knee, shoulder). Heat diffusion softens
 * those transitions, blending weights smoothly across the skin surface.
 *
 * ─── Algorithm ───────────────────────────────────────────────────────────────
 *
 *  Step 1 — Adjacency
 *    Parse the mesh face buffer (indexed or non-indexed) to build a compact
 *    vertex-neighbour lookup: for every vertex, the list of vertices that
 *    share a triangle edge with it.
 *
 *  Step 2 — Sparse weight representation
 *    Convert the flat `skinIndex / skinWeight` buffers from weightTransfer.ts
 *    into an array of small Maps (vertexIndex → Map<boneIndex, weight>),
 *    which lets us efficiently merge and blend bone channels across neighbours.
 *
 *  Step 3 — Laplacian diffusion (N iterations)
 *    For each iteration:
 *      For each vertex v:
 *        For each bone b present in v or any neighbour of v:
 *          smoothed[b] = (1 − λ) · current[v][b]
 *                      +      λ  · mean(neighbours[v][b])
 *      Re-normalise per vertex so weights still sum to 1.0.
 *      Keep only the top `maxInfluences` bones.
 *
 *  Step 4 — Pack back
 *    Write the smoothed, normalised weights into new Uint16Array / Float32Array
 *    buffers compatible with Three.js BufferAttribute(_, 4).
 *
 * ─── Complexity ──────────────────────────────────────────────────────────────
 *
 *  Adjacency build: O(F)   — one pass over the face buffer.
 *  Per iteration:   O(V × K × B_local) where K = average vertex valence (~6
 *                   for triangulated meshes), B_local = active bones per ring.
 *  Typical 15k-vertex mesh, 5 iterations: ~2–8 ms in browser.
 *
 * ─── Legal ───────────────────────────────────────────────────────────────────
 *
 *  Uniform Laplacian smoothing is classical applied mathematics (textbook
 *  graph Laplacian), not patentable. No proprietary implementation is copied.
 *
 * Usage:
 *   import { diffuseWeights, applyDiffusedWeightsToGeometry } from '@/lib/rigger/heatDiffusion';
 */

import * as THREE from 'three';
import type { WeightTransferResult } from '@/lib/rigger/weightTransfer';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffusionOptions {
  /**
   * Number of Laplacian smoothing passes.
   * More iterations = smoother transitions, but risk over-blurring tight joints.
   * Recommended: 3–5. Default: 4.
   */
  iterations?: number;

  /**
   * Diffusion rate λ per iteration [0–1].
   * Higher = faster convergence but can overshoot near joint seams.
   * Recommended: 0.3–0.5. Default: 0.35.
   */
  lambda?: number;

  /**
   * Maximum bone influences per vertex in the output (1–4).
   * Must match the value used in weightTransfer. Default: 4.
   */
  maxInfluences?: number;

  /**
   * Minimum weight to retain after re-normalisation.
   * Weights below this are zeroed out to keep the map sparse.
   * Default: 0.001.
   */
  minWeight?: number;

  /**
   * Optional per-vertex anchor strength [0–1].
   * Vertices with anchor = 1.0 are completely frozen (no smoothing).
   * Vertices with anchor = 0.0 are fully diffused.
   * Pass a Float32Array of length `vertexCount` or omit for no anchoring.
   *
   * Useful for pinning joint-centre vertices so their weights don't blur away.
   */
  anchorStrength?: Float32Array;

  /**
   * Progress callback — called after each iteration.
   * `progress` is 0–1.
   */
  onProgress?: (progress: number) => void;
}

export interface DiffusionResult {
  /** Smoothed bone indices — same format as WeightTransferResult.skinIndex. */
  skinIndex:  Uint16Array;
  /** Smoothed bone weights — normalised, same format as WeightTransferResult.skinWeight. */
  skinWeight: Float32Array;
  /** Number of vertices processed. */
  vertexCount: number;
  /** Number of iterations actually run (may be less if already converged). */
  iterationsRun: number;
  /**
   * Maximum weight change across all vertices in the final iteration.
   * Useful for diagnosing convergence: < 0.001 means the map is stable.
   */
  finalMaxDelta: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Adjacency builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compact adjacency structure: for each vertex, the flat list of its unique
 * edge-neighbours in the triangle mesh.
 *
 * Layout:
 *   offsets[i]       = start of vertex i's neighbour list in `data`
 *   offsets[i + 1]   = exclusive end (so neighbours are data[offsets[i]..offsets[i+1]])
 *   data[...]        = packed neighbour vertex indices (Uint32)
 */
export interface Adjacency {
  offsets: Uint32Array;   // length: vertexCount + 1
  data:    Uint32Array;   // length: total edge-neighbour count (sum of all valences)
}

/**
 * Builds the vertex adjacency structure from a mesh geometry.
 *
 * Works with both indexed (`geometry.index !== null`) and non-indexed
 * geometries. For non-indexed meshes every 3 elements form a triangle.
 *
 * Duplicate edges (shared between two triangles) are automatically
 * deduplicated — each neighbour appears at most once.
 */
export function buildAdjacency(geometry: THREE.BufferGeometry): Adjacency {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('[heatDiffusion] Geometry has no position attribute.');
  }
  const vertexCount = posAttr.count;

  // Phase 1: collect neighbour sets per vertex (using bit-sets would be faster
  // for dense meshes, but Set<number> is simpler and correct for browser use)
  const neighbourSets: Set<number>[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) neighbourSets[i] = new Set<number>();

  const addEdge = (a: number, b: number) => {
    if (a !== b) {
      neighbourSets[a]!.add(b);
      neighbourSets[b]!.add(a);
    }
  };

  const index = geometry.index;
  if (index !== null) {
    // Indexed geometry
    const idx = index.array;
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f]!;
      const b = idx[f + 1]!;
      const c = idx[f + 2]!;
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }
  } else {
    // Non-indexed geometry — every 3 vertices form a triangle
    for (let f = 0; f < vertexCount; f += 3) {
      addEdge(f, f + 1);
      addEdge(f + 1, f + 2);
      addEdge(f + 2, f);
    }
  }

  // Phase 2: pack into flat arrays
  const offsets = new Uint32Array(vertexCount + 1);
  let totalEdges = 0;
  for (let i = 0; i < vertexCount; i++) {
    offsets[i] = totalEdges;
    totalEdges += neighbourSets[i]!.size;
  }
  offsets[vertexCount] = totalEdges;

  const data = new Uint32Array(totalEdges);
  let ptr = 0;
  for (let i = 0; i < vertexCount; i++) {
    for (const nb of neighbourSets[i]!) {
      data[ptr++] = nb;
    }
  }

  return { offsets, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Sparse weight representation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-vertex sparse weight map: boneIndex → weight.
 * Only non-zero influences are stored (at most `maxInfluences` entries).
 */
type VertexWeightMap = Map<number, number>;

/**
 * Unpacks the flat `skinIndex / skinWeight` buffers into an array of Maps,
 * one per vertex. Zero-weight slots are skipped.
 */
function unpackToMaps(
  skinIndex:  Uint16Array,
  skinWeight: Float32Array,
  vertexCount: number,
): VertexWeightMap[] {
  const maps: VertexWeightMap[] = new Array(vertexCount);
  for (let vi = 0; vi < vertexCount; vi++) {
    const m = new Map<number, number>();
    const base = vi * 4;
    for (let s = 0; s < 4; s++) {
      const w = skinWeight[base + s]!;
      if (w > 0) {
        m.set(skinIndex[base + s]!, w);
      }
    }
    maps[vi] = m;
  }
  return maps;
}

/**
 * Packs an array of sparse weight maps back into flat typed arrays.
 * Keeps the top `maxInfluences` entries by weight, normalises to sum = 1.0,
 * and zeros out weights below `minWeight`.
 */
function packFromMaps(
  maps:         VertexWeightMap[],
  vertexCount:  number,
  maxInfluences: number,
  minWeight:    number,
): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const skinIndex  = new Uint16Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);

  for (let vi = 0; vi < vertexCount; vi++) {
    const m = maps[vi]!;
    const base = vi * 4;

    // Sort by weight descending, keep top N
    const entries = Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxInfluences);

    // Zero out below threshold
    let sum = 0;
    for (const [, w] of entries) {
      if (w >= minWeight) sum += w;
    }

    let slot = 0;
    for (const [boneIdx, w] of entries) {
      if (w < minWeight) continue;
      skinIndex [base + slot] = boneIdx;
      skinWeight[base + slot] = sum > 0 ? w / sum : 0;
      slot++;
    }

    // If nothing survived the threshold, pin to bone 0 (hips)
    if (slot === 0) {
      skinIndex [base] = 0;
      skinWeight[base] = 1.0;
    }

    // Remaining slots stay zero (default Uint16/Float32 init)
  }

  return { skinIndex, skinWeight };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Single Laplacian pass
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs one Laplacian smoothing pass over all vertices.
 *
 * For each vertex v:
 *   For each bone b active on v or any neighbour of v:
 *     smoothed[v][b] = (1 − λ) · current[v][b]
 *                    +      λ  · mean_{j ∈ N(v)}(current[j][b])
 *
 * @returns The maximum weight change across all vertices (convergence indicator).
 */
function laplacianPass(
  current:       VertexWeightMap[],
  next:          VertexWeightMap[],  // pre-allocated output buffer
  adjacency:     Adjacency,
  lambda:        number,
  anchorStrength: Float32Array | undefined,
): number {
  const { offsets, data } = adjacency;
  const vertexCount = current.length;
  let maxDelta = 0;

  for (let vi = 0; vi < vertexCount; vi++) {
    // Effective lambda is 0 for fully anchored vertices
    const anchor = anchorStrength ? (anchorStrength[vi] ?? 0) : 0;
    const effectiveLambda = lambda * (1 - anchor);

    const nbStart = offsets[vi]!;
    const nbEnd   = offsets[vi + 1]!;
    const nbCount = nbEnd - nbStart;

    if (nbCount === 0 || effectiveLambda <= 0) {
      // Isolated vertex or anchored: copy unchanged
      next[vi] = new Map(current[vi]!);
      continue;
    }

    // Collect all bone indices active on this vertex OR its neighbours
    const activeBones = new Set<number>(current[vi]!.keys());
    for (let ni = nbStart; ni < nbEnd; ni++) {
      for (const boneIdx of current[data[ni]!]!.keys()) {
        activeBones.add(boneIdx);
      }
    }

    const smoothed = new Map<number, number>();

    for (const boneIdx of activeBones) {
      // Self contribution: (1 − λ) × current weight
      const selfW = current[vi]!.get(boneIdx) ?? 0;

      // Neighbour contribution: λ × mean of neighbours' weights for this bone
      let nbSum = 0;
      for (let ni = nbStart; ni < nbEnd; ni++) {
        nbSum += current[data[ni]!]!.get(boneIdx) ?? 0;
      }
      const nbMean = nbSum / nbCount;

      const newW = (1 - effectiveLambda) * selfW + effectiveLambda * nbMean;
      if (newW > 1e-6) {
        smoothed.set(boneIdx, newW);

        // Track convergence
        const delta = Math.abs(newW - selfW);
        if (delta > maxDelta) maxDelta = delta;
      }
    }

    next[vi] = smoothed;
  }

  return maxDelta;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Main exported function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs Laplacian heat diffusion over raw skin weights to smooth joint seams.
 *
 * Call this after `transferWeights()` and before `exportRiggedGlb()`.
 *
 * @param rawResult   The output of `transferWeights()` or `transferWeightsAsync()`.
 * @param geometry    The same mesh geometry used for weight transfer (needed for adjacency).
 * @param options     Tuning options.
 *
 * @example
 * ```ts
 * const raw     = transferWeights(geometry, fitResult, worldMatrix);
 * const smooth  = diffuseWeights(raw, geometry, { iterations: 4, lambda: 0.35 });
 * applyWeightsToGeometry(geometry, smooth);
 * ```
 */
export function diffuseWeights(
  rawResult: WeightTransferResult,
  geometry:  THREE.BufferGeometry,
  options:   DiffusionOptions = {},
): DiffusionResult {
  const iterations    = Math.max(1, Math.round(options.iterations    ?? 4));
  const lambda        = Math.max(0, Math.min(1, options.lambda       ?? 0.35));
  const maxInfluences = Math.min(4, Math.max(1, options.maxInfluences ?? 4));
  const minWeight     = options.minWeight     ?? 0.001;
  const anchorStrength = options.anchorStrength;
  const onProgress    = options.onProgress;

  const { vertexCount, skinIndex: rawIdx, skinWeight: rawWgt } = rawResult;

  // ── Build adjacency ────────────────────────────────────────────────────────
  const adjacency = buildAdjacency(geometry);

  // ── Unpack into sparse maps ────────────────────────────────────────────────
  let current = unpackToMaps(rawIdx, rawWgt, vertexCount);

  // Pre-allocate the "next" buffer (reused every iteration)
  let next: VertexWeightMap[] = new Array(vertexCount);

  // ── Diffusion loop ─────────────────────────────────────────────────────────
  const CONVERGE_THRESHOLD = 5e-5; // stop early if max delta falls below this
  let iterationsRun = 0;
  let finalMaxDelta = 0;

  for (let iter = 0; iter < iterations; iter++) {
    finalMaxDelta = laplacianPass(current, next, adjacency, lambda, anchorStrength);
    iterationsRun++;

    // Swap buffers
    const tmp = current;
    current   = next;
    next      = tmp;

    if (onProgress) onProgress((iter + 1) / iterations);

    // Early exit if converged
    if (finalMaxDelta < CONVERGE_THRESHOLD) break;
  }

  // ── Pack back to typed arrays ──────────────────────────────────────────────
  const { skinIndex, skinWeight } = packFromMaps(current, vertexCount, maxInfluences, minWeight);

  return { skinIndex, skinWeight, vertexCount, iterationsRun, finalMaxDelta };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Convenience wrapper — apply directly to geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs `diffuseWeights` and writes the smoothed result directly onto the
 * geometry's `skinIndex` and `skinWeight` attributes in-place.
 *
 * @returns The same geometry, mutated.
 */
export function applyDiffusedWeightsToGeometry(
  rawResult: WeightTransferResult,
  geometry:  THREE.BufferGeometry,
  options?:  DiffusionOptions,
): THREE.BufferGeometry {
  const result = diffuseWeights(rawResult, geometry, options);

  geometry.setAttribute(
    'skinIndex',
    new THREE.BufferAttribute(result.skinIndex,  4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.BufferAttribute(result.skinWeight, 4),
  );

  return geometry;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Async variant — event-loop-friendly for large meshes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async version of `diffuseWeights` that yields to the event loop between
 * iterations, keeping the UI responsive for dense meshes (100k+ vertices).
 *
 * Each iteration is a full Laplacian pass; `setTimeout(0)` between iterations
 * lets layout and input events run without needing a Web Worker.
 */
export async function diffuseWeightsAsync(
  rawResult: WeightTransferResult,
  geometry:  THREE.BufferGeometry,
  options:   DiffusionOptions = {},
): Promise<DiffusionResult> {
  const iterations    = Math.max(1, Math.round(options.iterations    ?? 4));
  const lambda        = Math.max(0, Math.min(1, options.lambda       ?? 0.35));
  const maxInfluences = Math.min(4, Math.max(1, options.maxInfluences ?? 4));
  const minWeight     = options.minWeight     ?? 0.001;
  const anchorStrength = options.anchorStrength;
  const onProgress    = options.onProgress;

  const { vertexCount, skinIndex: rawIdx, skinWeight: rawWgt } = rawResult;

  const adjacency = buildAdjacency(geometry);
  let current = unpackToMaps(rawIdx, rawWgt, vertexCount);
  let next: VertexWeightMap[] = new Array(vertexCount);

  const CONVERGE_THRESHOLD = 5e-5;
  let iterationsRun = 0;
  let finalMaxDelta = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Yield before each iteration
    await new Promise<void>((r) => setTimeout(r, 0));

    finalMaxDelta = laplacianPass(current, next, adjacency, lambda, anchorStrength);
    iterationsRun++;

    const tmp = current;
    current   = next;
    next      = tmp;

    if (onProgress) onProgress((iter + 1) / iterations);
    if (finalMaxDelta < CONVERGE_THRESHOLD) break;
  }

  const { skinIndex, skinWeight } = packFromMaps(current, vertexCount, maxInfluences, minWeight);
  return { skinIndex, skinWeight, vertexCount, iterationsRun, finalMaxDelta };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Anchor helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds an anchor-strength buffer that pins vertices near joint centres
 * (bone endpoints) so their weights don't blur away during diffusion.
 *
 * Vertices within `pinRadius` metres of any bone endpoint get anchor = 1.0.
 * Vertices beyond `blendRadius` get anchor = 0.0.
 * In between, a smooth ramp is applied.
 *
 * @param geometry         The mesh geometry.
 * @param boneWorldPositions  Map from bone name → world position (from FitResult).
 * @param meshWorldMatrix  World matrix of the mesh.
 * @param pinRadius        Distance from joint centre that gets fully pinned. Default: 0.03 m.
 * @param blendRadius      Distance at which anchor fades to zero. Default: 0.08 m.
 */
export function buildJointAnchorStrength(
  geometry: THREE.BufferGeometry,
  boneWorldPositions: Map<string, THREE.Vector3>,
  meshWorldMatrix: THREE.Matrix4 = new THREE.Matrix4(),
  pinRadius   = 0.03,
  blendRadius = 0.08,
): Float32Array {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('[heatDiffusion] Geometry has no position attribute.');
  }

  const vertexCount = posAttr.count;
  const anchor = new Float32Array(vertexCount);

  // Pre-collect joint positions as a plain array for fast iteration
  const jointPositions = Array.from(boneWorldPositions.values());
  if (jointPositions.length === 0) return anchor;

  const vWorld = new THREE.Vector3();
  const bandWidth = Math.max(1e-6, blendRadius - pinRadius);

  for (let vi = 0; vi < vertexCount; vi++) {
    vWorld.fromBufferAttribute(posAttr, vi).applyMatrix4(meshWorldMatrix);

    // Find the closest joint
    let minDist = Infinity;
    for (const jPos of jointPositions) {
      const d = vWorld.distanceTo(jPos);
      if (d < minDist) minDist = d;
    }

    // Map distance → anchor strength
    if (minDist <= pinRadius) {
      anchor[vi] = 1.0;
    } else if (minDist >= blendRadius) {
      anchor[vi] = 0.0;
    } else {
      // Smooth ramp: 1 → 0 from pinRadius → blendRadius
      const t = (minDist - pinRadius) / bandWidth;
      anchor[vi] = 1 - t * t * (3 - 2 * t); // smoothstep(1 → 0)
    }
  }

  return anchor;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Diagnostic helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the average "entropy" of the weight map — a measure of how spread
 * out the influences are. High entropy = many bones share similar weights
 * (soft, well-blended). Low entropy = single-bone dominance (hard, stiff).
 *
 * Uses the normalised Shannon entropy per vertex:
 *   H(v) = -Σ w·log2(w) / log2(N)   for all non-zero w
 *
 * Returns a value in [0, 1]. A well-smoothed character body typically lands
 * in [0.3, 0.7].
 */
export function computeWeightEntropy(skinWeight: Float32Array, vertexCount: number): number {
  let totalEntropy = 0;
  const LOG2_4 = Math.log2(4);

  for (let vi = 0; vi < vertexCount; vi++) {
    const base = vi * 4;
    let H = 0;
    for (let s = 0; s < 4; s++) {
      const w = skinWeight[base + s]!;
      if (w > 1e-7) H -= w * Math.log2(w);
    }
    totalEntropy += H / LOG2_4; // normalise to [0,1]
  }

  return totalEntropy / vertexCount;
}

/**
 * Returns a diagnostic summary of a `DiffusionResult`.
 *
 * Example:
 *   Iterations:   4 / 4
 *   Final Δmax:   0.000312  (converged: no)
 *   Weight entropy: 0.42  (well-blended)
 */
export function diffusionSummary(result: DiffusionResult, maxIterations: number): string {
  const converged = result.finalMaxDelta < 5e-5;
  const entropy   = computeWeightEntropy(result.skinWeight, result.vertexCount);

  const entropyLabel =
    entropy > 0.6 ? 'very soft / over-smoothed' :
    entropy > 0.35 ? 'well-blended' :
    entropy > 0.15 ? 'moderate' :
                     'stiff / under-smoothed';

  return [
    `Iterations:     ${result.iterationsRun} / ${maxIterations}`,
    `Final Δmax:     ${result.finalMaxDelta.toFixed(6)}  (converged: ${converged ? 'yes' : 'no'})`,
    `Weight entropy: ${entropy.toFixed(3)}  (${entropyLabel})`,
  ].join('\n');
}
