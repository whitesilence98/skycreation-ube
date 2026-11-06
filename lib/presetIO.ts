import {
  PRESETS,
  REGIONS,
  REGIONS_BY_ID,
  SLIDER_DEFS,
  type RegionId,
  type SliderId,
  type SliderValues,
  type TransformMode,
} from '@/lib/regions';
import { coerceHair, type HairSettings } from '@/lib/hair/settings';
import type { GizmoPose, OverlayLayer } from '@/lib/store';
import { ASSET_KINDS, type AssetSelection } from '@/lib/manifestSelect';

/**
 * Import/export for character presets.
 *
 * Two formats are accepted on import:
 *
 *   1. This app's own export (`format: "lyra-preset"`), which round-trips the
 *      full state — every region's slider bank and gizmo pose.
 *   2. A RaceMenu `.jslot` straight out of the mod archive. Those are JSON with
 *      a `morphs.custom` list of `{ name, value }`; the names are the real
 *      RaceMenu morph vocabulary (`BF_Nose_TipHeight`, `AE_FACE_FaceLength`,
 *      …) that the sliders in `lib/regions.ts` are already keyed to.
 *
 * A `.jslot` carries more than the six sliders per region can express, so an
 * import from that format applies the morphs it recognises and reports how
 * many it could not place rather than silently dropping them.
 */

export const PRESET_FORMAT = 'lyra-preset';
export const PRESET_VERSION = 2;

export interface RegionSnapshot {
  sliders: SliderValues;
  pose: GizmoPose;
}

export interface PresetFile {
  format: typeof PRESET_FORMAT;
  version: number;
  /** ISO timestamp; informational only. */
  savedAt: string;
  name: string;
  preset: string;
  activeRegion: RegionId;
  transformMode: TransformMode;
  bisymmetry: boolean;
  regions: Record<RegionId, RegionSnapshot>;
  /** The same values in RaceMenu's vocabulary, for use inside the game. */
  raceMenu: { morphs: Array<{ name: string; value: number }> };
  /** Which MO2 asset each category was wearing at export time. */
  assets?: AssetSelection;
  /** Body weight, 0–1 — the same field a `.jslot` calls `actor.weight`/100. */
  weight?: number;
  /** The makeup / tattoo / wrinkle stack, in draw order. */
  hair?: HairSettings;
  overlays?: OverlayLayer[];
}

/**
 * Parses and maps a `.jslot`'s `morphs.custom` list onto the slider banks.
 *
 * Shared by `parsePreset` (a file the user dropped on the HUD) and by the
 * asset panel's preset picker, which already has the morph list in the
 * manifest and should not have to round-trip it through a synthetic file.
 */
