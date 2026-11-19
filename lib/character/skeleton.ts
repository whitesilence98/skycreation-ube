import * as THREE from 'three';
import type { MeshBone } from '@/components/scene/useMeshGeometry';
import { BODY_SCALE_BASELINE_HEIGHT, type BodyScale } from '@/lib/anatomy/bodyScale';

/**
 * One bone set shared by every skinned part of the character.
 *
 * Each pack NIF embeds its own copy of the skeleton it was skinned to. The
 * copies overlap but disagree about hierarchy: the outfit ships the full body
 * chain, a hairstyle ships the NPC bones flat under `Scene Root` with world
 * transforms baked in, and a style with no body attachment ships only the head
 * chain. They agree on **world rest pose** (~1e-5 across this pack), so world
 * rest is what crosses the wire and what this registry builds from.
 *
 * Posing cannot use any single mesh's bone array either: every part has to
 * resolve its weights against the *same* `THREE.Bone` objects, or moving one
 * part leaves the others behind. Bones are registered by name — the first mesh
 * to name a bone creates it, later meshes reuse it and only contribute the
 * names nobody has claimed. Each `SkinnedMesh` still gets its own
 * `THREE.Skeleton` (own ordering, own bind inverses) over those shared bones.
 *
 * Registration is idempotent: the tree is rebuilt from the accumulated world
 * rests every time, so a bone whose parent is only supplied by a later mesh
 * still ends up parented correctly, and a re-registration cannot corrupt a
 * hierarchy another mesh already depends on.
 */
export interface RegisteredSkeleton {
  skeleton: THREE.Skeleton;
  /** This mesh's bone index → the shared bone. */
  bones: THREE.Bone[];
}

/** A bone's rest TRS, the base every pose is applied as a delta over. */
export interface RestPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface BoneRest {
  /** World rest matrix in render space. */
  world: THREE.Matrix4;
  parentName: string | null;
  pose: RestPose;
}

/** NIF (z-up, centimetres) → the render frame the mesh vertices use. */
export function meshFrameMatrix(frame = 'head'): THREE.Matrix4 {
  // Mirrors `FRAMES` in scripts/convert_worker.py: a position becomes
  // (x·S, (z − CZ)·S, (y − CY)·S).
  const conf =
    frame === 'ground'
      ? { scale: 0.01288, center_y: 0.0, center_z: 0.0 }
      : { scale: 0.01288, center_y: 1.0, center_z: 120.73 };
  const { scale: S, center_y: CY, center_z: CZ } = conf;
  return new THREE.Matrix4().set(
    S, 0, 0, 0,
    0, 0, S, -CZ * S,
    0, S, 0, -CY * S,
    0, 0, 0, 1,
  );
}

/**
 * A row-major 3×4 world rest matrix, converted into render space.
 *
 * The frame is applied to the **world** matrix, once per bone, and that is
 * correct: `F·W` is a change of coordinates, so locals derived from it
 * (`(F·Wp)⁻¹·(F·Wc)`) collapse back to `Wp⁻¹·Wc`. Folding the frame's
 * translation into each bone's *local* transform instead would add it once per
 * hierarchy level and stretch the skeleton.
 */
export function boneWorldMatrix(bone: MeshBone, frame = 'head'): THREE.Matrix4 {
  const w = bone.world;
  const nif = new THREE.Matrix4().set(
    w[0], w[1], w[2], w[3],
    w[4], w[5], w[6], w[7],
    w[8], w[9], w[10], w[11],
    0, 0, 0, 1,
  );
  return meshFrameMatrix(frame).multiply(nif);
}

/** Key into `Object3D.userData`. A string, not a `Symbol`: three types
 *  `userData` as `Record<string, any>`, so a unique-symbol key does not index. */
const REST = '__boneRest';

/**
 * Canonical XP32 bone hierarchy.
 *
 * Limb attachments (hands, fingers, feet, toes) in Bethesda NIFs were often
 * authored with flat bone hierarchies (`parent: Scene Root`). When registered,
 * this map enforces the authentic skeletal parenting so wrists follow forearms,
 * fingers follow hands, and feet/toes follow calves during posing.
 */
