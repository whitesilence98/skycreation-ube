import * as THREE from 'three';
import type { SkeletonRegistry } from '@/lib/character/skeleton';

/**
 * The preset pose library.
 *
 * Poses are authored in the character's own frame — the one the viewport shows,
 * where +y is up, +x is the character's left and +z is forward — because that
 * is the only frame a person can reason about. Each entry names a bone, an
 * axis and an angle; the applier converts that axis into the bone's local
 * frame, which is where Three.js actually wants the delta.
 *
 * A pose is always applied **over the rest pose**, never accumulated: applying
 * "arms down" then "rest" must give the bind pose back, not a rotation of the
 * first.
 */
export interface PoseRotation {
  /** Bone node name as the pack authored it, e.g. `NPC L UpperArm [LUar]`. */
  bone: string;
  /** Axis in the rendered character frame. */
  axis: [number, number, number];
  degrees: number;
}

export interface BodyPose {
  id: string;
  label: string;
  /** One-line description for the tile's tooltip. */
  note: string;
  category?: 'IDLE' | 'ACTION' | 'EXPRESSIONS';
  rotations: PoseRotation[];
}

const X: [number, number, number] = [1, 0, 0];
const Y: [number, number, number] = [0, 1, 0];
const Z: [number, number, number] = [0, 0, 1];

