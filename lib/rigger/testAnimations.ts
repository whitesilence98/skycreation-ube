/**
 * lib/rigger/testAnimations.ts
 *
 * Procedural VRM 1.0 gait solver for the Auto-Rigger Studio preview.
 * Drives bones with pose-relative quaternion rotations so both T-pose
 * and arbitrary A-pose rest skeletons animate cleanly without thigh clipping.
 *
 * VRM coordinate conventions (right-handed Y-up, facing +Z):
 *   +X = character's left
 *   -X = character's right
 *   +Y = up
 *   +Z = forward
 *
 * Usage inside a R3F `useFrame` callback:
 *   driveTestAnimation(boneMap, restQuats, mode, clock.getElapsedTime());
 */

import * as THREE from 'three';
import { SECONDARY_BONE_DEFS, type RigBoneName } from '@/lib/rigger/vrmSkeleton';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TestAnimationMode = 'tpose' | 'idle' | 'walk' | 'run';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const _qSwing = new THREE.Quaternion();
const _qLower = new THREE.Quaternion();
const _euler  = new THREE.Euler();
const _armDir = new THREE.Vector3();
const _bendAxis = new THREE.Vector3();
const _fwdZ = new THREE.Vector3(0, 0, 1);

const SECONDARY_BONE_NAMES: readonly RigBoneName[] = SECONDARY_BONE_DEFS.map((d) => d.name);

/** Rotate a bone by Euler angles (degrees, XYZ) on top of its rest pose. */
function rotBone<TName extends string>(
  boneMap: Map<TName, THREE.Bone>,
  restQuats: Map<TName, THREE.Quaternion>,
  name: RigBoneName,
  xDeg: number,
  yDeg: number = 0,
  zDeg: number = 0,
): void {
  const bone = boneMap.get(name as TName);
  const rest = restQuats.get(name as TName);
  if (!bone || !rest) return;
  _euler.set(xDeg * DEG, yDeg * DEG, zDeg * DEG, 'XYZ');
  _qSwing.setFromEuler(_euler);
  bone.quaternion.copy(rest).multiply(_qSwing);
}

/**
 * Measures the rest upper-arm droop angle (in degrees below horizontal T-pose)
 * from the child lowerArm bone's local offset.
 */
function measureRestAdductDeg<TName extends string>(
  boneMap: Map<TName, THREE.Bone>,
  lowerArmName: 'leftLowerArm' | 'rightLowerArm',
  side: 1 | -1,
): number {
  const lowerArm = boneMap.get(lowerArmName as TName);
  if (!lowerArm) return 0;
  _armDir.copy(lowerArm.position);
  if (_armDir.lengthSq() < 1e-8) return 0;
  _armDir.normalize();
  return Math.atan2(-_armDir.y, side * _armDir.x) * (180 / Math.PI);
}

/**
 * Pose an upper arm relative to its actual rest orientation (T-pose or A-pose).
 * Measures `restAdductDeg` and applies only `targetAdductDeg - restAdductDeg`
 * so A-pose arms never over-rotate into the thighs.
 */
function poseUpperArm<TName extends string>(
  boneMap: Map<TName, THREE.Bone>,
  restQuats: Map<TName, THREE.Quaternion>,
  name: 'leftUpperArm' | 'rightUpperArm',
  lowerArmName: 'leftLowerArm' | 'rightLowerArm',
  side: 1 | -1, // +1 = left (+X arm), -1 = right (-X arm)
  targetAdductDeg: number, // desired angle below horizontal T-pose (e.g. 68–72)
  swingXDeg: number, // negative = forward (+Z), positive = backward (-Z)
): void {
  const bone = boneMap.get(name as TName);
  const rest = restQuats.get(name as TName);
  if (!bone || !rest) return;

  const restAdductDeg = measureRestAdductDeg(boneMap, lowerArmName, side);
  const deltaAdductDeg = targetAdductDeg - restAdductDeg;

  _euler.set(0, 0, -side * deltaAdductDeg * DEG, 'XYZ');
  _qLower.setFromEuler(_euler);

  _euler.set(swingXDeg * DEG, 0, 0, 'XYZ');
  _qSwing.setFromEuler(_euler);

  bone.quaternion.copy(rest).multiply(_qSwing).multiply(_qLower);
}

/**
 * Bend an elbow forward toward +Z regardless of whether the rest arm is
 * horizontal (T-pose) or angled downward (A-pose).
 * Uses `crossVectors(armDir, +Z).normalize()` as the local hinge axis.
 */