export const XP32_CANONICAL_PARENTS: Readonly<Record<string, string>> = {
  // Spine & Pelvis chain
  'NPC COM [COM ]': 'NPC Root [Root]',
  'NPC Pelvis [Pelv]': 'NPC COM [COM ]',
  'NPC Spine [Spn0]': 'NPC COM [COM ]',
  'NPC Spine1 [Spn1]': 'NPC Spine [Spn0]',
  'NPC Spine2 [Spn2]': 'NPC Spine1 [Spn1]',
  'NPC Neck [Neck]': 'NPC Spine2 [Spn2]',
  'NPC Head [Head]': 'NPC Neck [Neck]',
  'NPCEyeBone': 'NPC Head [Head]',

  // Arms & Hands
  'NPC L Clavicle [LClv]': 'NPC Spine2 [Spn2]',
  'NPC L UpperArm [LUar]': 'NPC L Clavicle [LClv]',
  'NPC L Forearm [LLar]': 'NPC L UpperArm [LUar]',
  'NPC L Hand [LHnd]': 'NPC L Forearm [LLar]',
  'NPC L ForearmTwist1 [LLt1]': 'NPC L Forearm [LLar]',
  'NPC L ForearmTwist2 [LLt2]': 'NPC L Forearm [LLar]',
  'NPC L UpperarmTwist1 [LUt1]': 'NPC L UpperArm [LUar]',
  'NPC L UpperarmTwist2 [LUt2]': 'NPC L UpperarmTwist1 [LUt1]',

  'NPC R Clavicle [RClv]': 'NPC Spine2 [Spn2]',
  'NPC R UpperArm [RUar]': 'NPC R Clavicle [RClv]',
  'NPC R Forearm [RLar]': 'NPC R UpperArm [RUar]',
  'NPC R Hand [RHnd]': 'NPC R Forearm [RLar]',
  'NPC R ForearmTwist1 [RLt1]': 'NPC R Forearm [RLar]',
  'NPC R ForearmTwist2 [RLt2]': 'NPC R Forearm [RLar]',
  'NPC R UpperarmTwist1 [RUt1]': 'NPC R UpperArm [RUar]',
  'NPC R UpperarmTwist2 [RUt2]': 'NPC R UpperarmTwist1 [RUt1]',

  // Left Fingers
  'NPC L Finger00 [LF00]': 'NPC L Hand [LHnd]',
  'NPC L Finger01 [LF01]': 'NPC L Finger00 [LF00]',
  'NPC L Finger02 [LF02]': 'NPC L Finger01 [LF01]',
  'NPC L Finger10 [LF10]': 'NPC L Hand [LHnd]',
  'NPC L Finger11 [LF11]': 'NPC L Finger10 [LF10]',
  'NPC L Finger12 [LF12]': 'NPC L Finger11 [LF11]',
  'NPC L Finger20 [LF20]': 'NPC L Hand [LHnd]',
  'NPC L Finger21 [LF21]': 'NPC L Finger20 [LF20]',
  'NPC L Finger22 [LF22]': 'NPC L Finger21 [LF21]',
  'NPC L Finger30 [LF30]': 'NPC L Hand [LHnd]',
  'NPC L Finger31 [LF31]': 'NPC L Finger30 [LF30]',
  'NPC L Finger32 [LF32]': 'NPC L Finger31 [LF31]',
  'NPC L Finger40 [LF40]': 'NPC L Hand [LHnd]',
  'NPC L Finger41 [LF41]': 'NPC L Finger40 [LF40]',
  'NPC L Finger42 [LF42]': 'NPC L Finger41 [LF41]',

  // Right Fingers
  'NPC R Finger00 [RF00]': 'NPC R Hand [RHnd]',
  'NPC R Finger01 [RF01]': 'NPC R Finger00 [RF00]',
  'NPC R Finger02 [RF02]': 'NPC R Finger01 [RF01]',
  'NPC R Finger10 [RF10]': 'NPC R Hand [RHnd]',
  'NPC R Finger11 [RF11]': 'NPC R Finger10 [RF10]',
  'NPC R Finger12 [RF12]': 'NPC R Finger11 [RF11]',
  'NPC R Finger20 [RF20]': 'NPC R Hand [RHnd]',
  'NPC R Finger21 [RF21]': 'NPC R Finger20 [RF20]',
  'NPC R Finger22 [RF22]': 'NPC R Finger21 [RF21]',
  'NPC R Finger30 [RF30]': 'NPC R Hand [RHnd]',
  'NPC R Finger31 [RF31]': 'NPC R Finger30 [RF30]',
  'NPC R Finger32 [RF32]': 'NPC R Finger31 [RF31]',
  'NPC R Finger40 [RF40]': 'NPC R Hand [RHnd]',
  'NPC R Finger41 [RF41]': 'NPC R Finger40 [RF40]',
  'NPC R Finger42 [RF42]': 'NPC R Finger41 [RF41]',

  // Legs & Feet
  'NPC L Thigh [LThg]': 'NPC Pelvis [Pelv]',
  'NPC L Calf [LClf]': 'NPC L Thigh [LThg]',
  'NPC L Foot [Lft ]': 'NPC L Calf [LClf]',
  'NPC L Toe0 [LToe]': 'NPC L Foot [Lft ]',

  'NPC R Thigh [RThg]': 'NPC Pelvis [Pelv]',
  'NPC R Calf [RClf]': 'NPC R Thigh [RThg]',
  'NPC R Foot [Rft ]': 'NPC R Calf [RClf]',
  'NPC R Toe0 [RToe]': 'NPC R Foot [Rft ]',

  // Soft Body & Physics (CBPC / SMP / UBE)
  'Butt': 'NPC Pelvis [Pelv]',
  'NPC L Butt': 'Butt',
  'NPC R Butt': 'Butt',
  'Belly': 'NPC Spine1 [Spn1]',
  'NPC Belly': 'Belly',
  'HDT Belly': 'NPC Spine1 [Spn1]',
  'Breast': 'NPC Spine2 [Spn2]',
  'CME Spine2 [Spn2]': 'NPC Spine2 [Spn2]',
};