export const BODY_POSES: BodyPose[] = [
  {
    id: 'rest',
    label: 'Idle Standing',
    note: 'The pack skeleton exactly as authored — a relaxed A-pose.',
    category: 'IDLE',
    rotations: [],
  },
  {
    id: 'fighting-stance',
    label: 'Fighting Stance',
    note: 'Alert combat posture, fists guarded and knees bent.',
    category: 'ACTION',
    rotations: [
      { bone: 'NPC Spine1 [Spn1]', axis: X, degrees: 8 },
      { bone: 'NPC L Thigh [LThg]', axis: X, degrees: 14 },
      { bone: 'NPC R Thigh [RThg]', axis: X, degrees: -8 },
      { bone: 'NPC L Calf [LClf]', axis: X, degrees: -18 },
      { bone: 'NPC R Calf [RClf]', axis: X, degrees: 10 },
      { bone: 'NPC L UpperArm [LUar]', axis: X, degrees: 38 },
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: -22 },
      { bone: 'NPC L Forearm [LLar]', axis: Z, degrees: -68 },
      { bone: 'NPC L Forearm [LLar]', axis: X, degrees: 18 },
      { bone: 'NPC R UpperArm [RUar]', axis: X, degrees: 32 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: 18 },
      { bone: 'NPC R Forearm [RLar]', axis: Z, degrees: 64 },
      { bone: 'NPC R Forearm [RLar]', axis: X, degrees: 22 },
      { bone: 'NPC Neck [Neck]', axis: X, degrees: -8 },
    ],
  },
  {
    id: 'greeting-wave',
    label: 'Greeting Wave',
    note: 'Friendly posture with right arm raised in a welcoming wave.',
    category: 'ACTION',
    rotations: [
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: 90 },
      { bone: 'NPC R UpperArm [RUar]', axis: Y, degrees: -12 },
      { bone: 'NPC R Forearm [RLar]', axis: Z, degrees: 32 },
      { bone: 'NPC R Hand [RHnd]', axis: Z, degrees: 14 },
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: -10 },
      { bone: 'NPC Head [Head]', axis: Z, degrees: 5 },
      { bone: 'NPC Head [Head]', axis: Y, degrees: 4 },
      { bone: 'NPC Spine1 [Spn1]', axis: Z, degrees: 3 },
    ],
  },
  {
    id: 'defeat',
    label: 'Defeat',
    note: 'Exhausted stance with head bowed and shoulders slumped forward.',
    category: 'ACTION',
    rotations: [
      { bone: 'NPC Neck [Neck]', axis: X, degrees: -22 },
      { bone: 'NPC Head [Head]', axis: X, degrees: -16 },
      { bone: 'NPC Spine [Spn0]', axis: X, degrees: 12 },
      { bone: 'NPC Spine1 [Spn1]', axis: X, degrees: 14 },
      { bone: 'NPC Spine2 [Spn2]', axis: X, degrees: 10 },
      { bone: 'NPC L UpperArm [LUar]', axis: X, degrees: 10 },
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: -4 },
      { bone: 'NPC R UpperArm [RUar]', axis: X, degrees: 10 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: 4 },
    ],
  },
  {
    id: 'victory',
    label: 'Victory',
    note: 'Triumphant celebratory stance with both arms held high.',
    category: 'ACTION',
    rotations: [
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: -82 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: 82 },
      { bone: 'NPC Spine1 [Spn1]', axis: X, degrees: -5 },
      { bone: 'NPC Spine2 [Spn2]', axis: X, degrees: -5 },
      { bone: 'NPC L Forearm [LLar]', axis: Z, degrees: -14 },
      { bone: 'NPC R Forearm [RLar]', axis: Z, degrees: 14 },
      { bone: 'NPC Neck [Neck]', axis: X, degrees: 8 },
      { bone: 'NPC Head [Head]', axis: X, degrees: 6 },
    ],
  },
  {
    id: 'hands-on-hips',
    label: 'Hands on Hips',
    note: 'Elbows out, hands resting at the waist in confident repose.',
    category: 'IDLE',
    rotations: [
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: 4 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: -4 },
      { bone: 'NPC L Forearm [LLar]', axis: Z, degrees: -55 },
      { bone: 'NPC R Forearm [RLar]', axis: Z, degrees: 55 },
      { bone: 'NPC L Forearm [LLar]', axis: X, degrees: 25 },
      { bone: 'NPC R Forearm [RLar]', axis: X, degrees: 25 },
      { bone: 'NPC L Hand [LHnd]', axis: Z, degrees: -8 },
      { bone: 'NPC R Hand [RHnd]', axis: Z, degrees: 8 },
      { bone: 'NPC Spine2 [Spn2]', axis: X, degrees: -3 },
    ],
  },
  {
    id: 'contrapposto',
    label: 'Contrapposto',
    note: 'Weight on one leg, hips and shoulders tilted against each other.',
    category: 'IDLE',
    rotations: [
      { bone: 'NPC Pelvis [Pelv]', axis: Z, degrees: 4 },
      { bone: 'NPC Spine [Spn0]', axis: Z, degrees: -2.5 },
      { bone: 'NPC Spine2 [Spn2]', axis: Z, degrees: -1.5 },
      { bone: 'NPC L Thigh [LThg]', axis: X, degrees: -3 },
      { bone: 'NPC R Thigh [RThg]', axis: X, degrees: 3 },
      { bone: 'NPC L Calf [LClf]', axis: X, degrees: 3 },
      { bone: 'NPC Neck [Neck]', axis: Z, degrees: 2.5 },
      { bone: 'NPC Head [Head]', axis: Z, degrees: -1.5 },
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: -6 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: 6 },
      { bone: 'NPC L Forearm [LLar]', axis: X, degrees: -6 },
      { bone: 'NPC R Forearm [RLar]', axis: X, degrees: -6 },
    ],
  },
  {
    id: 'relaxed',
    label: 'Relaxed Stance',
    note: 'Arms drawn in a little closer, weight settled.',
    category: 'IDLE',
    rotations: [
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: -8 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: 8 },
      { bone: 'NPC L Forearm [LLar]', axis: X, degrees: -6 },
      { bone: 'NPC R Forearm [RLar]', axis: X, degrees: -6 },
      { bone: 'NPC Spine1 [Spn1]', axis: X, degrees: 1.5 },
      { bone: 'NPC Neck [Neck]', axis: X, degrees: -2 },
    ],
  },
  {
    id: 'idle-sitting',
    label: 'Idle Sitting',
    note: 'Restful seated posture with bent knees and composed posture.',
    category: 'IDLE',
    rotations: [
      { bone: 'NPC L Thigh [LThg]', axis: X, degrees: 72 },
      { bone: 'NPC R Thigh [RThg]', axis: X, degrees: 72 },
      { bone: 'NPC L Calf [LClf]', axis: X, degrees: -74 },
      { bone: 'NPC R Calf [RClf]', axis: X, degrees: -74 },
      { bone: 'NPC L UpperArm [LUar]', axis: X, degrees: 18 },
      { bone: 'NPC R UpperArm [RUar]', axis: X, degrees: 18 },
      { bone: 'NPC L Forearm [LLar]', axis: X, degrees: 16 },
      { bone: 'NPC R Forearm [RLar]', axis: X, degrees: 16 },
      { bone: 'NPC Spine1 [Spn1]', axis: X, degrees: -2 },
    ],
  },
  {
    id: 'side-glance',
    label: 'Side Glance',
    note: 'Head turned and tipped, curious casual glance.',
    category: 'EXPRESSIONS',
    rotations: [
      { bone: 'NPC Neck [Neck]', axis: Y, degrees: 10 },
      { bone: 'NPC Neck [Neck]', axis: Z, degrees: 3 },
      { bone: 'NPC Head [Head]', axis: Y, degrees: 16 },
      { bone: 'NPC Head [Head]', axis: Z, degrees: -3 },
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: -7 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: 7 },
      { bone: 'NPC L Forearm [LLar]', axis: X, degrees: -6 },
      { bone: 'NPC R Forearm [RLar]', axis: X, degrees: -6 },
    ],
  },
  {
    id: 'shy-pose',
    label: 'Shy & Modest',
    note: 'Gentle inward turn with hands clasped close in front.',
    category: 'EXPRESSIONS',
    rotations: [
      { bone: 'NPC Neck [Neck]', axis: X, degrees: -6 },
      { bone: 'NPC Neck [Neck]', axis: Z, degrees: 4 },
      { bone: 'NPC Head [Head]', axis: Z, degrees: -3 },
      { bone: 'NPC L UpperArm [LUar]', axis: X, degrees: 15 },
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: -16 },
      { bone: 'NPC L Forearm [LLar]', axis: Z, degrees: -40 },
      { bone: 'NPC R UpperArm [RUar]', axis: X, degrees: 15 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: 16 },
      { bone: 'NPC R Forearm [RLar]', axis: Z, degrees: 40 },
      { bone: 'NPC Pelvis [Pelv]', axis: Z, degrees: -2 },
    ],
  },
  {
    id: 'confident',
    label: 'Confident',
    note: 'High chin, proud spine, and poised composure.',
    category: 'EXPRESSIONS',
    rotations: [
      { bone: 'NPC Neck [Neck]', axis: X, degrees: 6 },
      { bone: 'NPC Head [Head]', axis: Y, degrees: -8 },
      { bone: 'NPC Spine1 [Spn1]', axis: X, degrees: -3 },
      { bone: 'NPC Spine2 [Spn2]', axis: Z, degrees: 2 },
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: 2 },
      { bone: 'NPC L Forearm [LLar]', axis: Z, degrees: -38 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: -6 },
      { bone: 'NPC Pelvis [Pelv]', axis: Z, degrees: 3 },
    ],
  },
];

