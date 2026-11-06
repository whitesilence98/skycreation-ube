export type RegionId =
  | 'forehead'
  | 'eyebrows'
  | 'nose'
  | 'cheeks'
  | 'lips'
  | 'jaw';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export type SliderId =
  | 'length'
  | 'width'
  | 'depth'
  | 'height'
  | 'angle'
  | 'protrusion';

export type SliderValues = Record<SliderId, number>;

/**
 * How a slider moves its bone.
 *
 * `scaleX/Y/Z` are fractions of the bind scale (0.01 = +1%) and are what a
 * *width*, *length* or *depth* slider must use: a bone scaling about its own
 * pivot widens the feature in place. The translation channels are for the
 * sliders that genuinely move a feature — *height* lifts, *protrusion* pushes
 * forward — and their units are metres, so the gains are ~1 mm per unit.
 *
 * This distinction was missing, and because the bones never posed there was
 * nothing to reveal it: `width` was routed to `x`, so `width +12` slid the nose
 * 54 mm sideways *and*, through the old `1 + x·6.5` scale coupling, inflated it
 * by 30%. Every region deformed that way, which is why the face rendered with
 * flared wings and a sunken muzzle the moment the rig started working.
 */
export type SliderChannel =
  | 'x'
  | 'y'
  | 'z'
  | 'scaleX'
  | 'scaleY'
  | 'scaleZ'
  | 'rotX'
  | 'rotZ'
  | 'radial';

export interface SliderDef {
  id: SliderId;
  label: string;
  /** Bracketed readout for the primary axes, parenthesised for morphs. */
  style: 'axis' | 'morph';
  axis?: 'x' | 'y' | 'z';
  min: number;
  max: number;
  step: number;
  /** Morph name this slider drives, from the RaceMenu / XPMSSE vocabulary. */
  morph: string;
  /** Which 3D channel the slider pushes on the deform target. */
  channel: SliderChannel;
  /** Metres per unit for the translation channels, a fraction per unit for
   *  the scale channels, radians per unit for the rotations. */
  gain: number;
  format: (v: number) => string;
}

export interface RegionDef {
  id: RegionId;
  label: string;
  /** Short label used inside the tooltip / chips. */
  short: string;
  /** Skeleton node this region is bound to (created at runtime if absent). */
  bone: string;
  /** Centre of the deform field in head-local space (metres, head origin at neck joint). */
  center: [number, number, number];
  /** Influence radius in metres. */
  radius: number;
  /** Direction the region protrudes, used for gizmo orientation + "depth". */
  normal: [number, number, number];
  /** Face-contour SVG diagram id. */
  diagram: 'forehead' | 'eyebrows' | 'nose' | 'cheeks' | 'lips' | 'jaw';
  /** Bounding box of the region on the front face, in normalized face coords. */
  contour: [number, number, number, number];
  defaults: SliderValues;
}

/* Rounded, because a preset import can land on a fractional value (the jslot's
   morph units do not divide evenly by the slider step) and `[+4.633…]` is not
   a readout this HUD would ever show. */
const axisFmt = (v: number) => {
  const r = Math.round(v);
  return `[${r > 0 ? '+' : ''}${r}]`;
};
const morphFmt = (v: number) => `(${v.toFixed(2)})`;

/* The six sliders are shared by every region, so each gain has to be sane for
   the smallest feature as well as the largest. They are now calibrated in the
   units the label implies: ±10 on a scale slider is roughly ±4 %, a translation
   slider moves ~1 mm per unit, and a morph moves ~3 mm at full deflection.
   Previously `width` sent 0.0045 m *per unit* to the x channel, i.e. 54 mm of
   sideways drift at +12 — half the width of the face — on top of a 30 % scale. */
