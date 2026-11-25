/**
 * lib/rigger/heatDiffusion.ts
 *
 * Laplacian Heat Diffusion — Phase 4 of the CC-Kit Auto-Rigger pipeline.
 *
 * Uses flat CSR typed arrays (`buildAdjacency`) and fixed-capacity typed-array
 * buffers (`INTER_SLOTS = 8`) with zero per-vertex `Set`/`Map` allocations, so
 * high-poly external meshes (500k+ vertices, ~1M triangles) smooth rapidly with
 * low memory overhead.
 */

import * as THREE from 'three';
import type { WeightTransferResult } from '@/lib/rigger/weightTransfer';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffusionOptions {
  /** Number of Laplacian smoothing passes (1–8). Default: 4. */
  iterations?: number;
  /** Diffusion rate λ per iteration [0–1]. Default: 0.35. */
  lambda?: number;
  /** Maximum bone influences per vertex in output (1–4). Default: 4. */
  maxInfluences?: number;
  /** Minimum weight to retain after re-normalisation. Default: 0.001. */
  minWeight?: number;
  /** Optional per-vertex anchor strength [0–1]. */
  anchorStrength?: Float32Array;
  /** Progress callback — called periodically (`progress` in 0..1). */
  onProgress?: (progress: number) => void;
}

export interface DiffusionResult {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  vertexCount: number;
  iterationsRun: number;
  finalMaxDelta: number;
}

export interface Adjacency {
  offsets: Uint32Array;
  data: Uint32Array;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Flat CSR Adjacency Builder (zero per-vertex Set allocations)
// ─────────────────────────────────────────────────────────────────────────────

function sortSliceInPlace(arr: Uint32Array, start: number, end: number): void {
  // Small valence (typically 4–12): fast in-place insertion sort with zero heap alloc
  if (end - start <= 32) {
    for (let i = start + 1; i < end; i++) {
      const key = arr[i]!;
      let j = i - 1;
      while (j >= start && arr[j]! > key) {
        arr[j + 1] = arr[j]!;
        j--;
      }
      arr[j + 1] = key;
    }
    return;
  }
  arr.subarray(start, end).sort();
}

/**
 * Builds deduplicated vertex edge-adjacency using flat typed arrays.
 */
export function buildAdjacency(geometry: THREE.BufferGeometry): Adjacency {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('[heatDiffusion] Geometry has no position attribute.');
  }
  const vertexCount = posAttr.count;
  const deg = new Uint32Array(vertexCount);
  const index = geometry.index;

  // Pass 1: count raw edge incidences per vertex
  if (index !== null) {
    const idx = index.array;
    for (let f = 0; f + 2 < idx.length; f += 3) {
      const a = idx[f]!;
      const b = idx[f + 1]!;
      const c = idx[f + 2]!;
      if (a < vertexCount && b < vertexCount && a !== b) {
        deg[a]!++;
        deg[b]!++;
      }
      if (b < vertexCount && c < vertexCount && b !== c) {
        deg[b]!++;
        deg[c]!++;
      }
      if (c < vertexCount && a < vertexCount && c !== a) {
        deg[c]!++;
        deg[a]!++;
      }
    }
  } else {
    for (let f = 0; f + 2 < vertexCount; f += 3) {
      const a = f;
      const b = f + 1;
      const c = f + 2;
      deg[a]! += 2;
      deg[b]! += 2;
      deg[c]! += 2;
    }
  }

  // Pass 2: prefix sum raw offsets & fill raw neighbour slots
  const rawOffsets = new Uint32Array(vertexCount + 1);
  let totalRaw = 0;
  for (let i = 0; i < vertexCount; i++) {
    rawOffsets[i] = totalRaw;
    totalRaw += deg[i]!;
  }
  rawOffsets[vertexCount] = totalRaw;

  const rawTargets = new Uint32Array(totalRaw);
  const writePtr = new Uint32Array(rawOffsets.subarray(0, vertexCount));