export const DEFAULT_POSE_ID = 'rest';

export interface BoneTransformTrack {
  q?: [number, number, number, number];
  t?: [number, number, number];
}

export interface PoseTrack {
  id: string;
  name: string;
  pack: string;
  category?: string;
  event?: string;
  boneCount?: number;
  bones: Record<string, BoneTransformTrack>;
}

export interface PoseManifestItem {
  id: string;
  name: string;
  pack: string;
  category?: string;
  file?: string;
  note?: string;
  boneCount?: number;
}

export interface PosePackMeta {
  id: string;
  name: string;
  categories: string[];
  count: number;
}

export interface PoseManifest {
  version: number;
  defaultPoseId: string;
  packs: PosePackMeta[];
  poses: Record<string, PoseManifestItem>;
}

const POSE_TRACK_CACHE = new Map<string, PoseTrack>();
let manifestCache: PoseManifest | null = null;

export async function loadPoseManifest(): Promise<PoseManifest | null> {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch('/assets/preset-pack/poses/manifest.json');
    if (!res.ok) return null;
    manifestCache = (await res.json()) as PoseManifest;
    return manifestCache;
  } catch (err) {
    console.error('Failed to load pose manifest:', err);
    return null;
  }
}

export async function fetchPoseTrack(id: string, file?: string): Promise<PoseTrack | null> {
  if (POSE_TRACK_CACHE.has(id)) {
    return POSE_TRACK_CACHE.get(id)!;
  }
  const relPath =
    file ??
    (id.startsWith('halos_')
      ? `halos/${id}.json`
      : id.startsWith('gomapero_')
        ? `gomapero/${id}.json`
        : null);
  if (!relPath) return null;

  try {
    const res = await fetch(`/assets/preset-pack/poses/${relPath}`);
    if (!res.ok) return null;
    const track = (await res.json()) as PoseTrack;
    POSE_TRACK_CACHE.set(id, track);
    return track;
  } catch (err) {
    console.error(`Failed to fetch pose track ${id}:`, err);
    return null;
  }
}

export function getCachedPoseTrack(id: string): PoseTrack | undefined {
  return POSE_TRACK_CACHE.get(id);
}

export function bodyPose(id: string | undefined): BodyPose {
  return BODY_POSES.find((p) => p.id === id) ?? BODY_POSES[0];
}

/**
 * Applies a Havok keyframe track directly onto registered bones.
 * Bones agree on local coordinate frames with NIF/Havok; quaternions
 * and COM/pelvis displacements are assigned cleanly over the reset skeleton.
 */
