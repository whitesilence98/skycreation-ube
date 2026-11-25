/**
 * lib/morphs/eyeBlinkMorphs.ts
 *
 * Builds standard ARKit / Unreal MetaHuman-compatible `eyeBlinkLeft` and
 * `eyeBlinkRight` relative GPU morph targets on UBE Head & Eyelash meshes,
 * while preserving pre-authored shape keys on imported MetaHuman / glTF models.
 */

import * as THREE from 'three';
import {
  expandSparseMorph,
  hasNamedMorphTarget,
  mergeNamedMorphTargets,
  type MorphTargetEntry,
  type SparseMorphDelta,
} from '@/lib/morphs/gpuMorphUtils';

export const BLINK_LEFT_ALIASES = [
  'eyeBlinkLeft',
  'EyeBlinkLeft',
  'Blink_L',
  'EyeBlink_L',
  'CTRL_expressions_eyeBlinkL',
] as const;

export const BLINK_RIGHT_ALIASES = [
  'eyeBlinkRight',
  'EyeBlinkRight',
  'Blink_R',
  'EyeBlink_R',
  'CTRL_expressions_eyeBlinkR',
] as const;

export const UBE_EYE_BLINK_URL = '/assets/morphs/head/ube-eye-blink.json';
const UBE_BLINK_FLAG = '__ubeProceduralBlink';
const UBE_HEAD_VERT_COUNTS: ReadonlySet<number> = new Set([11498, 11761]);
const UBE_LASH_VERT_COUNT = 1216;
const MANAGED_BLINK_NAMES: ReadonlySet<string> = new Set(['eyeBlinkLeft', 'eyeBlinkRight']);

export interface UbeEyeSideLandmark {
  upper: number;
  lower: number;
  baseClosingGap: number;
}

export interface UbeEyeBlinkHeadData {
  vertexCount: number;
  landmarks: {
    left: UbeEyeSideLandmark;
    right: UbeEyeSideLandmark;
  };
  eyeBlinkLeft: SparseMorphDelta;
  eyeBlinkRight: SparseMorphDelta;
}

export interface UbeEyeBlinkBundle {
  version: number;
  head: UbeEyeBlinkHeadData;
  headsByVertCount?: Record<string, UbeEyeBlinkHeadData>;
  lashes: {
    vertexCount: number;
    eyeBlinkLeft: SparseMorphDelta;
    eyeBlinkRight: SparseMorphDelta;
  };
}

let ubeBundlePromise: Promise<UbeEyeBlinkBundle | null> | null = null;
let ubeBundleCache: UbeEyeBlinkBundle | null = null;
let ubeBundleAttempted = false;

/** Fetches and caches UBE's sparse authored eye blink morph deltas. */
export async function loadUbeEyeBlinkData(): Promise<UbeEyeBlinkBundle | null> {
  if (ubeBundleCache) return ubeBundleCache;
  if (ubeBundlePromise) return ubeBundlePromise;

  ubeBundlePromise = (async () => {
    try {
      const res = await fetch(UBE_EYE_BLINK_URL);
      if (!res.ok) return null;
      const parsed = (await res.json()) as UbeEyeBlinkBundle;
      if (!parsed?.head?.eyeBlinkLeft || !parsed?.lashes?.eyeBlinkLeft) return null;
      ubeBundleCache = parsed;
      return parsed;
    } catch {
      return null;
    } finally {
      ubeBundleAttempted = true;
    }
  })();

  return ubeBundlePromise;
}

if (typeof window !== 'undefined') {
  void loadUbeEyeBlinkData();
}

export function getCachedUbeEyeBlinkData(): UbeEyeBlinkBundle | null {
  return ubeBundleCache;
}

export function hasUbeEyeBlinkSettled(): boolean {
  return ubeBundleAttempted;
}

export interface AttachBlinkOptions {
  force?: boolean;
  ubeData?: UbeEyeBlinkBundle | null;
}

interface SideBounds {
  minX: number;
  maxX: number;
  centerX: number;
  halfWidth: number;
  rimY: number;
  topY: number;
  bottomY: number;
  frontZ: number;
}

interface CorneaPoint {
  x: number;
  y: number;
  z: number;
}

function measureSideScale(
  pos: THREE.BufferAttribute | undefined,
  landmark: UbeEyeSideLandmark,
): number {
  if (!pos || pos.count <= Math.max(landmark.upper, landmark.lower)) return 1.0;
  const openGap = Math.max(0.002, pos.getY(landmark.upper) - pos.getY(landmark.lower));
  // Slight 6% seal bias prevents sub-millimeter midline sclera slivers across tall almond eye sculpts.
  return Math.min(1.36, Math.max(0.75, (openGap / Math.max(0.004, landmark.baseClosingGap)) * 1.06));
}

function collectAnteriorEyePoints(
  eyeGeo: THREE.BufferGeometry | null,
  isLeft: boolean,
): CorneaPoint[] {
  const pos = eyeGeo?.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return [];

  let maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (isLeft ? x <= 0.002 : x >= -0.002) continue;
    const z = pos.getZ(i);
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(maxZ)) return [];

  const minFrontZ = maxZ - 0.009;
  const points: CorneaPoint[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (isLeft ? x <= 0.002 : x >= -0.002) continue;
    const z = pos.getZ(i);
    if (z < minFrontZ) continue;
    points.push({ x, y: pos.getY(i), z });
  }
  return points;
}

