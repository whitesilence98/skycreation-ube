import * as THREE from 'three';
import type { MeshBone } from '@/components/scene/useMeshGeometry';

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
      if (this.byName.has(def.name)) continue;
      const bone = new THREE.Bone();
      bone.name = def.name;
      bone.userData[REST] = {
        world: boneWorldMatrix(def, this.frame),
        parentName: def.parent,
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
      const parent = rest.parentName ? this.byName.get(rest.parentName) : undefined;
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

  /** Restores every bone to its rest pose. */
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
