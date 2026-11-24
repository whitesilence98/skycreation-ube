/**
 * lib/rigger/vrmSkeleton.ts
 *
 * Custom humanoid skeleton definition for the CC-Kit Auto-Rigger.
 *
 * Bone names follow the VRM 1.0 Humanoid specification
 * (https://github.com/vrm-c/vrm-specification — MIT License).
 * No XPMSE, no Bethesda, no Mixamo — 100% open standard.
 *
 * Coordinate system: glTF / Three.js right-hand, Y-up.
 * All positions are in metres, normalised for a 1.7 m reference figure
 * standing in a neutral T-pose with arms horizontal, palms down.
 *
 * Usage:
 *   import { VRM_BONES, buildTPoseSkeleton } from '@/lib/rigger/vrmSkeleton';
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Bone name enum — VRM 1.0 required + optional humanoid bones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every VRM 1.0 humanoid bone name, typed as a string-literal union.
 * Required bones are marked in `VRM_BONE_DEFS` below.
 */
export type VrmBoneName =
  // Core spine
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  // Face (optional)
  | 'leftEye'
  | 'rightEye'
  | 'jaw'
  // Left arm
  | 'leftShoulder'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand'
  // Left fingers (optional)
  | 'leftThumbMetacarpal'
  | 'leftThumbProximal'
  | 'leftThumbDistal'
  | 'leftIndexProximal'
  | 'leftIndexIntermediate'
  | 'leftIndexDistal'
  | 'leftMiddleProximal'
  | 'leftMiddleIntermediate'
  | 'leftMiddleDistal'
  | 'leftRingProximal'
  | 'leftRingIntermediate'
  | 'leftRingDistal'
  | 'leftLittleProximal'
  | 'leftLittleIntermediate'
  | 'leftLittleDistal'
  // Right arm
  | 'rightShoulder'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand'
  // Right fingers (optional)
  | 'rightThumbMetacarpal'
  | 'rightThumbProximal'
  | 'rightThumbDistal'
  | 'rightIndexProximal'
  | 'rightIndexIntermediate'
  | 'rightIndexDistal'
  | 'rightMiddleProximal'
  | 'rightMiddleIntermediate'
  | 'rightMiddleDistal'
  | 'rightRingProximal'
  | 'rightRingIntermediate'
  | 'rightRingDistal'
  | 'rightLittleProximal'
  | 'rightLittleIntermediate'
  | 'rightLittleDistal'
  // Left leg
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'leftFoot'
  | 'leftToes'
  // Right leg
  | 'rightUpperLeg'
  | 'rightLowerLeg'
  | 'rightFoot'
  | 'rightToes';

// ─────────────────────────────────────────────────────────────────────────────
// 2. Bone definition table
// ─────────────────────────────────────────────────────────────────────────────

export interface VrmBoneDef {
  /** VRM 1.0 bone name */
  name: VrmBoneName;
  /** Bone is required by VRM 1.0 spec; false = optional */
  required: boolean;
  /** Parent bone name, or null for the root (hips) */
  parent: VrmBoneName | null;
  /**
   * T-pose position relative to parent in metres.
   * Normalised for a 1.70 m figure; scale with `SkeletonTemplate.scale`.
   */
  localPosition: readonly [x: number, y: number, z: number];
  /**
   * Anatomical region label — used by the auto-rigger to group bones
   * during landmark-based fitting.
   */
  region: 'spine' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg' | 'leftFinger' | 'rightFinger';
}

/**
 * Complete ordered list of VRM 1.0 humanoid bones.
 *
 * Local positions define the T-pose skeleton for a neutral 1.70 m figure.
 * All values in metres; Y is up; X is the character's left; Z is forward.
 *
 * Anatomical ratios sourced from:
 *  • Winter DA, "Biomechanics and Motor Control of Human Movement" (4th ed.)
 *  • De Leva P, "Adjustments to Zatsiorsky-Seluyanov's segment inertia parameters"
 *  Both are peer-reviewed public-domain reference tables.
 */