function maxLocalCorneaZ(points: CorneaPoint[], x: number, y: number, radius = 0.0024): number {
  let maxZ = -Infinity;
  const r2 = radius * radius;
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const dx = pt.x - x;
    const dy = pt.y - y;
    if (dx * dx + dy * dy <= r2 && pt.z > maxZ) {
      maxZ = pt.z;
    }
  }
  return maxZ;
}

function enforceCorneaClearance(
  pos: THREE.BufferAttribute,
  deltas: Float32Array,
  eyePoints: CorneaPoint[],
): void {
  if (eyePoints.length === 0) return;

  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    const dy = deltas[o + 1];
    if (dy >= -0.001) continue;

    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);
    const eyeZ0 = maxLocalCorneaZ(eyePoints, x0, y0);
    if (!Number.isFinite(eyeZ0) || z0 < eyeZ0 - 0.0002) continue;

    const dx = deltas[o];
    let dz = deltas[o + 2];

    for (const frac of [0.5, 1.0]) {
      const eyeZ = maxLocalCorneaZ(eyePoints, x0 + dx * frac, y0 + dy * frac);
      if (!Number.isFinite(eyeZ)) continue;
      const reqZ = eyeZ + 0.0011;
      const curZ = z0 + dz * frac;
      if (curZ < reqZ) {
        const lift = (reqZ - curZ) / frac;
        if (lift > 0 && lift < 0.0045) {
          dz += lift;
        }
      }
    }
    deltas[o + 2] = dz;
  }
}

function measureLashSideBounds(
  lashesGeo: THREE.BufferGeometry | null,
  eyeGeo: THREE.BufferGeometry | null,
  isLeft: boolean,
): SideBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let count = 0;

  const scan = (geo: THREE.BufferGeometry | null) => {
    const pos = geo?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (isLeft ? x <= 0.002 : x >= -0.002) continue;
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
      count++;
    }
  };

  scan(lashesGeo);
  if (count === 0) scan(eyeGeo);

  if (count === 0) {
    const cx = isLeft ? 0.032 : -0.032;
    return {
      minX: cx - 0.017,
      maxX: cx + 0.017,
      centerX: cx,
      halfWidth: 0.017,
      rimY: 0.035,
      topY: 0.044,
      bottomY: 0.024,
      frontZ: 0.084,
    };
  }

  const centerX = (minX + maxX) * 0.5;
  const halfWidth = Math.max(0.013, (maxX - minX) * 0.52);
  return {
    minX,
    maxX,
    centerX,
    halfWidth,
    rimY: minY + (maxY - minY) * 0.54,
    topY: maxY + 0.007,
    bottomY: minY - 0.002,
    frontZ: maxZ,
  };
}

function buildFallbackBlinkDeltas(
  geo: THREE.BufferGeometry,
  side: SideBounds,
  dropScale: number,
): Float32Array | null {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return null;

  const deltas = new Float32Array(pos.count * 3);
  const lidTravel = Math.min(0.014, Math.max(0.007, (side.rimY - side.bottomY) * 0.92)) * dropScale;
  let movedCount = 0;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const dxNorm = Math.abs(x - side.centerX) / (side.halfWidth * 1.04);
    if (dxNorm >= 1) continue;
    if (z < side.frontZ - 0.022) continue;
    if (y < side.bottomY || y > side.topY) continue;

    const wx = Math.cos(dxNorm * Math.PI * 0.5);
    const wx2 = wx * wx;

    if (y >= side.rimY) {
      const t = (y - side.rimY) / Math.max(0.004, side.topY - side.rimY);
      const wy = Math.pow(Math.max(0, Math.cos(t * Math.PI * 0.5)), 1.45);
      const weight = wx2 * wy;
      if (weight < 0.005) continue;
      deltas[i * 3 + 1] = -lidTravel * 0.86 * weight;
      deltas[i * 3 + 2] = 0.0012 * weight;
      movedCount++;
    } else {
      const t = (side.rimY - y) / Math.max(0.004, side.rimY - side.bottomY);
      const wy = Math.pow(Math.max(0, 1 - t), 1.4);
      const weight = wx2 * wy;
      if (weight < 0.005) continue;
      deltas[i * 3 + 1] = lidTravel * 0.14 * weight;
      deltas[i * 3 + 2] = 0.0009 * weight;
      movedCount++;
    }
  }

  return movedCount > 0 ? deltas : null;
}

