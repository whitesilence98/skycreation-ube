/**
 * lib/rigger/templateFitter.ts
 *
 * Template Skeleton Fitter — Phase 2 of the CC-Kit Auto-Rigger pipeline.
 *
 * Takes the VRM template skeleton (from `vrmSkeleton.ts`) and warps it to match
 * a target humanoid mesh using 8 required core landmarks plus optional limb
 * (elbows, wrists, knees) and detail (chin, groin) landmarks — supporting
 * T-pose, A-pose, and bent-limb rest poses cleanly.
 *
 * All maths uses publicly documented anatomical ratios (Winter 1990, De Leva
 * 1996 — public domain). No XPMSE, Bethesda, or Mixamo code.
 *
 * Usage:
 *   import { fitSkeletonToLandmarks } from '@/lib/rigger/templateFitter';
 */

import * as THREE from 'three';
import {
  ALL_RIG_BONE_DEFS,
  buildTPoseSkeleton,
  type BuiltSkeleton,
  type LandmarkMap,
  type LandmarkPreset,
  type RigBoneName,
} from '@/lib/rigger/vrmSkeleton';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface FitOptions {
  /**
   * When true, only required VRM 1.0 bones are created (22 bones — no fingers,
   * no face). Faster; suitable for game characters that don't need finger IK.
   * Default: false (all 54 VRM bones).
   */
  requiredOnly?: boolean;

  /**
   * Clamp scale to a reasonable human range [0.5 m, 3.0 m].
   * Prevents degenerate skeletons from bad landmarks. Default: true.
   */
  clampScale?: boolean;

  /**
   * When true (and `requiredOnly` is false), appends optional non-VRM secondary
   * bones (`pelvisLower`, `leftButt`, `rightButt`, `leftBreast`, `rightBreast`)
   * for pelvis, glute, and chest deformation. Default: false.
   */
  includeSecondaryBones?: boolean;
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
  worldPositions: Map<RigBoneName, THREE.Vector3>;

  /**
   * Shoulder width in metres (distance between the two shoulder landmarks).
   * Stored for downstream weight-transfer to gauge arm region extents.
   */
  shoulderWidth: number;

  /**
   * Hip width in metres (distance between the two hip landmarks).
   */
  hipWidth: number;

  /**
   * Optional groin Y coordinate when `landmarks.groin` is provided.
   * Used downstream by weightTransfer to refine pelvis vs. leg boundaries.
   */
  groinY?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function lerpVec3(
  a: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.lerpVectors(a, b, t);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx]!;
}

// Reference figure height used when authoring `VRM_BONE_DEFS` local positions.
const REFERENCE_HEIGHT_M = 1.70;

// ─────────────────────────────────────────────────────────────────────────────
// Derived landmark geometry
// ─────────────────────────────────────────────────────────────────────────────

interface LandmarkGeometry {
  scale: number;
  characterHeight: number;
  hipCentre: THREE.Vector3;
  spineAxis: THREE.Vector3;      // unit vector from hipCentre toward neckBase
  leftAxis: THREE.Vector3;       // unit vector pointing to character's left (+X in T-pose)
  forwardAxis: THREE.Vector3;    // unit vector pointing forward (+Z in T-pose)
  shoulderWidth: number;
  hipWidth: number;
  groinY?: number;
}