export const VRM_BONE_DEFS: readonly VrmBoneDef[] = [
  // ── Core spine ──────────────────────────────────────────────────────────
  {
    name: 'hips',
    required: true,
    parent: null,
    // Hip joint centre at ~56% of full height from ground (≈ 0.952 m for 1.70 m)
    localPosition: [0, 0.952, 0],
    region: 'spine',
  },
  {
    name: 'spine',
    required: true,
    parent: 'hips',
    // L4–L5 vertebra: ~5.5% of height above hip centre
    localPosition: [0, 0.094, 0],
    region: 'spine',
  },
  {
    name: 'chest',
    required: true,
    parent: 'spine',
    // T8 vertebra level: ~11% of height above L4–L5
    localPosition: [0, 0.187, 0],
    region: 'spine',
  },
  {
    name: 'upperChest',
    required: false,
    parent: 'chest',
    // T2 vertebra: ~8% of height above T8
    localPosition: [0, 0.136, 0],
    region: 'spine',
  },
  {
    name: 'neck',
    required: true,
    parent: 'upperChest',
    // C7 vertebra: ~4% of height above T2
    localPosition: [0, 0.068, 0],
    region: 'spine',
  },
  {
    name: 'head',
    required: true,
    parent: 'neck',
    // Skull base: ~4% of height above C7
    localPosition: [0, 0.068, 0],
    region: 'head',
  },

  // ── Face (optional) ─────────────────────────────────────────────────────
  {
    name: 'leftEye',
    required: false,
    parent: 'head',
    localPosition: [0.032, 0.062, 0.058],
    region: 'head',
  },
  {
    name: 'rightEye',
    required: false,
    parent: 'head',
    localPosition: [-0.032, 0.062, 0.058],
    region: 'head',
  },
  {
    name: 'jaw',
    required: false,
    parent: 'head',
    localPosition: [0, -0.01, 0.045],
    region: 'head',
  },

  // ── Left arm ────────────────────────────────────────────────────────────
  {
    name: 'leftShoulder',
    required: false,
    parent: 'upperChest',
    // Clavicle medial-to-lateral; ~11% of shoulder width from midline
    localPosition: [0.038, 0.034, 0],
    region: 'leftArm',
  },
  {
    name: 'leftUpperArm',
    required: true,
    parent: 'leftShoulder',
    // Glenohumeral joint: 20% of height from midline in X, same Y as chest
    localPosition: [0.142, 0, 0],
    region: 'leftArm',
  },
  {
    name: 'leftLowerArm',
    required: true,
    parent: 'leftUpperArm',
    // Elbow: upper arm is ~16.4% of height
    localPosition: [0.279, 0, 0],
    region: 'leftArm',
  },
  {
    name: 'leftHand',
    required: true,
    parent: 'leftLowerArm',
    // Wrist: forearm is ~15.7% of height
    localPosition: [0.267, 0, 0],
    region: 'leftArm',
  },

  // ── Left fingers ────────────────────────────────────────────────────────
  {
    name: 'leftThumbMetacarpal',
    required: false,
    parent: 'leftHand',
    localPosition: [0.034, -0.006, 0.022],
    region: 'leftFinger',
  },
  {
    name: 'leftThumbProximal',
    required: false,
    parent: 'leftThumbMetacarpal',
    localPosition: [0.026, 0, 0.012],
    region: 'leftFinger',
  },
  {
    name: 'leftThumbDistal',
    required: false,
    parent: 'leftThumbProximal',
    localPosition: [0.022, 0, 0],
    region: 'leftFinger',
  },
  {
    name: 'leftIndexProximal',
    required: false,
    parent: 'leftHand',
    localPosition: [0.082, 0, 0.012],
    region: 'leftFinger',
  },
  {
    name: 'leftIndexIntermediate',
    required: false,
    parent: 'leftIndexProximal',
    localPosition: [0.030, 0, 0],
    region: 'leftFinger',
  },
  {
    name: 'leftIndexDistal',
    required: false,
    parent: 'leftIndexIntermediate',
    localPosition: [0.022, 0, 0],
    region: 'leftFinger',
  },
  {
    name: 'leftMiddleProximal',
    required: false,
    parent: 'leftHand',
    localPosition: [0.082, 0, 0.004],
    region: 'leftFinger',
  },
  {
    name: 'leftMiddleIntermediate',
    required: false,
    parent: 'leftMiddleProximal',
    localPosition: [0.034, 0, 0],
    region: 'leftFinger',
  },
  {
    name: 'leftMiddleDistal',
    required: false,
    parent: 'leftMiddleIntermediate',
    localPosition: [0.026, 0, 0],
    region: 'leftFinger',
  },
  {
    name: 'leftRingProximal',
    required: false,
    parent: 'leftHand',
    localPosition: [0.079, 0, -0.008],
    region: 'leftFinger',
  },
  {
    name: 'leftRingIntermediate',
    required: false,
    parent: 'leftRingProximal',
    localPosition: [0.030, 0, 0],
    region: 'leftFinger',
  },
  {
    name: 'leftRingDistal',
    required: false,
    parent: 'leftRingIntermediate',
    localPosition: [0.022, 0, 0],
    region: 'leftFinger',
  },
  {
    name: 'leftLittleProximal',
    required: false,
    parent: 'leftHand',
    localPosition: [0.072, 0, -0.020],
    region: 'leftFinger',
  },
  {
    name: 'leftLittleIntermediate',
    required: false,
    parent: 'leftLittleProximal',
    localPosition: [0.024, 0, 0],
    region: 'leftFinger',
  },
  {
    name: 'leftLittleDistal',
    required: false,
    parent: 'leftLittleIntermediate',
    localPosition: [0.018, 0, 0],
    region: 'leftFinger',
  },

  // ── Right arm (mirror of left; X negated) ───────────────────────────────
  {
    name: 'rightShoulder',
    required: false,
    parent: 'upperChest',
    localPosition: [-0.038, 0.034, 0],
    region: 'rightArm',
  },
  {
    name: 'rightUpperArm',
    required: true,
    parent: 'rightShoulder',
    localPosition: [-0.142, 0, 0],
    region: 'rightArm',
  },
  {
    name: 'rightLowerArm',
    required: true,
    parent: 'rightUpperArm',
    localPosition: [-0.279, 0, 0],
    region: 'rightArm',
  },
  {
    name: 'rightHand',
    required: true,
    parent: 'rightLowerArm',
    localPosition: [-0.267, 0, 0],
    region: 'rightArm',
  },
  {
    name: 'rightThumbMetacarpal',
    required: false,
    parent: 'rightHand',
    localPosition: [-0.034, -0.006, 0.022],
    region: 'rightFinger',
  },
  {
    name: 'rightThumbProximal',
    required: false,
    parent: 'rightThumbMetacarpal',
    localPosition: [-0.026, 0, 0.012],
    region: 'rightFinger',
  },
  {
    name: 'rightThumbDistal',
    required: false,
    parent: 'rightThumbProximal',
    localPosition: [-0.022, 0, 0],
    region: 'rightFinger',
  },
  {
    name: 'rightIndexProximal',
    required: false,
    parent: 'rightHand',
    localPosition: [-0.082, 0, 0.012],
    region: 'rightFinger',
  },
  {
    name: 'rightIndexIntermediate',
    required: false,
    parent: 'rightIndexProximal',
    localPosition: [-0.030, 0, 0],
    region: 'rightFinger',
  },
  {
    name: 'rightIndexDistal',
    required: false,
    parent: 'rightIndexIntermediate',
    localPosition: [-0.022, 0, 0],
    region: 'rightFinger',
  },
  {
    name: 'rightMiddleProximal',
    required: false,
    parent: 'rightHand',
    localPosition: [-0.082, 0, 0.004],
    region: 'rightFinger',
  },
  {
    name: 'rightMiddleIntermediate',
    required: false,
    parent: 'rightMiddleProximal',
    localPosition: [-0.034, 0, 0],
    region: 'rightFinger',
  },
  {
    name: 'rightMiddleDistal',
    required: false,
    parent: 'rightMiddleIntermediate',
    localPosition: [-0.026, 0, 0],
    region: 'rightFinger',
  },
  {
    name: 'rightRingProximal',
    required: false,
    parent: 'rightHand',
    localPosition: [-0.079, 0, -0.008],
    region: 'rightFinger',
  },
  {
    name: 'rightRingIntermediate',
    required: false,
    parent: 'rightRingProximal',
    localPosition: [-0.030, 0, 0],
    region: 'rightFinger',
  },
  {
    name: 'rightRingDistal',
    required: false,
    parent: 'rightRingIntermediate',
    localPosition: [-0.022, 0, 0],
    region: 'rightFinger',
  },
  {
    name: 'rightLittleProximal',
    required: false,
    parent: 'rightHand',
    localPosition: [-0.072, 0, -0.020],
    region: 'rightFinger',
  },
  {
    name: 'rightLittleIntermediate',
    required: false,
    parent: 'rightLittleProximal',
    localPosition: [-0.024, 0, 0],
    region: 'rightFinger',
  },
  {
    name: 'rightLittleDistal',
    required: false,
    parent: 'rightLittleIntermediate',
    localPosition: [-0.018, 0, 0],
    region: 'rightFinger',
  },

  // ── Left leg ────────────────────────────────────────────────────────────
  {
    name: 'leftUpperLeg',
    required: true,
    parent: 'hips',
    // Hip socket: ~9.5% of height lateral from midline
    localPosition: [0.090, -0.034, 0],
    region: 'leftLeg',
  },
  {
    name: 'leftLowerLeg',
    required: true,
    parent: 'leftUpperLeg',
    // Knee: thigh is ~24.5% of height
    localPosition: [0, -0.417, 0],
    region: 'leftLeg',
  },
  {
    name: 'leftFoot',
    required: true,
    parent: 'leftLowerLeg',
    // Ankle: shank is ~24.6% of height
    localPosition: [0, -0.418, 0],
    region: 'leftLeg',
  },
  {
    name: 'leftToes',
    required: false,
    parent: 'leftFoot',
    // Ball of foot
    localPosition: [0, -0.062, 0.070],
    region: 'leftLeg',
  },

  // ── Right leg (mirror of left; X negated) ───────────────────────────────
  {
    name: 'rightUpperLeg',
    required: true,
    parent: 'hips',
    localPosition: [-0.090, -0.034, 0],
    region: 'rightLeg',
  },
  {
    name: 'rightLowerLeg',
    required: true,
    parent: 'rightUpperLeg',
    localPosition: [0, -0.417, 0],
    region: 'rightLeg',
  },
  {
    name: 'rightFoot',
    required: true,
    parent: 'rightLowerLeg',
    localPosition: [0, -0.418, 0],
    region: 'rightLeg',
  },
  {
    name: 'rightToes',
    required: false,
    parent: 'rightFoot',
    localPosition: [0, -0.062, 0.070],
    region: 'rightLeg',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Lookup helpers
// ─────────────────────────────────────────────────────────────────────────────

/** O(1) lookup by VRM bone name. */
export const VRM_BONE_BY_NAME: Readonly<Record<VrmBoneName, VrmBoneDef>> =
  Object.fromEntries(VRM_BONE_DEFS.map((d) => [d.name, d])) as Record<VrmBoneName, VrmBoneDef>;

/** Ordered list of only the required VRM 1.0 bones (22 bones). */
export const VRM_REQUIRED_BONES: readonly VrmBoneDef[] = VRM_BONE_DEFS.filter((d) => d.required);

/** All bone names, ordered depth-first so parents always precede children. */
export const VRM_BONE_NAMES: readonly VrmBoneName[] = VRM_BONE_DEFS.map((d) => d.name);

/** Returns the full ancestor chain from `boneName` to the root, root-first. */
export function vrmAncestors(boneName: VrmBoneName): VrmBoneName[] {
  const chain: VrmBoneName[] = [];
  let current: VrmBoneName | null = boneName;
  while (current !== null) {
    const def: VrmBoneDef = VRM_BONE_BY_NAME[current];
    if (def.parent !== null) {
      chain.unshift(def.parent);
    }
    current = def.parent;
  }
  return chain;
}

/** Returns all direct children of a bone. */
export function vrmChildren(boneName: VrmBoneName): VrmBoneName[] {
  return VRM_BONE_DEFS.filter((d) => d.parent === boneName).map((d) => d.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Landmark mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 8 anatomical landmarks needed to place the full skeleton.
 * These are the minimum user-provided or auto-detected points.
 */
export type LandmarkId =
  | 'headTop'       // Crown of skull
  | 'neckBase'      // C7 vertebra / pit of the neck
  | 'leftShoulder'  // Left glenohumeral joint
  | 'rightShoulder' // Right glenohumeral joint
  | 'leftHip'       // Left hip socket
  | 'rightHip'      // Right hip socket
  | 'leftAnkle'     // Left ankle joint
  | 'rightAnkle';   // Right ankle joint

export type LandmarkMap = Record<LandmarkId, THREE.Vector3>;

/**
 * The canonical landmark set and its placement order — the single source of
 * truth. `store.ts`, `LandmarkEditor` and `RiggerSidebar` all used to keep
 * their own copy, so the "next unplaced landmark" advance had three orders to
 * disagree about.
 */
export const LANDMARK_IDS: readonly LandmarkId[] = [
  'headTop',
  'neckBase',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftAnkle',
  'rightAnkle',
] as const;

/** The next landmark after `current` that has no position yet, else null. */
export function nextUnplacedLandmark(
  current: LandmarkId | null,
  landmarks: Partial<LandmarkMap>,
): LandmarkId | null {
  const start = current ? LANDMARK_IDS.indexOf(current) : -1;
  // Walk forward from the current marker, then wrap, so placement always
  // continues from where the user is rather than jumping back to the top.
  for (let step = 1; step <= LANDMARK_IDS.length; step++) {
    const id = LANDMARK_IDS[(start + step) % LANDMARK_IDS.length];
    if (!landmarks[id]) return id;
  }
  return null;
}

/**
 * Maps each VRM bone to the pair of landmarks that bracket its position.
 * The `t` value (0–1) interpolates from `from` toward `to` using the
 * anatomical ratio encoded in `VRM_BONE_DEFS.localPosition`.
 *
 * Used by `templateFitter.ts` to warp the skeleton to a specific mesh.
 */
export interface BoneLandmarkBinding {
  bone: VrmBoneName;
  from: LandmarkId;
  to: LandmarkId;
  /**
   * Parametric position along the from→to axis in world space (0=from, 1=to).
   * Derived from anatomical ratios — not arbitrary.
   */
  t: number;
}

export const BONE_LANDMARK_BINDINGS: readonly BoneLandmarkBinding[] = [
  { bone: 'hips',         from: 'leftHip',      to: 'rightHip',      t: 0.5  },
  { bone: 'spine',        from: 'leftHip',      to: 'neckBase',      t: 0.14 },
  { bone: 'chest',        from: 'leftHip',      to: 'neckBase',      t: 0.42 },
  { bone: 'upperChest',   from: 'leftHip',      to: 'neckBase',      t: 0.70 },
  { bone: 'neck',         from: 'neckBase',     to: 'headTop',       t: 0.08 },
  { bone: 'head',         from: 'neckBase',     to: 'headTop',       t: 0.28 },
  { bone: 'leftUpperLeg', from: 'leftHip',      to: 'leftAnkle',     t: 0.0  },
  { bone: 'leftLowerLeg', from: 'leftHip',      to: 'leftAnkle',     t: 0.49 },
  { bone: 'leftFoot',     from: 'leftHip',      to: 'leftAnkle',     t: 0.98 },
  { bone: 'rightUpperLeg',from: 'rightHip',     to: 'rightAnkle',    t: 0.0  },
  { bone: 'rightLowerLeg',from: 'rightHip',     to: 'rightAnkle',    t: 0.49 },
  { bone: 'rightFoot',    from: 'rightHip',     to: 'rightAnkle',    t: 0.98 },
  { bone: 'leftUpperArm', from: 'leftShoulder', to: 'leftShoulder',  t: 0.0  },
  { bone: 'rightUpperArm',from: 'rightShoulder',to: 'rightShoulder', t: 0.0  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 5. Skeleton builder — returns a live Three.js Bone hierarchy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for `buildTPoseSkeleton`.
 */
export interface SkeletonBuildOptions {
  /**
   * Uniform scale factor applied to all local positions.
   * Default `1.0` = the reference 1.70 m figure.
   * Set to `targetHeightMetres / 1.70` to match a different height.
   */
  scale?: number;
  /**
   * When true, only required VRM 1.0 bones are created (22 bones).
   * When false (default), all 54 bones including fingers and face are created.
   */
  requiredOnly?: boolean;
}

export interface BuiltSkeleton {
  /** The root bone (hips). Add this to your scene / armature Object3D. */
  root: THREE.Bone;
  /** All created bones, ordered to match `skeleton.bones`. */
  bones: THREE.Bone[];
  /** VRM bone name → Three.js Bone. */
  boneMap: Map<VrmBoneName, THREE.Bone>;
  /** Ready-to-use Three.js Skeleton with identity bind matrices. */
  skeleton: THREE.Skeleton;
}

/**
 * Builds a complete VRM T-pose skeleton as a Three.js Bone hierarchy.
 *
 * The returned `root` bone can be added directly to a Three.js scene or
 * wrapped in an `Object3D` armature. The `skeleton` has identity bind matrices
 * — call `skeleton.calculateInverses()` after positioning it in world space
 * to bake correct inverse bind matrices before attaching skinned meshes.
 *
 * @example
 * ```ts
 * const { root, skeleton, boneMap } = buildTPoseSkeleton({ scale: 1.0 });
 * scene.add(root);
 * root.updateWorldMatrix(true, true);
 * skeleton.calculateInverses();
 * ```
 */
export function buildTPoseSkeleton(options: SkeletonBuildOptions = {}): BuiltSkeleton {
  const scale = options.scale ?? 1.0;
  const defs = options.requiredOnly
    ? VRM_BONE_DEFS.filter((d) => d.required)
    : VRM_BONE_DEFS;

  const boneMap = new Map<VrmBoneName, THREE.Bone>();
  const bones: THREE.Bone[] = [];

  // Create all bones and wire parent→child relationships
  for (const def of defs) {
    const bone = new THREE.Bone();
    bone.name = def.name;

    const [lx, ly, lz] = def.localPosition;
    bone.position.set(lx * scale, ly * scale, lz * scale);

    boneMap.set(def.name, bone);
    bones.push(bone);

    if (def.parent !== null) {
      const parentBone = boneMap.get(def.parent);
      if (parentBone) {
        parentBone.add(bone);
      }
      // If parent was excluded (requiredOnly), the bone becomes a root-level
      // orphan — callers should handle or avoid this case.
    }
  }

  const root = boneMap.get('hips');
  if (!root) {
    throw new Error('[vrmSkeleton] buildTPoseSkeleton: hips bone not found — something went wrong.');
  }

  // Update matrices before creating the skeleton
  root.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(bones);
  // Inverse bind matrices are initially identity; caller must call
  // skeleton.calculateInverses() after the skeleton is in world space.

  return { root, bones, boneMap, skeleton };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Utility — world-space T-pose positions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a map of every bone's world-space position in the T-pose,
 * useful for distance-based weight assignment in `weightTransfer.ts`.
 *
 * Call this AFTER `root.updateMatrixWorld(true)`.
 */
export function getTPoseWorldPositions(boneMap: Map<VrmBoneName, THREE.Bone>): Map<VrmBoneName, THREE.Vector3> {
  const positions = new Map<VrmBoneName, THREE.Vector3>();
  for (const [name, bone] of boneMap) {
    positions.set(name, bone.getWorldPosition(new THREE.Vector3()));
  }
  return positions;
}

/**
 * Returns the world-space segment (start, end) for each bone, useful for
 * closest-point-on-segment weight queries in `weightTransfer.ts`.
 *
 * A bone's segment runs from its own world position to the centroid of its
 * children's world positions (or just its own tip offset for leaf bones).
 */
export interface BoneSegment {
  name: VrmBoneName;
  start: THREE.Vector3;
  end: THREE.Vector3;
}

export function getTPoseBoneSegments(
  boneMap: Map<VrmBoneName, THREE.Bone>,
): Map<VrmBoneName, BoneSegment> {
  const segments = new Map<VrmBoneName, BoneSegment>();
  const _tmp = new THREE.Vector3();

  for (const [name, bone] of boneMap) {
    const start = bone.getWorldPosition(new THREE.Vector3());

    // End = centroid of children's world positions
    const childBones = bone.children.filter((c): c is THREE.Bone => (c as THREE.Bone).isBone);

    let end: THREE.Vector3;
    if (childBones.length > 0) {
      end = new THREE.Vector3();
      for (const child of childBones) {
        child.getWorldPosition(_tmp);
        end.add(_tmp);
      }
      end.divideScalar(childBones.length);
    } else {
      // Leaf bone: extend 3 cm in parent-local +Y as a stub tip
      end = start.clone().add(new THREE.Vector3(0, 0.03, 0).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion())));
    }

    segments.set(name, { name, start, end });
  }

  return segments;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. VRM extension metadata helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the `VRM` extension node map expected by the VRM 1.0 spec
 * (vrm-specification §5 — humanoid).
 *
 * Pass this to your glTF exporter's `extensions` or inject it into the
 * GLB JSON chunk alongside the bone node indices.
 *
 * @param boneToNodeIndex  Map from VRM bone name → glTF node index.
 *                         Build this after GLTFExporter assigns node indices.
 */
export function buildVrmHumanoidExtension(
  boneToNodeIndex: Map<VrmBoneName, number>,
): Record<string, unknown> {
  const humanBones: Record<string, { node: number }> = {};
  for (const [name, index] of boneToNodeIndex) {
    humanBones[name] = { node: index };
  }
  return {
    specVersion: '1.0',
    humanoid: {
      humanBones,
    },
    meta: {
      name: 'CC-Kit Auto-Rigged Character',
      version: '1.0',
      authors: ['CC-Kit Auto-Rigger'],
      licenseUrl: 'https://vrm.dev/licenses/1.0/',
    },
  };
}
