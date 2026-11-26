/**
 * lib/animations/retargetGlbAnimation.ts
 *
 * Loads Blender-authored VRM 1.0 locomotion GLBs (`/assets/animations/{idle,walk,run}.glb`)
 * and retargets them via world-space delta-from-rest quaternions onto:
 *   1. Any CC-Kit Auto-Rigger VRM 1.0 skeleton (`vrmSkeleton.ts`, T-pose or A-pose fitted)
 *   2. The Skyrim XP32 skeleton (`SkeletonRegistry`) in the main Character Creator.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import type { SkeletonRegistry } from '@/lib/character/skeleton';

export type GlbLocomotionId = 'idle' | 'walk' | 'run';

export const GLB_ANIMATION_URLS: Record<GlbLocomotionId, string> = {
  idle: '/assets/animations/idle.glb',
  walk: '/assets/animations/walk.glb',
  run: '/assets/animations/run.glb',
};

const SAMPLE_FPS = 30;

/** Ordered depth-first VRM 1.0 bone list matching the exported Blender rig. */
const VRM_ORDERED_BONES: readonly string[] = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
];

const VRM_PARENT_BY_BONE: Readonly<Record<string, string | null>> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  leftShoulder: 'upperChest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToes: 'leftFoot',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToes: 'rightFoot',
};

const VRM_SEGMENT_CHILD: Readonly<Record<string, string>> = {
  leftUpperArm: 'leftLowerArm',
  leftLowerArm: 'leftHand',
  rightUpperArm: 'rightLowerArm',
  rightLowerArm: 'rightHand',
};

/**
 * Spatial VRM -> XP32 mapping.
 *
 * In `SkeletonRegistry` (head render frame, +Y up, +Z forward), Skyrim's
 * `NPC R ...` bones sit on +X (character's VRM left) and `NPC L ...` sit on -X
 * (character's VRM right), so pairing by physical world side preserves exact
 * limb bend signs, forward arm swing, and asymmetric stance silhouettes.
 */
const VRM_TO_XP32: Readonly<Record<string, string>> = {
  hips: 'NPC COM [COM ]',
  spine: 'NPC Spine [Spn0]',
  chest: 'NPC Spine1 [Spn1]',
  upperChest: 'NPC Spine2 [Spn2]',
  neck: 'NPC Neck [Neck]',
  head: 'NPC Head [Head]',
  leftShoulder: 'NPC R Clavicle [RClv]',
  leftUpperArm: 'NPC R UpperArm [RUar]',
  leftLowerArm: 'NPC R Forearm [RLar]',
  leftHand: 'NPC R Hand [RHnd]',
  rightShoulder: 'NPC L Clavicle [LClv]',
  rightUpperArm: 'NPC L UpperArm [LUar]',
  rightLowerArm: 'NPC L Forearm [LLar]',
  rightHand: 'NPC L Hand [LHnd]',
  leftUpperLeg: 'NPC R Thigh [RThg]',
  leftLowerLeg: 'NPC R Calf [RClf]',
  leftFoot: 'NPC R Foot [Rft ]',
  leftToes: 'NPC R Toe0 [RToe]',
  rightUpperLeg: 'NPC L Thigh [LThg]',
  rightLowerLeg: 'NPC L Calf [LClf]',
  rightFoot: 'NPC L Foot [Lft ]',
  rightToes: 'NPC L Toe0 [LToe]',
};

interface BakedGlbClip {
  id: GlbLocomotionId;
  name: string;
  duration: number;
  fps: number;
  frameCount: number;
  srcHipsRestY: number;
  srcSegmentDirs: Record<string, THREE.Vector3>;
  /** Length `frameCount * 3` (world-space delta translation from rest `hips`). */
  hipsPosDeltas: Float32Array;
  /** Per VRM bone name: length `frameCount * 4` (`Q_animWorld * inv(Q_restWorld)`). */
  boneWorldDeltas: Record<string, Float32Array>;
}

const bakedCache = new Map<GlbLocomotionId, BakedGlbClip>();
const loadPromises = new Map<GlbLocomotionId, Promise<BakedGlbClip | null>>();
let sharedLoader: GLTFLoader | null = null;