function deriveLandmarkGeometry(lm: LandmarkMap, clampScale: boolean): LandmarkGeometry {
  const floorY = Math.min(lm.leftAnkle.y, lm.rightAnkle.y);
  const characterHeight = lm.headTop.y - floorY;
  let scale = characterHeight / REFERENCE_HEIGHT_M;
  if (clampScale) {
    scale = clamp(scale, 0.5 / REFERENCE_HEIGHT_M, 3.0 / REFERENCE_HEIGHT_M);
  }

  const hipCentre = new THREE.Vector3()
    .addVectors(lm.leftHip, lm.rightHip)
    .multiplyScalar(0.5);

  // If groin is placed, refine pelvis root vertically without breaking L/R symmetry.
  const groinY = lm.groin?.y;
  if (groinY !== undefined) {
    const targetHipY = clamp(
      THREE.MathUtils.lerp(hipCentre.y, groinY + 0.065 * scale, 0.35),
      groinY + 0.03 * scale,
      hipCentre.y + 0.06 * scale,
    );
    hipCentre.y = targetHipY;
  }

  const hipWidth = lm.leftHip.distanceTo(lm.rightHip);
  const shoulderWidth = lm.leftShoulder.distanceTo(lm.rightShoulder);

  const spineAxis = new THREE.Vector3()
    .subVectors(lm.neckBase, hipCentre);
  if (spineAxis.lengthSq() > 1e-8) {
    spineAxis.normalize();
  } else {
    spineAxis.set(0, 1, 0);
  }

  const rawLeft = new THREE.Vector3().subVectors(lm.leftShoulder, lm.rightShoulder);
  const leftAxis = rawLeft
    .sub(spineAxis.clone().multiplyScalar(rawLeft.dot(spineAxis)));
  if (leftAxis.lengthSq() > 1e-8) {
    leftAxis.normalize();
  } else {
    leftAxis.set(1, 0, 0);
  }

  const forwardAxis = new THREE.Vector3().crossVectors(leftAxis, spineAxis);
  if (forwardAxis.lengthSq() > 1e-8) {
    forwardAxis.normalize();
  } else {
    forwardAxis.set(0, 0, 1);
  }

  return {
    scale,
    characterHeight,
    hipCentre,
    spineAxis,
    leftAxis,
    forwardAxis,
    shoulderWidth,
    hipWidth,
    groinY,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// World-position solver helpers
// ─────────────────────────────────────────────────────────────────────────────

function placeArmChain(
  side: 1 | -1,
  shoulderLm: THREE.Vector3,
  elbowLm: THREE.Vector3 | undefined,
  wristLm: THREE.Vector3 | undefined,
  upperChestPos: THREE.Vector3 | undefined,
  leftAxis: THREE.Vector3,
  scale: number,
  set: (name: RigBoneName, pos: THREE.Vector3) => void,
): { lowerArmPos: THREE.Vector3; handPos: THREE.Vector3 } {
  const clavicleName: RigBoneName = side === 1 ? 'leftShoulder' : 'rightShoulder';
  const upperName: RigBoneName = side === 1 ? 'leftUpperArm' : 'rightUpperArm';
  const lowerName: RigBoneName = side === 1 ? 'leftLowerArm' : 'rightLowerArm';
  const handName: RigBoneName = side === 1 ? 'leftHand' : 'rightHand';

  const sideDir = leftAxis.clone().multiplyScalar(side);
  const refUpperArm = 0.279 * scale;
  const refLowerArm = 0.267 * scale;

  if (upperChestPos) {
    set(clavicleName, lerpVec3(upperChestPos, shoulderLm, 0.4));
  }

  const upperArmPos = shoulderLm.clone();
  set(upperName, upperArmPos);

  let lowerArmPos: THREE.Vector3;
  let handPos: THREE.Vector3;

  if (elbowLm && wristLm) {
    lowerArmPos = elbowLm.clone();
    handPos = wristLm.clone();
  } else if (wristLm) {
    handPos = wristLm.clone();
    lowerArmPos = lerpVec3(upperArmPos, handPos, 0.51);
  } else if (elbowLm) {
    lowerArmPos = elbowLm.clone();
    const upperDir = new THREE.Vector3().subVectors(lowerArmPos, upperArmPos);
    if (upperDir.lengthSq() > 1e-8) {
      upperDir.normalize();
    } else {
      upperDir.copy(sideDir);
    }
    handPos = lowerArmPos.clone().addScaledVector(upperDir, refLowerArm);
  } else {
    lowerArmPos = upperArmPos.clone().addScaledVector(sideDir, refUpperArm);
    handPos = lowerArmPos.clone().addScaledVector(sideDir, refLowerArm);
  }

  set(lowerName, lowerArmPos);
  set(handName, handPos);
  return { lowerArmPos, handPos };
}

function placeFingerChain(
  side: 1 | -1,
  handPos: THREE.Vector3,
  lowerArmPos: THREE.Vector3,
  leftAxis: THREE.Vector3,
  forwardAxis: THREE.Vector3,
  spineAxis: THREE.Vector3,
  scale: number,
  set: (name: RigBoneName, pos: THREE.Vector3) => void,
): void {
  const prefix = side === 1 ? 'left' : 'right';

  // Primary finger extension axis follows forearm→wrist so A-pose hands align naturally
  const fi = new THREE.Vector3().subVectors(handPos, lowerArmPos);
  if (fi.lengthSq() > 1e-8) {
    fi.normalize();
  } else {
    fi.copy(leftAxis).multiplyScalar(side);
  }

  // Orthogonal spread axis (thumb toward +fw, little toward -fw)
  const fw = forwardAxis.clone().addScaledVector(fi, -forwardAxis.dot(fi));
  if (fw.lengthSq() > 1e-6) {
    fw.normalize();
  } else {
    fw.copy(spineAxis).addScaledVector(fi, -spineAxis.dot(fi));
    if (fw.lengthSq() > 1e-6) {
      fw.normalize();
    } else {
      fw.set(0, 0, 1);
    }
  }

  // Orthogonal dorsal/palmar up axis matching +spineAxis in T-pose on both sides
  const palmUp = new THREE.Vector3().crossVectors(fw, fi).multiplyScalar(side);
  if (palmUp.lengthSq() > 1e-6) {
    palmUp.normalize();
  } else {
    palmUp.copy(spineAxis);
  }

  const refMC = 0.082 * scale;
  const refPrx = 0.030 * scale;
  const refMid = 0.022 * scale;

  const thumbBase = handPos
    .clone()
    .addScaledVector(fi, 0.034 * scale)
    .addScaledVector(palmUp, -0.006 * scale)
    .addScaledVector(fw, 0.022 * scale);
  set(`${prefix}ThumbMetacarpal` as RigBoneName, thumbBase);
  const tPrx = thumbBase
    .clone()
    .addScaledVector(fi, 0.026 * scale)
    .addScaledVector(fw, 0.012 * scale);
  set(`${prefix}ThumbProximal` as RigBoneName, tPrx);
  set(`${prefix}ThumbDistal` as RigBoneName, tPrx.clone().addScaledVector(fi, 0.022 * scale));

  const idxBase = handPos.clone().addScaledVector(fi, refMC).addScaledVector(fw, 0.012 * scale);
  set(`${prefix}IndexProximal` as RigBoneName, idxBase);
  const idxMid = idxBase.clone().addScaledVector(fi, refPrx);
  set(`${prefix}IndexIntermediate` as RigBoneName, idxMid);
  set(`${prefix}IndexDistal` as RigBoneName, idxMid.clone().addScaledVector(fi, refMid));

  const midBase = handPos.clone().addScaledVector(fi, refMC).addScaledVector(fw, 0.004 * scale);
  set(`${prefix}MiddleProximal` as RigBoneName, midBase);
  const midMid = midBase.clone().addScaledVector(fi, 0.034 * scale);
  set(`${prefix}MiddleIntermediate` as RigBoneName, midMid);
  set(`${prefix}MiddleDistal` as RigBoneName, midMid.clone().addScaledVector(fi, 0.026 * scale));

  const ringBase = handPos.clone().addScaledVector(fi, 0.079 * scale).addScaledVector(fw, -0.008 * scale);
  set(`${prefix}RingProximal` as RigBoneName, ringBase);
  const ringMid = ringBase.clone().addScaledVector(fi, refPrx);
  set(`${prefix}RingIntermediate` as RigBoneName, ringMid);
  set(`${prefix}RingDistal` as RigBoneName, ringMid.clone().addScaledVector(fi, refMid));

  const littleBase = handPos.clone().addScaledVector(fi, 0.072 * scale).addScaledVector(fw, -0.020 * scale);
  set(`${prefix}LittleProximal` as RigBoneName, littleBase);
  const littleMid = littleBase.clone().addScaledVector(fi, 0.024 * scale);
  set(`${prefix}LittleIntermediate` as RigBoneName, littleMid);
  set(`${prefix}LittleDistal` as RigBoneName, littleMid.clone().addScaledVector(fi, 0.018 * scale));
}

function placeLegChain(
  side: 1 | -1,
  hipSocket: THREE.Vector3,
  kneeLm: THREE.Vector3 | undefined,
  ankleLm: THREE.Vector3,
  spineAxis: THREE.Vector3,
  forwardAxis: THREE.Vector3,
  scale: number,
  set: (name: RigBoneName, pos: THREE.Vector3) => void,
): void {
  const prefix = side === 1 ? 'left' : 'right';
  const upperName = `${prefix}UpperLeg` as RigBoneName;
  const lowerName = `${prefix}LowerLeg` as RigBoneName;
  const footName = `${prefix}Foot` as RigBoneName;
  const toesName = `${prefix}Toes` as RigBoneName;

  const kneePos = kneeLm ? kneeLm.clone() : lerpVec3(hipSocket, ankleLm, 0.49);
  const footPos = lerpVec3(kneePos, ankleLm, 0.96);

  set(upperName, hipSocket.clone());
  set(lowerName, kneePos);
  set(footName, footPos);
  set(
    toesName,
    ankleLm
      .clone()
      .addScaledVector(spineAxis, -0.062 * scale)
      .addScaledVector(forwardAxis, 0.070 * scale),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// World-position solver
// ─────────────────────────────────────────────────────────────────────────────

function solveWorldPositions(
  lm: LandmarkMap,
  geo: LandmarkGeometry,
  includedBones: Set<RigBoneName>,
): Map<RigBoneName, THREE.Vector3> {
  const wp = new Map<RigBoneName, THREE.Vector3>();
  const { scale, hipCentre, spineAxis, leftAxis, forwardAxis } = geo;

  const set = (name: RigBoneName, pos: THREE.Vector3) => {
    if (includedBones.has(name)) wp.set(name, pos.clone());
  };

  // ── 1. Hips ───────────────────────────────────────────────────────────────
  set('hips', hipCentre);

  // ── 2. Spine chain (hips → spine → chest → upperChest → neck → head) ─────
  const hipToNeck = new THREE.Vector3().subVectors(lm.neckBase, hipCentre);
  const neckToHead = new THREE.Vector3().subVectors(lm.headTop, lm.neckBase);

  const spineBinding: Partial<Record<RigBoneName, number>> = {
    spine: 0.14,
    chest: 0.42,
    upperChest: 0.70,
  };
  for (const [bone, t] of Object.entries(spineBinding) as [RigBoneName, number][]) {
    set(bone, new THREE.Vector3().copy(hipCentre).addScaledVector(hipToNeck, t));
  }

  let tNeck = 0.08;
  let tHead = 0.28;
  if (lm.chin) {
    const neckSpanY = Math.max(1e-4, lm.headTop.y - lm.neckBase.y);
    const chinY = clamp(lm.chin.y, lm.neckBase.y + 0.01 * scale, lm.headTop.y - 0.02 * scale);
    const neckY = THREE.MathUtils.lerp(lm.neckBase.y, chinY, 0.40);
    const headY = Math.max(
      neckY + 0.015 * scale,
      chinY + (lm.headTop.y - chinY) * 0.16,
    );
    tNeck = clamp((neckY - lm.neckBase.y) / neckSpanY, 0.04, 0.45);
    tHead = clamp((headY - lm.neckBase.y) / neckSpanY, tNeck + 0.08, 0.65);
  }

  set('neck', new THREE.Vector3().copy(lm.neckBase).addScaledVector(neckToHead, tNeck));
  set('head', new THREE.Vector3().copy(lm.neckBase).addScaledVector(neckToHead, tHead));

  // ── 3. Face bones (relative to head position & optional chin) ─────────────
  if (wp.has('head')) {
    const headPos = wp.get('head')!;
    const headH = 0.23 * scale;

    set(
      'leftEye',
      new THREE.Vector3()
        .copy(headPos)
        .addScaledVector(leftAxis, 0.032 * scale)
        .addScaledVector(spineAxis, 0.062 * scale)
        .addScaledVector(forwardAxis, 0.058 * scale),
    );
    set(
      'rightEye',
      new THREE.Vector3()
        .copy(headPos)
        .addScaledVector(leftAxis, -0.032 * scale)
        .addScaledVector(spineAxis, 0.062 * scale)
        .addScaledVector(forwardAxis, 0.058 * scale),
    );

    const jawPos = lm.chin
      ? lerpVec3(headPos, lm.chin, 0.65)
      : new THREE.Vector3()
          .copy(headPos)
          .addScaledVector(spineAxis, -0.01 * scale)
          .addScaledVector(forwardAxis, headH * 0.20);
    set('jaw', jawPos);
  }

  // ── 4 & 5. Leg chains (symmetric thigh root adjustment if groin present) ──
  let thighOffsetY = 0;
  if (lm.groin) {
    const avgHipY = (lm.leftHip.y + lm.rightHip.y) * 0.5;
    const guidedThighY = clamp(
      THREE.MathUtils.lerp(avgHipY, lm.groin.y + 0.035 * scale, 0.35),
      lm.groin.y + 0.015 * scale,
      avgHipY + 0.05 * scale,
    );
    thighOffsetY = guidedThighY - avgHipY;
  }

  const leftHipSocket = lm.leftHip.clone();
  leftHipSocket.y += thighOffsetY;
  const rightHipSocket = lm.rightHip.clone();
  rightHipSocket.y += thighOffsetY;

  placeLegChain(1, leftHipSocket, lm.leftKnee, lm.leftAnkle, spineAxis, forwardAxis, scale, set);
  placeLegChain(-1, rightHipSocket, lm.rightKnee, lm.rightAnkle, spineAxis, forwardAxis, scale, set);

  // ── 6 & 7. Arm chains ─────────────────────────────────────────────────────
  const upperChestPos = wp.get('upperChest');
  const leftArm = placeArmChain(
    1,
    lm.leftShoulder,
    lm.leftElbow,
    lm.leftWrist,
    upperChestPos,
    leftAxis,
    scale,
    set,
  );
  const rightArm = placeArmChain(
    -1,
    lm.rightShoulder,
    lm.rightElbow,
    lm.rightWrist,
    upperChestPos,
    leftAxis,
    scale,
    set,
  );

  // ── 8 & 9. Finger chains aligned with forearm→wrist ───────────────────────
  if (wp.has('leftHand')) {
    placeFingerChain(
      1,
      leftArm.handPos,
      leftArm.lowerArmPos,
      leftAxis,
      forwardAxis,
      spineAxis,
      scale,
      set,
    );
  }
  if (wp.has('rightHand')) {
    placeFingerChain(
      -1,
      rightArm.handPos,
      rightArm.lowerArmPos,
      leftAxis,
      forwardAxis,
      spineAxis,
      scale,
      set,
    );
  }

  // ── 10. Optional secondary non-VRM bones ──────────────────────────────────
  if (includedBones.has('pelvisLower')) {
    const pelvisLowerPos = lm.groin
      ? lm.groin.clone().addScaledVector(spineAxis, 0.015 * scale)
      : hipCentre
          .clone()
          .addScaledVector(spineAxis, -0.065 * scale)
          .addScaledVector(forwardAxis, 0.015 * scale);
    set('pelvisLower', pelvisLowerPos);
  }

  if (includedBones.has('leftButt') || includedBones.has('rightButt')) {
    const gluteOffsetY = lm.groin
      ? lm.groin.y + 0.03 * scale - hipCentre.y
      : -0.035 * scale;
    const buttX = Math.max(0.06 * scale, geo.hipWidth * 0.42);
    const buttBack = 0.085 * scale;

    set(
      'leftButt',
      hipCentre
        .clone()
        .addScaledVector(leftAxis, buttX)
        .addScaledVector(spineAxis, gluteOffsetY)
        .addScaledVector(forwardAxis, -buttBack),
    );
    set(
      'rightButt',
      hipCentre
        .clone()
        .addScaledVector(leftAxis, -buttX)
        .addScaledVector(spineAxis, gluteOffsetY)
        .addScaledVector(forwardAxis, -buttBack),
    );
  }

  if (includedBones.has('leftBreast') || includedBones.has('rightBreast')) {
    const chestAnchor = wp.get('upperChest') ?? wp.get('chest') ?? hipCentre;
    const chestPos = wp.get('chest') ?? chestAnchor;
    const midChest = lerpVec3(chestAnchor, chestPos, 0.35);
    const breastX = Math.max(0.075 * scale, geo.shoulderWidth * 0.24);
    const breastForward = 0.095 * scale;

    set(
      'leftBreast',
      midChest
        .clone()
        .addScaledVector(leftAxis, breastX)
        .addScaledVector(forwardAxis, breastForward),
    );
    set(
      'rightBreast',
      midChest
        .clone()
        .addScaledVector(leftAxis, -breastX)
        .addScaledVector(forwardAxis, breastForward),
    );
  }

  return wp;
}

// ─────────────────────────────────────────────────────────────────────────────
// World → local conversion
// ─────────────────────────────────────────────────────────────────────────────

function applyWorldPositionsToBones(
  built: BuiltSkeleton,
  worldPositions: Map<RigBoneName, THREE.Vector3>,
  scale: number,
): void {
  // Walk in definition order (parents before children)
  for (const def of ALL_RIG_BONE_DEFS) {
    const bone = built.boneMap.get(def.name);
    if (!bone) continue;

    const worldPos = worldPositions.get(def.name);
    if (!worldPos) {
      const [lx, ly, lz] = def.localPosition;
      bone.position.set(lx * scale, ly * scale, lz * scale);
      continue;
    }

    const actualParent = bone.parent && (bone.parent as THREE.Bone).isBone
      ? (bone.parent.name as RigBoneName)
      : null;

    if (actualParent === null) {
      bone.position.copy(worldPos);
    } else {
      const parentWorldPos = worldPositions.get(actualParent);
      if (parentWorldPos) {
        bone.position.subVectors(worldPos, parentWorldPos);
      } else {
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
 * Fits a VRM skeleton to a set of anatomical landmarks (8 core required +
 * optional limb/detail markers), returning a skeleton matching T-pose, A-pose,
 * or bent-limb meshes.
 */
export function fitSkeletonToLandmarks(
  landmarks: LandmarkMap,
  options: FitOptions = {},
): FitResult {
  const clampScale = options.clampScale ?? true;
  const requiredOnly = options.requiredOnly ?? false;
  const includeSecondaryBones = !requiredOnly && (options.includeSecondaryBones ?? false);

  const geo = deriveLandmarkGeometry(landmarks, clampScale);

  const built = buildTPoseSkeleton({
    scale: geo.scale,
    requiredOnly,
    includeSecondaryBones,
  });

  const includedBones = new Set<RigBoneName>(built.boneMap.keys());
  const worldPositions = solveWorldPositions(landmarks, geo, includedBones);

  applyWorldPositionsToBones(built, worldPositions, geo.scale);
  built.root.updateMatrixWorld(true);

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
    ...(geo.groinY !== undefined ? { groinY: geo.groinY } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Landmark auto-detection from mesh bounding geometry + vertex slices
// ─────────────────────────────────────────────────────────────────────────────

export interface BoundingBoxLandmarkOptions {
  /**
   * The mesh's bounding box, in world space.
   */
  boundingBox: THREE.Box3;

  /**
   * Optional vertex position buffer (Float32Array) used to detect T-pose vs
   * A-pose arm droop, elbows, wrists, knees, chin, groin, and median Z depths.
   */
  positionBuffer?: Float32Array;

  /**
   * Landmark preset ('8' | '14' | '16') controlling whether limb and detail
   * landmarks are populated. Defaults to '8' when omitted for backward compatibility.
   */
  preset?: LandmarkPreset;
}

interface SampledVertex {
  x: number;
  y: number;
  z: number;
  u: number; // normalised height in [0, 1]
}

function sampleMeshVertices(
  pos: Float32Array,
  minY: number,
  totalH: number,
): SampledVertex[] {
  const count = Math.floor(pos.length / 3);
  if (count < 12 || totalH <= 1e-5) return [];

  const stride = count > 24000 ? Math.floor(count / 20000) : 1;
  const verts: SampledVertex[] = [];
  for (let i = 0; i < count; i += stride) {
    const o = i * 3;
    const x = pos[o]!;
    const y = pos[o + 1]!;
    const z = pos[o + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    verts.push({ x, y, z, u: (y - minY) / totalH });
  }
  return verts;
}

function detectSideArm(
  side: 1 | -1,
  verts: SampledVertex[],
  midX: number,
  torsoZ: number,
  shoulderDx: number,
  defaultShoulderY: number,
  totalH: number,
  isTPoseFallback: boolean,
): {
  shoulder: THREE.Vector3;
  elbow: THREE.Vector3;
  wrist: THREE.Vector3;
} {
  // Refined shoulder height/Z from the deltoid-torso junction band
  const shBand = verts.filter(
    (v) =>
      v.u >= 0.76 &&
      v.u <= 0.87 &&
      side * (v.x - midX) >= shoulderDx * 0.78 &&
      side * (v.x - midX) <= shoulderDx * 1.35 &&
      Math.abs(v.z - torsoZ) < 0.14 * totalH,
  );
  const shoulderY = shBand.length >= 3 ? (median(shBand.map((v) => v.y)) ?? defaultShoulderY) : defaultShoulderY;
  const shoulderZ = shBand.length >= 3 ? (median(shBand.map((v) => v.z)) ?? torsoZ) : torsoZ;
  const shoulder = new THREE.Vector3(midX + side * shoulderDx, shoulderY, shoulderZ);

  // Lateral arm vertices outside torso/hip X band
  const armVerts = verts.filter(
    (v) =>
      v.u >= 0.34 &&
      v.u <= 0.93 &&
      side * (v.x - midX) > shoulderDx + 0.02 * totalH,
  );

  if (armVerts.length >= 8) {
    // Rank arm tips primarily by lateral reach from shoulder so flared skirts/hips
    // (large vertical drop, small X offset) never beat the actual outstretched hand.
    const withReach = armVerts.map((v) => ({
      v,
      lat: side * (v.x - shoulder.x),
      d: Math.hypot(v.x - shoulder.x, v.y - shoulder.y, v.z - shoulder.z),
    }));
    const tipLat = percentile(withReach.map((item) => item.lat), 0.98) ?? 0;

    if (tipLat >= 0.07 * totalH) {
      const tipBand = withReach
        .filter((item) => item.lat >= tipLat * 0.88)
        .map((item) => item.v);
      const tip = new THREE.Vector3(
        median(tipBand.map((v) => v.x)) ?? shoulder.x + side * tipLat,
        median(tipBand.map((v) => v.y)) ?? shoulder.y,
        median(tipBand.map((v) => v.z)) ?? shoulder.z,
      );

      // Filter vertices along the shoulder -> tip cylinder so hanging skirt cloth
      // never contaminates wrist or elbow medians.
      const chord = new THREE.Vector3().subVectors(tip, shoulder);
      const chordLen = chord.length();
      const chordLenSq = Math.max(1e-6, chordLen * chordLen);
      const tubeRadiusSq = Math.pow(0.08 * totalH, 2);

      const onArm = armVerts
        .map((v) => {
          const rx = v.x - shoulder.x;
          const ry = v.y - shoulder.y;
          const rz = v.z - shoulder.z;
          const proj = (rx * chord.x + ry * chord.y + rz * chord.z) / chordLenSq;
          const px = rx - proj * chord.x;
          const py = ry - proj * chord.y;
          const pz = rz - proj * chord.z;
          return { v, proj, perpSq: px * px + py * py + pz * pz };
        })
        .filter((item) => item.proj >= 0 && item.proj <= 1.05 && item.perpSq <= tubeRadiusSq);

      const wristBand = onArm
        .filter((item) => item.proj >= 0.75 && item.proj <= 0.88)
        .map((item) => item.v);
      const wrist = wristBand.length >= 3
        ? new THREE.Vector3(
            median(wristBand.map((v) => v.x))!,
            median(wristBand.map((v) => v.y))!,
            median(wristBand.map((v) => v.z))!,
          )
        : lerpVec3(shoulder, tip, 0.81);

      const wChord = new THREE.Vector3().subVectors(wrist, shoulder);
      const wChordLenSq = Math.max(1e-6, wChord.lengthSq());
      const elbowBand = onArm
        .filter((item) => {
          const projW =
            ((item.v.x - shoulder.x) * wChord.x +
              (item.v.y - shoulder.y) * wChord.y +
              (item.v.z - shoulder.z) * wChord.z) /
            wChordLenSq;
          return projW >= 0.43 && projW <= 0.58;
        })
        .map((item) => item.v);
      const elbow = elbowBand.length >= 3
        ? new THREE.Vector3(
            median(elbowBand.map((v) => v.x))!,
            median(elbowBand.map((v) => v.y))!,
            median(elbowBand.map((v) => v.z))!,
          )
        : lerpVec3(shoulder, wrist, 0.51);

      // Refine shoulder Z/Y gently toward proximal upper arm centerline
      const proxBand = onArm
        .filter((item) => item.proj >= 0.04 && item.proj <= 0.18)
        .map((item) => item.v);
      if (proxBand.length >= 3) {
        const proxY = median(proxBand.map((v) => v.y))!;
        const proxZ = median(proxBand.map((v) => v.z))!;
        shoulder.y = THREE.MathUtils.lerp(shoulder.y, proxY, 0.45);
        shoulder.z = THREE.MathUtils.lerp(shoulder.z, proxZ, 0.5);
      }

      return { shoulder, elbow, wrist };
    }
  }

  // Proportional fallback (T-pose vs ~48° A-pose)
  if (isTPoseFallback) {
    return {
      shoulder,
      elbow: shoulder.clone().add(new THREE.Vector3(side * 0.164 * totalH, 0, 0)),
      wrist: shoulder.clone().add(new THREE.Vector3(side * 0.321 * totalH, 0, 0)),
    };
  }
  return {
    shoulder,
    elbow: shoulder.clone().add(new THREE.Vector3(side * 0.115 * totalH, -0.115 * totalH, 0)),
    wrist: shoulder.clone().add(new THREE.Vector3(side * 0.220 * totalH, -0.230 * totalH, 0.015 * totalH)),
  };
}

/**
 * Estimates anatomical landmarks from the mesh bounding box and (when supplied)
 * vertex positions. Detects T-pose vs A-pose arm droop, bent limbs, chin, groin,
 * and interior median Z depths automatically.
 */
export function estimateLandmarksFromBounds(
  opts: BoundingBoxLandmarkOptions,
): LandmarkMap {
  const { boundingBox: bb, positionBuffer, preset = '8' } = opts;

  const minY = bb.min.y;
  const maxY = bb.max.y;
  const minX = bb.min.x;
  const maxX = bb.max.x;
  const totalH = Math.max(1e-4, maxY - minY);
  const totalW = Math.max(1e-4, maxX - minX);
  const centreX = (minX + maxX) * 0.5;
  const centreZ = (bb.min.z + bb.max.z) * 0.5;
  const isWideTPose = totalW / totalH > 0.72;

  const yAt = (ratio: number) => minY + totalH * ratio;

  // Height-based proportional fallback bounds (clamped inside bbox)
  const fallbackShoulderDx = Math.min(totalW * 0.43, 0.118 * totalH);
  const fallbackHipDx = Math.min(totalW * 0.25, 0.068 * totalH);
  const fallbackAnkleDx = Math.min(totalW * 0.16, 0.062 * totalH);

  const verts = positionBuffer ? sampleMeshVertices(positionBuffer, minY, totalH) : [];
  const hasVerts = verts.length >= 24;

  // ── 1. Body midline X and core Z ──────────────────────────────────────────
  let midX = centreX;
  let headZ = centreZ;
  let torsoZ = centreZ;

  if (hasVerts) {
    const headBand = verts.filter((v) => v.u >= 0.89 && v.u <= 0.98);
    if (headBand.length >= 6) {
      midX = median(headBand.map((v) => v.x)) ?? centreX;
      headZ = median(headBand.map((v) => v.z)) ?? centreZ;
    }

    const coreTorso = verts.filter(
      (v) => v.u >= 0.56 && v.u <= 0.74 && Math.abs(v.x - midX) < 0.125 * totalH,
    );
    if (coreTorso.length >= 8) {
      torsoZ = median(coreTorso.map((v) => v.z)) ?? headZ;
      const coreMid = median(coreTorso.map((v) => v.x));
      if (coreMid !== null) midX = THREE.MathUtils.lerp(midX, coreMid, 0.5);
    } else {
      torsoZ = headZ;
    }
  }

  // ── 2. Head top, neck base, chin ──────────────────────────────────────────
  let headTop = new THREE.Vector3(midX, yAt(1.0), headZ);
  let neckBase = new THREE.Vector3(midX, yAt(0.86), torsoZ);
  let chin = new THREE.Vector3(midX, yAt(0.888), clamp(headZ + 0.05 * totalH, bb.min.z, bb.max.z));

  if (hasVerts) {
    const crownBand = verts.filter((v) => v.u >= 0.96);
    if (crownBand.length >= 2) {
      let crownMaxY = maxY;
      for (const v of crownBand) {
        if (v.y > crownMaxY) crownMaxY = v.y;
      }
      headTop = new THREE.Vector3(
        midX,
        crownMaxY,
        median(crownBand.map((v) => v.z)) ?? headZ,
      );
    }

    // Neck base: scan [0.81, 0.89] for the narrowest neck cross-section
    let bestNeckU = 0.855;
    let minSpan = Infinity;
    for (let s = 0; s < 8; s++) {
      const u0 = 0.81 + s * 0.01;
      const u1 = u0 + 0.012;
      const slice = verts.filter(
        (v) =>
          v.u >= u0 &&
          v.u <= u1 &&
          Math.abs(v.x - midX) < 0.095 * totalH &&
          Math.abs(v.z - torsoZ) < 0.12 * totalH,
      );
      if (slice.length >= 3) {
        let sMinX = Infinity;
        let sMaxX = -Infinity;
        for (const v of slice) {
          if (v.x < sMinX) sMinX = v.x;
          if (v.x > sMaxX) sMaxX = v.x;
        }
        const span = sMaxX - sMinX;
        if (span < minSpan) {
          minSpan = span;
          bestNeckU = (u0 + u1) * 0.5;
        }
      }
    }
    const neckU = clamp(bestNeckU - 0.012, 0.825, 0.875);
    const neckSlice = verts.filter(
      (v) =>
        Math.abs(v.u - neckU) <= 0.015 &&
        Math.abs(v.x - midX) < 0.065 * totalH,
    );
    neckBase = new THREE.Vector3(
      midX,
      yAt(neckU),
      neckSlice.length >= 2 ? (median(neckSlice.map((v) => v.z)) ?? torsoZ) : torsoZ,
    );

    // Chin: detect anterior protrusion jump above throat
    const throatVerts = verts.filter(
      (v) => v.u >= 0.835 && v.u <= 0.87 && Math.abs(v.x - midX) < 0.045 * totalH,
    );
    const throatFrontZ = throatVerts.length >= 2
      ? Math.max(...throatVerts.map((v) => v.z))
      : headZ;

    let detectedChinY: number | null = null;
    let detectedChinZ = headZ + 0.045 * totalH;
    for (let s = 0; s < 7; s++) {
      const u0 = 0.87 + s * 0.007;
      const u1 = u0 + 0.008;
      const faceSlice = verts.filter(
        (v) => v.u >= u0 && v.u <= u1 && Math.abs(v.x - midX) < 0.045 * totalH,
      );
      if (faceSlice.length >= 2) {
        const frontZ = Math.max(...faceSlice.map((v) => v.z));
        if (frontZ > throatFrontZ + 0.012 * totalH) {
          detectedChinY = yAt((u0 + u1) * 0.5);
          detectedChinZ = THREE.MathUtils.lerp(headZ, frontZ, 0.88);
          break;
        }
      }
    }
    if (detectedChinY !== null) {
      chin = new THREE.Vector3(midX, detectedChinY, detectedChinZ);
    } else {
      chin = new THREE.Vector3(
        midX,
        THREE.MathUtils.lerp(neckBase.y, headTop.y, 0.22),
        clamp(headZ + 0.045 * totalH, bb.min.z, bb.max.z),
      );
    }
  }

  // ── 3. Groin & Hips ───────────────────────────────────────────────────────
  let groin = new THREE.Vector3(midX, yAt(0.475), torsoZ);
  let groinDetected = false;
  let hipU = 0.52;
  let hipDx = fallbackHipDx;
  let hipZ = torsoZ;

  if (hasVerts) {
    // Scan midline gap from upper thighs (0.36) up through pelvis (0.58)
    const sliceCounts: Array<{ u: number; verts: SampledVertex[] }> = [];
    for (let s = 0; s < 22; s++) {
      const u0 = 0.36 + s * 0.01;
      const u1 = u0 + 0.01;
      const midSlice = verts.filter(
        (v) =>
          v.u >= u0 &&
          v.u <= u1 &&
          Math.abs(v.x - midX) < 0.026 * totalH &&
          Math.abs(v.z - torsoZ) < 0.11 * totalH,
      );
      sliceCounts.push({ u: (u0 + u1) * 0.5, verts: midSlice });
    }

    // Require an open leg gap below the crotch so skirts don't false-trigger at 0.36
    const hasOpenLegGap =
      sliceCounts[0]!.verts.length <= 1 && sliceCounts[1]!.verts.length <= 1;

    if (hasOpenLegGap) {
      for (let k = 2; k < sliceCounts.length - 1; k++) {
        if (sliceCounts[k]!.verts.length >= 2 && sliceCounts[k + 1]!.verts.length >= 2) {
          const gU = sliceCounts[k]!.u;
          const gZ = median(sliceCounts[k]!.verts.map((v) => v.z)) ?? torsoZ;
          groin = new THREE.Vector3(midX, yAt(gU), gZ);
          groinDetected = true;
          break;
        }
      }
    }

    if (groinDetected) {
      hipU = clamp((groin.y - minY) / totalH + 0.045, 0.48, 0.57);
    }

    const hipSlice = verts.filter(
      (v) =>
        Math.abs(v.u - hipU) <= 0.022 &&
        Math.abs(v.x - midX) < 0.15 * totalH &&
        Math.abs(v.z - torsoZ) < 0.14 * totalH,
    );
    if (hipSlice.length >= 6) {
      hipZ = median(hipSlice.map((v) => v.z)) ?? torsoZ;
      const pelvisHalfW = percentile(hipSlice.map((v) => Math.abs(v.x - midX)), 0.88);
      if (pelvisHalfW !== null) {
        hipDx = clamp(pelvisHalfW * 0.58, 0.048 * totalH, 0.088 * totalH);
      }
    }
  }

  const leftHip = new THREE.Vector3(midX + hipDx, yAt(hipU), hipZ);
  const rightHip = new THREE.Vector3(midX - hipDx, yAt(hipU), hipZ);

  // ── 4. Knees & Ankles ─────────────────────────────────────────────────────
  const ankleU = 0.045;
  const kneeU = THREE.MathUtils.lerp(ankleU, hipU, 0.51);

  const detectLegJoints = (side: 1 | -1) => {
    const legVerts = hasVerts
      ? verts.filter(
          (v) =>
            side * (v.x - midX) > 0.004 * totalH &&
            side * (v.x - midX) < 0.22 * totalH,
        )
      : [];

    const ankleBand = legVerts.filter((v) => v.u >= 0.028 && v.u <= 0.075);
    const ankle = ankleBand.length >= 3
      ? new THREE.Vector3(
          median(ankleBand.map((v) => v.x))!,
          yAt(ankleU),
          median(ankleBand.map((v) => v.z))!,
        )
      : new THREE.Vector3(midX + side * fallbackAnkleDx, yAt(ankleU), torsoZ);

    const kneeBand = legVerts.filter((v) => Math.abs(v.u - kneeU) <= 0.028);
    const knee = kneeBand.length >= 3
      ? new THREE.Vector3(
          median(kneeBand.map((v) => v.x))!,
          yAt(kneeU),
          median(kneeBand.map((v) => v.z))!,
        )
      : new THREE.Vector3(
          THREE.MathUtils.lerp(side === 1 ? leftHip.x : rightHip.x, ankle.x, 0.5),
          yAt(kneeU),
          THREE.MathUtils.lerp(hipZ, ankle.z, 0.5),
        );

    return { knee, ankle };
  };

  const leftLeg = detectLegJoints(1);
  const rightLeg = detectLegJoints(-1);

  // ── 5. Shoulders, Elbows, Wrists (T-pose vs A-pose detection) ─────────────
  let shoulderDx = fallbackShoulderDx;
  const defaultShoulderY = yAt(0.815);

  if (hasVerts) {
    const ribBand = verts.filter(
      (v) =>
        v.u >= 0.60 &&
        v.u <= 0.72 &&
        Math.abs(v.x - midX) < 0.135 * totalH &&
        Math.abs(v.z - torsoZ) < 0.14 * totalH,
    );
    if (ribBand.length >= 6) {
      const torsoEdge = percentile(ribBand.map((v) => Math.abs(v.x - midX)), 0.94);
      if (torsoEdge !== null) {
        shoulderDx = clamp(torsoEdge * 1.05, 0.095 * totalH, 0.135 * totalH);
      }
    }
  }

  let leftArm: { shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3 };
  let rightArm: { shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3 };

  if (hasVerts) {
    leftArm = detectSideArm(1, verts, midX, torsoZ, shoulderDx, defaultShoulderY, totalH, isWideTPose);
    rightArm = detectSideArm(-1, verts, midX, torsoZ, shoulderDx, defaultShoulderY, totalH, isWideTPose);
  } else {
    const shL = new THREE.Vector3(midX + shoulderDx, defaultShoulderY, torsoZ);
    const shR = new THREE.Vector3(midX - shoulderDx, defaultShoulderY, torsoZ);
    if (isWideTPose) {
      const reach = Math.max(0.18 * totalH, totalW * 0.43 - shoulderDx);
      leftArm = {
        shoulder: shL,
        elbow: shL.clone().add(new THREE.Vector3(reach * 0.48, 0, 0)),
        wrist: shL.clone().add(new THREE.Vector3(reach * 0.90, 0, 0)),
      };
      rightArm = {
        shoulder: shR,
        elbow: shR.clone().add(new THREE.Vector3(-reach * 0.48, 0, 0)),
        wrist: shR.clone().add(new THREE.Vector3(-reach * 0.90, 0, 0)),
      };
    } else {
      const armReachX = Math.max(0.08 * totalH, totalW * 0.42 - shoulderDx);
      leftArm = {
        shoulder: shL,
        elbow: new THREE.Vector3(midX + shoulderDx + armReachX * 0.48, yAt(0.69), torsoZ),
        wrist: new THREE.Vector3(midX + shoulderDx + armReachX * 0.88, yAt(0.54), torsoZ + 0.012 * totalH),
      };
      rightArm = {
        shoulder: shR,
        elbow: new THREE.Vector3(midX - shoulderDx - armReachX * 0.48, yAt(0.69), torsoZ),
        wrist: new THREE.Vector3(midX - shoulderDx - armReachX * 0.88, yAt(0.54), torsoZ + 0.012 * totalH),
      };
    }
  }

  const result: LandmarkMap = {
    headTop,
    neckBase,
    leftShoulder: leftArm.shoulder,
    rightShoulder: rightArm.shoulder,
    leftHip,
    rightHip,
    leftAnkle: leftLeg.ankle,
    rightAnkle: rightLeg.ankle,
  };

  if (preset === '14' || preset === '16') {
    result.leftElbow = leftArm.elbow;
    result.rightElbow = rightArm.elbow;
    result.leftWrist = leftArm.wrist;
    result.rightWrist = rightArm.wrist;
    result.leftKnee = leftLeg.knee;
    result.rightKnee = rightLeg.knee;
  }

  if (preset === '16') {
    result.chin = chin;
    result.groin = groin;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a set of landmarks passes basic sanity checks.
 * Returns an array of human-readable warning strings (empty = all good).
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

  // Optional limb & detail checks (only evaluated when present)
  if (lm.leftElbow && lm.rightElbow && lm.leftElbow.x < lm.rightElbow.x) {
    warnings.push('leftElbow should be to the character\'s left (+X). Landmarks may be swapped.');
  }
  if (lm.leftWrist && lm.rightWrist && lm.leftWrist.x < lm.rightWrist.x) {
    warnings.push('leftWrist should be to the character\'s left (+X). Landmarks may be swapped.');
  }
  if (lm.leftKnee && lm.rightKnee && lm.leftKnee.x < lm.rightKnee.x) {
    warnings.push('leftKnee should be to the character\'s left (+X). Landmarks may be swapped.');
  }
  if (lm.leftKnee && (lm.leftKnee.y > lm.leftHip.y + 0.02 || lm.leftKnee.y < lm.leftAnkle.y - 0.02)) {
    warnings.push('leftKnee should be positioned between leftHip and leftAnkle.');
  }
  if (lm.rightKnee && (lm.rightKnee.y > lm.rightHip.y + 0.02 || lm.rightKnee.y < lm.rightAnkle.y - 0.02)) {
    warnings.push('rightKnee should be positioned between rightHip and rightAnkle.');
  }
  if (lm.chin && (lm.chin.y >= lm.headTop.y || lm.chin.y < lm.neckBase.y - 0.06)) {
    warnings.push('chin should be positioned between neckBase and headTop.');
  }
  if (lm.groin && (lm.groin.y >= lm.neckBase.y || lm.groin.y <= Math.max(lm.leftAnkle.y, lm.rightAnkle.y))) {
    warnings.push('groin should be positioned between the ankles and neckBase.');
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