export function applyPoseTrack(registry: SkeletonRegistry, track: PoseTrack, intensity = 1.0): void {
  registry.reset();
  const clampedIntensity = Math.max(0, Math.min(2.0, intensity));
  const targetQuat = new THREE.Quaternion();

  for (const [boneName, transform] of Object.entries(track.bones)) {
    const bone = registry.byName.get(boneName);
    if (!bone) continue;

    if (transform.q) {
      targetQuat.set(transform.q[0], transform.q[1], transform.q[2], transform.q[3]);
      if (clampedIntensity !== 1.0) {
        bone.quaternion.slerp(targetQuat, clampedIntensity);
      } else {
        bone.quaternion.copy(targetQuat);
      }
    }
    // Only anatomical root displacement (COM / Root / Pos) should apply translation.
    // Limb joints (Thighs, Calves, Feet, Arms, Hands, Fingers, Spine) must strictly rotate
    // around their authored pivot lengths to preserve exact human anatomy and prevent joint popping.
    if (
      transform.t &&
      (boneName === 'NPC COM [COM ]' ||
        boneName === 'x_NPC Translate [Pos ]' ||
        boneName === 'NPC Root [Root]')
    ) {
      bone.position.set(
        transform.t[0] * clampedIntensity,
        transform.t[1] * clampedIntensity,
        transform.t[2] * clampedIntensity,
      );
    }
  }

  registry.updateWorld();
}

/**
 * High-level pose applier that handles both built-in procedural presets
 * and external Skyrim Havok pose tracks.
 */
export async function applyPoseById(registry: SkeletonRegistry, id: string, intensity = 1.0): Promise<void> {
  const builtin = BODY_POSES.find((p) => p.id === id);
  if (builtin) {
    applyBodyPose(registry, builtin, intensity);
    return;
  }

  let track = POSE_TRACK_CACHE.get(id);
  if (!track) {
    track = (await fetchPoseTrack(id)) ?? undefined;
  }

  if (track) {
    applyPoseTrack(registry, track, intensity);
  } else {
    // Fallback to rest pose if pose track not found
    applyBodyPose(registry, BODY_POSES[0], intensity);
  }
}

/**
 * Applies a pose over the rest pose.
 *
 * The axis arrives in the character's frame, but the delta has to be expressed
 * in the bone's own local frame, so it is carried across by the bone's rest
 * world rotation. Post-multiplying the rest local quaternion is what puts the
 * delta there — pre-multiplying would rotate about the parent's axes instead
 * and make "lower the arm" swing the whole shoulder.
 *
 * `reset` runs first so a pose is absolute. Bones the active mesh does not have
 * are skipped: a hairstyle only carries the head chain, and asking it for an
 * elbow is not an error.
 */
export function applyBodyPose(registry: SkeletonRegistry, pose: BodyPose, intensity = 1.0): void {
  registry.reset();
  registry.updateWorld();

  const worldQuat = new THREE.Quaternion();
  const inverseWorld = new THREE.Quaternion();
  const localAxis = new THREE.Vector3();
  const delta = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const clampedIntensity = Math.max(0, Math.min(2.0, intensity));

  for (const rotation of pose.rotations) {
    const bone = registry.byName.get(rotation.bone);
    if (!bone) continue;
    /* A bone that no registered mesh carries is skipped, not an error: a
       hairstyle only ships the head chain, so its elbow bones legitimately do
       not exist. */
    if (!registry.restPose(rotation.bone)) continue;

    /* The bone's *current* world rotation, not its rest: rotations accumulate
       left to right within one pose, so a second rotation on the same bone has
       to be expressed against the frame the first one left it in. */
    bone.getWorldQuaternion(worldQuat);
    inverseWorld.copy(worldQuat).invert();
    axis.set(rotation.axis[0], rotation.axis[1], rotation.axis[2]);
    if (axis.lengthSq() === 0) continue;
    localAxis.copy(axis.normalize()).applyQuaternion(inverseWorld);
    delta.setFromAxisAngle(localAxis, THREE.MathUtils.degToRad(rotation.degrees * clampedIntensity));

    /* Post-multiply, not assign from rest: the quaternion started at rest via
       `reset`, so this composes this rotation on top of whatever the pose
       already did to the bone. */
    bone.quaternion.multiply(delta);
    /* The next rotation reads this bone (or a child) back through
       `getWorldQuaternion`, so the matrices have to catch up first. */
    bone.updateMatrixWorld(true);
  }

  registry.updateWorld();
}