export class SkeletonRegistry {
  readonly byName = new Map<string, THREE.Bone>();
  /** Scene node holding the bone roots. Identity transform; bones are already
   *  in render space, so nothing below should re-scale them. */
  readonly group = new THREE.Group();
  private readonly frame: string;

  constructor(frame = 'head') {
    this.frame = frame;
    this.group.name = 'SkeletonRoot';
  }

  private restOf(bone: THREE.Bone): BoneRest {
    return bone.userData[REST] as BoneRest;
  }

  /** The world rest matrix of a registered bone, in render space. */
  restWorld(name: string): THREE.Matrix4 | null {
    const bone = this.byName.get(name);
    return bone ? this.restOf(bone).world.clone() : null;
  }

  /**
   * The bone's local rest TRS — the base a pose is applied as a delta over.
   *
   * Returned by reference, not cloned: poses read it every time they apply and
   * must never write to it, and the caller is inside this module's contract.
   */
  restPose(name: string): RestPose | null {
    const bone = this.byName.get(name);
    return bone ? this.restOf(bone).pose : null;
  }

  /** Bone names this registry knows, for diagnostics and pose panels. */
  get names(): string[] {
    return [...this.byName.keys()];
  }

  register(meshBones: MeshBone[]): RegisteredSkeleton {
    let changed = false;
    for (const def of meshBones) {
      const canonical = XP32_CANONICAL_PARENTS[def.name];
      const resolvedParent =
        def.parent && def.parent !== 'Scene Root'
          ? def.parent
          : (canonical ?? def.parent);

      if (this.byName.has(def.name)) {
        const bone = this.byName.get(def.name)!;
        const rest = this.restOf(bone);
        if (
          rest &&
          (!rest.parentName || rest.parentName === 'Scene Root') &&
          resolvedParent &&
          resolvedParent !== 'Scene Root'
        ) {
          rest.parentName = resolvedParent;
          changed = true;
        }
        continue;
      }

      const bone = new THREE.Bone();
      bone.name = def.name;
      bone.userData[REST] = {
        world: boneWorldMatrix(def, this.frame),
        parentName: resolvedParent,
        pose: {
          position: new THREE.Vector3(),
          quaternion: new THREE.Quaternion(),
          scale: new THREE.Vector3(1, 1, 1),
        },
      } satisfies BoneRest;
      this.byName.set(def.name, bone);
      changed = true;
    }
    /* A later mesh can supply the parent of a bone an earlier one registered
       flat, so rebuild whenever anything new arrived. */
    if (changed) this.rebuild();

    const bones = meshBones.map((def) => this.byName.get(def.name)!);
    const inverses = bones.map((b) => this.restOf(b).world.clone().invert());
    return { skeleton: new THREE.Skeleton(bones, inverses), bones };
  }