function attachBlinkPair(
  geo: THREE.BufferGeometry,
  leftDeltas: Float32Array | null,
  rightDeltas: Float32Array | null,
  force: boolean,
): boolean {
  const hasNativeBoth =
    hasNamedMorphTarget(geo, BLINK_LEFT_ALIASES) && hasNamedMorphTarget(geo, BLINK_RIGHT_ALIASES);
  if (hasNativeBoth && (!force || !geo.userData[UBE_BLINK_FLAG])) {
    return false;
  }

  const entries: MorphTargetEntry[] = [];
  if (leftDeltas) entries.push({ name: 'eyeBlinkLeft', deltas: leftDeltas });
  if (rightDeltas) entries.push({ name: 'eyeBlinkRight', deltas: rightDeltas });
  return mergeNamedMorphTargets(geo, entries, MANAGED_BLINK_NAMES, UBE_BLINK_FLAG);
}

function resolveUbeHeadBlinkData(
  ubeData: UbeEyeBlinkBundle | null | undefined,
  vertCount: number | undefined,
): UbeEyeBlinkHeadData | null {
  if (!ubeData || !vertCount) return null;
  const byCount = ubeData.headsByVertCount?.[String(vertCount)];
  if (byCount && byCount.vertexCount === vertCount && byCount.eyeBlinkLeft && byCount.eyeBlinkRight) {
    return byCount;
  }
  if (ubeData.head && ubeData.head.vertexCount === vertCount) {
    return ubeData.head;
  }
  return null;
}

/**
 * Ensures `headGeo` and `lashesGeo` carry `eyeBlinkLeft` and `eyeBlinkRight`
 * relative morph targets + morph normals. Preserves any pre-authored
 * MetaHuman or glTF blink shape keys untouched.
 */
export function attachBlinkMorphTargets(
  headGeo: THREE.BufferGeometry | null,
  lashesGeo: THREE.BufferGeometry | null,
  eyeGeo: THREE.BufferGeometry | null,
  options?: AttachBlinkOptions,
): boolean {
  if (!headGeo && !lashesGeo) return false;

  const force = Boolean(options?.force);
  const ubeData = options?.ubeData ?? ubeBundleCache;

  const headPos = headGeo?.getAttribute('position') as THREE.BufferAttribute | undefined;
  const lashPos = lashesGeo?.getAttribute('position') as THREE.BufferAttribute | undefined;

  const needsUbeWait =
    !ubeData &&
    !ubeBundleAttempted &&
    ((headPos !== undefined && UBE_HEAD_VERT_COUNTS.has(headPos.count)) ||
      lashPos?.count === UBE_LASH_VERT_COUNT);
  if (needsUbeWait) return false;

  const ubeHead = resolveUbeHeadBlinkData(ubeData, headPos?.count);
  const isUbeHead = Boolean(ubeHead && headPos);
  const isUbeLashes = Boolean(ubeData && lashPos && lashPos.count === ubeData.lashes.vertexCount);

  const leftScale = ubeHead && headPos ? measureSideScale(headPos, ubeHead.landmarks.left) : 1.0;
  const rightScale = ubeHead && headPos ? measureSideScale(headPos, ubeHead.landmarks.right) : 1.0;

  const leftBounds = isUbeHead ? null : measureLashSideBounds(lashesGeo, eyeGeo, true);
  const rightBounds = isUbeHead ? null : measureLashSideBounds(lashesGeo, eyeGeo, false);

  let updated = false;

  if (headGeo && headPos) {
    let leftDeltas: Float32Array | null = null;
    let rightDeltas: Float32Array | null = null;

    if (ubeHead) {
      leftDeltas = expandSparseMorph(headPos.count, ubeHead.eyeBlinkLeft, leftScale);
      rightDeltas = expandSparseMorph(headPos.count, ubeHead.eyeBlinkRight, rightScale);
      if (eyeGeo) {
        enforceCorneaClearance(headPos, leftDeltas, collectAnteriorEyePoints(eyeGeo, true));
        enforceCorneaClearance(headPos, rightDeltas, collectAnteriorEyePoints(eyeGeo, false));
      }
    } else if (leftBounds && rightBounds) {
      leftDeltas = buildFallbackBlinkDeltas(headGeo, leftBounds, 1.0);
      rightDeltas = buildFallbackBlinkDeltas(headGeo, rightBounds, 1.0);
    }

    updated = attachBlinkPair(headGeo, leftDeltas, rightDeltas, force) || updated;
  }

  if (lashesGeo && lashPos) {
    let leftDeltas: Float32Array | null = null;
    let rightDeltas: Float32Array | null = null;

    if (isUbeLashes && ubeData) {
      leftDeltas = expandSparseMorph(lashPos.count, ubeData.lashes.eyeBlinkLeft, leftScale, true);
      rightDeltas = expandSparseMorph(lashPos.count, ubeData.lashes.eyeBlinkRight, rightScale, true);
    } else {
      const lb = leftBounds ?? measureLashSideBounds(lashesGeo, eyeGeo, true);
      const rb = rightBounds ?? measureLashSideBounds(lashesGeo, eyeGeo, false);
      leftDeltas = buildFallbackBlinkDeltas(lashesGeo, lb, 1.05);
      rightDeltas = buildFallbackBlinkDeltas(lashesGeo, rb, 1.05);
    }

    updated = attachBlinkPair(lashesGeo, leftDeltas, rightDeltas, force) || updated;
  }

  return updated;
}