function getLoader(): GLTFLoader {
  if (!sharedLoader) sharedLoader = new GLTFLoader();
  return sharedLoader;
}

function collectNodesByName(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const map = new Map<string, THREE.Object3D>();
  root.traverse((obj) => {
    if (obj.name && !map.has(obj.name)) {
      map.set(obj.name, obj);
    }
  });
  return map;
}

function bakeSourceClip(id: GlbLocomotionId, scene: THREE.Object3D, clip: THREE.AnimationClip): BakedGlbClip {
  scene.updateMatrixWorld(true);
  const nodes = collectNodesByName(scene);

  const srcRestWorldQuat: Record<string, THREE.Quaternion> = {};
  const srcRestWorldPos: Record<string, THREE.Vector3> = {};

  for (const name of VRM_ORDERED_BONES) {
    const node = nodes.get(name);
    if (!node) continue;
    srcRestWorldQuat[name] = node.getWorldQuaternion(new THREE.Quaternion()).normalize();
    srcRestWorldPos[name] = node.getWorldPosition(new THREE.Vector3());
  }

  const srcHipsRestPos = srcRestWorldPos.hips ?? new THREE.Vector3(0, 0.952, 0);
  const srcHipsRestY = Math.max(0.2, srcHipsRestPos.y);

  const srcSegmentDirs: Record<string, THREE.Vector3> = {};
  for (const [parentName, childName] of Object.entries(VRM_SEGMENT_CHILD)) {
    const p = srcRestWorldPos[parentName];
    const c = srcRestWorldPos[childName];
    if (p && c) {
      const dir = c.clone().sub(p);
      if (dir.lengthSq() > 1e-8) {
        srcSegmentDirs[parentName] = dir.normalize();
      }
    }
  }

  const duration = Math.max(0.1, clip.duration);
  const frameCount = Math.max(2, Math.round(duration * SAMPLE_FPS) + 1);
  const hipsPosDeltas = new Float32Array(frameCount * 3);
  const boneWorldDeltas: Record<string, Float32Array> = {};
  for (const name of VRM_ORDERED_BONES) {
    if (srcRestWorldQuat[name]) {
      boneWorldDeltas[name] = new Float32Array(frameCount * 4);
    }
  }

  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();

  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const invRest = new THREE.Quaternion();
  const deltaQuat = new THREE.Quaternion();

  for (let f = 0; f < frameCount; f++) {
    const t = f === frameCount - 1 ? 0 : (f / (frameCount - 1)) * duration;
    mixer.setTime(t);
    scene.updateMatrixWorld(true);

    const hipsNode = nodes.get('hips');
    if (hipsNode) {
      hipsNode.getWorldPosition(tmpPos);
      const po = f * 3;
      hipsPosDeltas[po] = tmpPos.x - srcHipsRestPos.x;
      hipsPosDeltas[po + 1] = tmpPos.y - srcHipsRestPos.y;
      hipsPosDeltas[po + 2] = tmpPos.z - srcHipsRestPos.z;
    }

    for (const name of VRM_ORDERED_BONES) {
      const node = nodes.get(name);
      const restQ = srcRestWorldQuat[name];
      const out = boneWorldDeltas[name];
      if (!node || !restQ || !out) continue;

      node.getWorldQuaternion(tmpQuat).normalize();
      invRest.copy(restQ).invert();
      deltaQuat.copy(tmpQuat).multiply(invRest).normalize();

      const qo = f * 4;
      out[qo] = deltaQuat.x;
      out[qo + 1] = deltaQuat.y;
      out[qo + 2] = deltaQuat.z;
      out[qo + 3] = deltaQuat.w;
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  return {
    id,
    name: clip.name || id.charAt(0).toUpperCase() + id.slice(1),
    duration,
    fps: SAMPLE_FPS,
    frameCount,
    srcHipsRestY,
    srcSegmentDirs,
    hipsPosDeltas,
    boneWorldDeltas,
  };
}

/** Fetches, bakes, and caches a Blender GLB locomotion animation clip. */
export async function loadGlbAnimation(id: GlbLocomotionId): Promise<BakedGlbClip | null> {
  const existing = bakedCache.get(id);
  if (existing) return existing;

  const inflight = loadPromises.get(id);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const gltf = await getLoader().loadAsync(GLB_ANIMATION_URLS[id]);
      const clip = gltf.animations[0];
      if (!clip || !gltf.scene) return null;
      const baked = bakeSourceClip(id, gltf.scene, clip);
      bakedCache.set(id, baked);
      return baked;
    } catch (err) {
      console.warn(`[retargetGlbAnimation] Failed to load ${GLB_ANIMATION_URLS[id]}:`, err);
      return null;
    }
  })();

  loadPromises.set(id, promise);
  return promise;
}

