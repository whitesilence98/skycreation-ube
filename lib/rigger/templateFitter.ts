/**
 * lib/rigger/templateFitter.ts
 *
 * Template Skeleton Fitter — Phase 2 of the CC-Kit Auto-Rigger pipeline.
 *
 * Takes the VRM T-pose template skeleton (from `vrmSkeleton.ts`) and
 * warps it to match a target humanoid mesh using 7 anatomical landmarks.
 *
 * Algorithm overview:
 *   1. Measure — derive character height + proportional scale from landmarks.
 *   2. Place spine — fit hips → spine → chest → upperChest → neck → head
 *      by lerping between the hip-centre and neck-base landmarks.
 *   3. Place legs — fit upper/lower leg + foot for each side from hip→ankle.
 *   4. Place arms — fit shoulder → upper arm → lower arm → hand, extending
 *      laterally from the shoulder landmark using scaled anatomical ratios.
 *   5. Place fingers & toes — proportional sub-chains off their root joints.
 *   6. Convert world positions → local positions, respecting the bone hierarchy.
 *   7. Recompute matrices and return a skeleton ready for weight transfer.
 *
 * All maths uses publicly documented anatomical ratios (Winter 1990, De Leva
 * 1996 — public domain). No XPMSE, Bethesda, or Mixamo code.
 *
 * Usage:
 *   import { fitSkeletonToLandmarks } from '@/lib/rigger/templateFitter';
 */

import * as THREE from 'three';
import {
  buildTPoseSkeleton,
  BONE_LANDMARK_BINDINGS,
  VRM_BONE_BY_NAME,
  VRM_BONE_DEFS,
  type BuiltSkeleton,
  type LandmarkMap,
  type VrmBoneName,
} from '@/lib/rigger/vrmSkeleton';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface FitOptions {
  /**
   * When true, only required VRM 1.0 bones are created (22 bones — no fingers,
   * no face). Faster; suitable for game characters that don't need finger IK.
   * Default: false (all 54 bones).
   */
  requiredOnly?: boolean;

  /**
   * Clamp scale to a reasonable human range [0.5 m, 3.0 m].
   * Prevents degenerate skeletons from bad landmarks. Default: true.
   */
  clampScale?: boolean;
}

export interface FitResult {
  /** Fitted skeleton, ready to be used as a binding skeleton for a mesh. */
  built: BuiltSkeleton;

  /** Computed character height in metres (headTop → lowest ankle). */
  characterHeight: number;

  /**
   * Uniform scale relative to the 1.70 m reference figure.
   * `targetHeight / 1.70`.
   */
  scale: number;

  /**
   * World-space positions of every bone after fitting.
   * Useful for debugging overlays and weight-transfer queries.
   */
  worldPositions: Map<VrmBoneName, THREE.Vector3>;

  /**
   * Shoulder width in metres (distance between the two shoulder landmarks).
   * Stored for downstream weight-transfer to gauge arm region extents.
   */
  shoulderWidth: number;

