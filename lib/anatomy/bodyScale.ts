/**
 * RaceMenu-style body/head bone scaling.
 *
 * RaceMenu's head/height/build sliders are bone transforms, not BodySlide
 * morph targets: the preset `transforms` block holds per-bone scale entries.
 * This module reproduces that vocabulary over the shared XP32/UBE skeleton —
 * every body, clothing, hand, foot and skinned-hair part is skinned to the same
 * `THREE.Bone` set, so one scale pass deforms the whole character coherently.
 *
 * Pure data only: no three.js and no import back into `params.ts`.
 */

/** Per-axis multiplier for one skeleton bone. Neutral is exactly 1. */
export interface ScaleFactors {
  x: number;
  y: number;
  z: number;
}

/**
 * A complete body-scale deformation.
 *
 * `rootScale` is a single uniform scale applied to every bone whose parent is
 * the registry group. Scaling a root multiplies every descendant offset by
 * exactly that number once, so the whole figure grows proportionally and
 * nothing downstream needs calibration. `bones` holds local per-bone factors
 * for body build; several sliders compose multiplicatively on the same bone.
 */
export interface BodyScale {
  bones: Record<string, ScaleFactors>;
  rootScale: number;
}

/** Authored standing height of the unscaled rig, in metres. This is the
 *  fallback in `exportGlb.ts:computeGroundOffset`, and the denominator the
 *  camera framing divides the live `characterHeight` by. */
export const BODY_SCALE_BASELINE_HEIGHT = 1.554;

/** Anatomy height that maps to an exactly neutral (×1) root scale. */
export const BODY_SCALE_REFERENCE_HEIGHT_CM = 170;

/** Final factor band. Keeps every parent scale far away from the zero-scale
 *  guard in `applySkeletonWeight`'s anchor pass. */
export const BODY_SCALE_MIN_FACTOR = 0.55;
export const BODY_SCALE_MAX_FACTOR = 1.65;

/**
 * Declared literally rather than `Extract<AnatomyParamId, …>`: `params.ts`
 * calls `hasBodyScale` inside the inference of `ANATOMY_PARAMS`, so a type
 * here that depended on `AnatomyParamId` would close a type cycle. These ids
 * are still checked against the real catalogue by `check_body_scale.cjs`.
 */
export type BodyScaleParamId =
  | 'body.heightCm'
  | 'body.headScale'
  | 'body.fat'
  | 'body.shoulderWidth'
  | 'body.chestSize'
  | 'body.waistSize'
  | 'body.hipWidth'
  | 'body.armLength'
  | 'body.legLength';

/**
 * The anatomy slice this module reads. Structural, so `AnatomyValues` (a
 * superset) satisfies it without this file importing from `params.ts` — that
 * import would close a type cycle, since `params.ts` calls `hasBodyScale`.
 */
export type BodyScaleAnatomies = Readonly<Record<BodyScaleParamId, number>>;

/** The nine anatomy values this module implements. `body.muscleDefinition` is
 *  a material stub, not a scale, and deliberately stays out. */
const BODY_SCALE_PARAM_IDS: readonly BodyScaleParamId[] = [
  'body.heightCm',
  'body.headScale',
  'body.fat',
  'body.shoulderWidth',
  'body.chestSize',
  'body.waistSize',
  'body.hipWidth',
  'body.armLength',
  'body.legLength',
];

export function hasBodyScale(id: string): id is BodyScaleParamId {
  return (BODY_SCALE_PARAM_IDS as readonly string[]).includes(id);
}

type Axis = keyof ScaleFactors;