  if (index !== null) {
    const idx = index.array;
    for (let f = 0; f + 2 < idx.length; f += 3) {
      const a = idx[f]!;
      const b = idx[f + 1]!;
      const c = idx[f + 2]!;
      if (a < vertexCount && b < vertexCount && a !== b) {
        rawTargets[writePtr[a]!++] = b;
        rawTargets[writePtr[b]!++] = a;
      }
      if (b < vertexCount && c < vertexCount && b !== c) {
        rawTargets[writePtr[b]!++] = c;
        rawTargets[writePtr[c]!++] = b;
      }
      if (c < vertexCount && a < vertexCount && c !== a) {
        rawTargets[writePtr[c]!++] = a;
        rawTargets[writePtr[a]!++] = c;
      }
    }
  } else {
    for (let f = 0; f + 2 < vertexCount; f += 3) {
      const a = f;
      const b = f + 1;
      const c = f + 2;
      rawTargets[writePtr[a]!++] = b;
      rawTargets[writePtr[b]!++] = a;
      rawTargets[writePtr[b]!++] = c;
      rawTargets[writePtr[c]!++] = b;
      rawTargets[writePtr[c]!++] = a;
      rawTargets[writePtr[a]!++] = c;
    }
  }

  // Pass 3: sort & deduplicate each vertex's slice in-place forward (safe since uniquePtr <= start)
  const offsets = rawOffsets; // reuse allocation safely
  let uniquePtr = 0;
  for (let i = 0; i < vertexCount; i++) {
    const start = offsets[i]!;
    const end = offsets[i + 1]!;
    offsets[i] = uniquePtr;
    if (start >= end) continue;

    sortSliceInPlace(rawTargets, start, end);
    let prev = -1;
    for (let k = start; k < end; k++) {
      const nb = rawTargets[k]!;
      if (nb !== prev) {
        rawTargets[uniquePtr++] = nb;
        prev = nb;
      }
    }
  }
  offsets[vertexCount] = uniquePtr;