export function payloadFromMorphs(
  morphs: Array<{ name: string; value: number }>,
  meta?: { name?: string; baked?: boolean; actorWeight?: unknown },
): PresetPayload {
  // morph name → the region/slider it feeds. Aliases are ranked so a preset
  // that supplies both `AA_Brows_Angle` and `Brow_BrowSlope` does not have its
  // brow angle applied twice.
  const lookup = new Map<string, { region: RegionId; slider: SliderId; rank: number }>();
  for (const region of REGIONS) {
    for (const def of SLIDER_DEFS) {
      const names = REGION_MORPHS[region.id][def.id];
      if (!names) continue;
      names.forEach((name, rank) => {
        const prev = lookup.get(name);
        if (!prev || rank < prev.rank) lookup.set(name, { region: region.id, slider: def.id, rank });
      });
    }
  }

  const regions: PresetPayload['regions'] = {};
  for (const region of REGIONS) {
    regions[region.id] = {
      sliders: meta?.baked
        ? Object.fromEntries(SLIDER_DEFS.map((d) => [d.id, 0])) as SliderValues
        : { ...region.defaults },
      pose: identityPose(),
    };
  }

  // Pass 1: index what the file actually contains.
  const present = new Map<string, number>();
  let unmapped = 0;
  for (const entry of morphs) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.name !== 'string' || typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
      continue;
    }
    if (lookup.has(entry.name)) present.set(entry.name, entry.value);
    else unmapped += 1;
  }

  /* Pass 2: one morph per slider — the best-ranked name the file supplies.
     Summing every alias would apply the same feature two or three times when
     a preset carries both vocabularies, which some of these files do.

     Routing goes through `lookup`, not a fresh alias scan. Scanning aliases
     per slider let one morph name feed two sliders (it is listed as an alias
     of both), so `AF_Forehead_Width` drove forehead width *and* height and the
     imported face came out fatter than the file's. `lookup` resolves each name
     to exactly one slider by rank, which is also what export inverts. */
  const best = new Map<string, { region: RegionId; slider: SliderId; rank: number; value: number }>();
  for (const [name, value] of present) {
    const hit = lookup.get(name);
    if (!hit) continue;
    const key = `${hit.region}.${hit.slider}`;
    const prev = best.get(key);
    if (!prev || hit.rank < prev.rank) {
      best.set(key, { region: hit.region, slider: hit.slider, rank: hit.rank, value });
    }
  }

  for (const { region, slider, value } of best.values()) {
    const def = SLIDER_DEFS.find((d) => d.id === slider);
    if (!def) continue;
    /* `toRaceMenuMorphs` writes `slider * MORPH_PER_SLIDER`, so import is the
       exact inverse: `slider = morph / MORPH_PER_SLIDER`. Adding the region
       default back on top (which this used to do) made every imported file
       land at `default + morph/factor`; a preset authored at 0 came in at 12
       on a slider whose default is 12, so the imported face was not the
       file's face. Neutral is 0 on both sides of the mapping. */
    const raw = value / MORPH_PER_SLIDER[def.style];
    /* Snap to the slider's own step. Without this the readout renders the
       raw quotient (`[+4.633333365122477]`) because the axis sliders step
       by 1 and nothing in the drag path rounds a programme-set value. */
    const snapped = Math.round(raw / def.step) * def.step;
    const bank = regions[region];
    if (!bank) continue;
    bank.sliders[slider] = clamp(
      Math.round(snapped * 1e6) / 1e6,
      def.min,
      def.max,
    );
  }

  return {
    name: meta?.name,
    regions,
    unmapped,
    source: 'racemenu',
    weight: typeof meta?.actorWeight === 'number' && Number.isFinite(meta.actorWeight)
      && meta.actorWeight >= 0 && meta.actorWeight <= 100 ? meta.actorWeight / 100 : undefined,
  };
}

export interface PresetPayload {
  name?: string;
  preset?: string;
  /**
   * The preset file the payload came from for a `.jslot`
   * (`'Frau.jslot'`), or the LYRA export's own name.
   *
   * Preset import uses it to pick the `headMesh` whose baked sculpt was made
   * from this exact file (`sculptHeadFor`). Without it a `.jslot` import can
   * only move sliders, and a real face is mostly `morphs.sculpt` — 26,262
   * points for Frau against 37 morphs — so nothing visible would change.
   */
  sourceFile?: string;
  activeRegion?: RegionId;
  transformMode?: TransformMode;
  bisymmetry?: boolean;
  regions: Partial<Record<RegionId, RegionSnapshot>>;
  /** How many morphs in the source could not be mapped onto a slider. */
  unmapped: number;
  /** Human-readable name of the format that was read. */
  source: 'lyra' | 'racemenu';
  /** Asset ids the file was wearing, when it records them. */
  assets?: AssetSelection;
  /**
   * Body weight, 0–1. A `.jslot` stores it as an integer 0–100 under
   * `actor.weight`; this is that number divided by 100, and it is what the
   * BODY tab's slider drives.
   */
  weight?: number;
  /** Makeup / tattoo / wrinkle layers, when the file records them. */
  hair?: HairSettings;
  overlays?: OverlayLayer[];
}