export const SLIDER_DEFS: SliderDef[] = [
  {
    id: 'length',
    label: 'LENGTH',
    style: 'axis',
    axis: 'x',
    min: -10,
    max: 10,
    step: 1,
    morph: 'BF_Nose_TipHeight',
    channel: 'scaleY',
    gain: 0.0038,
    format: axisFmt,
  },
  {
    id: 'width',
    label: 'WIDTH',
    style: 'axis',
    axis: 'y',
    min: -10,
    max: 20,
    step: 1,
    morph: 'BS_Nose_WingWidth',
    channel: 'scaleX',
    gain: 0.0038,
    format: axisFmt,
  },
  {
    id: 'depth',
    label: 'DEPTH',
    style: 'axis',
    axis: 'z',
    min: -10,
    max: 20,
    step: 1,
    morph: 'BX_Nose_Tip_Depth',
    channel: 'scaleZ',
    gain: 0.0038,
    format: axisFmt,
  },
  {
    id: 'height',
    label: 'HEIGHT',
    style: 'morph',
    min: -1,
    max: 1,
    step: 0.01,
    morph: 'Nose_NoseBridgeHeight',
    channel: 'y',
    gain: 0.0030,
    format: morphFmt,
  },
  {
    id: 'angle',
    label: 'ANGLE',
    style: 'morph',
    min: -1,
    max: 1,
    step: 0.01,
    morph: 'BV_Nose_NostrilsAngle',
    channel: 'rotX',
    gain: 0.16,
    format: morphFmt,
  },
  {
    id: 'protrusion',
    label: 'PROTRUSION',
    style: 'morph',
    min: -1,
    max: 1,
    step: 0.01,
    morph: 'CA_Nose_TipGreaterAlar_Prominence',
    channel: 'z',
    gain: 0.0030,
    format: morphFmt,
  },
];

export const SLIDERS_BY_ID: Record<SliderId, SliderDef> = Object.fromEntries(
  SLIDER_DEFS.map((s) => [s.id, s]),
) as Record<SliderId, SliderDef>;

const noseDefaults: SliderValues = {
  length: -3,
  width: 12,
  depth: 8,
  height: 0.55,
  angle: 0.45,
  protrusion: 0.22,
};

export const REGIONS: RegionDef[] = [
  {
    id: 'forehead',
    label: 'FOREHEAD',
    short: 'FOREHEAD',
    bone: 'Forehead',
    center: [0, 0.0709, 0.0808],
    radius: 0.058,
    normal: [0, 0.35, 1],
    diagram: 'forehead',
    contour: [0.28, 0.06, 0.72, 0.3],
    defaults: { length: -1, width: 4, depth: 2, height: 0.4, angle: 0.12, protrusion: 0.3 },
  },
  {
    id: 'eyebrows',
    label: 'EYEBROWS',
    short: 'BROWS',
    bone: 'Brow_L',
    center: [0, 0.0370, 0.0746],
    radius: 0.05,
    normal: [0, 0.2, 1],
    diagram: 'eyebrows',
    contour: [0.24, 0.24, 0.76, 0.38],
    defaults: { length: 0, width: 6, depth: 3, height: 0.38, angle: 0.62, protrusion: 0.18 },
  },
  {
    id: 'nose',
    label: 'NOSE [ACTIVE]',
    short: 'NOSE',
    bone: 'Nose',
    center: [0, -0.0024, 0.0936],
    radius: 0.044,
    normal: [0, 0, 1],
    diagram: 'nose',
    contour: [0.42, 0.33, 0.58, 0.6],
    defaults: noseDefaults,
  },
  {
    id: 'cheeks',
    label: 'HIGHLIGHTED ACTIVE BONE',
    short: 'CHEEKS',
    bone: 'Cheek_L',
    center: [0.0468, 0.0006, 0.0660],
    radius: 0.05,
    normal: [0.45, 0, 1],
    diagram: 'cheeks',
    contour: [0.18, 0.36, 0.44, 0.62],
    defaults: { length: 0, width: 9, depth: 4, height: 0.5, angle: 0.3, protrusion: 0.26 },
  },
  {
    id: 'lips',
    label: 'LIPS',
    short: 'LIPS',
    /* Was `'Jaw'`, which `createRig` deduped with the jawline region: one bone
       at the *lips* pivot carried both banks, and because `jaw` is posed after
       `lips` its values always won. Maxing every lip slider outside the LIPS
       tab moved the mesh 0.0000 mm — so a preset's lip morphs simply vanished.
       A separate bone per region is what `REGION_BONES` always described. */
    bone: 'Lips',
    center: [0, -0.0309, 0.0844],
    radius: 0.034,
    normal: [0, -0.1, 1],
    diagram: 'lips',
    contour: [0.36, 0.58, 0.64, 0.7],
    defaults: { length: -1, width: 7, depth: 5, height: 0.52, angle: 0.28, protrusion: 0.34 },
  },
  {
    id: 'jaw',
    label: 'JAWLINE\nCHIN',
    short: 'JAWLINE',
    bone: 'Jaw',
    center: [0, -0.0763, 0.0380],
    radius: 0.062,
    normal: [0, -0.3, 1],
    diagram: 'jaw',
    contour: [0.22, 0.64, 0.78, 0.9],
    defaults: { length: -2, width: 11, depth: 3, height: 0.46, angle: 0.22, protrusion: 0.2 },
  },
];