/** Preloads all 3 Blender locomotion GLBs (`idle`, `walk`, `run`). */
export function preloadGlbAnimations(): Promise<(BakedGlbClip | null)[]> {
  return Promise.all([
    loadGlbAnimation('idle'),
    loadGlbAnimation('walk'),
    loadGlbAnimation('run'),
  ]);
}

/** Returns the already-cached baked GLB clip synchronously, or null while loading. */
export function getCachedGlbAnimation(id: GlbLocomotionId): BakedGlbClip | null {
  return bakedCache.get(id) ?? null;
}

/** Returns exact loop duration (seconds) of the loaded GLB clip, or null if unloaded. */
export function getGlbAnimationDuration(id: GlbLocomotionId): number | null {
  return bakedCache.get(id)?.duration ?? null;
}

// ── Sampling & A-pose/T-pose alignment helpers ────────────────────────────────

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();

function sampleFrameWindow(baked: BakedGlbClip, elapsedSeconds: number): { f0: number; f1: number; alpha: number } {
  const dur = baked.duration;
  const wrapped = ((elapsedSeconds % dur) + dur) % dur;
  const segments = baked.frameCount - 1;
  const fExact = (wrapped / dur) * segments;
  const f0 = Math.min(segments - 1, Math.floor(fExact));
  const f1 = f0 + 1;
  const alpha = fExact - f0;
  return { f0, f1, alpha };
}

function sampleDeltaQuat(arr: Float32Array, f0: number, f1: number, alpha: number, out: THREE.Quaternion): THREE.Quaternion {
  const o0 = f0 * 4;
  const o1 = f1 * 4;
  _q0.set(arr[o0]!, arr[o0 + 1]!, arr[o0 + 2]!, arr[o0 + 3]!);
  _q1.set(arr[o1]!, arr[o1 + 1]!, arr[o1 + 2]!, arr[o1 + 3]!);
  return out.copy(_q0).slerp(_q1, alpha).normalize();
}

function sampleHipsDelta(arr: Float32Array, f0: number, f1: number, alpha: number, out: THREE.Vector3): THREE.Vector3 {
  const o0 = f0 * 3;
  const o1 = f1 * 3;
  _v0.set(arr[o0]!, arr[o0 + 1]!, arr[o0 + 2]!);
  _v1.set(arr[o1]!, arr[o1 + 1]!, arr[o1 + 2]!);
  return out.lerpVectors(_v0, _v1, alpha);
}

/**
 * Computes per-arm-bone alignment quaternions so A-pose rest arms align to
 * horizontal T-pose before applying the Blender T-pose world animation delta.
 */
function buildArmAlignMap(
  baked: BakedGlbClip,
  getWorldPos: (vrmBone: string, out: THREE.Vector3) => boolean,
): Record<string, THREE.Quaternion> {
  const align: Record<string, THREE.Quaternion> = {};
  const pPos = new THREE.Vector3();
  const cPos = new THREE.Vector3();

  for (const [parentName, childName] of Object.entries(VRM_SEGMENT_CHILD)) {
    const srcDir = baked.srcSegmentDirs[parentName];
    if (!srcDir) continue;
    if (!getWorldPos(parentName, pPos) || !getWorldPos(childName, cPos)) continue;
    const tgtDir = cPos.sub(pPos);
    if (tgtDir.lengthSq() < 1e-8) continue;
    tgtDir.normalize();
    if (tgtDir.dot(srcDir) < 0.9994) {
      align[parentName] = new THREE.Quaternion().setFromUnitVectors(tgtDir, srcDir).normalize();
    }
  }

  // Hands inherit their forearm's A-pose alignment so wrists stay untwisted.
  if (align.leftLowerArm) align.leftHand = align.leftLowerArm.clone();
  if (align.rightLowerArm) align.rightHand = align.rightLowerArm.clone();
  return align;
}