/**
 * Which RaceMenu morph each slider writes for each region.
 *
 * The slider definitions in `lib/regions.ts` carry only the *nose* morph names
 * because the nose is the region the reference frame has selected; a preset
 * has to be region-correct, so the mapping lives here instead.
 *
 * Names below are taken verbatim from the `.jslot` files in the user's archive
 * (10 presets, 217 distinct morph names), not invented. Two vocabularies appear
 * there — the `AA_`-prefixed RaceMenu Extended set and the older unprefixed one
 * (`Nose_NoseBridgeHeight`, `Brow_BrowSlope`, …) — so every slider lists its
 * primary name first and then aliases; import matches any of them and export
 * always writes the primary.
 */
export const REGION_MORPHS: Record<RegionId, Partial<Record<SliderId, string[]>>> = {
  /* Every slider here has a distinct **first** entry: `toRaceMenuMorphs` sums
     sliders that share a primary into one morph, and no inverse can split that
     number back correctly when the sharers use different unit factors. Aliases
     may still repeat — import tries them in order — but a primary must map to
     one slider. */
  forehead: {
    length: ['FACE_FaceDepth', 'AE_FACE_FaceLength', 'AF_Forehead_Width'],
    width: ['AF_Forehead_Width', 'FACE_ForeheadWidth', 'AF_FACE_Width'],
    depth: ['FACE_ForeheadDepth', 'AG_FACE_Anime_Big_Forehead'],
    height: ['AH_Forehead_Angle', 'AC_FACE_Angle'],
    angle: ['AC_FACE_Angle'],
    protrusion: ['AG_FACE_Anime_Big_Forehead'],
  },
  eyebrows: {
    length: ['AA_Brows_Angle', 'Brow_BrowSlope', 'EFM_Brow_Angle', 'CME_BrowSlope', 'NSK_BrowAngle'],
    width: ['AJ_Brows_Area_Width', 'Brow_BrowOuterWidth', 'EFM_Brow_Width'],
    depth: ['AA_Brows_CenterDepth', 'Brow_BrowCentreDepth', 'CME_BrowBackForward'],
    height: ['AK_Brows_Area_Height', 'Brow_BrowMiddleHeight', 'EFM_Brow_Height'],
    angle: ['CME_BrowSlope', 'NSK_BrowAngle', 'Brow_BrowSlope'],
    protrusion: [
      'AB_Brows_Ridge_Defined',
      'Brow_BrowDefine',
      'Brow_BrowArched',
      'CME_BrowArch',
      'EFM_Brow_Thickness',
    ],
  },
  nose: {
    length: ['BF_Nose_TipHeight', 'Nose_NostrisHeight'],
    width: ['BS_Nose_WingWidth', 'Nose_NoseWingWidth', 'Nose_NoseBridgeWide'],
    depth: ['BX_Nose_Tip_Depth', 'AZZ_NOSE_BridgeDepth'],
    height: ['Nose_NoseBridgeHeight', 'BF_Nose_TipHeight'],
    angle: ['BV_Nose_NostrilsAngle'],
    protrusion: ['CA_Nose_TipGreaterAlar_Prominence', 'AYY_NOSE_Size', 'Nose_NoseCenterWidth'],
  },
  cheeks: {
    length: ['EE_FACE_Cheeks_Size', 'FACE_CheeksBonesHeightAlt'],
    width: ['AK_FACE_Cheeks_Width', 'EFM_Cheek_Width', 'FACE_CheeksBonesOutA'],
    depth: ['AO_FACE_LowerCheeksDepth', 'FACE_CheeksSink'],
    height: ['FACE_CheeksBonesHeightAlt', 'EE_FACE_Cheeks_Size'],
    angle: ['EFM_Cheek_Shape', 'FACE_CheeksBonesSculpt'],
    protrusion: ['FACE_CheeksBonesOutB', 'FACE_CheeksBonesSculpt'],
  },
  lips: {
    length: ['AG_LIP_UpperLipSize', 'AA_LIP_Size', 'LIP_LipsHeight', 'EFM_Lip_Height'],
    width: ['AB_LIP_Width', 'LIP_MouthWidth', 'EFM_Lip_Width'],
    depth: ['AC_LIP_ContactDepth', 'AQ_LIP_UpperLipContactDepth', 'AI_LIP_UpperLipDepth'],
    height: ['AU_LIP_LowerLipSize', 'EFM_Lip_Lower_Thickness', 'NSK_LipThickness'],
    angle: ['EFM_Lip_Angle', 'LIP_LipLowerCurveA'],
    /* Only morphs that are actually lip *volume*. Cupid's-bow height and the
       V-border width are separate features; folding them in here drove the
       morph sliders straight into their −1 / +1 stops. */
    protrusion: [
      'AT_LIP_UpperLipCenter_Prominence',
      'AH_LIP_UpperLipFiller',
      'AV_LIP_LowerLipFiller',
      'RANs_LipDuckly',
    ],
  },
  jaw: {
    length: ['AW_FACE_ChinLength', 'EF_FACE_Jaw-Chin_Height', 'EFM_Chin_Height'],
    width: ['AX_FACE_ChinWidth', 'EFM_Jaw_Width'],
    depth: ['EFM_Jaw_Shape', 'FACE_JawShapeAngular'],
    height: ['EF_FACE_Jaw-Chin_Height', 'EFM_Chin_Shape'],
    angle: ['FACE_JawShapeAngular', 'EFM_Jaw_Shape'],
    protrusion: ['FACE_ChinSquare', 'FACE_ChinCleft'],
  },
};

