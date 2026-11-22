import * as THREE from 'three';
import type { SkeletonRegistry } from '@/lib/character/skeleton';

export type SecondaryCategory = 'hair' | 'cloth' | 'accessory';

export interface DynamicParticle {
  /** The Three.js bone this particle controls or represents. */
  bone: THREE.Bone;
  name: string;
  category: SecondaryCategory;
  /** Parent bone in the hierarchy. */
  parent: THREE.Object3D;
  /** Rest local position of this bone or virtual tip relative to parent. */
  restLocalPos: THREE.Vector3;
  /** Rest local quaternion of this bone. */
  restLocalQuat: THREE.Quaternion;
  /** Rest length between parent and this particle in world space. */
  restLength: number;
  /** Rest unit direction from parent to this particle in parent local space. */
  restLocalDir: THREE.Vector3;
  /** Radius for collision avoidance with head, chest, and limbs (in metres). */
  radius: number;
  /** Whether this particle is an artificial virtual tip for a leaf bone. */
  isVirtualTip: boolean;
  /** The specific dynamic bone whose orientation is updated by this particle (null for kinematic parents). */
  targetBone: THREE.Bone | null;
  /** Rest local quaternion of the target bone. */
  targetRestQuat: THREE.Quaternion;
  /** Current simulated world position. */
  simPos: THREE.Vector3;
  /** Previous simulated world position (for Verlet integration). */
  prevPos: THREE.Vector3;
  /** Velocity vector in world space. */
  velocity: THREE.Vector3;
  /** Target world position derived from rigid parent transform. */
  targetWorldPos: THREE.Vector3;
  /** Whether the particle has been initialized to the current skeletal pose. */
  initialized: boolean;
}

export interface SecondaryChainSet {
  particles: DynamicParticle[];
  hairCount: number;
  clothCount: number;
  accessoryCount: number;
}

/** Standard XP32 kinematic skeleton bones that must NEVER be simulated as secondary physics. */
const EXCLUDED_XP32_EXACT = new Set([
  'NPC Root [Root]',
  'NPC COM [COM ]',
  'NPC Pelvis [Pelv]',
  'NPC Spine [Spn0]',
  'NPC Spine1 [Spn1]',
  'NPC Spine2 [Spn2]',
  'NPC Neck [Neck]',
  'NPC Head [Head]',
  'NPCEyeBone',
  'NPC L Clavicle [LClv]',
  'NPC L UpperArm [LUar]',
  'NPC L Forearm [LLar]',
  'NPC L Hand [LHnd]',
  'NPC R Clavicle [RClv]',
  'NPC R UpperArm [RUar]',
  'NPC R Forearm [RLar]',
  'NPC R Hand [RHnd]',
  'NPC L Thigh [LThg]',
  'NPC L Calf [LClf]',
  'NPC L Foot [LFt ]',
  'NPC L Toe0 [LToe]',
  'NPC R Thigh [RThg]',
  'NPC R Calf [RClf]',
  'NPC R Foot [RFt ]',
  'NPC R Toe0 [RToe]',
  // Soft body bones simulated independently by BodyPhysics (CBPC)
  'L Breast01',
  'R Breast01',
  'L Breast02',
  'R Breast02',
  'NPC L Breast',
  'NPC R Breast',
  'NPC L Butt',
  'NPC R Butt',
  'NPC Belly',
  'Belly',
  'HDT Belly',
  'NPC Belly01',
  'Butt',
  'Breast',
  'NPC L Pectoral',
  'NPC R Pectoral',
  'Camera',
  'Camera1st',
  'Camera3rd',
  'Scene Root',
]);

const EXCLUDED_PATTERNS = /(?:Finger|Twist|Weapon|Shield|Quiver|Arrow|Torch|Armor|ColHead|Collision|Proxy|Bound|Dummy|Belly|Breast|Butt|Groin|Pelv|Spine|Head|Neck|Root|COM|Clavicle|Hand|Foot|Toe|Thigh|Calf|Arm)/i;

const HAIR_PATTERNS = /(?:hair|hl\d|hr\d|hb\d|hf\d|bangs|ponytail|tail\d|braid|fringe|dint_hair|hdt_hair|side_l|side_r|ahoge|pigtail)/i;
const CLOTH_PATTERNS = /(?:skirt|dress|cape|cloak|robe|sleeve|apron|sash|coat|tail_cloth|loincloth|tunic|mantle|shawl)/i;
const ACCESSORY_PATTERNS = /(?:ribbon|tassel|earring|pendant|chain|brooch|(?:^|[_\s])bell(?:[_\s\d]|$)|amulet|strap)/i;

