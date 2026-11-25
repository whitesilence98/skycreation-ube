/**
 * lib/rigger/testAnimations.ts
 *
 * Procedural VRM 1.0 gait solver for the Auto-Rigger Studio preview.
 * Drives bones with quaternion rotations — no external animation files needed.
 *
 * VRM T-pose coordinate conventions (right-handed Y-up, facing +Z):
 *   +X = character's left   (left arm extends along +X)
 *   -X = character's right  (right arm extends along -X)
 *   +Y = up                 (spine extends along +Y)
 *   -Y = down               (legs extend along -Y)
 *   +Z = forward
 *
 * Usage inside a R3F `useFrame` callback:
 *   driveTestAnimation(boneMap, restQuats, mode, clock.getElapsedTime());
 */

import * as THREE from 'three';
import type { VrmBoneName } from '@/lib/rigger/vrmSkeleton';

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

/** Rotate a bone by Euler angles (degrees, XYZ) on top of its rest pose. */
function rotBone(
  boneMap: Map<VrmBoneName, THREE.Bone>,
  restQuats: Map<VrmBoneName, THREE.Quaternion>,
  name: VrmBoneName,
  xDeg: number,
  yDeg: number = 0,
  zDeg: number = 0,
): void {
  const bone = boneMap.get(name);
  const rest = restQuats.get(name);
  if (!bone || !rest) return;
  _euler.set(xDeg * DEG, yDeg * DEG, zDeg * DEG, 'XYZ');
  _qSwing.setFromEuler(_euler);
  bone.quaternion.copy(rest).multiply(_qSwing);
}

/**
 * Lower an upper arm from horizontal T-pose (+X / -X) down along the torso,
 * then swing it forward/backward in the sagittal plane (around parent X).
 *
 * Applying qSwingX * qLowerZ lowers the arm first (so it hangs near -Y),
 * then pitches the lowered arm cleanly forward (-X) or backward (+X).
 */
function poseUpperArm(
  boneMap: Map<VrmBoneName, THREE.Bone>,
  restQuats: Map<VrmBoneName, THREE.Quaternion>,
  name: 'leftUpperArm' | 'rightUpperArm',
  side: 1 | -1, // +1 = left (+X arm), -1 = right (-X arm)
  adductDeg: number, // degrees lowered from horizontal T-pose (e.g. 68)
  swingXDeg: number, // negative = forward (+Z), positive = backward (-Z)
): void {
  const bone = boneMap.get(name);
  const rest = restQuats.get(name);
  if (!bone || !rest) return;

  // Lower left arm (+X -> -Y) via -Z rotation; lower right arm (-X -> -Y) via +Z rotation
  _euler.set(0, 0, -side * adductDeg * DEG, 'XYZ');
  _qLower.setFromEuler(_euler);

  // Swing forward/backward around parent X axis
  _euler.set(swingXDeg * DEG, 0, 0, 'XYZ');
  _qSwing.setFromEuler(_euler);

  // Compose: rest * qSwing * qLower (lower first in local space, then swing in parent sagittal plane)
  bone.quaternion.copy(rest).multiply(_qSwing).multiply(_qLower);
}

/**
 * Bend an elbow forward. Because the upper arm is lowered via Z rotation,
 * the forearm's local +X/-X still points down the arm and local +Z faces forward.
 * Moving +X toward +Z (left elbow) is -Y rotation; moving -X toward +Z (right elbow) is +Y rotation.
 */
function poseLowerArm(
  boneMap: Map<VrmBoneName, THREE.Bone>,
  restQuats: Map<VrmBoneName, THREE.Quaternion>,
  name: 'leftLowerArm' | 'rightLowerArm',
  side: 1 | -1, // +1 = left, -1 = right
  flexDeg: number, // positive = bend forearm forward
): void {
  rotBone(boneMap, restQuats, name, 0, -side * flexDeg, 0);
}