/** Primary export name for a slider. */
export function primaryMorph(region: RegionId, slider: SliderId): string | undefined {
  return REGION_MORPHS[region][slider]?.[0];
}

/**
 * RaceMenu morph units per slider unit, by slider style.
 *
 * A `.jslot` writes morph values in roughly −3..+3. The axis sliders span
 * `[−10, +20]`, so ~0.3 morph units per step fills their range usefully. The
 * parenthesised morph sliders only span `[−1, +1]` — six times narrower — so
 * they need a much larger denominator. Using the axis factor for both drove
 * every imported lip and brow morph into its −1 / +1 stop.
 */
const MORPH_PER_SLIDER: Record<'axis' | 'morph', number> = { axis: 0.3, morph: 2.0 };

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Builds the `raceMenu.morphs` list from the current per-region sliders. */
export function toRaceMenuMorphs(
  regions: Record<RegionId, RegionSnapshot>,
): Array<{ name: string; value: number }> {
  const out = new Map<string, number>();
  for (const region of REGIONS) {
    const table = REGION_MORPHS[region.id];
    const values = regions[region.id]?.sliders;
    if (!values) continue;
    for (const def of SLIDER_DEFS) {
      const morph = table[def.id]?.[0];
      if (!morph) continue;
      /* Absolute, not the delta from the UI default: slider 0 is the rest
         pose, which is what a RaceMenu morph value of 0 also means. Writing
         deltas made the exported morph list empty for any region still on its
         starting pose, which is the common case. Import is the exact inverse
         (`slider = morph / factor`), so a round trip is still lossless. */
      const scaled = Math.round((values[def.id] ?? 0) * MORPH_PER_SLIDER[def.style] * 100) / 100;
      /* One morph per slider. This used to *sum* sliders that shared a name,
         which made the mapping non-invertible: with different unit factors on
         the two sharers, no import can recover the pair from the total, so the
         exported file and the imported face disagreed. `REGION_MORPHS` now
         gives every slider a distinct primary, and an accidental duplicate is
         a test failure rather than a silently mangled face. */
      if (out.has(morph)) continue;
      out.set(morph, scaled);
    }
  }
  return [...out.entries()]
    .filter(([, v]) => Math.abs(v) > 0.004)
    .map(([name, value]) => ({ name, value }));
}

export function buildPresetFile(args: {
  name: string;
  preset: string;
  activeRegion: RegionId;
  transformMode: TransformMode;
  bisymmetry: boolean;
  regions: Record<RegionId, RegionSnapshot>;
  assets?: AssetSelection;
  weight?: number;
  hair?: HairSettings;
  overlays?: OverlayLayer[];
}): PresetFile {
  return {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    savedAt: new Date().toISOString(),
    name: args.name,
    preset: args.preset,
    activeRegion: args.activeRegion,
    transformMode: args.transformMode,
    bisymmetry: args.bisymmetry,
    regions: args.regions,
    raceMenu: { morphs: toRaceMenuMorphs(args.regions) },
    assets: args.assets,
    weight: args.weight,
    hair: args.hair,
    overlays: args.overlays,
  };
}