interface ScaleRule {
  param: BodyScaleParamId;
  /** Bone name copied verbatim from `XP32_CANONICAL_PARENTS` /
   *  `SKELETON_WEIGHT_SCALES`. `applySkeletonWeight` skips unknown names
   *  silently, and bracket padding is part of the name. */
  bone: string;
  /** Local axes to scale. */
  axes: readonly Axis[];
  /** Gain per slider unit away from neutral 50 (0.003 = ±0.3 %/unit). */
  perUnit: number;
  /** Applied to the gain; the two-bone limb chains use ½ so the product of
   *  the two bones lands near the slider's own gain. */
  exponent?: number;
}

/**
 * Bone/axis table, measured against the actual baked XP32 meshes
 * (`bodyMesh-780aaed8c4e146dd.json`, hands, feet):
 *
 * - Chain offsets are local **+Z**: `Clavicle→UpperArm` 14.0,
 *   `UpperArm→Forearm` 22.8, `Forearm→Hand` 16.0, `Thigh→Calf` 35.6,
 *   `Calf→Foot` 28.0. So **limb length is Z** and the clavicle's shoulder
 *   reach is Z.
 * - Torso/spine child offsets also run along local +Z (Spine2→Neck 22.0), so a
 *   torso's radial cross-section is local **X/Y**. Scaling torso Z would
 *   lengthen the neck and change standing height, which is why none of the
 *   torso rules touch Z.
 * - The pelvis widens along local X (Pelvis→Thigh ±6.6).
 */
export const BODY_SCALE_RULES: readonly ScaleRule[] = [
  // Head size: uniform on the head bone. The facial parts ride `rig.root`,
  // driven from the head's world matrix, so they inherit it automatically.
  { param: 'body.headScale', bone: 'NPC Head [Head]', axes: ['x', 'y', 'z'], perUnit: 0.006 },

  // Shoulders: the clavicle's local Z is its reach to the shoulder joint;
  // the upper arm's X/Y are its radial cross-section (no length change).
  { param: 'body.shoulderWidth', bone: 'NPC L Clavicle [LClv]', axes: ['z'], perUnit: 0.0035 },
  { param: 'body.shoulderWidth', bone: 'NPC R Clavicle [RClv]', axes: ['z'], perUnit: 0.0035 },
  { param: 'body.shoulderWidth', bone: 'NPC L UpperArm [LUar]', axes: ['x', 'y'], perUnit: 0.0035 },
  { param: 'body.shoulderWidth', bone: 'NPC R UpperArm [RUar]', axes: ['x', 'y'], perUnit: 0.0035 },

  // Chest: ribcage girth radially; the breast chains are leaves, so uniform
  // here is safe (they never carry the head or feet).
  { param: 'body.chestSize', bone: 'NPC Spine2 [Spn2]', axes: ['x', 'y'], perUnit: 0.003 },
  { param: 'body.chestSize', bone: 'L Breast01', axes: ['x', 'y', 'z'], perUnit: 0.003 },
  { param: 'body.chestSize', bone: 'R Breast01', axes: ['x', 'y', 'z'], perUnit: 0.003 },
  { param: 'body.chestSize', bone: 'NPC L Breast', axes: ['x', 'y', 'z'], perUnit: 0.003 },
  { param: 'body.chestSize', bone: 'NPC R Breast', axes: ['x', 'y', 'z'], perUnit: 0.003 },

  // Waist: radial girth only.
  { param: 'body.waistSize', bone: 'NPC Spine [Spn0]', axes: ['x', 'y'], perUnit: 0.003 },
  { param: 'body.waistSize', bone: 'NPC Spine1 [Spn1]', axes: ['x', 'y'], perUnit: 0.003 },
  { param: 'body.waistSize', bone: 'Belly', axes: ['x', 'y'], perUnit: 0.003 },

  // Hips: local X is lateral across both bones.
  { param: 'body.hipWidth', bone: 'NPC Pelvis [Pelv]', axes: ['x'], perUnit: 0.004 },
  { param: 'body.hipWidth', bone: 'Butt', axes: ['x'], perUnit: 0.004 },

  // Fat: radial soft-tissue girth across the same torso bones.
  { param: 'body.fat', bone: 'NPC Spine1 [Spn1]', axes: ['x', 'y'], perUnit: 0.003 },
  { param: 'body.fat', bone: 'Belly', axes: ['x', 'y'], perUnit: 0.003 },
  { param: 'body.fat', bone: 'NPC Pelvis [Pelv]', axes: ['x', 'y'], perUnit: 0.003 },

  // Arm / leg length: the two-bone chains scale along local Z, ½ gain each.
  { param: 'body.armLength', bone: 'NPC L UpperArm [LUar]', axes: ['z'], perUnit: 0.0035, exponent: 0.5 },
  { param: 'body.armLength', bone: 'NPC R UpperArm [RUar]', axes: ['z'], perUnit: 0.0035, exponent: 0.5 },
  { param: 'body.armLength', bone: 'NPC L Forearm [LLar]', axes: ['z'], perUnit: 0.0035, exponent: 0.5 },
  { param: 'body.armLength', bone: 'NPC R Forearm [RLar]', axes: ['z'], perUnit: 0.0035, exponent: 0.5 },
  { param: 'body.legLength', bone: 'NPC L Thigh [LThg]', axes: ['z'], perUnit: 0.0035, exponent: 0.5 },
  { param: 'body.legLength', bone: 'NPC R Thigh [RThg]', axes: ['z'], perUnit: 0.0035, exponent: 0.5 },
  { param: 'body.legLength', bone: 'NPC L Calf [LClf]', axes: ['z'], perUnit: 0.0035, exponent: 0.5 },
  { param: 'body.legLength', bone: 'NPC R Calf [RClf]', axes: ['z'], perUnit: 0.0035, exponent: 0.5 },
];