export const REGIONS_BY_ID: Record<RegionId, RegionDef> = Object.fromEntries(
  REGIONS.map((r) => [r.id, r]),
) as Record<RegionId, RegionDef>;

export interface PresetDef {
  id: string;
  label: string;
  /** Seed for the procedural head silhouette. */
  seed: number;
  /** Per-region morph bias applied on top of the slider defaults. */
  bias: Partial<Record<RegionId, number>>;
}

export const PRESETS: PresetDef[] = [
  { id: 'lyra', label: 'LYRA', seed: 0.12, bias: { nose: 0.0, jaw: -0.1 } },
  { id: 'seraphine', label: 'SERAPHINE', seed: 0.38, bias: { nose: 0.2, lips: 0.15 } },
  { id: 'isolde', label: 'ISOLDE', seed: 0.61, bias: { jaw: 0.25, cheeks: 0.18 } },
  { id: 'miren', label: 'MIREN', seed: 0.84, bias: { forehead: -0.12, lips: -0.1 } },
];

/**
 * The slider bank a built-in preset stands for.
 *
 * `applyPreset` used to reset every region to the *same* defaults and only
 * change the `preset` id, so all four tiles rendered one identical face —
 * measured at 0.0 % of face pixels changed between any two of them. A tile
 * has to move the mesh or it is not a preset.
 *
 * `bias` is a fraction of each slider's own range, so one number means the
 * same thing on a ±10 axis slider and on a ±1 morph slider. Snapped to the
 * slider's step so the readout stays integral, and clamped so no preset can
 * walk a slider past its stop.
 */
export function presetSliderBank(preset: PresetDef): Record<RegionId, SliderValues> {
  const bank = Object.fromEntries(
    REGIONS.map((r) => [r.id, { ...r.defaults }]),
  ) as Record<RegionId, SliderValues>;
  for (const region of REGIONS) {
    const bias = preset.bias[region.id];
    if (!bias) continue;
    const values = bank[region.id];
    for (const def of SLIDER_DEFS) {
      const push = bias * (def.max - def.min) * 0.25;
      const next = values[def.id] + push;
      values[def.id] = Math.min(
        def.max,
        Math.max(def.min, Math.round(next / def.step) * def.step),
      );
    }
  }
  return bank;
}

/** Bone ↔ RaceMenu morph table shown in the asset panel. */
export const BONE_MORPH_MAP: Array<{
  bone: string;
  node: string;
  morphs: string[];
  region: RegionId;
}> = [
  { bone: 'Nose', node: 'NPC Nose [Nos]', morphs: ['BF_Nose_TipHeight', 'BS_Nose_WingWidth', 'BX_Nose_Tip_Depth'], region: 'nose' },
  { bone: 'Brow_L', node: 'NPC Brow Left [BrwL]', morphs: ['AA_Brows_Angle', 'AB_Brows_Ridge_Defined'], region: 'eyebrows' },
  { bone: 'Jaw', node: 'NPC Jaw [Jaw]', morphs: ['AF_FACE_Width', 'AW_FACE_ChinLength', 'EFM_Jaw_Width'], region: 'jaw' },
  { bone: 'Cheek_L', node: 'NPC Cheek Left [ChL]', morphs: ['AK_FACE_Cheeks_Width', 'AO_FACE_LowerCheeksDepth'], region: 'cheeks' },
  { bone: 'Forehead', node: 'NPC Forehead [Fhd]', morphs: ['AG_FACE_Anime_Big_Forehead', 'FACE_FaceDepth'], region: 'forehead' },
  { bone: 'Lips', node: 'NPC Lip Upper [LipU]', morphs: ['AG_LIP_UpperLipSize', 'AU_LIP_LowerLipSize'], region: 'lips' },
];

export const STATS = { faces: 47868, verts: 2998, tris: 1179 };

export const NAME_DEFAULT = 'LYRA';
