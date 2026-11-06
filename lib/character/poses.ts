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
  rotations: PoseRotation[];
}

const X: [number, number, number] = [1, 0, 0];
const Y: [number, number, number] = [0, 1, 0];
const Z: [number, number, number] = [0, 0, 1];

/* Arm convention — measured, not assumed. The pack's bind pose is *already* an
   A-pose: `NPC L Hand [LHnd]` sits at x −0.373, y −0.617 in render space, and the
   elbow at x −0.289. So a "lower the arms" rotation is a small delta, not the
   ~60° a T-pose would need: at −60° the left hand crossed the body to x +0.099.
   Every angle below was checked by replaying it through the baked body's bone
   tree and reading back the joint positions. */
export const BODY_POSES: BodyPose[] = [
  {
    id: 'rest',
    label: 'REST',
    note: 'The pack skeleton exactly as authored — a relaxed A-pose.',
    rotations: [],
  },
  {
    id: 'relaxed',
    label: 'RELAXED',
    note: 'Arms drawn in a little closer, weight settled.',
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
    id: 'hands-on-hips',
    label: 'HIPS',
    note: 'Elbows out, hands resting at the waist.',
    rotations: [
      { bone: 'NPC L UpperArm [LUar]', axis: Z, degrees: 4 },
      { bone: 'NPC R UpperArm [RUar]', axis: Z, degrees: -4 },
      /* The elbow carries the pose: a large Z bend swings the forearm in to the
         hip while leaving the elbow itself out at x ±0.307, which is the elbow
         "out" of a hands-on-hips stance. */
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
    label: 'CONTRA',
    note: 'Weight on one leg, hips and shoulders tilted against each other.',
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
    id: 'side-glance',
    label: 'GLANCE',
    note: 'Head turned and tipped a little, body relaxed.',
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
];

export const DEFAULT_POSE_ID = 'rest';

export function bodyPose(id: string | undefined): BodyPose {
  return BODY_POSES.find((p) => p.id === id) ?? BODY_POSES[0];
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
export function applyBodyPose(registry: SkeletonRegistry, pose: BodyPose): void {
  registry.reset();
  registry.updateWorld();

  const worldQuat = new THREE.Quaternion();
  const inverseWorld = new THREE.Quaternion();
  const localAxis = new THREE.Vector3();
  const delta = new THREE.Quaternion();
  const axis = new THREE.Vector3();

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
    delta.setFromAxisAngle(localAxis, THREE.MathUtils.degToRad(rotation.degrees));

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