  /**
   * Rebuild the hierarchy and every bone's *local* rest transform from the
   * accumulated world rests.
   *
   * Local = parentWorld⁻¹ · world, a pure function of the rest data, so this
   * is safe to run any number of times and never accumulates a pose.
   */
  rebuild(): void {
    const parentInverse = new THREE.Matrix4();
    for (const bone of this.byName.values()) {
      const rest = this.restOf(bone);
      let parentName = rest.parentName;
      if (!parentName || parentName === 'Scene Root' || !this.byName.has(parentName)) {
        const canonical = XP32_CANONICAL_PARENTS[bone.name];
        if (canonical && this.byName.has(canonical)) {
          parentName = canonical;
          rest.parentName = canonical;
        }
      }
      const parent = parentName ? this.byName.get(parentName) : undefined;
      const parentObject: THREE.Object3D = parent ?? this.group;
      if (bone.parent !== parentObject) {
        /* `add` re-parents; it does not mutate the removed bone's own TRS. */
        parentObject.add(bone);
      }

      if (parent) {
        parentInverse.copy(this.restOf(parent).world).invert().multiply(rest.world);
      } else {
        parentInverse.copy(rest.world);
      }
      parentInverse.decompose(rest.pose.position, rest.pose.quaternion, rest.pose.scale);
      /* The bone starts at rest; a pose is applied on top of `rest.pose` and
         never written back into it. */
      bone.position.copy(rest.pose.position);
      bone.quaternion.copy(rest.pose.quaternion);
      bone.scale.copy(rest.pose.scale);
    }
    this.updateWorld();
  }

  /** Recompute world matrices for every bone root chain. */
  updateWorld(): void {
    this.group.updateMatrixWorld(true);
  }

  /**
   * Restores every bone to its rest pose.
   *
   * This wipes any body-scale pass too (`bone.scale` returns to rest). Every
   * caller that resets a pose — `applyBodyPose` / `applyPoseTrack` are the
   * current ones — must re-apply the body scale afterwards, or a pose switch
   * silently reverts the figure to its authored height until the next slider
   * drag. Pass the factors into `applySkeletonWeight` on that re-apply.
   */
  reset(): void {
    for (const bone of this.byName.values()) {
      const rest = this.restOf(bone);
      bone.position.copy(rest.pose.position);
      bone.quaternion.copy(rest.pose.quaternion);
      bone.scale.copy(rest.pose.scale);
    }
    this.updateWorld();
  }
}

export interface BoneScaleFactors {
  x: number;
  y: number;
  z: number;
}

/**
 * Anatomical scale coefficients for Creation Engine character weight morphing.
 *
 * In Skyrim's Creation Engine, weight morphing scales the character's skeleton
 * bones (Pelvis, Spine, Belly, Butt, Thighs, Breasts) proportionally to the
 * actor's weight. Because clothing meshes are skinned to these same skeleton bones,
 * this scaling naturally expands both clothing and body together even when modded
 * clothing NIFs carry subtle or zero vertex displacement in their `_0`/`_1` pairs.
 *
 * Calibrated in incremental steps to avoid compounded scale accumulation along
 * the spine and limb hierarchies.
 */