// ── 1. Auto-Rigger live VRM skeleton driver ───────────────────────────────────

const _rtWorldQuat = new Map<string, THREE.Quaternion>();
const _rtHipsDelta = new THREE.Vector3();
const _rtDeltaQ = new THREE.Quaternion();
const _rtDesiredWorldQ = new THREE.Quaternion();
const _rtInvParentQ = new THREE.Quaternion();
const _rtRestPos = new Map<string, THREE.Vector3>();

interface VrmTargetCache {
  restWorldQuat: Record<string, THREE.Quaternion>;
  restHipsLocalPos: THREE.Vector3;
  hipsLegHeight: number;
  parentInvWorldQuat: THREE.Quaternion;
  worldPositions: Record<string, THREE.Vector3>;
}

const vrmTargetCache = new WeakMap<Map<string, THREE.Quaternion>, VrmTargetCache>();

function getOrBuildVrmTargetCache<TName extends string>(
  boneMap: Map<TName, THREE.Bone>,
  restQuats: Map<TName, THREE.Quaternion>,
): VrmTargetCache {
  const rawKey = restQuats as unknown as Map<string, THREE.Quaternion>;
  const hit = vrmTargetCache.get(rawKey);
  if (hit) return hit;

  // Snapshot live rotations, temporarily apply exact rest quats, read world rest, then restore.
  const saved = new Map<string, THREE.Quaternion>();
  for (const [name, bone] of boneMap) {
    saved.set(name, bone.quaternion.clone());
    const rq = restQuats.get(name);
    if (rq) bone.quaternion.copy(rq);
  }
  const hipsBone = boneMap.get('hips' as TName);
  const savedHipsPos = hipsBone ? hipsBone.position.clone() : new THREE.Vector3();
  const restHipsY = hipsBone ? ((hipsBone as unknown as { _restY?: number })._restY ?? savedHipsPos.y) : 0.952;
  if (hipsBone) hipsBone.position.y = restHipsY;

  const rootObj = hipsBone?.parent ?? hipsBone;
  rootObj?.updateMatrixWorld(true);

  const restWorldQuat: Record<string, THREE.Quaternion> = {};
  const worldPositions: Record<string, THREE.Vector3> = {};
  for (const name of VRM_ORDERED_BONES) {
    const b = boneMap.get(name as TName);
    if (!b) continue;
    restWorldQuat[name] = b.getWorldQuaternion(new THREE.Quaternion()).normalize();
    worldPositions[name] = b.getWorldPosition(new THREE.Vector3());
  }

  const parentInvWorldQuat = new THREE.Quaternion();
  if (hipsBone?.parent) {
    hipsBone.parent.getWorldQuaternion(parentInvWorldQuat).invert();
  }

  const hipsWorldY = worldPositions.hips?.y ?? 0.952;
  const footY = Math.min(
    worldPositions.leftToes?.y ?? worldPositions.leftFoot?.y ?? 0,
    worldPositions.rightToes?.y ?? worldPositions.rightFoot?.y ?? 0,
  );
  const hipsLegHeight = Math.max(0.25, hipsWorldY - footY);
  const restHipsLocalPos = new THREE.Vector3(savedHipsPos.x, restHipsY, savedHipsPos.z);

  // Restore pre-existing bone transforms
  for (const [name, bone] of boneMap) {
    const q = saved.get(name);
    if (q) bone.quaternion.copy(q);
  }
  if (hipsBone) hipsBone.position.copy(savedHipsPos);
  rootObj?.updateMatrixWorld(true);

  const built: VrmTargetCache = {
    restWorldQuat,
    restHipsLocalPos,
    hipsLegHeight,
    parentInvWorldQuat,
    worldPositions,
  };
  vrmTargetCache.set(rawKey, built);
  return built;
}

function resolveParentWorldQuat(
  name: string,
  worldQuatByName: Map<string, THREE.Quaternion>,
): THREE.Quaternion | undefined {
  let parentName = VRM_PARENT_BY_BONE[name] ?? null;
  while (parentName) {
    const q = worldQuatByName.get(parentName);
    if (q) return q;
    parentName = VRM_PARENT_BY_BONE[parentName] ?? null;
  }
  return undefined;
}