/** Restore a bone to rest pose. */
function restBone(
  boneMap: Map<VrmBoneName, THREE.Bone>,
  restQuats: Map<VrmBoneName, THREE.Quaternion>,
  name: VrmBoneName,
): void {
  const bone = boneMap.get(name);
  const rest = restQuats.get(name);
  if (!bone || !rest) return;
  bone.quaternion.copy(rest);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main driver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drive all bones for a given animation mode + elapsed time.
 * Call this inside R3F's `useFrame`.
 */
export function driveTestAnimation(
  boneMap: Map<VrmBoneName, THREE.Bone>,
  restQuats: Map<VrmBoneName, THREE.Quaternion>,
  mode: TestAnimationMode,
  elapsedSeconds: number,
): void {
  // ── T-Pose: restore every bone to rest ──────────────────────────────────
  if (mode === 'tpose') {
    for (const [name] of restQuats) {
      restBone(boneMap, restQuats, name);
    }
    const hips = boneMap.get('hips');
    if (hips) {
      const restY = (hips as unknown as { _restY?: number })._restY;
      if (restY !== undefined) hips.position.y = restY;
    }
    return;
  }

  const t = elapsedSeconds;

  // ── Idle: relaxed A-pose arms + gentle breathing ────────────────────────
  if (mode === 'idle') {
    const breath = Math.sin(t * 1.4);
    const sway   = Math.sin(t * 0.7);

    rotBone(boneMap, restQuats, 'spine', breath * 1.2, 0, sway * 0.8);
    rotBone(boneMap, restQuats, 'chest', breath * 1.5);
    rotBone(boneMap, restQuats, 'neck', -breath * 0.6);
    rotBone(boneMap, restQuats, 'head', -breath * 0.6, sway * 1.5, 0);

    const hips = boneMap.get('hips');
    if (hips) {
      const restY = (hips as unknown as { _restY?: number })._restY;
      if (restY !== undefined) hips.position.y = restY + breath * 0.003;
      rotBone(boneMap, restQuats, 'hips', 0, 0, sway * 0.6);
    }

    // Relaxed arms lowered to sides instead of stiff T-pose
    poseUpperArm(boneMap, restQuats, 'leftUpperArm',  1,  72 - breath * 1.0, 2);
    poseUpperArm(boneMap, restQuats, 'rightUpperArm', -1, 72 - breath * 1.0, 2);
    poseLowerArm(boneMap, restQuats, 'leftLowerArm',  1,  14);
    poseLowerArm(boneMap, restQuats, 'rightLowerArm', -1, 14);

    for (const bone of [
      'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
      'leftFoot', 'rightFoot',
    ] as VrmBoneName[]) {
      restBone(boneMap, restQuats, bone);
    }
    return;
  }

  // ── Walk & Run ──────────────────────────────────────────────────────────
  const isRun = mode === 'run';

  const cadence     = isRun ? 7.5 : 4.2;     // rad/s (~1.2 Hz run, ~0.67 Hz walk cycle)
  const phase       = t * cadence;

  const legSwing    = isRun ? 38 : 24;       // upper leg forward/back (deg)
  const kneeFlex    = isRun ? 65 : 40;       // max knee bend (deg, positive = backward)
  const footPitch   = isRun ? 22 : 14;       // ankle pitch (deg)
  const armAdduct   = isRun ? 62 : 70;       // degrees lowered from T-pose
  const armSwing    = isRun ? 38 : 22;       // arm swing forward/back (deg)
  const elbowBase   = isRun ? 70 : 18;       // base elbow bend (deg)
  const elbowPulse  = isRun ? 20 : 12;       // extra bend on forward swing
  const hipBob      = isRun ? 0.028 : 0.012; // vertical bounce (metres)
  const pelvisYaw   = isRun ? 7 : 5;         // pelvic twist (deg Y)
  const pelvisSway  = isRun ? 3.5 : 2.5;     // pelvic roll (deg Z)
  const spinePitch  = isRun ? 10 : 3;        // slight forward lean when running (deg +X)
  const spineTwist  = isRun ? 9 : 6;         // counter-rotation against pelvis (deg Y)

  const leftPhase  = phase;
  const rightPhase = phase + Math.PI;

  // Upper legs: negative X swings leg (-Y) forward toward +Z
  rotBone(boneMap, restQuats, 'leftUpperLeg',  -Math.sin(leftPhase)  * legSwing);
  rotBone(boneMap, restQuats, 'rightUpperLeg', -Math.sin(rightPhase) * legSwing);

  // Knees: only bend backward (+X rotation). Peak flexion occurs during swing-through (cos > 0)
  const leftKneeFactor  = Math.pow(Math.max(0, (Math.cos(leftPhase)  + 0.35) / 1.35), 1.3);
  const rightKneeFactor = Math.pow(Math.max(0, (Math.cos(rightPhase) + 0.35) / 1.35), 1.3);
  rotBone(boneMap, restQuats, 'leftLowerLeg',  leftKneeFactor  * kneeFlex);
  rotBone(boneMap, restQuats, 'rightLowerLeg', rightKneeFactor * kneeFlex);

  // Feet: counter-pitch slightly at heel strike & toe-off
  rotBone(boneMap, restQuats, 'leftFoot',  Math.cos(leftPhase)  * footPitch);
  rotBone(boneMap, restQuats, 'rightFoot', Math.cos(rightPhase) * footPitch);

  // Arms swing opposite to ipsilateral leg (-X = forward, +X = backward)
  poseUpperArm(boneMap, restQuats, 'leftUpperArm',  1,  armAdduct, -Math.sin(rightPhase) * armSwing);
  poseUpperArm(boneMap, restQuats, 'rightUpperArm', -1, armAdduct, -Math.sin(leftPhase)  * armSwing);

  // Forearms flex forward slightly more on forward arm swing
  const leftElbowFlex  = elbowBase + Math.max(0, Math.sin(rightPhase)) * elbowPulse;
  const rightElbowFlex = elbowBase + Math.max(0, Math.sin(leftPhase))  * elbowPulse;
  poseLowerArm(boneMap, restQuats, 'leftLowerArm',  1,  leftElbowFlex);
  poseLowerArm(boneMap, restQuats, 'rightLowerArm', -1, rightElbowFlex);

  // Hips: vertical double-frequency bob + subtle yaw/roll
  const hips = boneMap.get('hips');
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

  // Spine & chest: slight forward lean (when running) + counter-twist to keep shoulders balanced
  rotBone(boneMap, restQuats, 'spine', spinePitch * 0.5, Math.sin(leftPhase) * spineTwist * 0.5, -Math.sin(leftPhase) * pelvisSway * 0.6);
  rotBone(boneMap, restQuats, 'chest', spinePitch * 0.5, Math.sin(leftPhase) * spineTwist * 0.5, -Math.sin(leftPhase) * pelvisSway * 0.4);

  // Stabilize neck & head forward
  rotBone(boneMap, restQuats, 'neck', -spinePitch * 0.4, -Math.sin(leftPhase) * spineTwist * 0.3, 0);
  rotBone(boneMap, restQuats, 'head', -spinePitch * 0.4, -Math.sin(leftPhase) * spineTwist * 0.3, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rest snapshot helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capture the current quaternion of every bone as the "rest pose".
 * Also stores `_restY` on the hips bone for position restoration.
 * Call once after `fitResult` is set, before any animation runs.
 */
export function captureRestPose(
  boneMap: Map<VrmBoneName, THREE.Bone>,
): Map<VrmBoneName, THREE.Quaternion> {
  const snap = new Map<VrmBoneName, THREE.Quaternion>();
  for (const [name, bone] of boneMap) {
    snap.set(name, bone.quaternion.clone());
    if (name === 'hips') {
      (bone as unknown as { _restY: number })._restY = bone.position.y;
    }
  }
  return snap;
}