export const SKELETON_WEIGHT_SCALES: Readonly<Record<string, BoneScaleFactors>> = {
  // Spine & Torso (accumulates down Spine0 -> Spine1 -> Spine2 to ~10% total)
  'NPC Spine [Spn0]': { x: 0.035, y: 0.035, z: 0.035 },
  'NPC Spine1 [Spn1]': { x: 0.035, y: 0.035, z: 0.035 },
  'NPC Spine2 [Spn2]': { x: 0.025, y: 0.025, z: 0.025 },
  'NPC Belly': { x: 0.04, y: 0.05, z: 0.05 },
  'Belly': { x: 0.04, y: 0.05, z: 0.05 },

  // Pelvis & Butt (Pelvis ~9%, Butt ~14% total)
  'NPC Pelvis [Pelv]': { x: 0.09, y: 0.08, z: 0.08 },
  'NPC L Butt': { x: 0.045, y: 0.045, z: 0.045 },
  'NPC R Butt': { x: 0.045, y: 0.045, z: 0.045 },
  'Butt': { x: 0.045, y: 0.045, z: 0.045 },

  // Breasts (XP32 / 3BA chains, reaching ~14% total on top of Spine2)
  'L Breast01': { x: 0.038, y: 0.038, z: 0.038 },
  'R Breast01': { x: 0.038, y: 0.038, z: 0.038 },
  'L Breast02': { x: 0.025, y: 0.025, z: 0.025 },
  'R Breast02': { x: 0.025, y: 0.025, z: 0.025 },
  'NPC L Breast': { x: 0.038, y: 0.038, z: 0.038 },
  'NPC R Breast': { x: 0.038, y: 0.038, z: 0.038 },

  // Legs & Thighs (reaching ~8% on Thigh, ~4% on Calf)
  'NPC L Thigh [LThg]': { x: -0.01, y: -0.01, z: -0.01 },
  'NPC R Thigh [RThg]': { x: -0.01, y: -0.01, z: -0.01 },
  'NPC L Calf [LClf]': { x: -0.035, y: -0.035, z: -0.035 },
  'NPC R Calf [RClf]': { x: -0.035, y: -0.035, z: -0.035 },

  // Arms (reaching ~6% on UpperArm)
  'NPC L UpperArm [LUar]': { x: 0.06, y: 0.06, z: 0.06 },
  'NPC R UpperArm [RUar]': { x: 0.06, y: 0.06, z: 0.06 },
};

/** Bones whose world scale must remain unscaled (identity 1.0) to preserve
 *  anatomical anchors, neck seam alignment, and footwear/gloves fit. */
const ANCHOR_BONES = [
  'NPC Neck [Neck]',
  'NPC L Foot [Lft ]',
  'NPC R Foot [Rft ]',
  'NPC L Hand [LHnd]',
  'NPC R Hand [RHnd]',
] as const;

/** What the scene needs back from a scale pass, in registry-local space. */
export interface SkeletonScaleResult {
  /**
   * Vertical displacement the body-scale pass introduced at the foot bone,
   * measured posed-before vs posed-after in registry-local coordinates
   * (positive = the foot sank, so the scene should set the character wrapper's
   * `position.y` to this value to lift it back onto the floor). A uniform root
   * scale moves the soles whenever the root is not exactly at the floor, so
   * the scene re-plants them by exactly this measurement.
   */
  footDrop: number;
  /**
   * Height to frame the character with: the authored baseline
   * (`BODY_SCALE_BASELINE_HEIGHT`) ratio-calibrated by how much this pass
   * grew the pose's head-to-foot span. Neutral body scale returns exactly the
   * baseline for any pose, so the camera never reframes on a pose change.
   */
  height: number;
}

const HEAD_BONE = 'NPC Head [Head]';
const FOOT_BONES = ['NPC L Foot [Lft ]', 'NPC R Foot [Rft ]'] as const;

/**
 * Apply Creation Engine body weight bone scaling, then the RaceMenu-style
 * body/head scale, over the skeleton registry.
 *
 * Order is deliberate: the anchor counter-scale runs on the **weight** pass
 * only. Applying body scale before it would let the neck anchor pin the head
 * to its rest world scale, so a taller figure would not grow its head. With
 * body scale last the head, hands and feet inherit the height uniformly.
 *
 * Feet therefore move with the root scale; `footDrop` reports that movement so
 * the scene can lift the character back onto the floor.
 *
 * Only `bone.scale` is written; pose rotations and positions are untouched.
 */