function poseLowerArm<TName extends string>(
  boneMap: Map<TName, THREE.Bone>,
  restQuats: Map<TName, THREE.Quaternion>,
  name: 'leftLowerArm' | 'rightLowerArm',
  handName: 'leftHand' | 'rightHand',
  side: 1 | -1,
  flexDeg: number, // positive = bend forearm forward (+Z)
): void {
  const bone = boneMap.get(name as TName);
  const rest = restQuats.get(name as TName);
  if (!bone || !rest) return;

  const hand = boneMap.get(handName as TName);
  if (hand && hand.position.lengthSq() > 1e-8) {
    _armDir.copy(hand.position).normalize();
  } else if (bone.position.lengthSq() > 1e-8) {
    _armDir.copy(bone.position).normalize();
  } else {
    _armDir.set(side, 0, 0);
  }

  _bendAxis.crossVectors(_armDir, _fwdZ);
  if (_bendAxis.lengthSq() > 1e-6) {
    _bendAxis.normalize();
  } else {
    _bendAxis.set(0, -side, 0);
  }

  _qSwing.setFromAxisAngle(_bendAxis, flexDeg * DEG);
  bone.quaternion.copy(rest).multiply(_qSwing);
}

/** Restore a bone to rest pose. */
function restBone<TName extends string>(
  boneMap: Map<TName, THREE.Bone>,
  restQuats: Map<TName, THREE.Quaternion>,
  name: RigBoneName,
): void {
  const bone = boneMap.get(name as TName);
  const rest = restQuats.get(name as TName);
  if (!bone || !rest) return;
  bone.quaternion.copy(rest);
}