/**
 * Evaluates a loaded Blender GLB locomotion clip (`idle` | `walk` | `run`) onto
 * an Auto-Rigger VRM `boneMap`. Returns `false` if the GLB is still loading so
 * the caller can fall back to procedural animation.
 */
export function applyGlbTestAnimation<TName extends string>(
  boneMap: Map<TName, THREE.Bone>,
  restQuats: Map<TName, THREE.Quaternion>,
  mode: GlbLocomotionId,
  elapsedSeconds: number,
): boolean {
  const baked = bakedCache.get(mode);
  if (!baked) return false;

  const target = getOrBuildVrmTargetCache(boneMap, restQuats);
  const align = buildArmAlignMap(baked, (name, out) => {
    const p = target.worldPositions[name];
    if (!p) return false;
    out.copy(p);
    return true;
  });

  const { f0, f1, alpha } = sampleFrameWindow(baked, elapsedSeconds);
  const hipsScale = target.hipsLegHeight / baked.srcHipsRestY;

  _rtWorldQuat.clear();

  for (const name of VRM_ORDERED_BONES) {
    const bone = boneMap.get(name as TName);
    const restWorld = target.restWorldQuat[name];
    const deltaArr = baked.boneWorldDeltas[name];
    if (!bone || !restWorld || !deltaArr) continue;

    sampleDeltaQuat(deltaArr, f0, f1, alpha, _rtDeltaQ);
    _rtDesiredWorldQ.copy(_rtDeltaQ);
    const qAlign = align[name];
    if (qAlign) {
      _rtDesiredWorldQ.multiply(qAlign);
    }
    _rtDesiredWorldQ.multiply(restWorld).normalize();

    const parentWorldQ = resolveParentWorldQuat(name, _rtWorldQuat);
    if (parentWorldQ) {
      _rtInvParentQ.copy(parentWorldQ).invert();
      bone.quaternion.copy(_rtInvParentQ).multiply(_rtDesiredWorldQ).normalize();
    } else {
      bone.quaternion.copy(target.parentInvWorldQuat).multiply(_rtDesiredWorldQ).normalize();
    }

    _rtWorldQuat.set(name, _rtDesiredWorldQ.clone());

    if (name === 'hips') {
      sampleHipsDelta(baked.hipsPosDeltas, f0, f1, alpha, _rtHipsDelta);
      _rtHipsDelta.multiplyScalar(hipsScale).applyQuaternion(target.parentInvWorldQuat);
      bone.position.set(
        target.restHipsLocalPos.x + _rtHipsDelta.x,
        target.restHipsLocalPos.y + _rtHipsDelta.y,
        target.restHipsLocalPos.z + _rtHipsDelta.z,
      );
    }
  }

  // Keep any non-22 secondary/finger VRM bones cleanly at their rest quaternions
  for (const [name, bone] of boneMap) {
    if (!VRM_ORDERED_BONES.includes(name)) {
      const rq = restQuats.get(name);
      if (rq) bone.quaternion.copy(rq);
    }
  }
  _rtRestPos.clear();
  return true;
}

// ── 2. Main Character Creator XP32 clip baker ─────────────────────────────────

/**
 * Extracts the orthonormal 3x3 basis of `mat4`, removing per-axis scale magnitudes
 * while strictly preserving reflection parity (`det = +1` or `det = -1`) so
 * Skyrim NIF `meshFrameMatrix` mirror transforms retain exact handedness.
 */
function extractUnitBasis3(mat4: THREE.Matrix4): THREE.Matrix3 {
  const e = mat4.elements;
  const lx = Math.hypot(e[0]!, e[1]!, e[2]!) || 1;
  const ly = Math.hypot(e[4]!, e[5]!, e[6]!) || 1;
  const lz = Math.hypot(e[8]!, e[9]!, e[10]!) || 1;
  return new THREE.Matrix3().set(
    e[0]! / lx, e[4]! / ly, e[8]! / lz,
    e[1]! / lx, e[5]! / ly, e[9]! / lz,
    e[2]! / lx, e[6]! / ly, e[10]! / lz,
  );
}

