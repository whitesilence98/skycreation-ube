/**
 * One hair-material policy for every loader (NIF cards, GLB hairstyles, scalp).
 *
 * Hair atlases are authored as `MASK`/cutout alpha. Rendering cutout geometry
 * with `transparent: true` makes every texel that survives the cutoff blend by
 * its own alpha — a ghostly veil over a "100% opaque" hairstyle, and the reason
 * cards punch holes in each other in the transparent pass. So: cut out while
 * opaque, blend only once the user actually fades it.
 *
 * Every threshold is overridable from the ADVANCED TUNING panel; the exported
 * defaults are the values the fix shipped with, and omitting `tuning` keeps the
 * behaviour byte-identical.
 */
export interface HairMaterialState {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  alphaTest: number;
}

/** Only the fields this module reads, so a full `HairSettings` is accepted. */
export interface HairMaterialTuning {
  matCutoff?: number;
  matCutoffFaded?: number;
  matBlendThreshold?: number;
  matSheenFloor?: number;
  matSheenBase?: number;
  matSheenSlope?: number;
}

export const HAIR_ALPHA_CUTOFF = 0.35;
export const HAIR_ALPHA_CUTOFF_FADED = 0.05;
export const HAIR_BLEND_THRESHOLD = 0.999;
export const HAIR_SHEEN_FLOOR = 0.28;
export const HAIR_SHEEN_BASE = 0.62;
export const HAIR_SHEEN_SLOPE = 0.4;

/**
 * @param alpha  user opacity, 0..1
 * @param tuning override for the cutout / blend thresholds
 * @param authoredBlend  true when the source material declares `alphaMode: BLEND`
 */
export function hairMaterialState(
  alpha: number,
  tuning?: HairMaterialTuning,
  authoredBlend = false,
): HairMaterialState {
  const a = Math.max(0, Math.min(1, alpha));
  const cutoff = tuning?.matCutoff ?? HAIR_ALPHA_CUTOFF;
  const fadedCutoff = tuning?.matCutoffFaded ?? HAIR_ALPHA_CUTOFF_FADED;
  const threshold = tuning?.matBlendThreshold ?? HAIR_BLEND_THRESHOLD;

  const blend = authoredBlend || a < threshold;
  return {
    opacity: a,
    transparent: blend,
    depthWrite: !blend,
    // A low cutout while fading keeps soft edges instead of shattering the cards.
    alphaTest: authoredBlend ? 0 : blend ? fadedCutoff : cutoff,
  };
}

/**
 * Gloss slider → roughness. The old GLB map hit 0.1 at gloss 1 (a mirror under
 * the env map); the floor keeps a highlight, not a chrome sheet.
 */
export function hairRoughness(gloss: number, tuning?: HairMaterialTuning): number {
  const floor = tuning?.matSheenFloor ?? HAIR_SHEEN_FLOOR;
  const base = tuning?.matSheenBase ?? HAIR_SHEEN_BASE;
  const slope = tuning?.matSheenSlope ?? HAIR_SHEEN_SLOPE;
  return Math.max(floor, base - gloss * slope);
}