/** Every bone this module writes, for contract tests. */
export const BODY_SCALE_BONES: readonly string[] = [
  ...new Set(BODY_SCALE_RULES.map((rule) => rule.bone)),
];

const neutralFactors = (): ScaleFactors => ({ x: 1, y: 1, z: 1 });

const clamp = (value: number) =>
  Math.min(BODY_SCALE_MAX_FACTOR, Math.max(BODY_SCALE_MIN_FACTOR, value));

export const NEUTRAL_BODY_SCALE: BodyScale = { bones: {}, rootScale: 1 };

/**
 * Derive the skeleton deformation for a set of anatomy values.
 *
 * Neutral anatomy (every slider at 50, height 170 cm) yields exactly ×1 on
 * every axis and `rootScale === 1`, so existing presets render byte-identical.
 */
export function bodyScaleFactors(anatomy: BodyScaleAnatomies): BodyScale {
  const bones: Record<string, ScaleFactors> = {};

  for (const rule of BODY_SCALE_RULES) {
    const value = anatomy[rule.param];
    if (!Number.isFinite(value)) continue;
    let gain = 1 + (value - 50) * rule.perUnit;
    if (rule.exponent !== undefined) gain = Math.pow(Math.max(0, gain), rule.exponent);
    /* Neutral rules contribute nothing, so neutral anatomy yields exactly an
       empty `bones` map rather than a table of identity entries. */
    if (!Number.isFinite(gain) || Math.abs(gain - 1) < 1e-12) continue;
    const factors = bones[rule.bone] ?? (bones[rule.bone] = neutralFactors());
    for (const axis of rule.axes) factors[axis] *= gain;
  }

  /* Several rules can compose on one bone (waist + fat on the belly), so the
     clamp belongs on the product, not the individual rule. */
  for (const factors of Object.values(bones)) {
    factors.x = clamp(factors.x);
    factors.y = clamp(factors.y);
    factors.z = clamp(factors.z);
  }

  const heightCm = anatomy['body.heightCm'];
  const rootScale = Number.isFinite(heightCm)
    ? clamp(heightCm / BODY_SCALE_REFERENCE_HEIGHT_CM)
    : 1;
  return { bones, rootScale };
}