  const data = rawTargets.slice(0, uniquePtr);
  return { offsets, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Typed Sparse Buffers & Zero-Allocation Laplacian Pass
// ─────────────────────────────────────────────────────────────────────────────

const INTER_SLOTS = 8;

interface DiffusionWorkspace {
  curIdx: Uint16Array;
  curWgt: Float32Array;
  nxtIdx: Uint16Array;
  nxtWgt: Float32Array;
  boneAcc: Float32Array;
  boneSeen: Uint8Array;
  touchedBones: Uint16Array;
  topBone: Uint16Array;
  topWgt: Float32Array;
}

function createWorkspace(
  rawIdx: Uint16Array,
  rawWgt: Float32Array,
  vertexCount: number,
): DiffusionWorkspace {
  let maxBoneIdx = 0;
  const len4 = vertexCount * 4;
  for (let i = 0; i < len4; i++) {
    if (rawWgt[i]! > 0 && rawIdx[i]! > maxBoneIdx) {
      maxBoneIdx = rawIdx[i]!;
    }
  }
  const boneSpace = maxBoneIdx + 1;

  const curIdx = new Uint16Array(vertexCount * INTER_SLOTS);
  const curWgt = new Float32Array(vertexCount * INTER_SLOTS);
  const nxtIdx = new Uint16Array(vertexCount * INTER_SLOTS);
  const nxtWgt = new Float32Array(vertexCount * INTER_SLOTS);

  for (let vi = 0; vi < vertexCount; vi++) {
    const src = vi * 4;
    const dst = vi * INTER_SLOTS;
    for (let s = 0; s < 4; s++) {
      curIdx[dst + s] = rawIdx[src + s]!;
      curWgt[dst + s] = rawWgt[src + s]!;
    }
  }

  return {
    curIdx,
    curWgt,
    nxtIdx,
    nxtWgt,
    boneAcc: new Float32Array(boneSpace),
    boneSeen: new Uint8Array(boneSpace),
    touchedBones: new Uint16Array(boneSpace),
    topBone: new Uint16Array(INTER_SLOTS),
    topWgt: new Float32Array(INTER_SLOTS),
  };
}

function stepVertexRange(
  startVi: number,
  endVi: number,
  ws: DiffusionWorkspace,
  adjacency: Adjacency,
  lambda: number,
  anchorStrength: Float32Array | undefined,
): number {
  const { curIdx, curWgt, nxtIdx, nxtWgt, boneAcc, boneSeen, touchedBones, topBone, topWgt } = ws;
  const { offsets, data } = adjacency;
  let maxDelta = 0;

  for (let vi = startVi; vi < endVi; vi++) {
    const base = vi * INTER_SLOTS;
    const anchor = anchorStrength ? (anchorStrength[vi] ?? 0) : 0;
    const effLambda = lambda * (1 - anchor);

    const nbStart = offsets[vi]!;
    const nbEnd = offsets[vi + 1]!;
    const nbCount = nbEnd - nbStart;

    if (nbCount === 0 || effLambda <= 0) {
      for (let s = 0; s < INTER_SLOTS; s++) {
        nxtIdx[base + s] = curIdx[base + s]!;
        nxtWgt[base + s] = curWgt[base + s]!;
      }
      continue;
    }

    const selfScale = 1 - effLambda;
    const nbScale = effLambda / nbCount;
    let touchedCount = 0;

    // Self weights
    for (let s = 0; s < INTER_SLOTS; s++) {
      const w = curWgt[base + s]!;
      if (w <= 0) break;
      const b = curIdx[base + s]!;
      if (!boneSeen[b]) {
        boneSeen[b] = 1;
        touchedBones[touchedCount++] = b;
      }
      boneAcc[b]! += w * selfScale;
    }

    // Neighbour weights
    for (let ni = nbStart; ni < nbEnd; ni++) {
      const nBase = data[ni]! * INTER_SLOTS;
      for (let s = 0; s < INTER_SLOTS; s++) {
        const w = curWgt[nBase + s]!;
        if (w <= 0) break;
        const b = curIdx[nBase + s]!;
        if (!boneSeen[b]) {
          boneSeen[b] = 1;
          touchedBones[touchedCount++] = b;
        }
        boneAcc[b]! += w * nbScale;
      }
    }

    // Keep top INTER_SLOTS descending & reset accumulators
    let topCount = 0;
    for (let t = 0; t < touchedCount; t++) {
      const b = touchedBones[t]!;
      const newW = boneAcc[b]!;
      boneAcc[b] = 0;
      boneSeen[b] = 0;
      if (newW <= 1e-6) continue;

      if (topCount < INTER_SLOTS) {
        let pos = topCount++;
        while (pos > 0 && topWgt[pos - 1]! < newW) {
          topWgt[pos] = topWgt[pos - 1]!;
          topBone[pos] = topBone[pos - 1]!;
          pos--;
        }
        topWgt[pos] = newW;
        topBone[pos] = b;
      } else if (newW > topWgt[INTER_SLOTS - 1]!) {
        let pos = INTER_SLOTS - 1;
        while (pos > 0 && topWgt[pos - 1]! < newW) {
          topWgt[pos] = topWgt[pos - 1]!;
          topBone[pos] = topBone[pos - 1]!;
          pos--;
        }
        topWgt[pos] = newW;
        topBone[pos] = b;
      }
    }

    let sum = 0;
    for (let s = 0; s < topCount; s++) sum += topWgt[s]!;

    if (sum > 0) {
      const invSum = 1 / sum;
      for (let s = 0; s < topCount; s++) {
        const normalizedW = topWgt[s]! * invSum;
        const b = topBone[s]!;
        nxtIdx[base + s] = b;
        nxtWgt[base + s] = normalizedW;

        // Track convergence delta against previous self weight
        let prevW = 0;
        for (let k = 0; k < INTER_SLOTS; k++) {
          const cw = curWgt[base + k]!;
          if (cw <= 0) break;
          if (curIdx[base + k]! === b) {
            prevW = cw;
            break;
          }
        }
        const delta = Math.abs(normalizedW - prevW);
        if (delta > maxDelta) maxDelta = delta;
      }
      for (let s = topCount; s < INTER_SLOTS; s++) {
        nxtIdx[base + s] = 0;
        nxtWgt[base + s] = 0;
      }
    } else {
      for (let s = 0; s < INTER_SLOTS; s++) {
        nxtIdx[base + s] = curIdx[base + s]!;
        nxtWgt[base + s] = curWgt[base + s]!;
      }
    }
  }

  return maxDelta;
}

function packWorkspace(
  ws: DiffusionWorkspace,
  vertexCount: number,
  maxInfluences: number,
  minWeight: number,
): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const { curIdx, curWgt } = ws;
  const skinIndex = new Uint16Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);