/** Classifies a bone into a secondary physics category, or null if non-dynamic. */
export function classifySecondaryBone(name: string): SecondaryCategory | null {
  if (EXCLUDED_XP32_EXACT.has(name) || EXCLUDED_PATTERNS.test(name)) {
    return null;
  }
  if (/(?:belly|breast|butt|groin|pelv|spine|head|neck|hand|foot|calf|thigh|arm)/i.test(name)) {
    return null;
  }
  if (HAIR_PATTERNS.test(name)) return 'hair';
  if (CLOTH_PATTERNS.test(name)) return 'cloth';
  if (ACCESSORY_PATTERNS.test(name)) return 'accessory';
  return null;
}

/**
 * Scans the SkeletonRegistry and constructs dynamic physics particles for all
 * registered hair, clothing, and accessory bone hierarchies.
 */
export function buildSecondaryChains(registry: SkeletonRegistry): SecondaryChainSet {
  const particles: DynamicParticle[] = [];
  let hairCount = 0;
  let clothCount = 0;
  let accessoryCount = 0;

  const dynamicBones = new Map<string, { bone: THREE.Bone; category: SecondaryCategory }>();

  // 1. Collect all candidates
  for (const name of registry.names) {
    const category = classifySecondaryBone(name);
    if (!category) continue;
    const bone = registry.byName.get(name);
    if (!bone || !bone.parent) continue;
    dynamicBones.set(name, { bone, category });
  }

  // 2. Build particle graph
  const scratchPosA = new THREE.Vector3();
  const scratchPosB = new THREE.Vector3();

  for (const [name, { bone, category }] of dynamicBones) {
    const parent = bone.parent;
    if (!parent) continue;

    const rest = registry.restPose(name);
    const restLocalPos = rest ? rest.position.clone() : bone.position.clone();
    const restLocalQuat = rest ? rest.quaternion.clone() : bone.quaternion.clone();

    // Check if any children of this bone are also dynamic
    const dynamicChildren: THREE.Bone[] = [];
    bone.traverse((child) => {
      if (child !== bone && child instanceof THREE.Bone && dynamicBones.has(child.name)) {
        if (child.parent === bone) {
          dynamicChildren.push(child);
        }
      }
    });

    // World rest positions
    const worldRest = registry.restWorld(name);
    const parentWorldRest = registry.restWorld(parent.name);

    let restLength = 0.05; // Fallback 5cm
    const restLocalDir = new THREE.Vector3(0, -1, 0);

    if (worldRest && parentWorldRest) {
      scratchPosA.setFromMatrixPosition(worldRest);
      scratchPosB.setFromMatrixPosition(parentWorldRest);
      const dist = scratchPosA.distanceTo(scratchPosB);
      if (dist > 0.005) {
        restLength = dist;
      }
      // Compute rest direction in parent's local space
      const invParent = parentWorldRest.clone().invert();
      scratchPosA.applyMatrix4(invParent);
      if (scratchPosA.lengthSq() > 1e-6) {
        restLocalDir.copy(scratchPosA).normalize();
      }
    } else if (restLocalPos.lengthSq() > 1e-6) {
      restLength = restLocalPos.length();
      restLocalDir.copy(restLocalPos).normalize();
    }

    const radius =
      category === 'hair' ? 0.025 : category === 'cloth' ? 0.045 : 0.02;

    const isParentDynamic = parent instanceof THREE.Bone && dynamicBones.has(parent.name);
    const targetBone = isParentDynamic ? (parent as THREE.Bone) : null;
    const targetRest = targetBone ? registry.restPose(targetBone.name) : null;
    const targetRestQuat = targetRest
      ? targetRest.quaternion.clone()
      : targetBone
      ? targetBone.quaternion.clone()
      : new THREE.Quaternion();

    // Add particle for this bone
    particles.push({
      bone,
      name,
      category,
      parent,
      restLocalPos,
      restLocalQuat,
      restLength,
      restLocalDir,
      radius,
      isVirtualTip: false,
      targetBone,
      targetRestQuat,
      simPos: new THREE.Vector3(),
      prevPos: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      targetWorldPos: new THREE.Vector3(),
      initialized: false,
    });

    if (category === 'hair') hairCount++;
    else if (category === 'cloth') clothCount++;
    else accessoryCount++;

    // If leaf node (no dynamic children), attach a virtual tip particle so the leaf can rotate!
    if (dynamicChildren.length === 0) {
      const tipOffset = restLocalDir.clone().multiplyScalar(Math.max(restLength, 0.04));
      particles.push({
        bone,
        name: `${name}_VirtualTip`,
        category,
        parent: bone,
        restLocalPos: tipOffset,
        restLocalQuat: new THREE.Quaternion(),
        restLength: Math.max(restLength, 0.04),
        restLocalDir: restLocalDir.clone(),
        radius: radius * 0.8,
        isVirtualTip: true,
        targetBone: bone,
        targetRestQuat: restLocalQuat.clone(),
        simPos: new THREE.Vector3(),
        prevPos: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        targetWorldPos: new THREE.Vector3(),
        initialized: false,
      });
    }
  }

  return { particles, hairCount, clothCount, accessoryCount };
}