/**
 * A stored weight, normalised to 0–1, or undefined.
 *
 * Accepts both forms: our own export writes 0–1, a `.jslot` writes 0–100. The
 * threshold is the only way to tell them apart without a schema field, and it
 * is safe because a weight above 1 only ever comes from RaceMenu — nothing in
 * this app stores a value outside 0–1.
 */
function coerceWeight(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v < 0 || v > 100) return undefined;
  return v > 1 ? v / 100 : v;
}

function isRegionId(v: unknown): v is RegionId {
  return typeof v === 'string' && v in REGIONS_BY_ID;
}

/**
 * Keeps only the well-formed `{ kind: id }` pairs from an exported file.
 *
 * Derived from `ASSET_KINDS` rather than a local copy: the previous duplicate
 * silently rejected every kind added after it was written, so a file exported
 * with makeup selected would import with the makeup dropped.
 */
function isAssetSelection(v: unknown): v is AssetSelection {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Object.entries(o).every(
    ([k, id]) => (ASSET_KINDS as readonly string[]).includes(k) && typeof id === 'string',
  );
}

/** Same treatment for the overlay stack: bounded, typed, no surprises. */
function isOverlayLayers(v: unknown): v is OverlayLayer[] {
  if (!Array.isArray(v) || v.length > 16) return false;
  return v.every((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const o = raw as Record<string, unknown>;
    return (
      typeof o.kind === 'string' &&
      (ASSET_KINDS as readonly string[]).includes(o.kind) &&
      typeof o.id === 'string' &&
      typeof o.color === 'string' &&
      /^#[0-9a-f]{6}$/i.test(o.color) &&
      typeof o.opacity === 'number' &&
      Number.isFinite(o.opacity) &&
      o.opacity >= 0 &&
      o.opacity <= 1
    );
  });
}

function identityPose(): GizmoPose {
  return { offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
}

function coerceSliderValues(raw: unknown, fallback: SliderValues): SliderValues {
  const out: SliderValues = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  for (const def of SLIDER_DEFS) {
    const v = (raw as Record<string, unknown>)[def.id];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[def.id] = clamp(v, def.min, def.max);
    }
  }
  return out;
}

function coercePose(raw: unknown): GizmoPose {
  const base = identityPose();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<GizmoPose>;
  const trip = (v: unknown, d: [number, number, number]): [number, number, number] =>
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? [v[0], v[1], v[2]]
      : d;
  return {
    offset: trip(r.offset, base.offset),
    rotation: trip(r.rotation, base.rotation),
    scale: trip(r.scale, base.scale),
  };
}

/**
 * Parses either format. Throws an Error with a user-facing message when the
 * text is neither.
 */