  for (let vi = 0; vi < vertexCount; vi++) {
    const src = vi * INTER_SLOTS;
    const dst = vi * 4;

    let sum = 0;
    let count = 0;
    for (let s = 0; s < maxInfluences; s++) {
      const w = curWgt[src + s]!;
      if (w < minWeight) break;
      sum += w;
      count++;
    }

    if (count === 0) {
      skinIndex[dst] = curIdx[src]!;
      skinWeight[dst] = 1.0;
      continue;
    }

    const invSum = 1 / sum;
    for (let s = 0; s < count; s++) {
      skinIndex[dst + s] = curIdx[src + s]!;
      skinWeight[dst + s] = curWgt[src + s]! * invSum;
    }
  }

  return { skinIndex, skinWeight };
}

function swapWorkspaceBuffers(ws: DiffusionWorkspace): void {
  const tmpIdx = ws.curIdx;
  ws.curIdx = ws.nxtIdx;
  ws.nxtIdx = tmpIdx;

  const tmpWgt = ws.curWgt;
  ws.curWgt = ws.nxtWgt;
  ws.nxtWgt = tmpWgt;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Main exported functions (sync + async)
// ─────────────────────────────────────────────────────────────────────────────

export function diffuseWeights(
  rawResult: WeightTransferResult,
  geometry: THREE.BufferGeometry,
  options: DiffusionOptions = {},
): DiffusionResult {
  const iterations = Math.max(1, Math.round(options.iterations ?? 4));
  const lambda = Math.max(0, Math.min(1, options.lambda ?? 0.35));
  const maxInfluences = Math.min(4, Math.max(1, options.maxInfluences ?? 4));
  const minWeight = options.minWeight ?? 0.001;
  const anchorStrength = options.anchorStrength;
  const onProgress = options.onProgress;

  const { vertexCount, skinIndex: rawIdx, skinWeight: rawWgt } = rawResult;
  const adjacency = buildAdjacency(geometry);
  const ws = createWorkspace(rawIdx, rawWgt, vertexCount);

  const CONVERGE_THRESHOLD = 5e-5;
  let iterationsRun = 0;
  let finalMaxDelta = 0;

  for (let iter = 0; iter < iterations; iter++) {
    finalMaxDelta = stepVertexRange(0, vertexCount, ws, adjacency, lambda, anchorStrength);
    swapWorkspaceBuffers(ws);
    iterationsRun++;

    if (onProgress) onProgress((iter + 1) / iterations);
    if (finalMaxDelta < CONVERGE_THRESHOLD) break;
  }

  const { skinIndex, skinWeight } = packWorkspace(ws, vertexCount, maxInfluences, minWeight);
  return { skinIndex, skinWeight, vertexCount, iterationsRun, finalMaxDelta };
}

export function applyDiffusedWeightsToGeometry(
  rawResult: WeightTransferResult,
  geometry: THREE.BufferGeometry,
  options?: DiffusionOptions,
): THREE.BufferGeometry {
  const result = diffuseWeights(rawResult, geometry, options);

  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(result.skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(result.skinWeight, 4));
  return geometry;
}

/**
 * Chunked async Laplacian diffusion yielding every ~25,000 vertices so dense
 * external sculpts (500k+ verts) stay responsive without freezing the browser tab.
 */
export async function diffuseWeightsAsync(
  rawResult: WeightTransferResult,
  geometry: THREE.BufferGeometry,
  options: DiffusionOptions = {},
): Promise<DiffusionResult> {
  const iterations = Math.max(1, Math.round(options.iterations ?? 4));
  const lambda = Math.max(0, Math.min(1, options.lambda ?? 0.35));
  const maxInfluences = Math.min(4, Math.max(1, options.maxInfluences ?? 4));
  const minWeight = options.minWeight ?? 0.001;
  const anchorStrength = options.anchorStrength;
  const onProgress = options.onProgress;

  const { vertexCount, skinIndex: rawIdx, skinWeight: rawWgt } = rawResult;
  const adjacency = buildAdjacency(geometry);
  const ws = createWorkspace(rawIdx, rawWgt, vertexCount);

  const CONVERGE_THRESHOLD = 5e-5;
  const CHUNK_VERTS = 25000;
  let iterationsRun = 0;
  let finalMaxDelta = 0;

  for (let iter = 0; iter < iterations; iter++) {
    let iterMaxDelta = 0;
    for (let start = 0; start < vertexCount; start += CHUNK_VERTS) {
      await new Promise<void>((r) => setTimeout(r, 0));
      const end = Math.min(vertexCount, start + CHUNK_VERTS);
      const chunkMax = stepVertexRange(start, end, ws, adjacency, lambda, anchorStrength);
      if (chunkMax > iterMaxDelta) iterMaxDelta = chunkMax;
      if (onProgress) {
        onProgress((iter + end / Math.max(1, vertexCount)) / iterations);
      }
    }

    finalMaxDelta = iterMaxDelta;
    swapWorkspaceBuffers(ws);
    iterationsRun++;

    if (finalMaxDelta < CONVERGE_THRESHOLD) break;
  }

  const { skinIndex, skinWeight } = packWorkspace(ws, vertexCount, maxInfluences, minWeight);
  return { skinIndex, skinWeight, vertexCount, iterationsRun, finalMaxDelta };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Anchor & diagnostic helpers
// ─────────────────────────────────────────────────────────────────────────────

export function buildJointAnchorStrength(
  geometry: THREE.BufferGeometry,
  boneWorldPositions: Map<string, THREE.Vector3>,
  meshWorldMatrix: THREE.Matrix4 = new THREE.Matrix4(),
  pinRadius = 0.03,
  blendRadius = 0.08,
): Float32Array {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('[heatDiffusion] Geometry has no position attribute.');
  }

  const vertexCount = posAttr.count;
  const anchor = new Float32Array(vertexCount);

  const jointPositions = Array.from(boneWorldPositions.values());
  if (jointPositions.length === 0) return anchor;

  const vWorld = new THREE.Vector3();
  const bandWidth = Math.max(1e-6, blendRadius - pinRadius);

  for (let vi = 0; vi < vertexCount; vi++) {
    vWorld.fromBufferAttribute(posAttr, vi).applyMatrix4(meshWorldMatrix);

    let minDist = Infinity;
    for (const jPos of jointPositions) {
      const d = vWorld.distanceTo(jPos);
      if (d < minDist) minDist = d;
    }

    if (minDist <= pinRadius) {
      anchor[vi] = 1.0;
    } else if (minDist >= blendRadius) {
      anchor[vi] = 0.0;
    } else {
      const t = (minDist - pinRadius) / bandWidth;
      anchor[vi] = 1 - t * t * (3 - 2 * t);
    }
  }

  return anchor;
}

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
    totalEntropy += H / LOG2_4;
  }

  return totalEntropy / vertexCount;
}

export function diffusionSummary(result: DiffusionResult, maxIterations: number): string {
  const converged = result.finalMaxDelta < 5e-5;
  const entropy = computeWeightEntropy(result.skinWeight, result.vertexCount);

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
