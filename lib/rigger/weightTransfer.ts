/**
 * lib/rigger/weightTransfer.ts
 *
 * Skin Weight Transfer — Phase 3 of the CC-Kit Auto-Rigger pipeline.
 *
 * For every vertex of the input mesh, computes which bones influence it
 * and by how much, producing the `skinIndex` and `skinWeight` buffer
 * attributes required by glTF 2.0 / Three.js SkinnedMesh.
 *
 * Pure geometric algorithm — no ML model weights, no proprietary data.
 *
 * Usage:
 *   import { transferWeights } from '@/lib/rigger/weightTransfer';
 */

import * as THREE from 'three';
import {
  ALL_RIG_BONE_DEFS,
  type BoneRegion,
  type RigBoneName,
} from '@/lib/rigger/vrmSkeleton';
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

type BoneSide = 'left' | 'right' | 'centre';

interface Segment3 {
  ax: number; ay: number; az: number;
  dx: number; dy: number; dz: number; // unit direction
  len: number;
}

interface BoneCache {
  index: number;
  name: RigBoneName;
  side: BoneSide;
  region: BoneRegion;
  segStart: THREE.Vector3;
  segEnd: THREE.Vector3;
  segDir: THREE.Vector3;
  segLen: number;
}

interface RegionContext {
  midX: number;
  hipY: number;
  groinY: number | undefined;
  neckY: number;
  headY: number;
  shoulderY: number;
  shoulderWidth: number;
  hipWidth: number;
  maxLegX: number;
  scale: number;
  leftArmSegs: Segment3[];
  rightArmSegs: Segment3[];
  leftLegSegs: Segment3[];
  rightLegSegs: Segment3[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Bone & segment cache builders
// ─────────────────────────────────────────────────────────────────────────────

function getBoneSide(name: string): BoneSide {
  if (name.startsWith('left')) return 'left';
  if (name.startsWith('right')) return 'right';
  return 'centre';
}

function makeSegment(a: THREE.Vector3, b: THREE.Vector3): Segment3 {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const vz = b.z - a.z;
  const len = Math.hypot(vx, vy, vz);
  if (len > 1e-6) {
    return { ax: a.x, ay: a.y, az: a.z, dx: vx / len, dy: vy / len, dz: vz / len, len };
  }
  return { ax: a.x, ay: a.y, az: a.z, dx: 0, dy: 1, dz: 0, len: 0 };
}

function minDistToSegments(px: number, py: number, pz: number, segs: Segment3[]): number {
  let bestSq = Infinity;
  for (const s of segs) {
    const rx = px - s.ax;
    const ry = py - s.ay;
    const rz = pz - s.az;
    const t = Math.max(0, Math.min(s.len, rx * s.dx + ry * s.dy + rz * s.dz));
    const cx = s.ax + t * s.dx;
    const cy = s.ay + t * s.dy;
    const cz = s.az + t * s.dz;
    const dSq = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
    if (dSq < bestSq) bestSq = dSq;
  }
  return Math.sqrt(bestSq);
}

/**
 * Builds per-bone segment cache from the fitted skeleton's world positions.
 * Segments run from each bone's world position to the centroid of its children,
 * and leaf bone stubs extend along the parent → bone direction.
 */
function buildBoneCache(fitResult: FitResult): BoneCache[] {
  const { built, worldPositions, scale } = fitResult;
  const defByName = new Map(ALL_RIG_BONE_DEFS.map((d) => [d.name, d]));
  const cache: BoneCache[] = [];

  for (let i = 0; i < built.bones.length; i++) {
    const bone = built.bones[i]!;
    const name = bone.name as RigBoneName;
    const def = defByName.get(name);
    if (!def) continue;

    const segStart = worldPositions.get(name) ?? bone.getWorldPosition(new THREE.Vector3());

    // Prefer non-secondary children for core VRM bone segment direction so
    // optional breast/glute attachments don't skew spine/upperChest segments.
    const childBones = bone.children.filter((c): c is THREE.Bone => {
      if (!(c as THREE.Bone).isBone) return false;
      if (def.region !== 'secondary') {
        const cDef = defByName.get(c.name as RigBoneName);
        if (cDef?.region === 'secondary') return false;
      }
      return true;
    });

    let segEnd: THREE.Vector3;
    if (childBones.length > 0) {
      segEnd = new THREE.Vector3();
      for (const child of childBones) {
        const childPos = worldPositions.get(child.name as RigBoneName)
          ?? child.getWorldPosition(new THREE.Vector3());
        segEnd.add(childPos);
      }
      segEnd.divideScalar(childBones.length);
    } else {
      // Leaf bone: orient stub along parent -> bone direction so A-pose hands/fingers/toes
      // extend cleanly along the actual limb orientation rather than hardcoded +Y.
      const dir = new THREE.Vector3(0, 1, 0);
      if (bone.parent && (bone.parent as THREE.Bone).isBone) {
        const parentPos = worldPositions.get(bone.parent.name as RigBoneName)
          ?? bone.parent.getWorldPosition(new THREE.Vector3());
        const diff = new THREE.Vector3().subVectors(segStart, parentPos);
        if (diff.lengthSq() > 1e-8) {
          dir.copy(diff).normalize();
        }
      }
      const stubLen = (name === 'leftHand' || name === 'rightHand' || name === 'head')
        ? 0.08 * scale
        : 0.03 * scale;
      segEnd = segStart.clone().addScaledVector(dir, stubLen);
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
      segEnd: segEnd.clone(),
      segDir,
      segLen,
    });
  }

  return cache;
}

function buildRegionContext(fitResult: FitResult): RegionContext {
  const wp = fitResult.worldPositions;
  const hipPos = wp.get('hips');
  const neckPos = wp.get('neck');
  const headPos = wp.get('head');
  const lUpperArm = wp.get('leftUpperArm');
  const lLowerArm = wp.get('leftLowerArm');
  const lHand = wp.get('leftHand');
  const rUpperArm = wp.get('rightUpperArm');
  const rLowerArm = wp.get('rightLowerArm');
  const rHand = wp.get('rightHand');
  const lUpperLeg = wp.get('leftUpperLeg');
  const lLowerLeg = wp.get('leftLowerLeg');
  const lFoot = wp.get('leftFoot');
  const rUpperLeg = wp.get('rightUpperLeg');
  const rLowerLeg = wp.get('rightLowerLeg');
  const rFoot = wp.get('rightFoot');

  const midX = hipPos?.x ?? 0;
  const scale = fitResult.scale;

  const buildArmChain = (
    upper: THREE.Vector3 | undefined,
    lower: THREE.Vector3 | undefined,
    hand: THREE.Vector3 | undefined,
  ): Segment3[] => {
    const segs: Segment3[] = [];
    if (upper && lower) segs.push(makeSegment(upper, lower));
    if (lower && hand) {
      segs.push(makeSegment(lower, hand));
      const tipDir = new THREE.Vector3().subVectors(hand, lower);
      if (tipDir.lengthSq() > 1e-8) {
        tipDir.normalize();
        segs.push(makeSegment(hand, hand.clone().addScaledVector(tipDir, 0.14 * scale)));
      }
    }
    return segs;
  };

  const buildLegChain = (
    upper: THREE.Vector3 | undefined,
    lower: THREE.Vector3 | undefined,
    foot: THREE.Vector3 | undefined,
  ): Segment3[] => {
    const segs: Segment3[] = [];
    if (upper && lower) segs.push(makeSegment(upper, lower));
    if (lower && foot) segs.push(makeSegment(lower, foot));
    return segs;
  };

  const legXs = [lUpperLeg, lLowerLeg, lFoot, rUpperLeg, rLowerLeg, rFoot]
    .filter((v): v is THREE.Vector3 => Boolean(v))
    .map((v) => Math.abs(v.x - midX));
  const maxLegX = Math.max(fitResult.hipWidth * 0.65, ...(legXs.length > 0 ? legXs : [0.12 * scale])) + 0.07 * scale;

  const shoulderY =
    lUpperArm && rUpperArm
      ? (lUpperArm.y + rUpperArm.y) * 0.5
      : (neckPos?.y ?? 1.4);

  return {
    midX,
    hipY: hipPos?.y ?? 0.9,
    groinY: fitResult.groinY,
    neckY: neckPos?.y ?? 1.4,
    headY: headPos?.y ?? 1.6,
    shoulderY,
    shoulderWidth: fitResult.shoulderWidth,
    hipWidth: fitResult.hipWidth,
    maxLegX,
    scale,
    leftArmSegs: buildArmChain(lUpperArm, lLowerArm, lHand),
    rightArmSegs: buildArmChain(rUpperArm, rLowerArm, rHand),
    leftLegSegs: buildLegChain(lUpperLeg, lLowerLeg, lFoot),
    rightLegSegs: buildLegChain(rUpperLeg, rLowerLeg, rFoot),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Distance to bone segment
// ─────────────────────────────────────────────────────────────────────────────

function distSqToSegment(
  px: number,
  py: number,
  pz: number,
  bc: BoneCache,
): number {
  const dx = px - bc.segStart.x;
  const dy = py - bc.segStart.y;
  const dz = pz - bc.segStart.z;
  const t = Math.max(0, Math.min(bc.segLen, dx * bc.segDir.x + dy * bc.segDir.y + dz * bc.segDir.z));

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

function bilateralMask(
  vertexX: number,
  midX: number,
  side: BoneSide,
  strength: number,
  hipWidth: number,
): number {
  if (side === 'centre' || strength <= 0) return 1.0;

  const band = Math.max(0.02, hipWidth * 0.1);
  const relX = vertexX - midX;
  const signed = side === 'left' ? relX : -relX;
  const t = Math.max(0, Math.min(1, (signed + band) / (2 * band)));
  const smooth = t * t * (3 - 2 * t);

  return 1.0 - strength * (1.0 - smooth);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Region-affinity mask (A-pose & groin aware)
// ─────────────────────────────────────────────────────────────────────────────

type VertexRegion = 'spine' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

function classifyVertexRegion(
  px: number,
  py: number,
  pz: number,
  ctx: RegionContext,
): VertexRegion {
  // Above neck → head
  if (py > ctx.neckY + (ctx.headY - ctx.neckY) * 0.3) return 'head';

  const relX = px - ctx.midX;
  const absRelX = Math.abs(relX);

  // Check arm chains FIRST so lowered A-pose arms/elbows/wrists/hands hanging
  // below hipY are classified as leftArm/rightArm instead of leftLeg/rightLeg,
  // while requiring proximity to the arm chain so wide flared skirts in T-pose
  // aren't misclassified as arms.
  if (py <= ctx.shoulderY + 0.12 * ctx.scale && absRelX > ctx.shoulderWidth * 0.42) {
    const maxArmReach = 0.28 * ctx.scale;
    if (relX > 0 && ctx.leftArmSegs.length > 0) {
      const armDist = minDistToSegments(px, py, pz, ctx.leftArmSegs);
      const legDist = ctx.leftLegSegs.length > 0 ? minDistToSegments(px, py, pz, ctx.leftLegSegs) : Infinity;
      if (armDist < maxArmReach && (armDist < legDist * 0.85 || (py >= ctx.hipY && absRelX > ctx.maxLegX))) {
        return 'leftArm';
      }
    } else if (relX < 0 && ctx.rightArmSegs.length > 0) {
      const armDist = minDistToSegments(px, py, pz, ctx.rightArmSegs);
      const legDist = ctx.rightLegSegs.length > 0 ? minDistToSegments(px, py, pz, ctx.rightLegSegs) : Infinity;
      if (armDist < maxArmReach && (armDist < legDist * 0.85 || (py >= ctx.hipY && absRelX > ctx.maxLegX))) {
        return 'rightArm';
      }
    }
  }

  // Pelvis / groin split: when groinY is known, keep midline pelvis above groinY
  // in 'spine' and classify below groinY (or laterally outside core pelvis) as leg.
  if (ctx.groinY !== undefined) {
    if (py < ctx.groinY) {
      return relX >= 0 ? 'leftLeg' : 'rightLeg';
    }
    if (py < ctx.hipY && absRelX > ctx.hipWidth * 0.35) {
      return relX >= 0 ? 'leftLeg' : 'rightLeg';
    }
  } else if (py < ctx.hipY) {
    return relX >= 0 ? 'leftLeg' : 'rightLeg';
  }

  const halfShoulder = ctx.shoulderWidth * 0.52;
  if (relX > halfShoulder) return 'leftArm';
  if (relX < -halfShoulder) return 'rightArm';

  return 'spine';
}

const REGION_AFFINITY: Record<BoneRegion, Partial<Record<VertexRegion, number>>> = {
  spine:       { spine: 1.0,  head: 0.4,  leftArm: 0.3,  rightArm: 0.3,  leftLeg: 0.3, rightLeg: 0.3 },
  head:        { head:  1.0,  spine: 0.2 },
  leftArm:     { leftArm: 1.0,  spine: 0.4 },
  rightArm:    { rightArm: 1.0, spine: 0.4 },
  leftLeg:     { leftLeg: 1.0,  spine: 0.3 },
  rightLeg:    { rightLeg: 1.0, spine: 0.3 },
  leftFinger:  { leftArm: 1.0 },
  rightFinger: { rightArm: 1.0 },
  secondary:   { spine: 1.0, leftLeg: 0.75, rightLeg: 0.75 },
};

function regionAffinityMask(
  boneRegion: BoneRegion,
  vertexRegion: VertexRegion,
  strength: number,
): number {
  if (strength <= 0) return 1.0;
  const affinity = REGION_AFFINITY[boneRegion]?.[vertexRegion] ?? 0.05;
  return 1.0 - strength * (1.0 - affinity);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Per-vertex weight scoring & packing (shared by sync and async paths)
// ─────────────────────────────────────────────────────────────────────────────

// Module-level fixed-capacity scratch buffers for zero-GC top-K scoring per vertex.
const _topBoneIdx = new Int32Array(4);
const _topScore   = new Float64Array(4);

const VREGION_INDEX: Readonly<Record<VertexRegion, number>> = {
  spine: 0,
  head: 1,
  leftArm: 2,
  rightArm: 3,
  leftLeg: 4,
  rightLeg: 5,
};

interface FlatBoneArrays {
  count: number;
  boneIndex: Uint16Array;
  sideCode: Uint8Array; // 0 = centre, 1 = left, 2 = right
  segAx: Float64Array;
  segAy: Float64Array;
  segAz: Float64Array;
  segDx: Float64Array;
  segDy: Float64Array;
  segDz: Float64Array;
  segLen: Float64Array;
  /** Precomputed affinity table [bi * 6 + vRegionIdx] for zero lookups inside hot loop. */
  affinityTable: Float64Array;
}

function flattenBoneCache(boneCache: BoneCache[], regionStrength: number): FlatBoneArrays {
  const count = boneCache.length;
  const boneIndex = new Uint16Array(count);
  const sideCode = new Uint8Array(count);
  const segAx = new Float64Array(count);
  const segAy = new Float64Array(count);
  const segAz = new Float64Array(count);
  const segDx = new Float64Array(count);
  const segDy = new Float64Array(count);
  const segDz = new Float64Array(count);
  const segLen = new Float64Array(count);
  const affinityTable = new Float64Array(count * 6);
  const regions: VertexRegion[] = ['spine', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

  for (let i = 0; i < count; i++) {
    const bc = boneCache[i]!;
    boneIndex[i] = bc.index;
    sideCode[i] = bc.side === 'left' ? 1 : bc.side === 'right' ? 2 : 0;
    segAx[i] = bc.segStart.x;
    segAy[i] = bc.segStart.y;
    segAz[i] = bc.segStart.z;
    segDx[i] = bc.segDir.x;
    segDy[i] = bc.segDir.y;
    segDz[i] = bc.segDir.z;
    segLen[i] = bc.segLen;
    for (let r = 0; r < 6; r++) {
      affinityTable[i * 6 + r] = regionAffinityMask(bc.region, regions[r]!, regionStrength);
    }
  }

  return { count, boneIndex, sideCode, segAx, segAy, segAz, segDx, segDy, segDz, segLen, affinityTable };
}

function scoreVertexAndPack(
  vi: number,
  px: number,
  py: number,
  pz: number,
  flat: FlatBoneArrays,
  ctx: RegionContext,
  falloffExp: number,
  bilateralStrength: number,
  maxInfluences: number,
  minWeight: number,
  skinIndex: Uint16Array,
  skinWeight: Float32Array,
  boneVertexCounts: Uint32Array,
  boneCount: number,
): void {
  const EPS = 1e-6;
  const affBase = VREGION_INDEX[classifyVertexRegion(px, py, pz, ctx)];

  // Precompute left/right bilateral masks once per vertex (independent of bone)
  let maskLeft = 1.0;
  let maskRight = 1.0;
  if (bilateralStrength > 0) {
    const band = Math.max(0.02, ctx.hipWidth * 0.1);
    const inv2Band = 1 / (2 * band);
    const relX = px - ctx.midX;

    const tL = Math.max(0, Math.min(1, (relX + band) * inv2Band));
    maskLeft = 1.0 - bilateralStrength * (1.0 - tL * tL * (3 - 2 * tL));

    const tR = Math.max(0, Math.min(1, (-relX + band) * inv2Band));
    maskRight = 1.0 - bilateralStrength * (1.0 - tR * tR * (3 - 2 * tR));
  }

  const isSqFalloff = Math.abs(falloffExp - 2) < 1e-4;
  const isLinFalloff = Math.abs(falloffExp - 1) < 1e-4;
  const halfExp = falloffExp * 0.5;

  const { count, boneIndex, sideCode, segAx, segAy, segAz, segDx, segDy, segDz, segLen, affinityTable } = flat;
  let topCount = 0;

  for (let bi = 0; bi < count; bi++) {
    const rx = px - segAx[bi]!;
    const ry = py - segAy[bi]!;
    const rz = pz - segAz[bi]!;
    const dx = segDx[bi]!;
    const dy = segDy[bi]!;
    const dz = segDz[bi]!;
    let t = rx * dx + ry * dy + rz * dz;
    const len = segLen[bi]!;
    if (t < 0) t = 0;
    else if (t > len) t = len;

    const ex = rx - t * dx;
    const ey = ry - t * dy;
    const ez = rz - t * dz;
    const dSq = ex * ex + ey * ey + ez * ez;

    const distPow = isSqFalloff ? dSq : isLinFalloff ? Math.sqrt(dSq) : Math.pow(dSq, halfExp);
    const side = sideCode[bi]!;
    const bMask = side === 1 ? maskLeft : side === 2 ? maskRight : 1.0;
    const score = (bMask * affinityTable[bi * 6 + affBase]!) / (distPow + EPS);
    if (score <= EPS) continue;

    if (topCount < maxInfluences) {
      let pos = topCount++;
      while (pos > 0 && _topScore[pos - 1]! < score) {
        _topScore[pos] = _topScore[pos - 1]!;
        _topBoneIdx[pos] = _topBoneIdx[pos - 1]!;
        pos--;
      }
      _topScore[pos] = score;
      _topBoneIdx[pos] = boneIndex[bi]!;
    } else if (score > _topScore[maxInfluences - 1]!) {
      let pos = maxInfluences - 1;
      while (pos > 0 && _topScore[pos - 1]! < score) {
        _topScore[pos] = _topScore[pos - 1]!;
        _topBoneIdx[pos] = _topBoneIdx[pos - 1]!;
        pos--;
      }
      _topScore[pos] = score;
      _topBoneIdx[pos] = boneIndex[bi]!;
    }
  }

  let weightSum = 0;
  for (let s = 0; s < topCount; s++) weightSum += _topScore[s]!;

  const base = vi * 4;
  let primaryBone = 0;
  let primaryWeight = 0;

  for (let s = 0; s < topCount; s++) {
    let w = weightSum > 0 ? _topScore[s]! / weightSum : 0;
    if (w < minWeight) w = 0;
    const boneIdx = _topBoneIdx[s]!;
    skinIndex[base + s] = boneIdx;
    skinWeight[base + s] = w;
    if (w > primaryWeight) {
      primaryWeight = w;
      primaryBone = boneIdx;
    }
  }

  for (let s = topCount; s < 4; s++) {
    skinIndex[base + s] = 0;
    skinWeight[base + s] = 0;
  }

  let finalSum = 0;
  for (let s = 0; s < 4; s++) finalSum += skinWeight[base + s]!;
  if (finalSum > 0) {
    const invSum = 1 / finalSum;
    for (let s = 0; s < 4; s++) skinWeight[base + s]! *= invSum;
  } else {
    skinIndex[base] = 0;
    skinWeight[base] = 1.0;
    primaryBone = 0;
  }

  if (primaryBone < boneCount) {
    boneVertexCounts[primaryBone]!++;
  }
}

function prepareTransferParams(
  geometry: THREE.BufferGeometry,
  fitResult: FitResult,
  options: WeightTransferOptions,
) {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('[weightTransfer] Geometry has no position attribute.');
  }

  const maxInfluences = Math.min(4, Math.max(1, options.maxInfluences ?? 4));
  const falloffExp = Math.max(0.5, options.falloffExponent ?? 2);
  const minWeight = options.minWeight ?? 0.001;
  const bilateralStrength = Math.max(0, Math.min(1, options.bilateralStrength ?? 0.85));
  const regionStrength = Math.max(0, Math.min(1, options.regionAffinityStrength ?? 0.6));
  const vertexCount = posAttr.count;
  const batchSize = options.batchSize ?? (vertexCount > 100000 ? 15000 : 4000);
  const onProgress = options.onProgress;

  const boneCache = buildBoneCache(fitResult);
  const flatBones = flattenBoneCache(boneCache, regionStrength);
  const boneCount = fitResult.built.bones.length;
  const ctx = buildRegionContext(fitResult);

  const skinIndex = new Uint16Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);
  const boneVertexCounts = new Uint32Array(boneCount);

  return {
    posAttr,
    maxInfluences,
    falloffExp,
    minWeight,
    bilateralStrength,
    batchSize,
    onProgress,
    flatBones,
    boneCount,
    ctx,
    vertexCount,
    skinIndex,
    skinWeight,
    boneVertexCounts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Main weight transfer function
// ─────────────────────────────────────────────────────────────────────────────

export function transferWeights(
  geometry: THREE.BufferGeometry,
  fitResult: FitResult,
  meshWorldMatrix: THREE.Matrix4 = new THREE.Matrix4(),
  options: WeightTransferOptions = {},
): WeightTransferResult {
  const p = prepareTransferParams(geometry, fitResult, options);
  const vWorld = new THREE.Vector3();

  for (let vi = 0; vi < p.vertexCount; vi++) {
    vWorld.fromBufferAttribute(p.posAttr, vi).applyMatrix4(meshWorldMatrix);
    scoreVertexAndPack(
      vi,
      vWorld.x,
      vWorld.y,
      vWorld.z,
      p.flatBones,
      p.ctx,
      p.falloffExp,
      p.bilateralStrength,
      p.maxInfluences,
      p.minWeight,
      p.skinIndex,
      p.skinWeight,
      p.boneVertexCounts,
      p.boneCount,
    );

    if (p.onProgress && (vi + 1) % p.batchSize === 0) {
      p.onProgress((vi + 1) / p.vertexCount);
    }
  }

  if (p.onProgress) p.onProgress(1.0);

  const activeBoneCount = p.boneVertexCounts.reduce((acc, c) => acc + (c > 0 ? 1 : 0), 0);
  return {
    skinIndex: p.skinIndex,
    skinWeight: p.skinWeight,
    vertexCount: p.vertexCount,
    activeBoneCount,
    boneVertexCounts: p.boneVertexCounts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Apply weights to a Three.js geometry
// ─────────────────────────────────────────────────────────────────────────────

export function applyWeightsToGeometry(
  geometry: THREE.BufferGeometry,
  fitResult: FitResult,
  meshWorldMatrix?: THREE.Matrix4,
  options?: WeightTransferOptions,
): THREE.BufferGeometry {
  const result = transferWeights(geometry, fitResult, meshWorldMatrix, options);
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(result.skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(result.skinWeight, 4));
  return geometry;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Async wrapper (event-loop friendly)
// ─────────────────────────────────────────────────────────────────────────────

export async function transferWeightsAsync(
  geometry: THREE.BufferGeometry,
  fitResult: FitResult,
  meshWorldMatrix: THREE.Matrix4 = new THREE.Matrix4(),
  options: WeightTransferOptions = {},
): Promise<WeightTransferResult> {
  const p = prepareTransferParams(geometry, fitResult, options);
  const vWorld = new THREE.Vector3();
  let vi = 0;

  const processBatch = (): boolean => {
    const end = Math.min(vi + p.batchSize, p.vertexCount);
    for (; vi < end; vi++) {
      vWorld.fromBufferAttribute(p.posAttr, vi).applyMatrix4(meshWorldMatrix);
      scoreVertexAndPack(
        vi,
        vWorld.x,
        vWorld.y,
        vWorld.z,
        p.flatBones,
        p.ctx,
        p.falloffExp,
        p.bilateralStrength,
        p.maxInfluences,
        p.minWeight,
        p.skinIndex,
        p.skinWeight,
        p.boneVertexCounts,
        p.boneCount,
      );
    }
    if (p.onProgress) p.onProgress(vi / p.vertexCount);
    return vi >= p.vertexCount;
  };

  await new Promise<void>((resolve) => {
    const tick = () => {
      if (processBatch()) resolve();
      else setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  });

  if (p.onProgress) p.onProgress(1.0);

  const activeBoneCount = p.boneVertexCounts.reduce((acc, c) => acc + (c > 0 ? 1 : 0), 0);
  return {
    skinIndex: p.skinIndex,
    skinWeight: p.skinWeight,
    vertexCount: p.vertexCount,
    activeBoneCount,
    boneVertexCounts: p.boneVertexCounts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Diagnostic helpers
// ─────────────────────────────────────────────────────────────────────────────

export function buildWeightHeatmapColors(
  result: Pick<WeightTransferResult, 'skinIndex' | 'skinWeight' | 'vertexCount'>,
  boneCount: number,
): Float32Array {
  const colors = new Float32Array(result.vertexCount * 3);

  for (let vi = 0; vi < result.vertexCount; vi++) {
    const base = vi * 4;
    let bestSlot = 0;
    let bestW = result.skinWeight[base] ?? 0;
    for (let s = 1; s < 4; s++) {
      const w = result.skinWeight[base + s] ?? 0;
      if (w > bestW) {
        bestW = w;
        bestSlot = s;
      }
    }

    const primaryBone = result.skinIndex[base + bestSlot]!;
    const hue = (primaryBone / Math.max(1, boneCount)) * 360;
    const [r, g, b] = hslToRgb(hue, 0.85, 0.55);

    colors[vi * 3 + 0] = r;
    colors[vi * 3 + 1] = g;
    colors[vi * 3 + 2] = b;
  }

  return colors;
}

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

export function weightTransferSummary(
  result: WeightTransferResult,
  boneNames: string[],
): string {
  const lines: string[] = [
    `Vertices:       ${result.vertexCount}`,
    `Active bones:   ${result.activeBoneCount} / ${boneNames.length}`,
  ];

  let totalInfluences = 0;
  for (let vi = 0; vi < result.vertexCount; vi++) {
    const base = vi * 4;
    for (let s = 0; s < 4; s++) {
      if (result.skinWeight[base + s]! > 0) totalInfluences++;
    }
  }
  lines.push(`Avg influences: ${(totalInfluences / Math.max(1, result.vertexCount)).toFixed(1)}`);

  const dead = boneNames.filter((_, i) => (result.boneVertexCounts[i] ?? 0) === 0);
  if (dead.length > 0) {
    lines.push(`Dead bones (0 primary verts): ${dead.join(', ')}`);
  }

  return lines.join('\n');
}