export function applySkeletonWeight(
  registry: SkeletonRegistry,
  weight: number,
  bodyScale?: BodyScale,
): SkeletonScaleResult {
  const w = Math.max(0, Math.min(1, weight));
  const rootScale = bodyScale?.rootScale ?? 1;
  const boneFactors = bodyScale?.bones ?? {};

  // 1. Reset scale to authored rest TRS first so scale is absolute, never accumulating across frames
  for (const bone of registry.byName.values()) {
    const rest = (bone.userData[REST] as BoneRest | undefined)?.pose;
    if (rest) bone.scale.copy(rest.scale);
    else bone.scale.set(1, 1, 1);
  }

  // 2. Apply body weight scaling multipliers
  for (const [boneName, factors] of Object.entries(SKELETON_WEIGHT_SCALES)) {
    const bone = registry.byName.get(boneName);
    if (!bone) continue;
    bone.scale.set(
      bone.scale.x * (1.0 + factors.x * w),
      bone.scale.y * (1.0 + factors.y * w),
      bone.scale.z * (1.0 + factors.z * w),
    );
  }

  // 3. Propagate transforms down the hierarchy
  registry.updateWorld();

  // 4. Counter-scale anchor bones (Neck, Feet, Hands) so their world scale stays identical to rest
  const restWorldScale = new THREE.Vector3();
  const parentWorldScale = new THREE.Vector3();
  for (const anchorName of ANCHOR_BONES) {
    const bone = registry.byName.get(anchorName);
    const rest = bone ? (bone.userData[REST] as BoneRest | undefined) : undefined;
    if (!bone || !bone.parent || !rest) continue;
    rest.world.decompose(new THREE.Vector3(), new THREE.Quaternion(), restWorldScale);
    bone.parent.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), parentWorldScale);
    if (Math.abs(parentWorldScale.x) > 1e-5 && Math.abs(parentWorldScale.y) > 1e-5 && Math.abs(parentWorldScale.z) > 1e-5) {
      bone.scale.set(
        Math.abs(restWorldScale.x / parentWorldScale.x),
        Math.abs(restWorldScale.y / parentWorldScale.y),
        Math.abs(restWorldScale.z / parentWorldScale.z),
      );
    }
  }

  // 5. Normalized anchors, then measure the posed baseline body scale grows from
  registry.updateWorld();
  const groupInverse = new THREE.Matrix4().copy(registry.group.matrixWorld).invert();
  const localPosition = (name: string, out: THREE.Vector3): boolean => {
    const bone = registry.byName.get(name);
    if (!bone) return false;
    out.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(groupInverse);
    return true;
  };
  /* One foot bone, chosen consistently before and after so the delta is never
     taken across different feet. */
  const footBone = FOOT_BONES.find((name) => registry.byName.has(name));
  const beforeHead = new THREE.Vector3();
  const beforeFoot = new THREE.Vector3();
  const hasHead = localPosition(HEAD_BONE, beforeHead);
  const hasFoot = footBone ? localPosition(footBone, beforeFoot) : false;
  /* Distance is frame-independent: the registry group only carries the scene
     wrapper's lift, never rotation or scale. */
  const beforeSpan = hasHead && hasFoot ? beforeHead.distanceTo(beforeFoot) : 0;
  const beforeFootY = beforeFoot.y;

  // 6. RaceMenu-style scale: uniform root scale for height, then per-bone build factors
  if (rootScale !== 1) {
    for (const bone of registry.byName.values()) {
      /* Every bone whose parent is the registry group is a root; scaling a
         root multiplies every descendant offset exactly once. */
      if (bone.parent === registry.group) bone.scale.multiplyScalar(rootScale);
    }
  }
  for (const [boneName, factors] of Object.entries(boneFactors)) {
    const bone = registry.byName.get(boneName);
    if (!bone) continue;
    bone.scale.set(
      bone.scale.x * factors.x,
      bone.scale.y * factors.y,
      bone.scale.z * factors.z,
    );
  }

  // 7. Final world update, then measure what the scale pass changed
  registry.updateWorld();
  let footDrop = 0;
  let height = BODY_SCALE_BASELINE_HEIGHT;
  if (hasHead && hasFoot && footBone) {
    const afterHead = new THREE.Vector3();
    const afterFoot = new THREE.Vector3();
    localPosition(HEAD_BONE, afterHead);
    localPosition(footBone, afterFoot);
    /* Posed-before vs posed-after, both in registry-local space: comparing the
       live foot against its *rest* world position would read the pose (a bent
       knee) as grounding drift. */
    footDrop = beforeFootY - afterFoot.y;
    if (beforeSpan > 1e-6) {
      height = BODY_SCALE_BASELINE_HEIGHT * (afterHead.distanceTo(afterFoot) / beforeSpan);
    }
  }
  return { footDrop, height };
}