  /**
   * Hip width in metres (distance between the two hip landmarks).
   */
  hipWidth: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Linear interpolation between two Vector3 values. */
function lerpVec3(a: THREE.Vector3, b: THREE.Vector3, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.lerpVectors(a, b, t);
}

/**
 * Clamps a number into [min, max].
 */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// Reference figure height used when authoring `VRM_BONE_DEFS` local positions.
const REFERENCE_HEIGHT_M = 1.70;

// ─────────────────────────────────────────────────────────────────────────────
// Derived landmark geometry
// ─────────────────────────────────────────────────────────────────────────────

interface LandmarkGeometry {
  /** Uniform scale factor (targetHeight / 1.70). */
  scale: number;
  characterHeight: number;
  hipCentre: THREE.Vector3;
  spineAxis: THREE.Vector3;      // unit vector from hipCentre toward neckBase
  leftAxis: THREE.Vector3;       // unit vector pointing to character's left (+X in T-pose)
  forwardAxis: THREE.Vector3;    // unit vector pointing forward (+Z in T-pose)
  shoulderWidth: number;
  hipWidth: number;
  /** Left side arm reach: shoulder → wrist, metres */
  leftArmReach: number;
  /** Right side arm reach: shoulder → wrist, metres */
  rightArmReach: number;
}

/**
 * Derives all measurements needed for skeleton fitting from the 7 raw landmarks.
 */
function deriveLandmarkGeometry(lm: LandmarkMap, clampScale: boolean): LandmarkGeometry {
  // Height: from lowest ankle to head top
  const floorY = Math.min(lm.leftAnkle.y, lm.rightAnkle.y);
  const characterHeight = lm.headTop.y - floorY;
  let scale = characterHeight / REFERENCE_HEIGHT_M;
  if (clampScale) {
    scale = clamp(scale, 0.5 / REFERENCE_HEIGHT_M, 3.0 / REFERENCE_HEIGHT_M);
  }

  // Hip centre: average of left/right hip landmarks
  const hipCentre = new THREE.Vector3()
    .addVectors(lm.leftHip, lm.rightHip)
    .multiplyScalar(0.5);

  // Hip width
  const hipWidth = lm.leftHip.distanceTo(lm.rightHip);

  // Shoulder width
  const shoulderWidth = lm.leftShoulder.distanceTo(lm.rightShoulder);

  // Spine axis: hip centre → neck base, normalised
  const spineAxis = new THREE.Vector3()
    .subVectors(lm.neckBase, hipCentre)
    .normalize();

  // Left axis: from right shoulder to left shoulder, projected onto the
  // plane perpendicular to spineAxis, then normalised.
  // This gives us "character left" even if the mesh is slightly rotated.
  const rawLeft = new THREE.Vector3().subVectors(lm.leftShoulder, lm.rightShoulder);
  const leftAxis = rawLeft
    .sub(spineAxis.clone().multiplyScalar(rawLeft.dot(spineAxis)))
    .normalize();

  // Forward axis: perpendicular to both spine and left (right-hand rule: left × spine = forward)
  const forwardAxis = new THREE.Vector3().crossVectors(leftAxis, spineAxis).normalize();

  // Arm reach: upper arm + lower arm + hand, estimated from scale since
  // we only have shoulder landmarks (no elbow/wrist landmarks).
  // Reference arm reach (shoulder → wrist) for 1.70 m: 0.279 + 0.267 = 0.546 m
  const refArmReach = 0.546; // metres on the 1.70 m reference figure
  const leftArmReach = refArmReach * scale;
  const rightArmReach = refArmReach * scale;

  return {
    scale,
    characterHeight,
    hipCentre,
    spineAxis,
    leftAxis,
    forwardAxis,
    shoulderWidth,
    hipWidth,
    leftArmReach,
    rightArmReach,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// World-position solver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes world-space positions for every VRM bone, given landmark geometry.
 *
 * Strategy:
 *  - Spine chain: lerp along hipCentre → neckBase using BONE_LANDMARK_BINDINGS ratios.
 *  - Head: lerp along neckBase → headTop.
 *  - Leg chains: lerp along hipSocket → ankle using BONE_LANDMARK_BINDINGS ratios.
 *  - Arm chains: extend laterally from shoulder landmark using scaled segment lengths.
 *  - Fingers / toes: proportional offset from their chain root joint.
 *  - Eyes / jaw: proportional offset from head.
 *  - Shoulder bones: lerp between spine midline and shoulder landmark.
 */
function solveWorldPositions(
  lm: LandmarkMap,
  geo: LandmarkGeometry,
  includedBones: Set<VrmBoneName>,
): Map<VrmBoneName, THREE.Vector3> {
  const wp = new Map<VrmBoneName, THREE.Vector3>();
  const { scale, hipCentre, spineAxis, leftAxis, forwardAxis } = geo;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Store a world position for a bone (only if it is included). */
  const set = (name: VrmBoneName, pos: THREE.Vector3) => {
    if (includedBones.has(name)) wp.set(name, pos.clone());
  };

  // ── 1. Hips ───────────────────────────────────────────────────────────────
  set('hips', hipCentre);

  // ── 2. Spine chain (hips → spine → chest → upperChest → neck → head) ─────
  // We parameterise along hipCentre → neckBase (t=0 to 1) and then
  // neckBase → headTop for neck and head.
  const hipToNeck = new THREE.Vector3().subVectors(lm.neckBase, hipCentre);
  const neckToHead = new THREE.Vector3().subVectors(lm.headTop, lm.neckBase);

  // Spine bones that interpolate along hipCentre→neckBase
  const spineBinding: Partial<Record<VrmBoneName, number>> = {
    spine:      0.14,
    chest:      0.42,
    upperChest: 0.70,
  };
  for (const [bone, t] of Object.entries(spineBinding) as [VrmBoneName, number][]) {
    set(bone, new THREE.Vector3().copy(hipCentre).addScaledVector(hipToNeck, t));
  }

  // Neck and head interpolate along neckBase→headTop
  set('neck', new THREE.Vector3().copy(lm.neckBase).addScaledVector(neckToHead, 0.08));
  set('head', new THREE.Vector3().copy(lm.neckBase).addScaledVector(neckToHead, 0.28));

  // ── 3. Face bones (relative to head position) ─────────────────────────────
  if (wp.has('head')) {
    const headPos = wp.get('head')!;

    // Head size proportional to scale; reference head height ≈ 0.23 m for 1.70 m figure
    const headH = 0.23 * scale;

    // Eyes: forward + lateral + slightly up from head joint
    set('leftEye',  new THREE.Vector3().copy(headPos)
      .addScaledVector(leftAxis,    0.032 * scale)
      .addScaledVector(spineAxis,   0.062 * scale)
      .addScaledVector(forwardAxis, 0.058 * scale));

    set('rightEye', new THREE.Vector3().copy(headPos)
      .addScaledVector(leftAxis,   -0.032 * scale)
      .addScaledVector(spineAxis,   0.062 * scale)
      .addScaledVector(forwardAxis, 0.058 * scale));

    set('jaw', new THREE.Vector3().copy(headPos)
      .addScaledVector(spineAxis,  -0.01 * scale)
      .addScaledVector(forwardAxis, headH * 0.20));
  }

  // ── 4. Left leg chain ─────────────────────────────────────────────────────
  // Hip socket: the landmark position plus a small medial offset to put the
  // joint at the socket rather than the outer landmark point.
  const leftHipSocket = lm.leftHip.clone();
  const leftAnkle     = lm.leftAnkle.clone();
  const leftLegVec    = new THREE.Vector3().subVectors(leftAnkle, leftHipSocket);

  set('leftUpperLeg', leftHipSocket.clone());
  set('leftLowerLeg', new THREE.Vector3().copy(leftHipSocket).addScaledVector(leftLegVec, 0.49));
  set('leftFoot',     new THREE.Vector3().copy(leftHipSocket).addScaledVector(leftLegVec, 0.98));
  set('leftToes',     new THREE.Vector3().copy(leftAnkle)
    .addScaledVector(spineAxis,   -0.062 * scale)
    .addScaledVector(forwardAxis,  0.070 * scale));

  // ── 5. Right leg chain ────────────────────────────────────────────────────
  const rightHipSocket = lm.rightHip.clone();
  const rightAnkle     = lm.rightAnkle.clone();
  const rightLegVec    = new THREE.Vector3().subVectors(rightAnkle, rightHipSocket);

  set('rightUpperLeg', rightHipSocket.clone());
  set('rightLowerLeg', new THREE.Vector3().copy(rightHipSocket).addScaledVector(rightLegVec, 0.49));
  set('rightFoot',     new THREE.Vector3().copy(rightHipSocket).addScaledVector(rightLegVec, 0.98));
  set('rightToes',     new THREE.Vector3().copy(rightAnkle)
    .addScaledVector(spineAxis,   -0.062 * scale)
    .addScaledVector(forwardAxis,  0.070 * scale));

  // ── 6. Left arm chain ─────────────────────────────────────────────────────
  // The shoulder landmark is the glenohumeral joint (shoulder ball).
  // We extend along leftAxis (character's left = +X in T-pose world).
  // Reference segment lengths (scaled):
  //   upperArm:  0.279 m  →  0.279 * scale
  //   lowerArm:  0.267 m  →  0.267 * scale
  //   finger tip: 0.082 m  → 0.082 * scale (index proximal)

  const refUpperArm  = 0.279 * scale;
  const refLowerArm  = 0.267 * scale;

  // Shoulder bone sits between upperChest midline and glenohumeral joint
  if (wp.has('upperChest')) {
    const upperChestPos = wp.get('upperChest')!;
    set('leftShoulder', lerpVec3(upperChestPos, lm.leftShoulder, 0.4));
  }

  const leftUpperArmPos = lm.leftShoulder.clone();
  set('leftUpperArm', leftUpperArmPos);

  const leftLowerArmPos = leftUpperArmPos.clone().addScaledVector(leftAxis, refUpperArm);
  set('leftLowerArm', leftLowerArmPos);

  const leftHandPos = leftLowerArmPos.clone().addScaledVector(leftAxis, refLowerArm);
  set('leftHand', leftHandPos);

  // ── 7. Right arm chain ────────────────────────────────────────────────────
  if (wp.has('upperChest')) {
    const upperChestPos = wp.get('upperChest')!;
    set('rightShoulder', lerpVec3(upperChestPos, lm.rightShoulder, 0.4));
  }

  const rightUpperArmPos = lm.rightShoulder.clone();
  set('rightUpperArm', rightUpperArmPos);

  const rightLowerArmPos = rightUpperArmPos.clone().addScaledVector(leftAxis, -refUpperArm);
  set('rightLowerArm', rightLowerArmPos);

  const rightHandPos = rightLowerArmPos.clone().addScaledVector(leftAxis, -refLowerArm);
  set('rightHand', rightHandPos);

  // ── 8. Left fingers ───────────────────────────────────────────────────────
  // Fingers fan out from the hand in the leftAxis (+X) direction.
  // Z offsets spread them: thumb forward, little finger back.
  // Reference metacarpal length ≈ 0.082 * scale (index).
  if (wp.has('leftHand')) {
    const hand = wp.get('leftHand')!;
    const fi   = leftAxis.clone();      // finger extension direction
    const fw   = forwardAxis.clone();   // finger spread direction

    const refMC   = 0.082 * scale;
    const refPrx  = 0.030 * scale;
    const refMid  = 0.022 * scale;

    // Thumb (angled forward)
    const thumbBase = hand.clone()
      .addScaledVector(fi, 0.034 * scale)
      .addScaledVector(spineAxis, -0.006 * scale)
      .addScaledVector(fw,  0.022 * scale);
    set('leftThumbMetacarpal', thumbBase);
    const tPrx = thumbBase.clone().addScaledVector(fi, 0.026 * scale).addScaledVector(fw, 0.012 * scale);
    set('leftThumbProximal', tPrx);
    set('leftThumbDistal', tPrx.clone().addScaledVector(fi, 0.022 * scale));

    // Index
    const idxBase = hand.clone().addScaledVector(fi, refMC).addScaledVector(fw, 0.012 * scale);
    set('leftIndexProximal', idxBase);
    const idxMid = idxBase.clone().addScaledVector(fi, refPrx);
    set('leftIndexIntermediate', idxMid);
    set('leftIndexDistal', idxMid.clone().addScaledVector(fi, refMid));

    // Middle
    const midBase = hand.clone().addScaledVector(fi, refMC).addScaledVector(fw, 0.004 * scale);
    set('leftMiddleProximal', midBase);
    const midMid = midBase.clone().addScaledVector(fi, 0.034 * scale);
    set('leftMiddleIntermediate', midMid);
    set('leftMiddleDistal', midMid.clone().addScaledVector(fi, 0.026 * scale));

    // Ring
    const ringBase = hand.clone().addScaledVector(fi, 0.079 * scale).addScaledVector(fw, -0.008 * scale);
    set('leftRingProximal', ringBase);
    const ringMid = ringBase.clone().addScaledVector(fi, refPrx);
    set('leftRingIntermediate', ringMid);
    set('leftRingDistal', ringMid.clone().addScaledVector(fi, refMid));

    // Little
    const littleBase = hand.clone().addScaledVector(fi, 0.072 * scale).addScaledVector(fw, -0.020 * scale);
    set('leftLittleProximal', littleBase);
    const littleMid = littleBase.clone().addScaledVector(fi, 0.024 * scale);
    set('leftLittleIntermediate', littleMid);
    set('leftLittleDistal', littleMid.clone().addScaledVector(fi, 0.018 * scale));
  }

  // ── 9. Right fingers (mirror of left; negate leftAxis offsets) ────────────
  if (wp.has('rightHand')) {
    const hand = wp.get('rightHand')!;
    const fi   = leftAxis.clone().negate(); // right hand extends in -leftAxis
    const fw   = forwardAxis.clone();

    const refMC   = 0.082 * scale;
    const refPrx  = 0.030 * scale;
    const refMid  = 0.022 * scale;

    const thumbBase = hand.clone()
      .addScaledVector(fi, 0.034 * scale)
      .addScaledVector(spineAxis, -0.006 * scale)
      .addScaledVector(fw, 0.022 * scale);
    set('rightThumbMetacarpal', thumbBase);
    const tPrx = thumbBase.clone().addScaledVector(fi, 0.026 * scale).addScaledVector(fw, 0.012 * scale);
    set('rightThumbProximal', tPrx);
    set('rightThumbDistal', tPrx.clone().addScaledVector(fi, 0.022 * scale));

    const idxBase = hand.clone().addScaledVector(fi, refMC).addScaledVector(fw, 0.012 * scale);
    set('rightIndexProximal', idxBase);
    const idxMid = idxBase.clone().addScaledVector(fi, refPrx);
    set('rightIndexIntermediate', idxMid);
    set('rightIndexDistal', idxMid.clone().addScaledVector(fi, refMid));

    const midBase = hand.clone().addScaledVector(fi, refMC).addScaledVector(fw, 0.004 * scale);
    set('rightMiddleProximal', midBase);
    const midMid = midBase.clone().addScaledVector(fi, 0.034 * scale);
    set('rightMiddleIntermediate', midMid);
    set('rightMiddleDistal', midMid.clone().addScaledVector(fi, 0.026 * scale));

    const ringBase = hand.clone().addScaledVector(fi, 0.079 * scale).addScaledVector(fw, -0.008 * scale);
    set('rightRingProximal', ringBase);
    const ringMid = ringBase.clone().addScaledVector(fi, refPrx);
    set('rightRingIntermediate', ringMid);
    set('rightRingDistal', ringMid.clone().addScaledVector(fi, refMid));

    const littleBase = hand.clone().addScaledVector(fi, 0.072 * scale).addScaledVector(fw, -0.020 * scale);
    set('rightLittleProximal', littleBase);
    const littleMid = littleBase.clone().addScaledVector(fi, 0.024 * scale);
    set('rightLittleIntermediate', littleMid);
    set('rightLittleDistal', littleMid.clone().addScaledVector(fi, 0.018 * scale));
  }

  return wp;
}

// ─────────────────────────────────────────────────────────────────────────────
// World → local conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts world-space bone positions back into the local positions expected
 * by the bone hierarchy, then writes them onto the actual `THREE.Bone` objects.
 *
 * Since we keep all bone rotations as identity (pure T-pose), the local
 * position of a bone is simply:
 *
 *   localPos = worldPos - parentWorldPos
 *
 * This is exact for identity-rotation hierarchies (no rotation means the
 * world transform is just accumulated translation).
 *
 * Bones without a solved world position are left at their scaled T-pose default.
 */
function applyWorldPositionsToBones(
  built: BuiltSkeleton,
  worldPositions: Map<VrmBoneName, THREE.Vector3>,
  scale: number,
): void {
  // Walk in definition order (parents before children)
  for (const def of VRM_BONE_DEFS) {
    const bone = built.boneMap.get(def.name);
    if (!bone) continue; // bone not in this skeleton (requiredOnly)

    const worldPos = worldPositions.get(def.name);
    if (!worldPos) {
      // Bone has no world position solved — keep scaled T-pose local position
      const [lx, ly, lz] = def.localPosition;
      bone.position.set(lx * scale, ly * scale, lz * scale);
      continue;
    }

    if (def.parent === null) {
      // Root bone (hips): local position IS world position
      bone.position.copy(worldPos);
    } else {
      const parentWorldPos = worldPositions.get(def.parent);
      if (parentWorldPos) {
        bone.position.subVectors(worldPos, parentWorldPos);
      } else {
        // Parent not solved — fall back to scaled T-pose offset
        const [lx, ly, lz] = def.localPosition;
        bone.position.set(lx * scale, ly * scale, lz * scale);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exported function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fits a fresh VRM T-pose skeleton to a set of 7 anatomical landmarks,
 * returning a skeleton whose bone positions match the target humanoid mesh.
 *
 * The returned skeleton should be placed at the scene origin before calling
 * `skeleton.calculateInverses()` and binding it to skinned meshes.
 *
 * @param landmarks  7 world-space points on the target mesh (in metres).
 * @param options    Optional tuning flags.
 *
 * @example
 * ```ts
 * const result = fitSkeletonToLandmarks(landmarks);
 * scene.add(result.built.root);
 * result.built.root.updateMatrixWorld(true);
 * result.built.skeleton.calculateInverses();
 * // → ready for weight transfer
 * ```
 */
export function fitSkeletonToLandmarks(
  landmarks: LandmarkMap,
  options: FitOptions = {},
): FitResult {
  const clampScale = options.clampScale ?? true;

  // 1. Measure
  const geo = deriveLandmarkGeometry(landmarks, clampScale);

  // 2. Build a fresh skeleton (always start clean)
  const built = buildTPoseSkeleton({
    scale: geo.scale,
    requiredOnly: options.requiredOnly ?? false,
  });

  // 3. Compute which bones are present
  const includedBones = new Set(built.boneMap.keys()) as Set<VrmBoneName>;

  // 4. Solve world-space positions
  const worldPositions = solveWorldPositions(landmarks, geo, includedBones);

  // 5. Apply world positions back onto the bone local positions
  applyWorldPositionsToBones(built, worldPositions, geo.scale);

  // 6. Recompute world matrices so the skeleton is ready
  built.root.updateMatrixWorld(true);

  // 7. Fill in any unsolved world positions from the final bone matrices
  //    (catches bones we placed via scaled T-pose fallback)
  for (const [name, bone] of built.boneMap) {
    if (!worldPositions.has(name)) {
      worldPositions.set(name, bone.getWorldPosition(new THREE.Vector3()));
    }
  }

  return {
    built,
    characterHeight: geo.characterHeight,
    scale: geo.scale,
    worldPositions,
    shoulderWidth: geo.shoulderWidth,
    hipWidth: geo.hipWidth,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Landmark auto-detection from mesh bounding geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for `estimateLandmarksFromBounds`.
 */
export interface BoundingBoxLandmarkOptions {
  /**
   * The mesh's bounding box, in world space.
   * Pass the result of `geometry.computeBoundingBox(); geometry.boundingBox`.
   */
  boundingBox: THREE.Box3;

  /**
   * Optional: the mesh's vertex positions buffer (Float32Array), used for a
   * more accurate hip-centre estimate by sampling the waist cross-section.
   * When omitted, the hip centre is estimated from bounding box proportions.
   */
  positionBuffer?: Float32Array;
}

/**
 * Estimates the 7 anatomical landmarks from the mesh's bounding box alone.
 *
 * This is the **fallback** auto-detection path: it assumes a standard upright
 * humanoid figure with arms out (T-pose or A-pose) and derives landmarks
 * from published proportional ratios.
 *
 * For better results, use a visual landmark editor (LandmarkEditor.tsx) on
 * top of this initial estimate.
 *
 * Ratios used (Winter 1990, De Leva 1996 — public domain):
 *   • Head top  : 100% of height
 *   • Neck base : 87%  of height
 *   • Shoulder  : 82%  of height, ±43% of width
 *   • Hip       : 52%  of height, ±25% of width
 *   • Ankle     : 4%   of height
 */
export function estimateLandmarksFromBounds(
  opts: BoundingBoxLandmarkOptions,
): LandmarkMap {
  const { boundingBox: bb } = opts;

  const minY  = bb.min.y;
  const maxY  = bb.max.y;
  const minX  = bb.min.x;
  const maxX  = bb.max.x;
  const totalH = maxY - minY;
  const totalW  = maxX - minX;
  const centreX = (minX + maxX) * 0.5;
  const centreZ = (bb.min.z + bb.max.z) * 0.5;

  const y = (ratio: number) => minY + totalH * ratio;
  const halfW = (ratio: number) => totalW * ratio;

  return {
    headTop:        new THREE.Vector3(centreX, y(1.00), centreZ),
    neckBase:       new THREE.Vector3(centreX, y(0.87), centreZ),
    leftShoulder:   new THREE.Vector3(centreX + halfW(0.43), y(0.82), centreZ),
    rightShoulder:  new THREE.Vector3(centreX - halfW(0.43), y(0.82), centreZ),
    leftHip:        new THREE.Vector3(centreX + halfW(0.25), y(0.52), centreZ),
    rightHip:       new THREE.Vector3(centreX - halfW(0.25), y(0.52), centreZ),
    leftAnkle:      new THREE.Vector3(centreX + halfW(0.14), y(0.04), centreZ),
    rightAnkle:     new THREE.Vector3(centreX - halfW(0.14), y(0.04), centreZ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a set of landmarks passes basic sanity checks.
 * Returns an array of human-readable warning strings (empty = all good).
 *
 * Useful for surfacing errors in the UI before running the fitter.
 */
export function validateLandmarks(lm: LandmarkMap): string[] {
  const warnings: string[] = [];

  const height = lm.headTop.y - Math.min(lm.leftAnkle.y, lm.rightAnkle.y);
  if (height <= 0) {
    warnings.push('headTop must be above the ankle landmarks.');
  }
  if (height < 0.3 || height > 4.0) {
    warnings.push(`Unusual character height: ${height.toFixed(2)} m. Expected 0.3–4.0 m.`);
  }
  if (lm.headTop.y < lm.neckBase.y) {
    warnings.push('headTop must be above neckBase.');
  }
  if (lm.neckBase.y < lm.leftHip.y || lm.neckBase.y < lm.rightHip.y) {
    warnings.push('neckBase must be above the hip landmarks.');
  }
  if (lm.leftHip.x < lm.rightHip.x) {
    warnings.push('leftHip should be to the character\'s left (+X). Landmarks may be swapped.');
  }
  if (lm.leftShoulder.x < lm.rightShoulder.x) {
    warnings.push('leftShoulder should be to the character\'s left (+X). Landmarks may be swapped.');
  }

  const shoulderWidth = lm.leftShoulder.distanceTo(lm.rightShoulder);
  if (shoulderWidth < 0.05) {
    warnings.push(`Shoulder landmarks are very close (${shoulderWidth.toFixed(3)} m). Check placement.`);
  }

  return warnings;
}

/**
 * Returns a simple text summary of a `FitResult` for debugging or logging.
 */
export function fitResultSummary(result: FitResult): string {
  const lines: string[] = [
    `Height: ${result.characterHeight.toFixed(3)} m`,
    `Scale:  ${result.scale.toFixed(4)}x (ref 1.70 m)`,
    `Shoulder width: ${result.shoulderWidth.toFixed(3)} m`,
    `Hip width:      ${result.hipWidth.toFixed(3)} m`,
    `Bones fitted:   ${result.built.bones.length}`,
  ];
  return lines.join('\n');
}