/**
 * Bakes a retargeted `THREE.AnimationClip` targeting `bone.uuid` tracks onto a
 * Skyrim XP32 `SkeletonRegistry` for seamless `AnimationMixer` playback in the
 * main Character Creator (`Idle` / `Walk` / `Run`).
 *
 * Uses reflection-safe 3x3 basis multiplication (`M_local = P_anim^T * M_rot * W_rest`)
 * because `SkeletonRegistry` carries a `det = -1` NIF frame reflection above `COM`.
 */
export function buildXp32ClipFromGlb(
  id: GlbLocomotionId,
  registry: SkeletonRegistry,
): THREE.AnimationClip | null {
  const baked = bakedCache.get(id);
  if (!baked) return null;

  const comBone = registry.byName.get(VRM_TO_XP32.hips);
  if (!comBone) return null;

  // Read immutable rest world transforms and reflection-safe unit bases
  const xpRestBasis: Record<string, THREE.Matrix3> = {};
  const xpRestWorldPos: Record<string, THREE.Vector3> = {};
  const tmpScale = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();

  for (const vrmName of VRM_ORDERED_BONES) {
    const xpName = VRM_TO_XP32[vrmName];
    const worldMat = xpName ? registry.restWorld(xpName) : null;
    if (!worldMat) continue;
    const p = new THREE.Vector3();
    worldMat.decompose(p, tmpQuat, tmpScale);
    xpRestWorldPos[vrmName] = p;
    xpRestBasis[vrmName] = extractUnitBasis3(worldMat);
  }

  // Cache unit rest basis + local rest rotation for any intermediate XP32 bone
  // (e.g. `NPC Pelvis [Pelv]`, `CME Spine [Spn0]`, `CME Spine1 [Spn1]`, `NPC Root [Root]`)
  const allRestBasis = new Map<string, THREE.Matrix3>();
  const allLocalRestBasis = new Map<string, THREE.Matrix3>();
  for (const name of registry.names) {
    const wm = registry.restWorld(name);
    if (wm) allRestBasis.set(name, extractUnitBasis3(wm));
    const rp = registry.restPose(name);
    if (rp) {
      const m4 = new THREE.Matrix4().makeRotationFromQuaternion(rp.quaternion);
      allLocalRestBasis.set(name, new THREE.Matrix3().setFromMatrix4(m4));
    }
  }

  const rootGroupWorldMat = new THREE.Matrix4().makeRotationFromQuaternion(
    registry.group.getWorldQuaternion(new THREE.Quaternion()),
  );
  const groupUnitBasis = new THREE.Matrix3().setFromMatrix4(rootGroupWorldMat);
  const comParentBasis =
    comBone.parent && allRestBasis.get(comBone.parent.name)
      ? allRestBasis.get(comBone.parent.name)!
      : groupUnitBasis;
  const invComParentBasis = comParentBasis.clone().transpose();

  const comY = xpRestWorldPos.hips?.y ?? -0.6674;
  const footY = Math.min(
    xpRestWorldPos.leftToes?.y ?? xpRestWorldPos.leftFoot?.y ?? -1.555,
    xpRestWorldPos.rightToes?.y ?? xpRestWorldPos.rightFoot?.y ?? -1.555,
  );
  const hipsLegHeight = Math.max(0.25, comY - footY);
  const hipsScale = hipsLegHeight / baked.srcHipsRestY;

  const align = buildArmAlignMap(baked, (vrmName, out) => {
    const p = xpRestWorldPos[vrmName];
    if (!p) return false;
    out.copy(p);
    return true;
  });

  const times = new Float32Array(baked.frameCount);
  for (let f = 0; f < baked.frameCount; f++) {
    times[f] = (f / (baked.frameCount - 1)) * baked.duration;
  }

  const comRestLocalPos = registry.restPose(VRM_TO_XP32.hips)?.position ?? comBone.position;
  const comPosValues = new Float32Array(baked.frameCount * 3);
  const boneQuatValues: Record<string, Float32Array> = {};
  for (const vrmName of VRM_ORDERED_BONES) {
    const xpName = VRM_TO_XP32[vrmName];
    if (xpName && registry.byName.has(xpName) && baked.boneWorldDeltas[vrmName]) {
      boneQuatValues[vrmName] = new Float32Array(baked.frameCount * 4);
    }
  }

  const animBasisThisFrame = new Map<string, THREE.Matrix3>();
  const resolveAnimBasis = (xpBoneName: string): THREE.Matrix3 => {
    const cached = animBasisThisFrame.get(xpBoneName);
    if (cached) return cached;
    const bone = registry.byName.get(xpBoneName);
    if (!bone || !(bone.parent instanceof THREE.Bone) || !registry.byName.has(bone.parent.name)) {
      return allRestBasis.get(xpBoneName) ?? groupUnitBasis;
    }
    const parentAnim = resolveAnimBasis(bone.parent.name);
    const localRest = allLocalRestBasis.get(xpBoneName);
    const res = localRest ? new THREE.Matrix3().multiplyMatrices(parentAnim, localRest) : parentAnim;
    animBasisThisFrame.set(xpBoneName, res);
    return res;
  };

  const hipsDelta = new THREE.Vector3();
  const deltaQ = new THREE.Quaternion();
  const rotQ = new THREE.Quaternion();
  const mRot4 = new THREE.Matrix4();
  const mRot3 = new THREE.Matrix3();
  const mAnim3 = new THREE.Matrix3();
  const mParentT = new THREE.Matrix3();
  const mLocal3 = new THREE.Matrix3();
  const mLocal4 = new THREE.Matrix4();
  const localQ = new THREE.Quaternion();

  for (let f = 0; f < baked.frameCount; f++) {
    animBasisThisFrame.clear();

    for (const vrmName of VRM_ORDERED_BONES) {
      const xpName = VRM_TO_XP32[vrmName];
      const xpBone = xpName ? registry.byName.get(xpName) : undefined;
      const restBasis = xpRestBasis[vrmName];
      const deltaArr = baked.boneWorldDeltas[vrmName];
      const out = boneQuatValues[vrmName];
      if (!xpName || !xpBone || !restBasis || !deltaArr || !out) continue;

      const qo = f * 4;
      deltaQ.set(deltaArr[qo]!, deltaArr[qo + 1]!, deltaArr[qo + 2]!, deltaArr[qo + 3]!);
      rotQ.copy(deltaQ);
      const qAlign = align[vrmName];
      if (qAlign) rotQ.multiply(qAlign);

      mRot4.makeRotationFromQuaternion(rotQ);
      mRot3.setFromMatrix4(mRot4);
      mAnim3.multiplyMatrices(mRot3, restBasis);

      const parentAnimBasis =
        xpBone.parent instanceof THREE.Bone && registry.byName.has(xpBone.parent.name)
          ? resolveAnimBasis(xpBone.parent.name)
          : groupUnitBasis;

      mParentT.copy(parentAnimBasis).transpose();
      mLocal3.multiplyMatrices(mParentT, mAnim3);
      mLocal4.setFromMatrix3(mLocal3);
      localQ.setFromRotationMatrix(mLocal4).normalize();

      animBasisThisFrame.set(xpName, mAnim3.clone());
      out[qo] = localQ.x;
      out[qo + 1] = localQ.y;
      out[qo + 2] = localQ.z;
      out[qo + 3] = localQ.w;

      if (vrmName === 'hips') {
        const po = f * 3;
        hipsDelta.set(
          baked.hipsPosDeltas[po]!,
          baked.hipsPosDeltas[po + 1]!,
          baked.hipsPosDeltas[po + 2]!,
        );
        hipsDelta.multiplyScalar(hipsScale).applyMatrix3(invComParentBasis);
        comPosValues[po] = comRestLocalPos.x + hipsDelta.x;
        comPosValues[po + 1] = comRestLocalPos.y + hipsDelta.y;
        comPosValues[po + 2] = comRestLocalPos.z + hipsDelta.z;
      }
    }
  }

  const tracks: THREE.KeyframeTrack[] = [];
  tracks.push(new THREE.VectorKeyframeTrack(`${comBone.uuid}.position`, times, comPosValues));

  for (const vrmName of VRM_ORDERED_BONES) {
    const out = boneQuatValues[vrmName];
    const xpName = VRM_TO_XP32[vrmName];
    const bone = xpName ? registry.byName.get(xpName) : undefined;
    if (!out || !bone) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, times, out));
  }

  return new THREE.AnimationClip(baked.name, baked.duration, tracks);
}