export function parsePreset(text: string, fileName?: string): PresetPayload {
  let data: unknown;
  try {
    // RaceMenu writes a UTF-8 BOM; JSON.parse rejects it.
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || typeof data !== 'object') throw new Error('That file is not a preset.');

  const obj = data as Record<string, unknown>;

  // ── this app's own export ───────────────────────────────────────
  if (obj.format === PRESET_FORMAT) {
    const rawRegions = (obj.regions ?? {}) as Record<string, unknown>;
    const regions: PresetPayload['regions'] = {};
    for (const region of REGIONS) {
      const entry = rawRegions[region.id];
      if (!entry || typeof entry !== 'object') continue;
      regions[region.id] = {
        sliders: coerceSliderValues((entry as RegionSnapshot).sliders, region.defaults),
        pose: coercePose((entry as RegionSnapshot).pose),
      };
    }
    if (!Object.keys(regions).length) throw new Error('That preset has no region data.');
    return {
      name: typeof obj.name === 'string' ? obj.name : undefined,
      preset: typeof obj.preset === 'string' ? obj.preset : undefined,
      activeRegion: isRegionId(obj.activeRegion) ? obj.activeRegion : undefined,
      transformMode:
        obj.transformMode === 'translate' ||
        obj.transformMode === 'rotate' ||
        obj.transformMode === 'scale'
          ? obj.transformMode
          : undefined,
      bisymmetry: typeof obj.bisymmetry === 'boolean' ? obj.bisymmetry : undefined,
      regions,
      unmapped: 0,
      source: 'lyra',
      assets: isAssetSelection(obj.assets) ? obj.assets : undefined,
      weight: coerceWeight(obj.weight),
      hair: obj.hair && typeof obj.hair === 'object' && !Array.isArray(obj.hair) ? coerceHair(obj.hair) : undefined,
      overlays: isOverlayLayers(obj.overlays) ? obj.overlays : undefined,
    };
  }

  // ── a RaceMenu .jslot ───────────────────────────────────────────
  const morphs = obj.morphs as { custom?: unknown } | undefined;
  /* `[3BA] Nini.jslot` writes `custom: null` — a preset with no named morphs,
     only sculpt. Treating that as "not a preset" rejected the file outright,
     so an import said "Unrecognised preset" for a real RaceMenu preset. A
     null/absent `custom` is an empty list; what makes a file a presets is the
     `morphs` object itself. */
  const rawCustom = morphs?.custom;
  const custom = Array.isArray(rawCustom)
    ? (rawCustom as unknown[])
    : rawCustom === null || rawCustom === undefined
      ? []
      : null;
  if (!custom) {
    throw new Error('Unrecognised preset. Expected a LYRA export or a RaceMenu .jslot.');
  }

  /* The mapping itself lives in `payloadFromMorphs` so the asset panel's
     preset picker can apply a manifest option without going through a file.
     Only the morph entries that are well-formed objects are worth mapping;
     malformed ones are counted as unmapped, as the picker does. */
  const entries = custom
    .filter((e): e is { name: string; value: number } =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as { name?: unknown }).name === 'string' &&
      typeof (e as { value?: unknown }).value === 'number' &&
      Number.isFinite((e as { value: number }).value),
    )
    .map((e) => ({ name: e.name, value: e.value }));

  const mapped = payloadFromMorphs(entries, {
    name: typeof obj.name === 'string' ? obj.name : undefined,
    actorWeight: (obj.actor as { weight?: unknown } | undefined)?.weight,
  });
  return {
    ...mapped,
    /* The `.jslot`'s own basename, so import can find the head mesh whose
       sculpt was baked from this file. A `.jslot` has no `name` field
       (RaceMenu writes the filename outside the JSON), so the basename is the
       only stable identifier it has. */
    source: 'racemenu',
    sourceFile: fileName,
    // Malformed entries are not "morphs this app cannot place", so count them
    // separately from the ones that simply have no slider.
    unmapped: mapped.unmapped + (custom.length - entries.length),
  };
}

/** Filename-safe slug for the download. */
export function presetFileName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const date = new Date().toISOString().slice(0, 10);
  return `lyra-${slug || 'preset'}-${date}.json`;
}

/** Applies a preset's values on top of the live banks. */
export function applyPayloadToBanks(
  payload: PresetPayload,
  defaults: Record<RegionId, SliderValues>,
): {
  sliders: Record<RegionId, SliderValues>;
  poses: Record<RegionId, GizmoPose>;
} {
  const sliders = Object.fromEntries(
    REGIONS.map((r) => [r.id, { ...defaults[r.id] }]),
  ) as Record<RegionId, SliderValues>;
  const poses = Object.fromEntries(
    REGIONS.map((r) => [r.id, identityPose()]),
  ) as Record<RegionId, GizmoPose>;

  for (const region of REGIONS) {
    const entry = payload.regions[region.id];
    if (!entry) continue;
    sliders[region.id] = { ...entry.sliders };
    poses[region.id] = entry.pose;
  }
  return { sliders, poses };
}

/** Preset id if it matches one of the built-in faces, else the first. */
export function resolvePresetId(id: string | undefined): string {
  return PRESETS.some((p) => p.id === id) ? (id as string) : PRESETS[0].id;
}