/** Keep optional non-VRM secondary bones cleanly at rest pose. */
function holdSecondaryBonesAtRest<TName extends string>(
  boneMap: Map<TName, THREE.Bone>,
  restQuats: Map<TName, THREE.Quaternion>,
): void {
  for (const name of SECONDARY_BONE_NAMES) {
    restBone(boneMap, restQuats, name);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main driver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drive all bones for a given animation mode + elapsed time.
 * Call this inside R3F's `useFrame`.
 */
export function driveTestAnimation<TName extends string = RigBoneName>(
  boneMap: Map<TName, THREE.Bone>,
  restQuats: Map<TName, THREE.Quaternion>,
  mode: TestAnimationMode,
  elapsedSeconds: number,
): void {
  // ── T-Pose / Rest: restore every bone to rest ───────────────────────────
  if (mode === 'tpose') {
    for (const [name] of restQuats) {
      const bone = boneMap.get(name);
      const rest = restQuats.get(name);
      if (bone && rest) bone.quaternion.copy(rest);
    }
    const hips = boneMap.get('hips' as TName);
    if (hips) {
      const restY = (hips as unknown as { _restY?: number })._restY;
      if (restY !== undefined) hips.position.y = restY;
    }
    return;
  }

  const t = elapsedSeconds;

  // ── Idle: relaxed pose-relative arms + gentle breathing ─────────────────
  if (mode === 'idle') {
    const breath = Math.sin(t * 1.4);
    const sway = Math.sin(t * 0.7);

    rotBone(boneMap, restQuats, 'spine', breath * 1.2, 0, sway * 0.8);
    rotBone(boneMap, restQuats, 'chest', breath * 1.5);
    rotBone(boneMap, restQuats, 'neck', -breath * 0.6);
    rotBone(boneMap, restQuats, 'head', -breath * 0.6, sway * 1.5, 0);

    const hips = boneMap.get('hips' as TName);
    if (hips) {
      const restY = (hips as unknown as { _restY?: number })._restY;
      if (restY !== undefined) hips.position.y = restY + breath * 0.003;
      rotBone(boneMap, restQuats, 'hips', 0, 0, sway * 0.6);
    }

    poseUpperArm(boneMap, restQuats, 'leftUpperArm',  'leftLowerArm',  1,  72 - breath * 1.0, 2);
    poseUpperArm(boneMap, restQuats, 'rightUpperArm', 'rightLowerArm', -1, 72 - breath * 1.0, 2);
    poseLowerArm(boneMap, restQuats, 'leftLowerArm',  'leftHand',  1,  14);
    poseLowerArm(boneMap, restQuats, 'rightLowerArm', 'rightHand', -1, 14);

    for (const bone of [
      'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
      'leftFoot', 'rightFoot',
    ] as RigBoneName[]) {
      restBone(boneMap, restQuats, bone);
    }
    holdSecondaryBonesAtRest(boneMap, restQuats);
    return;
  }

  // ── Walk & Run ──────────────────────────────────────────────────────────
  const isRun = mode === 'run';

  const cadence     = isRun ? 7.5 : 4.2;
  const phase       = t * cadence;

  const legSwing    = isRun ? 38 : 24;
  const kneeFlex    = isRun ? 65 : 40;
  const footPitch   = isRun ? 22 : 14;
  const armAdduct   = isRun ? 64 : 70;
  const armSwing    = isRun ? 38 : 22;
  const elbowBase   = isRun ? 70 : 18;
  const elbowPulse  = isRun ? 20 : 12;
  const hipBob      = isRun ? 0.028 : 0.012;
  const pelvisYaw   = isRun ? 7 : 5;
  const pelvisSway  = isRun ? 3.5 : 2.5;
  const spinePitch  = isRun ? 10 : 3;
  const spineTwist  = isRun ? 9 : 6;

  const leftPhase  = phase;
  const rightPhase = phase + Math.PI;

  rotBone(boneMap, restQuats, 'leftUpperLeg',  -Math.sin(leftPhase)  * legSwing);
  rotBone(boneMap, restQuats, 'rightUpperLeg', -Math.sin(rightPhase) * legSwing);

  const leftKneeFactor  = Math.pow(Math.max(0, (Math.cos(leftPhase)  + 0.35) / 1.35), 1.3);
  const rightKneeFactor = Math.pow(Math.max(0, (Math.cos(rightPhase) + 0.35) / 1.35), 1.3);
  rotBone(boneMap, restQuats, 'leftLowerLeg',  leftKneeFactor  * kneeFlex);
  rotBone(boneMap, restQuats, 'rightLowerLeg', rightKneeFactor * kneeFlex);

  rotBone(boneMap, restQuats, 'leftFoot',  Math.cos(leftPhase)  * footPitch);
  rotBone(boneMap, restQuats, 'rightFoot', Math.cos(rightPhase) * footPitch);

  poseUpperArm(boneMap, restQuats, 'leftUpperArm',  'leftLowerArm',  1,  armAdduct, -Math.sin(rightPhase) * armSwing);
  poseUpperArm(boneMap, restQuats, 'rightUpperArm', 'rightLowerArm', -1, armAdduct, -Math.sin(leftPhase)  * armSwing);

  const leftElbowFlex  = elbowBase + Math.max(0, Math.sin(rightPhase)) * elbowPulse;
  const rightElbowFlex = elbowBase + Math.max(0, Math.sin(leftPhase))  * elbowPulse;
  poseLowerArm(boneMap, restQuats, 'leftLowerArm',  'leftHand',  1,  leftElbowFlex);
  poseLowerArm(boneMap, restQuats, 'rightLowerArm', 'rightHand', -1, rightElbowFlex);

  const hips = boneMap.get('hips' as TName);
  if (hips) {
    const restY = (hips as unknown as { _restY?: number })._restY;
    if (restY !== undefined) {
      hips.position.y = restY + (Math.abs(Math.sin(leftPhase)) - 0.35) * hipBob;
    }
    rotBone(
      boneMap,
      restQuats,
      'hips',
      0,
      -Math.sin(leftPhase) * pelvisYaw,
      Math.sin(leftPhase) * pelvisSway,
    );
  }

  rotBone(boneMap, restQuats, 'spine', spinePitch * 0.5, Math.sin(leftPhase) * spineTwist * 0.5, -Math.sin(leftPhase) * pelvisSway * 0.6);
  rotBone(boneMap, restQuats, 'chest', spinePitch * 0.5, Math.sin(leftPhase) * spineTwist * 0.5, -Math.sin(leftPhase) * pelvisSway * 0.4);

  rotBone(boneMap, restQuats, 'neck', -spinePitch * 0.4, -Math.sin(leftPhase) * spineTwist * 0.3, 0);
  rotBone(boneMap, restQuats, 'head', -spinePitch * 0.4, -Math.sin(leftPhase) * spineTwist * 0.3, 0);

  holdSecondaryBonesAtRest(boneMap, restQuats);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rest snapshot helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capture the current quaternion of every bone as the "rest pose".
 * Also stores `_restY` on the hips bone for position restoration.
 * Call once after `fitResult` is set, before any animation runs.
 */
export function captureRestPose<TName extends string = RigBoneName>(
  boneMap: Map<TName, THREE.Bone>,
): Map<TName, THREE.Quaternion> {
  const snap = new Map<TName, THREE.Quaternion>();
  for (const [name, bone] of boneMap) {
    snap.set(name, bone.quaternion.clone());
    if (name === 'hips') {
      (bone as unknown as { _restY: number })._restY = bone.position.y;
    }
  }
  return snap;
}
