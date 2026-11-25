/**
 * lib/rigger/engineProfiles.ts
 *
 * Export-target skeleton profiles for the CC-Kit Auto-Rigger Studio.
 *
 * The rigger runs once internally against the open VRM 1.0 skeleton (`vrmSkeleton.ts`),
 * then translates bone names, optional grounded root hierarchy, and FBX unit scale
 * on export so a single rig serves VRM/Blender, Unity Humanoid, and Unreal Engine 5.
 */

import type { RigBoneName } from '@/lib/rigger/vrmSkeleton';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ExportTarget = 'vrm' | 'unity' | 'ue5';

export interface EngineProfile {
  id: ExportTarget;
  /** Full display label for export panel. */
  label: string;
  /** Compact pill label for sidebar & switcher. */
  shortLabel: string;
  /** Short badge shown in Auto-Rigger Studio header. */
  badgeText: string;
  /** Top skeleton bone name in the exported FBX. */
  rootBoneLabel: string;
  /** Human-readable unit / scale summary. */
  unitLabel: string;
  /** Guidance note shown under the selector in Export. */
  importHint: string;
  /** Filename segment after Character name: e.g. Character_unity_skeleton.fbx. */
  fbxSuffixTag: 'rigged' | 'unity' | 'ue5';
  /** Map from internal VRM `RigBoneName` to target engine bone name. */
  boneNames: Readonly<Record<RigBoneName, string>>;
  /** Inject a grounded `root` bone at world `(0,0,0)` parenting `hips`/`pelvis` (UE5). */
  addRootBone: boolean;
  /** Geometric coordinate scale multiplier (1.0 = meters, 100.0 = centimeters). */
  scaleFactor: number;
  /** FBX GlobalSettings UnitScaleFactor (`100` when authored in m, `1` when authored in cm). */
  unitScaleFactor: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bone mapping tables (complete coverage of all 59 RigBoneName entries)
// ─────────────────────────────────────────────────────────────────────────────

const VRM_BONE_MAP: Record<RigBoneName, string> = {
  hips: 'hips',
  spine: 'spine',
  chest: 'chest',
  upperChest: 'upperChest',
  neck: 'neck',
  head: 'head',
  leftEye: 'leftEye',
  rightEye: 'rightEye',
  jaw: 'jaw',
  leftShoulder: 'leftShoulder',
  leftUpperArm: 'leftUpperArm',
  leftLowerArm: 'leftLowerArm',
  leftHand: 'leftHand',
  leftThumbMetacarpal: 'leftThumbMetacarpal',
  leftThumbProximal: 'leftThumbProximal',
  leftThumbDistal: 'leftThumbDistal',
  leftIndexProximal: 'leftIndexProximal',
  leftIndexIntermediate: 'leftIndexIntermediate',
  leftIndexDistal: 'leftIndexDistal',
  leftMiddleProximal: 'leftMiddleProximal',
  leftMiddleIntermediate: 'leftMiddleIntermediate',
  leftMiddleDistal: 'leftMiddleDistal',
  leftRingProximal: 'leftRingProximal',
  leftRingIntermediate: 'leftRingIntermediate',
  leftRingDistal: 'leftRingDistal',
  leftLittleProximal: 'leftLittleProximal',
  leftLittleIntermediate: 'leftLittleIntermediate',
  leftLittleDistal: 'leftLittleDistal',
  rightShoulder: 'rightShoulder',
  rightUpperArm: 'rightUpperArm',
  rightLowerArm: 'rightLowerArm',
  rightHand: 'rightHand',
  rightThumbMetacarpal: 'rightThumbMetacarpal',
  rightThumbProximal: 'rightThumbProximal',
  rightThumbDistal: 'rightThumbDistal',
  rightIndexProximal: 'rightIndexProximal',
  rightIndexIntermediate: 'rightIndexIntermediate',
  rightIndexDistal: 'rightIndexDistal',
  rightMiddleProximal: 'rightMiddleProximal',
  rightMiddleIntermediate: 'rightMiddleIntermediate',
  rightMiddleDistal: 'rightMiddleDistal',
  rightRingProximal: 'rightRingProximal',
  rightRingIntermediate: 'rightRingIntermediate',
  rightRingDistal: 'rightRingDistal',
  rightLittleProximal: 'rightLittleProximal',
  rightLittleIntermediate: 'rightLittleIntermediate',
  rightLittleDistal: 'rightLittleDistal',
  leftUpperLeg: 'leftUpperLeg',
  leftLowerLeg: 'leftLowerLeg',
  leftFoot: 'leftFoot',
  leftToes: 'leftToes',
  rightUpperLeg: 'rightUpperLeg',
  rightLowerLeg: 'rightLowerLeg',
  rightFoot: 'rightFoot',
  rightToes: 'rightToes',
  pelvisLower: 'pelvisLower',
  leftButt: 'leftButt',
  rightButt: 'rightButt',
  leftBreast: 'leftBreast',
  rightBreast: 'rightBreast',
};

/**
 * Unity Humanoid Avatar auto-mapping convention (PascalCase).
 * Thumbs map Metacarpal/Proximal/Distal -> Proximal/Intermediate/Distal
 * so Unity's Avatar Configurator recognizes all 15 finger bones automatically.
 */
const UNITY_BONE_MAP: Record<RigBoneName, string> = {
  hips: 'Hips',
  spine: 'Spine',
  chest: 'Chest',
  upperChest: 'UpperChest',
  neck: 'Neck',
  head: 'Head',
  leftEye: 'LeftEye',
  rightEye: 'RightEye',
  jaw: 'Jaw',
  leftShoulder: 'LeftShoulder',
  leftUpperArm: 'LeftUpperArm',
  leftLowerArm: 'LeftLowerArm',
  leftHand: 'LeftHand',
  leftThumbMetacarpal: 'LeftThumbProximal',
  leftThumbProximal: 'LeftThumbIntermediate',
  leftThumbDistal: 'LeftThumbDistal',
  leftIndexProximal: 'LeftIndexProximal',
  leftIndexIntermediate: 'LeftIndexIntermediate',
  leftIndexDistal: 'LeftIndexDistal',
  leftMiddleProximal: 'LeftMiddleProximal',
  leftMiddleIntermediate: 'LeftMiddleIntermediate',
  leftMiddleDistal: 'LeftMiddleDistal',
  leftRingProximal: 'LeftRingProximal',
  leftRingIntermediate: 'LeftRingIntermediate',
  leftRingDistal: 'LeftRingDistal',
  leftLittleProximal: 'LeftLittleProximal',
  leftLittleIntermediate: 'LeftLittleIntermediate',
  leftLittleDistal: 'LeftLittleDistal',
  rightShoulder: 'RightShoulder',
  rightUpperArm: 'RightUpperArm',
  rightLowerArm: 'RightLowerArm',
  rightHand: 'RightHand',
  rightThumbMetacarpal: 'RightThumbProximal',
  rightThumbProximal: 'RightThumbIntermediate',
  rightThumbDistal: 'RightThumbDistal',
  rightIndexProximal: 'RightIndexProximal',
  rightIndexIntermediate: 'RightIndexIntermediate',
  rightIndexDistal: 'RightIndexDistal',
  rightMiddleProximal: 'RightMiddleProximal',
  rightMiddleIntermediate: 'RightMiddleIntermediate',
  rightMiddleDistal: 'RightMiddleDistal',
  rightRingProximal: 'RightRingProximal',
  rightRingIntermediate: 'RightRingIntermediate',
  rightRingDistal: 'RightRingDistal',
  rightLittleProximal: 'RightLittleProximal',
  rightLittleIntermediate: 'RightLittleIntermediate',
  rightLittleDistal: 'RightLittleDistal',
  leftUpperLeg: 'LeftUpperLeg',
  leftLowerLeg: 'LeftLowerLeg',
  leftFoot: 'LeftFoot',
  leftToes: 'LeftToes',
  rightUpperLeg: 'RightUpperLeg',
  rightLowerLeg: 'RightLowerLeg',
  rightFoot: 'RightFoot',
  rightToes: 'RightToes',
  pelvisLower: 'PelvisLower',
  leftButt: 'LeftButt',
  rightButt: 'RightButt',
  leftBreast: 'LeftBreast',
  rightBreast: 'RightBreast',
};

/**
 * Unreal Engine 5 Manny / Quinn skeleton convention.
 * Exports under an injected grounded `root` bone at (0,0,0) -> `pelvis`.
 */
const UE5_BONE_MAP: Record<RigBoneName, string> = {
  hips: 'pelvis',
  spine: 'spine_01',
  chest: 'spine_02',
  upperChest: 'spine_03',
  neck: 'neck_01',
  head: 'head',
  leftEye: 'eye_l',
  rightEye: 'eye_r',
  jaw: 'jaw',
  leftShoulder: 'clavicle_l',
  leftUpperArm: 'upperarm_l',
  leftLowerArm: 'lowerarm_l',
  leftHand: 'hand_l',
  leftThumbMetacarpal: 'thumb_01_l',
  leftThumbProximal: 'thumb_02_l',
  leftThumbDistal: 'thumb_03_l',
  leftIndexProximal: 'index_01_l',
  leftIndexIntermediate: 'index_02_l',
  leftIndexDistal: 'index_03_l',
  leftMiddleProximal: 'middle_01_l',
  leftMiddleIntermediate: 'middle_02_l',
  leftMiddleDistal: 'middle_03_l',
  leftRingProximal: 'ring_01_l',
  leftRingIntermediate: 'ring_02_l',
  leftRingDistal: 'ring_03_l',
  leftLittleProximal: 'pinky_01_l',
  leftLittleIntermediate: 'pinky_02_l',
  leftLittleDistal: 'pinky_03_l',
  rightShoulder: 'clavicle_r',
  rightUpperArm: 'upperarm_r',
  rightLowerArm: 'lowerarm_r',
  rightHand: 'hand_r',
  rightThumbMetacarpal: 'thumb_01_r',
  rightThumbProximal: 'thumb_02_r',
  rightThumbDistal: 'thumb_03_r',
  rightIndexProximal: 'index_01_r',
  rightIndexIntermediate: 'index_02_r',
  rightIndexDistal: 'index_03_r',
  rightMiddleProximal: 'middle_01_r',
  rightMiddleIntermediate: 'middle_02_r',
  rightMiddleDistal: 'middle_03_r',
  rightRingProximal: 'ring_01_r',
  rightRingIntermediate: 'ring_02_r',
  rightRingDistal: 'ring_03_r',
  rightLittleProximal: 'pinky_01_r',
  rightLittleIntermediate: 'pinky_02_r',
  rightLittleDistal: 'pinky_03_r',
  leftUpperLeg: 'thigh_l',
  leftLowerLeg: 'calf_l',
  leftFoot: 'foot_l',
  leftToes: 'ball_l',
  rightUpperLeg: 'thigh_r',
  rightLowerLeg: 'calf_r',
  rightFoot: 'foot_r',
  rightToes: 'ball_r',
  pelvisLower: 'pelvis_lower',
  leftButt: 'butt_l',
  rightButt: 'butt_r',
  leftBreast: 'breast_l',
  rightBreast: 'breast_r',
};

// ─────────────────────────────────────────────────────────────────────────────
// Export target registry
// ─────────────────────────────────────────────────────────────────────────────

export const EXPORT_TARGETS: readonly ExportTarget[] = ['vrm', 'unity', 'ue5'] as const;

export const ENGINE_PROFILES: Readonly<Record<ExportTarget, EngineProfile>> = {
  vrm: {
    id: 'vrm',
    label: 'VRM / Blender',
    shortLabel: 'VRM / Blender',
    badgeText: 'VRM 1.0',
    rootBoneLabel: 'hips',
    unitLabel: 'm (1×)',
    importHint: 'Open standard VRM 1.0 GLB & Blender-ready FBX in meters.',
    fbxSuffixTag: 'rigged',
    boneNames: VRM_BONE_MAP,
    addRootBone: false,
    scaleFactor: 1,
    unitScaleFactor: 100,
  },
  unity: {
    id: 'unity',
    label: 'Unity Humanoid',
    shortLabel: 'Unity',
    badgeText: 'Unity',
    rootBoneLabel: 'Hips',
    unitLabel: 'm (1×)',
    importHint: 'Set Rig → Animation Type = Humanoid in Unity Inspector; PascalCase bones auto-map green.',
    fbxSuffixTag: 'unity',
    boneNames: UNITY_BONE_MAP,
    addRootBone: false,
    scaleFactor: 1,
    unitScaleFactor: 100,
  },
  ue5: {
    id: 'ue5',
    label: 'Unreal Engine 5',
    shortLabel: 'UE5',
    badgeText: 'UE5',
    rootBoneLabel: 'root → pelvis',
    unitLabel: 'cm (100×)',
    importHint: 'Exports in UE5 cm with grounded root bone & Manny/Quinn bone names for IK Retargeter.',
    fbxSuffixTag: 'ue5',
    boneNames: UE5_BONE_MAP,
    addRootBone: true,
    scaleFactor: 100,
    unitScaleFactor: 1,
  },
};

export function getEngineProfile(target: ExportTarget = 'vrm'): EngineProfile {
  return ENGINE_PROFILES[target] ?? ENGINE_PROFILES.vrm;
}

export function mapBoneNameForTarget(boneName: string, target: ExportTarget = 'vrm'): string {
  const profile = getEngineProfile(target);
  return profile.boneNames[boneName as RigBoneName] ?? boneName;
}
