'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ANATOMY_PARAMS, ANATOMY_COLOR_DEFS, ANATOMY_BY_ID, type AnatomySnapshot, type AnatomyMode, type AnatomyParamId, type AnatomyColorId, type AnatomyGroupId } from '@/lib/anatomy/params';
import { coerceAnatomy, coerceAsymmetry, coerceAnatomyColors, applyPresetValues } from '@/lib/anatomy/validate';
import { ANATOMY_PRESETS } from '@/lib/anatomy/presets';
import {
  NAME_DEFAULT,
  PRESETS,
  REGIONS,
  REGIONS_BY_ID,
  SLIDERS_BY_ID,
  presetSliderBank,
  type RegionDef,
  type RegionId,
  type SliderId,
  type SliderValues,
  type TransformMode,
} from '@/lib/regions';
import {
  OVERLAY_BLENDS,
  buildPresetFile,
  resolvePresetId,
  type PresetFile,
  type PresetPayload,
} from '@/lib/presetIO';
import {
  SESSION_KEY,
  SESSION_VERSION,
  coerceSession,
  enableSessionWrites,
  persistStorage,
  pickSession,
  type PersistedSession,
} from '@/lib/session';
import type { AssetSelection, AssetKind, AssetCatalogues, UiCategory } from '@/lib/manifestSelect';
import type { EquipSelection, EquipSlot } from '@/lib/equipment';
import { DEFAULT_HAIR, coerceHair, applyHairStyle as hairStyle, type HairSettings, type HairTab } from '@/lib/hair/settings';
/** The two screens the Hair and Makeup workspaces can show. */
export type StudioPage = 'default' | 'smart';import type { CatalogueEntry } from '@/lib/mo2/types';
import { type EnvMode } from '@/lib/envModes';
import { type BackgroundMode } from '@/lib/backgrounds';
import { type CameraFraming, type CameraPoseRequest, CAMERA_FOV_DEFAULT, CAMERA_FOV_MIN, CAMERA_FOV_MAX, CAMERA_ROTATE_SPEED_DEFAULT, CAMERA_ROTATE_SPEED_MIN, CAMERA_ROTATE_SPEED_MAX } from '@/lib/camera';
import { LIGHTING_DEFAULTS, coerceLighting, bounded, wrapDegrees, type LightingSettings } from '@/lib/lighting';
import { useBodySlideStore, LEGACY_SILHOUETTE_MAPPING } from '@/lib/bodyslide/store';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FEATURE FLAG: BODY WEIGHT SCALING
 * ─────────────────────────────────────────────────────────────────────────────
 * Set to `true` to re-enable body weight scaling and dynamic _0/_1 slider lerping.
 * Set to `false` to disable changing body weight and lock to 0% (default slim _0 mesh).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const BODY_WEIGHT_ENABLED = false;

/** How a tint layer combines with the atlas beneath it. `normal` is the
 *  historical source-over draw and the value an absent `blend` means. */
export type OverlayBlend = 'normal' | 'multiply' | 'screen' | 'overlay';

/** One tinted layer composited onto the face bake, in atlas space. */
export interface OverlayLayer {
  kind: AssetKind;
  /** Catalogue id of the tintmask. */
  id: string;
  /** `#rrggbb` from the preset's `tintInfo`, or a neutral when absent. */
  color: string;
  opacity: number;
  /** Blend mode; absent means `normal`. */
  blend?: OverlayBlend;
  /**
   * Mask coverage, 0–1, applied as a threshold rather than a fade:
   * `alpha' = alpha <= 1 - coverage ? 0 : (alpha - (1 - coverage)) / coverage`.
   * Absent means 1 (keep the mask's own alpha untouched).
   */
  coverage?: number;
}

/** Which category the asset panel is listing. Mirrors the HUD's sub-tabs. */
export type ActiveCategory = UiCategory;

/** The three ENB/ReShade combinations the composer implements. The on/off
 *  switch is separate, so a preset can be held while the stack is off and
 *  re-enabled without losing the pick. */
export type EnbPreset = 'all' | 'enb' | 'pure';

/** Left workspace dock. The panels stay mounted; only the active one is
 *  visible, so switching never drops filters, scroll position or local state. */
export type Workspace = 'edit' | 'assets' | 'camera' | 'graphics' | 'poses' | 'physics' | 'sculpt' | 'hdr' | 'settings' | 'wardrobe';

export type PoseCategory = 'IDLE' | 'ACTION' | 'EXPRESSIONS' | 'FAVORITES';

/** Colour grade presets. Implemented in `GradeEffect`, not a LUT texture. */
export type FilterPreset = 'vanilla' | 'dramatic' | 'cinematic' | 'fantasy';

/** Display transform applied after the linear composer.
 *
 *  `neutral` is Khronos PBR Neutral: hue-preserving and highlight-soft rather
 *  than filmic, which is the right default for a character creator where the
 *  skin tone the user picked has to survive to the screen. The others are the
 *  looks postprocessing ships; they are picked, not invented. */
export type ToneMappingId = 'neutral' | 'agx' | 'aces' | 'cineon';

const TONE_MAPPING_IDS: readonly ToneMappingId[] = ['neutral', 'agx', 'aces', 'cineon'];

/** One tinted luminance band. `amount` is signed −100..100. */
export interface ColorOverlay {
  color: string;
  amount: number;
  enabled: boolean;
}

export interface GradeSettings {
  /** −100..100, pivot at 0. */
  contrast: number;
  /** −100..100, pivot at 0. */
  saturation: number;
  /** −10..10 mockup points; scaled onto the ambient light's intensity. */
  ambient: number;
  filter: FilterPreset;
  overlays: [ColorOverlay, ColorOverlay, ColorOverlay];
}

export interface UtilityToggles {
  camPreset: boolean;
  beautyAlbum: boolean;
  poseEdit: boolean;
  viewOutfit: boolean;
  cameraFocus: boolean;
  historyRevert: boolean;
}

export interface GizmoPose {
  /** Offset from the bone's bind position, in head-local metres. */
  offset: [number, number, number];
  /** Euler rotation in radians. */
  rotation: [number, number, number];
  /** Uniform-ish scale deltas. */
  scale: [number, number, number];
}

const identityPose = (): GizmoPose => ({
  offset: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [0, 0, 0],
});

/** A blend mode the compositor implements, or undefined for an unknown one. */
function coerceBlend(v: unknown): OverlayBlend | undefined {
  return typeof v === 'string' && (OVERLAY_BLENDS as readonly string[]).includes(v)
    ? (v as OverlayBlend)
    : undefined;
}

/** A finite 0–1 coverage, or undefined when the value cannot be trusted. */
function coerceCoverage(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(1, Math.max(0, v))
    : undefined;
}

/** Every region keeps its own slider bank so switching tabs is lossless. */
const buildSliderBank = (): Record<RegionId, SliderValues> =>
  Object.fromEntries(REGIONS.map((r) => [r.id, { ...r.defaults }])) as Record<
    RegionId,
    SliderValues
  >;

const buildPoseBank = (): Record<RegionId, GizmoPose> =>
  Object.fromEntries(REGIONS.map((r) => [r.id, identityPose()])) as Record<
    RegionId,
    GizmoPose
  >;

export type BodyTab = 'gear' | 'physique';

/**
 * The face-only slice a face-history entry stores.
 *
 * Deliberately narrower than the character: hair, equipment, lighting, camera
 * and every asset pick are excluded, so undoing a nose slider can never revert
 * a hairstyle the user changed in between. `anatomyMode` rides along because
 * the advanced bank only deforms the face when that mode is `advanced`.
 */
export interface FaceSnapshot extends AnatomySnapshot {
  sliders: Record<RegionId, SliderValues>;
  poses: Record<RegionId, GizmoPose>;
  anatomyMode: AnatomyMode;
}

export interface CharacterState extends AnatomySnapshot {
  anatomyMode: AnatomyMode;
  anatomyPast: AnatomySnapshot[];
  anatomyFuture: AnatomySnapshot[];
  anatomyEditStart: AnatomySnapshot | null;
  setAnatomyMode: (mode: AnatomyMode) => void;
  beginAnatomyEdit: () => void;
  endAnatomyEdit: () => void;
  /** Face history: sliders, poses, anatomy and mode — never hair or gear. */
  facePast: FaceSnapshot[];
  faceFuture: FaceSnapshot[];
  /** Snapshot taken when a drag transaction opens; null when closed. */
  faceEditStart: FaceSnapshot | null;
  /** While non-null, hold-compare is showing the baseline and this holds the
   *  live edited face that ends the hold. Transient; never persisted. */
  faceCompareStart: FaceSnapshot | null;
  /** The face hold-compare returns to. Transient; never persisted. */
  faceBaseline: FaceSnapshot | null;
  beginFaceEdit: () => void;
  endFaceEdit: () => void;
  undoFace: () => void;
  redoFace: () => void;
  /** Resets the active region's sliders and pose as one history entry. */
  resetFaceRegion: () => void;
  beginFaceCompare: () => void;
  endFaceCompare: () => void;
  /** Re-anchors the compare baseline to the live edited face, without
   *  changing what is on screen. */
  applyFaceBaseline: () => void;
  setAnatomy: (id: AnatomyParamId, value: number) => void;
  setBodyAnatomyBatch: (patch: Record<string, number>) => void;
  setAnatomyAsymmetry: (id: AnatomyParamId, value: number) => void;
  setAnatomyColor: (id: AnatomyColorId, value: string) => void;
  applyAnatomyPreset: (id: string) => void;
  resetAnatomyGroup: (group: AnatomyGroupId) => void;
  undoAnatomy: () => void;
  redoAnatomy: () => void;
  hair: HairSettings;
  hairTab: HairTab;
  /** Which screen the Hair/Makeup workspace shows. `smart` is the Smart
   *  Customization studio screen, deliberately not persisted — restoring into
   *  it would surprise someone who left the app on a hairstyle list. */
  studioPage: StudioPage;
  setStudioPage: (page: StudioPage) => void;
  setHair: (patch: Partial<HairSettings>) => void;
  applyHairStyle: (id: string) => void;
  setHairTab: (tab: HairTab) => void;
  bodyTab: BodyTab;
  setBodyTab: (tab: BodyTab) => void;
  name: string;
  stats: { faces: number; verts: number; tris: number };
  activeRegion: RegionId;
  primaryTab: string;
  subTab: string;
  transformMode: TransformMode;
  bisymmetry: boolean;
  asymmetry: boolean;
  /** The cyan vertex net over the face. Off hides every overlay line + anchor. */
  showMesh: boolean;
  /** Whether the authored outfit's garment shapes draw; its embedded body
   *  stays visible regardless. On by default — the pack ships one valid outfit. */
  garmentVisible: boolean;
  setGarmentVisible: (v: boolean) => void;
  /** Which body preset the pack skeleton is posed to. `rest` is the bind pose,
   *  so the viewport is never stuck in a pose the user did not ask for. */
  bodyPoseId: string;
  setBodyPose: (id: string) => void;
  /** Multiplier for pose rotations [0..1.5], where 0 = neutral rest and 1 = full pose. */
  poseIntensity: number;
  setPoseIntensity: (v: number) => void;
  /** Speed multiplier for pose transitions and physical motions [0.2..2.0]. */
  animationSpeed: number;
  setAnimationSpeed: (v: number) => void;
  animationId: 'idle' | 'rest';
  setAnimationId: (id: 'idle' | 'rest') => void;
  animationPlaying: boolean;
  setAnimationPlaying: (v: boolean) => void;
  autoRigUnskinned: boolean;
  setAutoRigUnskinned: (v: boolean) => void;
  /** Active category tab in the Poses panel. */
  poseCategory: PoseCategory;
  setPoseCategory: (cat: PoseCategory) => void;
  /** IDs of favorited poses. */
  favoritePoses: string[];
  toggleFavoritePose: (id: string) => void;
  /**
   * Body weight, 0–1, live.
   *
   * Skyrim stores a body twice — `femalebody_0.nif` and `femalebody_1.nif` —
   * over one atlas, and lerps between them as the weight slider moves. This is
   * the same value divided by 100; a `.jslot`'s `actor.weight` is an integer in
   * that range, so an imported preset lands where it was authored.
   */
  weight: number;
  setWeight: (v: number) => void;
  /** Whether facial fullness and neck perimeter morph dynamically with body weight (Creation Engine FaceGen parity). */
  linkFaceToWeight: boolean;
  setLinkFaceToWeight: (link: boolean) => void;
  /** CBPC-style soft body spring physics enabled for breasts, butt, and belly. */
  bodyPhysicsEnabled: boolean;
  setBodyPhysicsEnabled: (v: boolean) => void;
  /** Soft-body bounciness factor [0..1] where 0 = firm/tight, 1 = soft/bouncy. */
  bodyPhysicsBounciness: number;
  setBodyPhysicsBounciness: (v: number) => void;
  /** CBPC analytical sphere-push collisions preventing hands/arms from clipping soft body. */
  bodyCollisionsEnabled: boolean;
  setBodyCollisionsEnabled: (v: boolean) => void;
  /** Impulse nonce bumped by "Jiggle Test" button to trigger a dynamic bounce. */
  physicsImpulseNonce: number;
  triggerPhysicsImpulse: () => void;
  /** Universal secondary spring physics enabled (Hair, Outfits, Accessories). */
  secondaryPhysicsEnabled: boolean;
  setSecondaryPhysicsEnabled: (v: boolean) => void;
  /** Hair-specific secondary physics enabled. */
  hairPhysicsEnabled: boolean;
  setHairPhysicsEnabled: (v: boolean) => void;
  /** Clothing / outfit-specific secondary physics enabled. */
  clothPhysicsEnabled: boolean;
  setClothPhysicsEnabled: (v: boolean) => void;
  /** Secondary physics stiffness factor [0..1] (0 = soft/flowy, 1 = stiff/controlled). */
  secondaryStiffness: number;
  setSecondaryStiffness: (v: number) => void;
  /** Secondary physics damping / drag factor [0..1]. */
  secondaryDamping: number;
  setSecondaryDamping: (v: number) => void;
  /** Secondary physics wind / ambient breeze factor [0..1]. */
  secondaryWindIntensity: number;
  setSecondaryWindIntensity: (v: number) => void;
  /** Impulse nonce bumped by "Test Secondary Dynamics" button. */
  secondaryImpulseNonce: number;
  triggerSecondaryImpulse: () => void;
  /** Active asset source identity, so a source switch can drop stale picks. */
  assetSourceId: string | null;
  setAssetSource: (id: string | null) => void;
  /**
   * Whether this document has been given a chance to restore a saved session.
   *
   * False until `rehydrate()` has settled (or immediately, when there is no
   * stored session). The startup `Default.jslot` load waits on it: applying
   * the default before the answer arrives would overwrite the restored face on
   * every reload, which is the whole bug this feature exists to fix.
   */
  hydrated: boolean;
  /** True when hydration actually found a saved session to restore. */
  restored: boolean;
  /** Per-load marker so the startup preset is applied at most once. */
  defaultOpened: boolean;
  markHydrated: (restored: boolean) => void;
  markDefaultOpened: () => void;
  /** The ENB/ReShade combination the panel remembers while the stack is off. */
  enbPreset: EnbPreset;
  /** Whether the ENB/ReShade pass draws at all. */
  enbEnabled: boolean;
  /** Per-effect switches for the composer's screen-space passes. */
  fx: { smaa: boolean; bloom: boolean; dof: boolean; vignette: boolean; grain: boolean };
  /** Contrast, saturation, ambient and the colour overlays. */
  grade: GradeSettings;
  /** Active procedural HDR environment lighting preset */
  envMode: EnvMode;
  /** Environment rotation around Y axis in degrees [0, 360) */
  envRotation: number;
  envIntensity: number;
  exposure: number;
  setExposure: (value: number) => void;
  /** Active 3D stage and background mode */
  backgroundMode: BackgroundMode;
  /** Custom GLB URL when backgroundMode is 'custom-3d' */
  customBackgroundUrl: string | null;
  setBackgroundMode: (mode: BackgroundMode) => void;
  setCustomBackgroundUrl: (url: string | null) => void;
  lighting: LightingSettings;
  cameraRotateSpeed: number;
  setLighting: (patch: Partial<LightingSettings>) => void;
  setEnvIntensity: (value: number) => void;
  setCameraRotateSpeed: (value: number) => void;
  /** Skin glossiness / specular sheen level [0.0 = matte, 1.0 = oiled/wet] */
  skinGloss: number;
  /** SSS strength multiplier on top of the gloss-derived parameters [0..1].
   *  1 reproduces the gloss-only mapping this app has always used. */
  skinSss: number;
  /** Additional synthetic pore detail [0..1]; 0 retains authored normals only. */
  skinDetail: number;
  /** Specular sheen strength [0..1]. Independent of `skinGloss`, which drives
   *  roughness: this is the broad fabric-like highlight on top of it. */
  skinSheen: number;
  /** Normal map depth/scale multiplier [0.0 = flat/off, 1.0 = standard, 2.5 = punchy depth]. */
  skinNormalStrength: number;
  setSkinNormalStrength: (v: number) => void;
  /** Skin tone color tint `#rrggbb`. '#ffffff' = untinted raw diffuse. */
  skinColor: string;
  /** Eyebrow tint `#rrggbb`. Default '#2B1A0A' matching Skyrim creation studio. */
  browColor: string;
  setBrowColor: (c: string) => void;
  /** Whether eyebrow color synchronizes with hair color by default (Skyrim RaceMenu parity). */
  linkBrowToHair: boolean;
  setLinkBrowToHair: (link: boolean) => void;
  /** Whether the scalp cap and hairline underlay are visible (default: true). */
  showScalp: boolean;
  setShowScalp: (showScalp: boolean) => void;
  /** Eyebrow opacity [0..1]. Default 1.0 (100%). */
  browOpacity: number;
  setBrowOpacity: (v: number) => void;
  /** Eyebrow specular gloss [0..1]. Default 0.15 (15%). */
  browGloss: number;
  setBrowGloss: (v: number) => void;
  /** Eyebrow glossiness sharpness [0..1]. Default 0.15 (15%). */
  browGlossy: number;
  setBrowGlossy: (v: number) => void;
  /** Eyelash tint `#rrggbb`. Default '#1a1412' matching the lash material. */
  lashesColor: string;
  setLashesColor: (c: string) => void;
  /** Eyelash opacity [0..1]. Default 1.0 (100%). */
  lashesOpacity: number;
  setLashesOpacity: (v: number) => void;
  /** Favorited brow IDs. */
  favoriteBrows: string[];
  toggleFavoriteBrow: (id: string) => void;
  /** Display transform applied after the linear composer. */
  toneMapping: ToneMappingId;
  /** Whether the graphics workspace is the active left dock panel. */
  graphicsOpen: boolean;
  /** Whether the camera workspace is the active left dock panel. */
  cameraOpen: boolean;
  /** Active left workspace. All four panels stay mounted behind it. */
  workspace: Workspace;
  /** HUD-hidden preview: every chrome panel disappears, the gutter stays. */
  previewMode: boolean;

  sliders: Record<RegionId, SliderValues>;
  poses: Record<RegionId, GizmoPose>;
  preset: string;
  utils: UtilityToggles;
  /** Chosen MO2 asset per category. Missing = the manifest's own default. */
  assetSelection: AssetSelection;
  assetCatalogues: AssetCatalogues;
  /**
   * Worn garments, one `clothingMesh` id per equipment slot.
   *
   * Separate from `assetSelection` because that map holds one id per *kind*
   * and the paper-doll wears several garments of the same kind at once. The
   * whole-body outfit keeps using `assetSelection.clothingMesh` — it is the
   * OUTFIT slot and predates this map.
   */
  equipment: EquipSelection;
  /** Which slot the EQUIPMENT picker is filling. */
  equipSlot: EquipSlot;
  setEquipSlot: (slot: EquipSlot) => void;
  /** `null` clears the slot; the store drops the key rather than storing null. */
  setEquip: (patch: Partial<Record<EquipSlot, string | null>>) => void;
  panelMode: 'mesh' | 'texture';
  setPanelMode: (mode: 'mesh' | 'texture') => void;
  setAssets: (patch: Partial<Record<AssetKind, string | null>>) => void;
  setAssetCatalogue: (kind: AssetKind, entries: CatalogueEntry[]) => void;
  /** Which category the asset panel lists. Set by the HUD's sub-tabs. */
  activeCategory: ActiveCategory;
  /** Makeup / tattoo layers, in draw order. */
  overlayLayers: OverlayLayer[];
  /**
   * `kind:id` of the overlay the makeup panel is editing, or null. UI-only —
   * never written to a preset and never persisted with the session.
   */
  activeOverlay: string | null;
  /** Set while the user is dragging a slider so the gizmo yields to it. */
  activeSlider: SliderId | null;
  /** Bumped whenever a preset is applied, to retrigger camera framing. */
  presetNonce: number;
  /** Camera vertical field-of-view in degrees [15..60]. Default 27. */
  cameraFov: number;
  /** Derived framing height; never persisted. */
  characterHeight: number;
  /** Active camera framing: auto, or locked to face / bust / body. */
  cameraFraming: CameraFraming;
  /** Nonce request for programmatic camera angle / framing transitions. */
  cameraPoseRequest: CameraPoseRequest | null;
  /** When true, slot naming restrictions are ignored so any clothing or accessory can be equipped into any slot. */
  unrestrictedSlots: boolean;
  setUnrestrictedSlots: (val: boolean) => void;
  toggleUnrestrictedSlots: () => void;
  /** When true, static _GND.nif meshes are included in the equipment list. */
  showGroundMeshes: boolean;
  setShowGroundMeshes: (val: boolean) => void;

  setActiveRegion: (id: RegionId) => void;
  setPrimaryTab: (t: string) => void;
  setSubTab: (t: string) => void;
  setTransformMode: (m: TransformMode) => void;
  setBisymmetry: (v: boolean) => void;
  setAsymmetry: (v: boolean) => void;
  setShowMesh: (v: boolean) => void;
  setEnbPreset: (preset: EnbPreset) => void;
  setEnbEnabled: (enabled: boolean) => void;
  /** Flips one composer effect on or off. */
  toggleFx: (key: keyof CharacterState['fx']) => void;
  /** Patches the grade, leaving the overlay rows alone. */
  setGrade: (patch: Partial<Omit<GradeSettings, 'overlays'>>) => void;
  setOverlay: (index: 0 | 1 | 2, patch: Partial<ColorOverlay>) => void;
  setEnvMode: (mode: EnvMode) => void;
  setEnvRotation: (rotation: number) => void;
  setSkinGloss: (v: number) => void;
  setSkinSss: (v: number) => void;
  setSkinDetail: (v: number) => void;
  setSkinSheen: (v: number) => void;
  setSkinColor: (v: string) => void;
  /** Unknown tone-mapping ids are ignored rather than stored. */
  setToneMapping: (id: ToneMappingId) => void;
  setGraphicsOpen: (open: boolean) => void;
  setCameraOpen: (open: boolean) => void;
  setWorkspace: (workspace: Workspace) => void;
  setPreviewMode: (preview: boolean) => void;
  setSlider: (id: SliderId, value: number) => void;
  setActiveSlider: (id: SliderId | null) => void;
  setPose: (patch: Partial<GizmoPose>) => void;
  applyPreset: (id: string) => void;
  toggleUtil: (key: keyof UtilityToggles) => void;
  /** Picks one option of a category; `null` clears back to the default. */
  setAsset: (kind: AssetKind, id: string | null) => void;
  setActiveCategory: (c: ActiveCategory) => void;
  /** Adds a layer, or replaces the one already using that kind + id. */
  toggleOverlay: (layer: OverlayLayer) => void;
  setOverlayOpacity: (kind: AssetKind, id: string, opacity: number) => void;
  setOverlayColor: (kind: AssetKind, id: string, color: string) => void;
  /** Sets how the layer combines with the atlas; unknown modes are ignored. */
  setOverlayBlend: (kind: AssetKind, id: string, blend: OverlayBlend) => void;
  /** Sets mask coverage 0–1 (clamped; non-finite input is ignored). */
  setOverlayCoverage: (kind: AssetKind, id: string, coverage: number) => void;
  setActiveOverlay: (key: string | null) => void;
  clearOverlays: (kind?: AssetKind) => void;
  setOverlayLayers: (layers: OverlayLayer[]) => void;
  setName: (n: string) => void;
  resetRegion: () => void;
  /** Replaces every region's bank with a parsed preset. */
  loadPreset: (payload: PresetPayload, sculptHeadId?: string) => void;
  /** Everything the exporter needs to write a preset file. */
  snapshotPreset: () => PresetFile;
  setCameraFov: (fov: number) => void;
  setCameraFraming: (framing: CameraFraming) => void;
  triggerCameraPose: (pose: Omit<CameraPoseRequest, 'nonce'>) => void;
  resetCameraView: () => void;
  toast: string | null;
  showToast: (msg: string) => void;
}

/**
 * The live character, persisted across reloads.
 *
 * `persist` writes a *slice* (`lib/session.ts` → `pickSession`) to
 * `localStorage` after every `set`, so an F5 lands back on the face the user
 * was building instead of the startup default. Two details are load-bearing:
 *
 * - `skipHydration: true`. The store module is imported while rendering on the
 *   server, where there is no `localStorage`; hydrating in the initializer
 *   would either mismatch the server HTML or, worse, make the first client
 *   render disagree with it. `CharacterCreation` calls `rehydrate()` from an
 *   effect instead — after mount, once, with a real storage.
 * - `merge` coerces instead of spreading. What comes back from storage is
 *   arbitrary JSON; see `coerceSession`.
 */
function anatomySnapshot(s: AnatomySnapshot): AnatomySnapshot {
  return { anatomy: { ...s.anatomy }, anatomyAsymmetry: { ...s.anatomyAsymmetry }, anatomyColors: { ...s.anatomyColors } };
}

/** Same number under the old serialized compare: `NaN` serialized as `null`,
 *  so two NaNs read as equal there and still do. Everything else is `===`
 *  (`-0 === 0` stays true, as the JSON form had it). */
const sameNumber = (a: number | undefined, b: number | undefined) =>
  a === b || (a !== a && b !== b);

/* The three anatomy banks are closed vocabularies (`ANATOMY_PARAMS`,
   `ANATOMY_COLOR_DEFS`), so comparing the fixed key sets is both exact and
   allocation-free — unlike a `JSON.stringify` of two whole snapshots, which
   this used to do on every slider event. An absent asymmetry key still
   compares unequal to an explicit `0`, matching the old serialized form. */
function anatomyDiffers(current: AnatomySnapshot, next: Partial<AnatomySnapshot>): boolean {
  if (next.anatomy) {
    for (const p of ANATOMY_PARAMS) if (!sameNumber(current.anatomy[p.id], next.anatomy[p.id])) return true;
  }
  if (next.anatomyAsymmetry) {
    for (const p of ANATOMY_PARAMS) {
      if (p.bilateral && !sameNumber(current.anatomyAsymmetry[p.id], next.anatomyAsymmetry[p.id])) return true;
    }
  }
  if (next.anatomyColors) {
    for (const p of ANATOMY_COLOR_DEFS) if (current.anatomyColors[p.id] !== next.anatomyColors[p.id]) return true;
  }
  return false;
}

function anatomyPatch(s: CharacterState, patch: Partial<AnatomySnapshot>): Partial<CharacterState> {
  if (!anatomyDiffers(s, patch)) return {};
  return { ...patch, anatomyFuture: [],
    anatomyPast: s.anatomyEditStart ? s.anatomyPast : [...s.anatomyPast, anatomySnapshot(s)].slice(-30) };
}

/* ── face history ─────────────────────────────────────────────────────────
   A second, wider history than `anatomyPast`: one entry is everything that
   changes the face — both slider banks, gizmo poses, the advanced anatomy
   values and the mode that makes them deform. Hair, equipment, lighting and
   camera state are deliberately absent, so undoing a nose edit cannot revert
   a wardrobe change made after it. */
const FACE_HISTORY_LIMIT = 50;

function clonePose(p: GizmoPose): GizmoPose {
  return { offset: [...p.offset], rotation: [...p.rotation], scale: [...p.scale] };
}

function cloneSliderBank(bank: Record<RegionId, SliderValues>): Record<RegionId, SliderValues> {
  return Object.fromEntries(REGIONS.map((r) => [r.id, { ...bank[r.id] }])) as Record<RegionId, SliderValues>;
}

function clonePoseBank(bank: Record<RegionId, GizmoPose>): Record<RegionId, GizmoPose> {
  return Object.fromEntries(REGIONS.map((r) => [r.id, clonePose(bank[r.id])])) as Record<RegionId, GizmoPose>;
}

function faceSnapshot(s: CharacterState): FaceSnapshot {
  return {
    ...anatomySnapshot(s),
    sliders: cloneSliderBank(s.sliders),
    poses: clonePoseBank(s.poses),
    anatomyMode: s.anatomyMode,
  };
}

/* Structural compares against the fixed banks — no clones, no `JSON.stringify`.
   Used both by `faceHistory` (is this patch a no-op?) and by `commitEdit`
   (did the closed transaction change the face at all?). */
function sliderBankDiffers(
  current: Record<RegionId, SliderValues>,
  previous: Record<RegionId, SliderValues>,
): boolean {
  for (const region of REGIONS) {
    const a = current[region.id];
    const b = previous[region.id];
    if (a === b) continue;
    for (const id in SLIDERS_BY_ID) {
      if (!sameNumber(a[id as SliderId], b[id as SliderId])) return true;
    }
  }
  return false;
}

function poseDiffers(a: GizmoPose, b: GizmoPose): boolean {
  for (let i = 0; i < 3; i++) {
    if (!sameNumber(a.offset[i], b.offset[i])) return true;
    if (!sameNumber(a.rotation[i], b.rotation[i])) return true;
    if (!sameNumber(a.scale[i], b.scale[i])) return true;
  }
  return false;
}

function poseBankDiffers(
  current: Record<RegionId, GizmoPose>,
  previous: Record<RegionId, GizmoPose>,
): boolean {
  for (const region of REGIONS) {
    const a = current[region.id];
    const b = previous[region.id];
    if (a !== b && poseDiffers(a, b)) return true;
  }
  return false;
}

function faceSnapshotDiffers(s: CharacterState, previous: FaceSnapshot): boolean {
  return s.anatomyMode !== previous.anatomyMode
    || anatomyDiffers(s, previous)
    || sliderBankDiffers(s.sliders, previous.sliders)
    || poseBankDiffers(s.poses, previous.poses);
}

/** Whether applying `patch` would move any face field. Only the banks the
 *  patch actually carries are inspected, so a slider move never walks — let
 *  alone serializes — the other regions' banks or the anatomy dictionaries. */
function facePatchDiffers(s: CharacterState, patch: Partial<CharacterState>): boolean {
  if (patch.anatomyMode !== undefined && patch.anatomyMode !== s.anatomyMode) return true;
  if (patch.sliders) {
    for (const region of REGIONS) {
      const next = patch.sliders[region.id];
      /* A patch that omits a region leaves it alone. */
      if (!next) continue;
      const current = s.sliders[region.id];
      if (next === current) continue;
      for (const id in SLIDERS_BY_ID) {
        if (!sameNumber(next[id as SliderId], current[id as SliderId])) return true;
      }
    }
  }
  if (patch.poses) {
    for (const region of REGIONS) {
      const next = patch.poses[region.id];
      if (!next) continue;
      const current = s.poses[region.id];
      if (next !== current && poseDiffers(next, current)) return true;
    }
  }
  return anatomyDiffers(s, patch);
}

/** The live-store partial that puts a stored face back on screen. */
function faceRestore(snap: FaceSnapshot): Partial<CharacterState> {
  return {
    ...anatomySnapshot(snap),
    sliders: cloneSliderBank(snap.sliders),
    poses: clonePoseBank(snap.poses),
    anatomyMode: snap.anatomyMode,
  };
}

/**
 * Wrap a face-changing patch with history bookkeeping.
 *
 * - While hold-compare is up the live face is the baseline, so every write is
 *   ignored: the release must restore exactly the pre-hold edit.
 * - A write that changes nothing adds nothing (sliders fire per pointer move).
 * - Inside `beginFaceEdit`/`endFaceEdit` the whole drag is one entry: the
 *   snapshot is taken on the first `begin`, not on every intermediate value.
 */
function faceHistory(s: CharacterState, patch: Partial<CharacterState>): Partial<CharacterState> {
  if (s.faceCompareStart) return {};
  /* Decide on the patch's own fields. Cloning the two full face snapshots only
     to throw them away on a no-op was most of a pointer move's allocation. */
  if (!facePatchDiffers(s, patch)) return {};
  /* Any open transaction — including one the advanced panel opened on its own
     via `beginAnatomyEdit` — takes one entry for the whole drag. */
  const inTransaction = Boolean(s.faceEditStart || s.anatomyEditStart);
  return {
    ...patch,
    /* The first edit anchors the compare baseline to the face as it was
       before that edit; otherwise hold-compare would always show the value
       the user is already looking at. Inside a transaction `s` is still the
       pre-drag face, so this is the same snapshot the open entry holds. */
    ...(s.faceBaseline ? {} : { faceBaseline: faceSnapshot(s) }),
    faceFuture: [],
    facePast: inTransaction ? s.facePast : [...s.facePast, faceSnapshot(s)].slice(-FACE_HISTORY_LIMIT),
  };
}

/** An anatomy write: recorded in the advanced (`anatomyPast`) history *and*
 *  in the face history, and ignored entirely while hold-compare is up. */
function faceAnatomyPatch(s: CharacterState, patch: Partial<AnatomySnapshot>): Partial<CharacterState> {
  if (!Object.keys(patch).length) return {};
  const anatomy = anatomyPatch(s, patch);
  return Object.keys(anatomy).length ? faceHistory(s, anatomy) : {};
}

/**
 * Close whatever transaction is open and write one entry per stack.
 *
 * The face and advanced histories share the drag: `beginFaceEdit` and
 * `beginAnatomyEdit` open both markers, so a control column drag that drives
 * both slider banks and `setAnatomy` still produces exactly one entry in each.
 */
function commitEdit(s: CharacterState): Partial<CharacterState> {
  const faceStart = s.faceEditStart;
  const anatomyStart = s.anatomyEditStart;
  if (!faceStart && !anatomyStart) return {};
  const anatomyChanged = anatomyStart ? anatomyDiffers(s, anatomyStart) : false;
  const faceChanged = faceStart ? faceSnapshotDiffers(s, faceStart) : anatomyChanged;
  return {
    faceEditStart: null,
    anatomyEditStart: null,
    ...(faceChanged && faceStart
      ? { facePast: [...s.facePast, faceStart].slice(-FACE_HISTORY_LIMIT), faceFuture: [] } : {}),
    ...(anatomyChanged && anatomyStart
      ? { anatomyPast: [...s.anatomyPast, anatomyStart].slice(-30) } : {}),
  };
}

/**
 * Keep the advanced stack aligned when a face step moves the anatomy.
 *
 * The advanced controls write to both stacks; a face step that restores an
 * older anatomy block must pop `anatomyPast` with it, or the panel's own undo
 * would later re-apply a value this call already left behind. A step that did
 * not touch anatomy (a slider drag) leaves the advanced stack alone.
 */
function anatomyStep(s: CharacterState, snap: FaceSnapshot, direction: 'undo' | 'redo'): Partial<CharacterState> {
  if (!anatomyDiffers(s, snap)) return {};
  return direction === 'undo'
    ? { anatomyPast: s.anatomyPast.slice(0, -1),
        anatomyFuture: [...s.anatomyFuture, anatomySnapshot(s)].slice(-30) }
    : { anatomyFuture: s.anatomyFuture.slice(0, -1),
        anatomyPast: [...s.anatomyPast, anatomySnapshot(s)].slice(-30) };
}

/** A different head target invalidates every stored face: drop both histories
 *  and the compare baseline rather than let undo cross onto another mesh. */
function faceRebase(): Pick<CharacterState,
  'facePast' | 'faceFuture' | 'faceEditStart' | 'faceCompareStart' | 'faceBaseline'> {
  return { facePast: [], faceFuture: [], faceEditStart: null, faceCompareStart: null, faceBaseline: null };
}

/** The face being built. While compare is held the live fields contain the
 *  baseline, so saving/exporting must read the edited copy kept in
 *  `faceCompareStart` instead. */
function liveFaceState(s: CharacterState): CharacterState {
  return s.faceCompareStart ? ({ ...s, ...faceRestore(s.faceCompareStart) } as CharacterState) : s;
}

export const useCharacter = create<CharacterState>()(persist((set, get) => ({
  anatomy: coerceAnatomy(),
  anatomyAsymmetry: coerceAsymmetry(),
  anatomyColors: coerceAnatomyColors(),
  anatomyMode: 'legacy',
  anatomyPast: [], anatomyFuture: [], anatomyEditStart: null,
  facePast: [], faceFuture: [], faceEditStart: null,
  faceCompareStart: null, faceBaseline: null,
  /* One transaction, two stacks. A control column drag may write both slider
     banks and advanced anatomy before it ends, so both markers open together
     and `commitEdit` closes them into exactly one entry per stack. */
  beginFaceEdit: () => set(s => s.faceCompareStart || s.faceEditStart ? {} : {
    faceEditStart: faceSnapshot(s),
    ...(s.anatomyEditStart ? {} : { anatomyEditStart: anatomySnapshot(s) }),
  }),
  endFaceEdit: () => set(s => commitEdit(s)),
  /* These walk the wider face history, which also holds anatomy values, so
     they undo both a slider drag and an advanced-control edit. */
  undoFace: () => { get().endFaceEdit(); set(s => {
    if (s.faceCompareStart) return {};
    const previous = s.facePast.at(-1);
    return previous ? { ...faceRestore(previous), facePast: s.facePast.slice(0, -1),
      faceFuture: [...s.faceFuture, faceSnapshot(s)].slice(-FACE_HISTORY_LIMIT),
      ...anatomyStep(s, previous, 'undo') } : {};
  }); },
  redoFace: () => { get().endFaceEdit(); set(s => {
    if (s.faceCompareStart) return {};
    const next = s.faceFuture.at(-1);
    return next ? { ...faceRestore(next), faceFuture: s.faceFuture.slice(0, -1),
      facePast: [...s.facePast, faceSnapshot(s)].slice(-FACE_HISTORY_LIMIT),
      ...anatomyStep(s, next, 'redo') } : {};
  }); },
  resetFaceRegion: () => {
    get().endFaceEdit();
    set(s => {
      if (s.faceCompareStart) return {};
      const region = s.activeRegion;
      return faceHistory(s, {
        sliders: { ...s.sliders, [region]: { ...REGIONS_BY_ID[region].defaults } },
        poses: { ...s.poses, [region]: identityPose() },
      });
    });
  },
  /* Hold-compare swaps the live face for the baseline and banks the edited
     face; the second call (button release) puts it back. Re-entering while
     held is a no-op, so a repeated pointerdown cannot overwrite the bank. */
  beginFaceCompare: () => set(s => {
    if (s.faceCompareStart) return {};
    /* The first hold anchors on the face as it is now; later holds reuse the
       baseline an `applyFaceBaseline` re-anchored. */
    const baseline = s.faceBaseline ?? faceSnapshot(s);
    return { faceCompareStart: faceSnapshot(s), faceBaseline: baseline, ...faceRestore(baseline) };
  }),
  endFaceCompare: () => set(s => s.faceCompareStart
    ? { ...faceRestore(s.faceCompareStart), faceCompareStart: null }
    : {}),
  applyFaceBaseline: () => set(s =>
    s.faceCompareStart
      /* Mid-hold: the live fields are the baseline, so re-anchor from the
         banked edited face without touching what is on screen. */
      ? { faceBaseline: faceSnapshot({ ...s, ...faceRestore(s.faceCompareStart) } as CharacterState) }
      : { faceBaseline: faceSnapshot(s) }),
  setAnatomyMode: (mode) => { get().endAnatomyEdit(); set(s => {
    const next: AnatomyMode = mode === 'advanced' ? 'advanced' : 'legacy';
    /* The mode changes which face is on screen, so it belongs in face history. */
    return s.anatomyMode === next ? {} : faceHistory(s, { anatomyMode: next });
  }); },
  /* The advanced panel opens this on its own; it participates in the same
     face history, so its drags batched and undone through `undoFace` too. */
  beginAnatomyEdit: () => set(s => s.faceCompareStart || s.anatomyEditStart ? {} : {
    anatomyEditStart: anatomySnapshot(s),
    ...(s.faceEditStart ? {} : { faceEditStart: faceSnapshot(s) }),
  }),
  endAnatomyEdit: () => set(s => commitEdit(s)),
  setAnatomy: (id, value) => {
    if (Object.hasOwn(LEGACY_SILHOUETTE_MAPPING, id) && Number.isFinite(value)) {
      useBodySlideStore.getState().setSlider(LEGACY_SILHOUETTE_MAPPING[id], value);
    }
    set(s => !Object.hasOwn(ANATOMY_BY_ID, id) || !Number.isFinite(value) ? {} :
      faceAnatomyPatch(s, { anatomy: coerceAnatomy({ ...s.anatomy, [id]: value }) }));
  },
  setBodyAnatomyBatch: (patch) => set(s => {
    const next = { ...s.anatomy };
    for (const [k, v] of Object.entries(patch)) {
      if (Object.hasOwn(ANATOMY_BY_ID, k) && ANATOMY_BY_ID[k as AnatomyParamId].group === 'body' && Number.isFinite(v)) {
        next[k as AnatomyParamId] = v;
      }
    }
    return { anatomy: coerceAnatomy(next) };
  }),
  setAnatomyAsymmetry: (id, value) => set(s => !Object.hasOwn(ANATOMY_BY_ID, id) || !ANATOMY_BY_ID[id].bilateral || !Number.isFinite(value) ? {} :
    faceAnatomyPatch(s, { anatomyAsymmetry: coerceAsymmetry({ ...s.anatomyAsymmetry, [id]: value }) })),
  setAnatomyColor: (id, value) => set(s => !ANATOMY_COLOR_DEFS.some(p => p.id === id) || !/^#[0-9a-f]{6}$/i.test(value) ? {} :
    faceAnatomyPatch(s, { anatomyColors: coerceAnatomyColors({ ...s.anatomyColors, [id]: value }) })),
  applyAnatomyPreset: (id) => {
    get().endAnatomyEdit();
    const preset = ANATOMY_PRESETS.find(p => p.id === id);
    if (preset && Object.keys(preset.values).length) set(s => faceAnatomyPatch(s, {
      anatomy: applyPresetValues(s.anatomy, preset.group, preset.values),
    }));
  },
  resetAnatomyGroup: (group) => {
    get().endAnatomyEdit();
    set(s => {
      const anatomy = { ...s.anatomy }, anatomyAsymmetry = { ...s.anatomyAsymmetry }, anatomyColors = { ...s.anatomyColors };
      for (const p of ANATOMY_PARAMS) if (p.group === group) { anatomy[p.id] = p.default; if (p.bilateral) anatomyAsymmetry[p.id] = 0; }
      for (const p of ANATOMY_COLOR_DEFS) if (p.group === group) anatomyColors[p.id] = p.default;
      return faceAnatomyPatch(s, { anatomy, anatomyAsymmetry, anatomyColors });
    });
  },
  /* These walk only the advanced slice, exactly as they did before the face
     history existed. A face step that moves anatomy keeps this stack aligned
     via `anatomyStep`, so the two can never disagree about the live face. */
  undoAnatomy: () => { get().endAnatomyEdit(); set(s => {
    if (s.faceCompareStart) return {};
    const previous = s.anatomyPast.at(-1);
    return previous ? { ...anatomySnapshot(previous), anatomyPast: s.anatomyPast.slice(0, -1),
      anatomyFuture: [...s.anatomyFuture, anatomySnapshot(s)].slice(-30) } : {};
  }); },
  redoAnatomy: () => { get().endAnatomyEdit(); set(s => {
    if (s.faceCompareStart) return {};
    const next = s.anatomyFuture.at(-1);
    return next ? { ...anatomySnapshot(next), anatomyFuture: s.anatomyFuture.slice(0, -1),
      anatomyPast: [...s.anatomyPast, anatomySnapshot(s)].slice(-30) } : {};
  }); },
  hair: PRESETS[0].hair ? coerceHair({ ...DEFAULT_HAIR, ...PRESETS[0].hair }) : { ...DEFAULT_HAIR },
  hairTab: 'STYLE',
  setHairTab: (hairTab) => set({ hairTab }),
  studioPage: 'default',
  setStudioPage: (studioPage) => set({ studioPage }),
  setHair: (patch) => set((s) => {
    const shapeKeys = ['lengthCm', 'bangs', 'side', 'back', 'volume', 'curl', 'wave', 'wispiness', 'asymmetry'];
    const nextHair = coerceHair({ ...s.hair, ...patch,
      style: shapeKeys.some((key) => key in patch) ? 'custom' : s.hair.style });
    // Synchronize brow color with hair tone when linked (Skyrim RaceMenu parity)
    const nextBrowColor = (s.linkBrowToHair && patch.tone)
      ? (patch.tone.toLowerCase() === '#ffffff' ? '#2B1A0A' : patch.tone)
      : s.browColor;
    return { hair: nextHair, browColor: nextBrowColor };
  }),
  applyHairStyle: (id) => set((s) => {
    const hair = hairStyle(s.hair, id);
    if (hair === s.hair) return s;
    const assetSelection = { ...s.assetSelection };
    delete assetSelection.hairMesh;
    return { hair, assetSelection };
  }),
  name: NAME_DEFAULT,
  stats: { faces: 47868, verts: 2998, tris: 1179 },
  activeRegion: 'nose',
  primaryTab: 'FACE',
  subTab: 'SKIN',
  bodyTab: 'gear',
  setBodyTab: (bodyTab) => set({ bodyTab }),
  transformMode: 'translate',
  bisymmetry: true,
  asymmetry: false,
  showMesh: false,
  garmentVisible: true,
  setGarmentVisible: (garmentVisible) => set({ garmentVisible }),
  bodyPoseId: 'rest',
  setBodyPose: (bodyPoseId) => set({ bodyPoseId }),
  poseIntensity: 1.0,
  setPoseIntensity: (poseIntensity) => set({ poseIntensity: Math.min(1.5, Math.max(0, poseIntensity)) }),
  animationSpeed: 1.0,
  setAnimationSpeed: (animationSpeed) => { if (Number.isFinite(animationSpeed)) set({ animationSpeed: Math.min(2.0, Math.max(0.2, animationSpeed)) }); },
  animationId: 'idle',
  setAnimationId: (animationId) => { if (animationId === 'idle' || animationId === 'rest') set({ animationId }); },
  animationPlaying: true,
  setAnimationPlaying: (animationPlaying) => set({ animationPlaying }),
  autoRigUnskinned: true,
  setAutoRigUnskinned: (autoRigUnskinned) => set({ autoRigUnskinned }),
  poseCategory: 'IDLE',
  setPoseCategory: (poseCategory) => set({ poseCategory }),
  favoritePoses: ['rest', 'relaxed', 'hands-on-hips', 'greeting-wave', 'victory'],
  toggleFavoritePose: (id) =>
    set((s) => ({
      favoritePoses: s.favoritePoses.includes(id)
        ? s.favoritePoses.filter((p) => p !== id)
        : [...s.favoritePoses, id],
    })),
  /* Default weight is 0 (slim _0 mesh) matching Skyrim Creation Engine base. */
  weight: 0,
  setWeight: (weight) => {
    if (!BODY_WEIGHT_ENABLED) return;
    set({ weight: Math.min(1, Math.max(0, weight)) });
  },
  linkFaceToWeight: true,
  setLinkFaceToWeight: (linkFaceToWeight) => set({ linkFaceToWeight }),
  bodyPhysicsEnabled: true,
  bodyPhysicsBounciness: 0.5,
  bodyCollisionsEnabled: true,
  physicsImpulseNonce: 0,
  setBodyPhysicsEnabled: (bodyPhysicsEnabled) => set({ bodyPhysicsEnabled }),
  setBodyPhysicsBounciness: (bodyPhysicsBounciness) => set({ bodyPhysicsBounciness }),
  setBodyCollisionsEnabled: (bodyCollisionsEnabled) => set({ bodyCollisionsEnabled }),
  triggerPhysicsImpulse: () => set((s) => ({ physicsImpulseNonce: s.physicsImpulseNonce + 1 })),
  secondaryPhysicsEnabled: true,
  hairPhysicsEnabled: true,
  clothPhysicsEnabled: true,
  secondaryStiffness: 0.55,
  secondaryDamping: 0.50,
  secondaryWindIntensity: 0.0,
  secondaryImpulseNonce: 0,
  setSecondaryPhysicsEnabled: (secondaryPhysicsEnabled) => set({ secondaryPhysicsEnabled }),
  setHairPhysicsEnabled: (hairPhysicsEnabled) => set({ hairPhysicsEnabled }),
  setClothPhysicsEnabled: (clothPhysicsEnabled) => set({ clothPhysicsEnabled }),
  setSecondaryStiffness: (secondaryStiffness) => set({ secondaryStiffness }),
  setSecondaryDamping: (secondaryDamping) => set({ secondaryDamping }),
  setSecondaryWindIntensity: (secondaryWindIntensity) => set({ secondaryWindIntensity }),
  triggerSecondaryImpulse: () => set((s) => ({ secondaryImpulseNonce: s.secondaryImpulseNonce + 1 })),
  assetSourceId: null,
  /* A different source has different catalogue ids: every pick, cached list
     and overlay tintmask from the previous one is unresolvable and must not
     leak into the new session.

     Two cases must NOT wipe, both of them created by restoring a session:
     `null` means this load could not read the manifest, which says nothing
     about the pack; and an identical id is the ordinary reload. The second
     already returned early; the first is new here — without it a transient
     fetch failure would delete the face the user just restored. */
  setAssetSource: (id) =>
    set((s) => {
      /* `null` is "this load could not read the manifest", not "a different
         pack". Treating it as a switch would delete a restored face whenever
         the fetch blipped, and storing the null would make the next healthy
         load look like a switch. So it carries no information at all. */
      if (id === null || s.assetSourceId === id) return s;
      return {
        assetSourceId: id,
        assetSelection: {},
        assetCatalogues: {},
        equipment: {},
        overlayLayers: [],
        /* The stack is gone, so the panel's selection cannot name a layer. */
        activeOverlay: null,
        activeCategory: 'skin',
        /* The head picks went with it, so the stored faces belong to a mesh
           this session no longer has. */
        ...faceRebase(),
      };
    }),
  hydrated: false,
  restored: false,
  defaultOpened: false,
  /* Transient by construction: `partialize` writes only the fields named in
     `PersistedSession`, so a stored `hydrated: true` can never tell the next
     load its session had already been restored. */
  markHydrated: (restored) => set({ hydrated: true, restored }),
  markDefaultOpened: () => set({ defaultOpened: true }),
  /* The stack starts off so the first frame is exactly the face this app has
     always drawn; the preset is remembered for when the user turns it on. */
  enbPreset: 'enb',
  enbEnabled: false,
  fx: { smaa: true, bloom: true, dof: true, vignette: true, grain: true },
  grade: {
    contrast: 0,
    saturation: 0,
    ambient: 0,
    filter: 'vanilla',
    overlays: [
      { color: '#e8a33d', amount: 0, enabled: false },
      { color: '#b8b8b8', amount: 0, enabled: false },
      { color: '#d8c39c', amount: 0, enabled: false },
    ],
  },
  envMode: 'studio',
  envRotation: 0,
  envIntensity: 1,
  exposure: 1,
  setExposure: value => set(s => ({ exposure: bounded(value, s.exposure, 0.1, 4) })),
  backgroundMode: 'void',
  customBackgroundUrl: null,
  lighting: { ...LIGHTING_DEFAULTS },
  cameraRotateSpeed: CAMERA_ROTATE_SPEED_DEFAULT,
  skinGloss: 0.52,
  skinSss: 1,
  skinDetail: 0.45,
  skinSheen: 0.2,
  skinNormalStrength: 1.0,
  skinColor: '#ffffff',
  browColor: PRESETS[0].browColor ?? '#110E0C',
  setBrowColor: (browColor) => set((s) => {
    // If the user manually picks a custom brow color that differs from hair tone,
    // unlink linkBrowToHair so their custom choice is preserved
    const isDifferent = s.hair.tone && s.hair.tone.toLowerCase() !== '#ffffff'
      ? s.hair.tone.toLowerCase() !== browColor.toLowerCase()
      : browColor.toLowerCase() !== '#2b1a0a';
    return {
      browColor,
      linkBrowToHair: isDifferent ? false : s.linkBrowToHair,
    };
  }),
  linkBrowToHair: PRESETS[0].linkBrowToHair ?? true,
  setLinkBrowToHair: (linkBrowToHair) => set((s) => ({
    linkBrowToHair,
    browColor: linkBrowToHair && s.hair.tone && s.hair.tone.toLowerCase() !== '#ffffff'
      ? s.hair.tone
      : (linkBrowToHair && (!s.hair.tone || s.hair.tone.toLowerCase() === '#ffffff') ? '#2B1A0A' : s.browColor),
  })),
  showScalp: true,
  setShowScalp: (showScalp) => set({ showScalp }),
  browOpacity: PRESETS[0].browOpacity ?? 1.0,
  setBrowOpacity: (browOpacity) => set({ browOpacity: Math.min(1, Math.max(0, browOpacity)) }),
  browGloss: PRESETS[0].browGloss ?? 0.15,
  setBrowGloss: (browGloss) => set({ browGloss: Math.min(1, Math.max(0, browGloss)) }),
  browGlossy: PRESETS[0].browGlossy ?? 0.15,
  setBrowGlossy: (browGlossy) => set({ browGlossy: Math.min(1, Math.max(0, browGlossy)) }),
  lashesColor: '#1a1412',
  /* An invalid or non-string value is ignored rather than stored, so a bad
     colour from an imported preset cannot put an unparseable tint on screen. */
  setLashesColor: (lashesColor) =>
    set(lashesColor && /^#[0-9a-f]{6}$/i.test(lashesColor) ? { lashesColor } : {}),
  lashesOpacity: 1,
  setLashesOpacity: (v) => { if (Number.isFinite(v)) set({ lashesOpacity: Math.min(1, Math.max(0, v)) }); },
  favoriteBrows: [],
  toggleFavoriteBrow: (id) =>
    set((s) => ({
      favoriteBrows: s.favoriteBrows.includes(id)
        ? s.favoriteBrows.filter((b) => b !== id)
        : [...s.favoriteBrows, id],
    })),
  toneMapping: 'neutral',
  graphicsOpen: false,
  cameraOpen: false,
  workspace: 'edit',
  previewMode: false,
  characterHeight: 1.554,
  cameraFov: CAMERA_FOV_DEFAULT,
  cameraFraming: 'auto',
  cameraPoseRequest: null,
  unrestrictedSlots: false,
  setUnrestrictedSlots: (unrestrictedSlots) => set({ unrestrictedSlots }),
  toggleUnrestrictedSlots: () => set((s) => ({ unrestrictedSlots: !s.unrestrictedSlots })),
  showGroundMeshes: false,
  setShowGroundMeshes: (showGroundMeshes) => set({ showGroundMeshes }),

  sliders: presetSliderBank(PRESETS[0]),
  poses: buildPoseBank(),
  preset: PRESETS[0].id,
  utils: {
    camPreset: true,
    beautyAlbum: false,
    poseEdit: false,
    viewOutfit: false,
    cameraFocus: true,
    historyRevert: false,
  },
  assetSelection: {},
  assetCatalogues: {},
  equipment: {},
  equipSlot: 'top',
  setEquipSlot: (equipSlot) => set({ equipSlot }),
  setEquip: (patch) => set((s) => {
    const next = { ...s.equipment };
    for (const [slot, id] of Object.entries(patch) as Array<[EquipSlot, string | null]>) {
      if (id) next[slot] = id;
      else delete next[slot];
    }
    return { equipment: next };
  }),
  panelMode: 'texture',
  setPanelMode: (panelMode) => set({ panelMode }),
  setAssetCatalogue: (kind, entries) => set((s) => ({
    assetCatalogues: { ...s.assetCatalogues, [kind]: entries },
  })),
  setAssets: (patch) => set((s) => {
    const next = { ...s.assetSelection };
    for (const [kind, id] of Object.entries(patch) as Array<[AssetKind, string | null]>) {
      if (id) next[kind] = id;
      else delete next[kind];
    }
    /* Picking a different head swaps the mesh every stored slider was
       measured against; undo/redo across that boundary would apply one
       head's morphs to another. Everything else (hair, eyes, makeup) leaves
       the face geometry alone and must not clear the history. */
    return { assetSelection: next, ...(next.headMesh !== s.assetSelection.headMesh ? faceRebase() : {}) };
  }),
  activeCategory: 'skin',
  overlayLayers: [],
  activeOverlay: null,
  activeSlider: null,
  presetNonce: 0,

  setActiveRegion: (id) => set({ activeRegion: id }),
  setPrimaryTab: (primaryTab) => set({ primaryTab }),
  setSubTab: (subTab) => set({ subTab }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setBisymmetry: (bisymmetry) =>
    set((s) => ({ bisymmetry, asymmetry: bisymmetry ? false : s.asymmetry })),
  setAsymmetry: (asymmetry) =>
    set((s) => ({ asymmetry, bisymmetry: asymmetry ? false : s.bisymmetry })),
  setShowMesh: (showMesh) => set({ showMesh }),
  setEnbPreset: (enbPreset) => set({ enbPreset }),
  setEnbEnabled: (enbEnabled) => set({ enbEnabled }),
  toggleFx: (key) => set((s) => ({ fx: { ...s.fx, [key]: !s.fx[key] } })),
  setGrade: (patch) => set((s) => ({ grade: { ...s.grade, ...patch } })),
  setOverlay: (index, patch) =>
    set((s) => {
      const overlays = s.grade.overlays.map((o, i) =>
        i === index ? { ...o, ...patch } : o,
      ) as GradeSettings['overlays'];
      return { grade: { ...s.grade, overlays } };
    }),
  setEnvMode: (envMode) => set({ envMode }),
  setEnvRotation: (value) => { if (Number.isFinite(value)) set({ envRotation: wrapDegrees(value) }); },
  setBackgroundMode: (backgroundMode) => set({ backgroundMode }),
  setCustomBackgroundUrl: (customBackgroundUrl) => set({ customBackgroundUrl }),
  setLighting: (patch) => set((s) => ({ lighting: coerceLighting(patch, s.lighting) })),
  setEnvIntensity: (value) => set((s) => ({ envIntensity: bounded(value, s.envIntensity, 0, 2) })),
  setCameraRotateSpeed: (value) => set((s) => ({ cameraRotateSpeed: bounded(value, s.cameraRotateSpeed, CAMERA_ROTATE_SPEED_MIN, CAMERA_ROTATE_SPEED_MAX) })),
  setSkinGloss: (skinGloss) => set({ skinGloss }),
  setSkinSss: (v) => set({ skinSss: Math.min(1, Math.max(0, v)) }),
  /* Detail and sheen ignore a non-finite value rather than clamping it to 0,
     so a NaN from a slider cannot silently zero a setting. */
  setSkinDetail: (v) => { if (Number.isFinite(v)) set({ skinDetail: Math.min(1, Math.max(0, v)) }); },
  setSkinSheen: (v) => { if (Number.isFinite(v)) set({ skinSheen: Math.min(1, Math.max(0, v)) }); },
  setSkinNormalStrength: (v) => { if (Number.isFinite(v)) set({ skinNormalStrength: Math.min(3, Math.max(0, v)) }); },
  setSkinColor: (skinColor) => set({ skinColor }),
  setToneMapping: (toneMapping) => {
    if ((TONE_MAPPING_IDS as readonly string[]).includes(toneMapping)) set({ toneMapping });
  },
  setWorkspace: (workspace) => set({
    workspace,
    graphicsOpen: workspace === 'graphics',
    cameraOpen: workspace === 'camera',
    previewMode: false,
  }),
  /* The old gutter buttons drove two mutually exclusive booleans. They still
     do, but each now names the integrated workspace so opening one never
     evicts the other panel's local state — only its visibility changes. */
  setGraphicsOpen: (open) => set(open
    ? { graphicsOpen: true, cameraOpen: false, workspace: 'graphics', previewMode: false }
    : { graphicsOpen: false, workspace: 'edit' }),
  setCameraOpen: (open) => set(open
    ? { cameraOpen: true, graphicsOpen: false, workspace: 'camera', previewMode: false }
    : { cameraOpen: false, workspace: 'edit' }),
  setPreviewMode: (preview) => set({ previewMode: preview }),
  setCameraFov: (cameraFov) => set({ cameraFov: Math.min(CAMERA_FOV_MAX, Math.max(CAMERA_FOV_MIN, cameraFov)) }),
  setCameraFraming: (cameraFraming) => set({ cameraFraming }),
  triggerCameraPose: (pose) =>
    set((s) => ({
      cameraPoseRequest: {
        ...pose,
        nonce: (s.cameraPoseRequest?.nonce ?? 0) + 1,
      },
    })),
  resetCameraView: () =>
    set((s) => ({
      cameraFov: CAMERA_FOV_DEFAULT,
      cameraFraming: 'auto',
      cameraPoseRequest: {
        yaw: 0,
        pitch: 0,
        reset: true,
        nonce: (s.cameraPoseRequest?.nonce ?? 0) + 1,
      },
    })),

  toast: null,
  showToast: (msg: string) => {
    set({ toast: msg });
    if (typeof window !== 'undefined') {
      const w = window as unknown as { __toastTimer?: ReturnType<typeof setTimeout> };
      if (w.__toastTimer) clearTimeout(w.__toastTimer);
      w.__toastTimer = setTimeout(() => {
        set({ toast: null });
      }, 2600);
    }
  },

  setSlider: (id, value) =>
    set((s) => {
      if (!Number.isFinite(value)) return {};
      const region = s.activeRegion;
      return faceHistory(s, {
        sliders: {
          ...s.sliders,
          [region]: { ...s.sliders[region], [id]: value },
        },
      });
    }),

  setActiveSlider: (activeSlider) => set({ activeSlider }),

  setPose: (patch) =>
    set((s) => faceHistory(s, {
      poses: {
        ...s.poses,
        [s.activeRegion]: { ...s.poses[s.activeRegion], ...patch },
      },
    })),

  applyPreset: (id) =>
    set((s) => {
      /* A tile has to move the face. This used to reset every bank to the same
         defaults and only change the `preset` id, so all four rendered one
         identical head — every tile measured 0.0 % of face pixels changed. */
      const def = PRESETS.find((p) => p.id === id);
      const assetSelection = { ...s.assetSelection };
      if (def?.assets) {
        Object.assign(assetSelection, def.assets);
      } else if (def?.headMeshId) {
        assetSelection.headMesh = def.headMeshId;
      } else {
        delete assetSelection.headMesh;
      }
      return {
        preset: def ? def.id : PRESETS[0].id,
        presetNonce: s.presetNonce + 1,
        sliders: def ? presetSliderBank(def) : buildSliderBank(),
        anatomyMode: 'legacy',
        anatomy: coerceAnatomy(), anatomyAsymmetry: coerceAsymmetry(), anatomyColors: coerceAnatomyColors(),
        anatomyPast: [], anatomyFuture: [], anatomyEditStart: null,
        ...faceRebase(),
        poses: buildPoseBank(),
        assetSelection,
        equipment: def?.equipment ? ({ ...def.equipment } as Record<EquipSlot, string>) : s.equipment,
        hair: def?.hair ? coerceHair({ ...s.hair, ...def.hair }) : s.hair,
        lashesColor: def?.lashesColor ?? s.lashesColor,
        lashesOpacity: def?.lashesOpacity ?? s.lashesOpacity,
        browColor: def?.browColor ?? s.browColor,
        browOpacity: def?.browOpacity ?? s.browOpacity,
        browGloss: def?.browGloss ?? s.browGloss,
        browGlossy: def?.browGlossy ?? s.browGlossy,
        linkBrowToHair: def?.linkBrowToHair ?? s.linkBrowToHair,
        overlayLayers: def?.overlays ? ([...def.overlays] as OverlayLayer[]) : s.overlayLayers,
        activeOverlay: def?.overlays ? null : s.activeOverlay,
        ...(BODY_WEIGHT_ENABLED && def?.weight !== undefined ? { weight: def.weight } : { weight: 0 }),
      };
    }),

  toggleUtil: (key) =>
    set((s) => ({ utils: { ...s.utils, [key]: !s.utils[key] } })),

  setAsset: (kind, id) => get().setAssets({ [kind]: id }),

  setActiveCategory: (activeCategory) => set({ activeCategory }),

  /* Layering is additive and idempotent: clicking a selected makeup swatch in
     a multi-select category removes it, and switching categories never drops
     what is already painted. Cap is a taste limit, not a technical one — each
     layer is one more full-atlas composite in the bake. */
  toggleOverlay: (layer) =>
    set((s) => {
      const same = (l: OverlayLayer) => l.kind === layer.kind && l.id === layer.id;
      if (s.overlayLayers.some(same)) {
        return { overlayLayers: s.overlayLayers.filter((l) => !same(l)) };
      }
      return { overlayLayers: [...s.overlayLayers, layer].slice(-8) };
    }),

  setOverlayOpacity: (kind, id, opacity) =>
    set((s) => ({
      overlayLayers: s.overlayLayers.map((l) =>
        l.kind === kind && l.id === id
          ? { ...l, opacity: Math.min(1, Math.max(0.02, opacity)) }
          : l,
      ),
    })),

  setOverlayColor: (kind, id, color) =>
    set((s) => ({
      overlayLayers: s.overlayLayers.map((l) =>
        l.kind === kind && l.id === id ? { ...l, color } : l,
      ),
    })),

  /* A blend the compositor does not implement is not written at all, which
     leaves `normal` (the absent-key default) in force rather than persisting a
     string that every later validation would reject. */
  setOverlayBlend: (kind, id, blend) => {
    const valid = coerceBlend(blend);
    if (!valid) return;
    set((s) => ({
      overlayLayers: s.overlayLayers.map((l) =>
        l.kind === kind && l.id === id ? { ...l, blend: valid } : l,
      ),
    }));
  },

  /* Coverage is clamped to 0–1; a non-finite value is ignored rather than
     coerced to 0, so a NaN from a slider cannot silently erase every layer. */
  setOverlayCoverage: (kind, id, coverage) => {
    const valid = coerceCoverage(coverage);
    if (valid === undefined) return;
    set((s) => ({
      overlayLayers: s.overlayLayers.map((l) =>
        l.kind === kind && l.id === id ? { ...l, coverage: valid } : l,
      ),
    }));
  },

  setActiveOverlay: (activeOverlay) => set({ activeOverlay }),

  clearOverlays: (kind) =>
    set((s) => ({
      overlayLayers: kind ? s.overlayLayers.filter((l) => l.kind !== kind) : [],
    })),

  setOverlayLayers: (overlayLayers) => set({ overlayLayers }),

  setName: (name) => set({ name }),

  /* The old region reset, now history-aware: one entry, and no write at all
     when the region is already at its defaults. */
  resetRegion: () => get().resetFaceRegion(),

  loadPreset: (payload, sculptHeadId) => {
    if (payload.bodySlide) {
      useBodySlideStore.getState().setSliders(payload.bodySlide);
    } else if (payload.anatomy) {
      useBodySlideStore.getState().applyLegacySilhouette(payload.anatomy);
    }
    return set((s) => {
      const sliders = { ...s.sliders };
      const poses = { ...s.poses };
      for (const region of REGIONS) {
        const entry = payload.regions[region.id];
        if (!entry) continue;
        sliders[region.id] = { ...entry.sliders };
        poses[region.id] = entry.pose;
      }
      /* A `.jslot` carries no asset selection — its face is the baked sculpt,
         not the sliders. When the caller resolved the sculpted head for this
         very file, selecting it is what actually changes the head; without it
         the import only nudged the sliders by a millimetre and looked like a
         no-op. An explicit selection in the file still wins. */
      const assetSelection = payload.assets
        ? payload.assets
        : sculptHeadId
          ? { ...s.assetSelection, headMesh: sculptHeadId }
          : s.assetSelection;
      return {
        sliders,
        anatomyMode: payload.anatomyMode === 'advanced' ? 'advanced' : 'legacy',
        anatomy: coerceAnatomy(payload.anatomy),
        anatomyAsymmetry: coerceAsymmetry(payload.anatomyAsymmetry),
        anatomyColors: coerceAnatomyColors(payload.anatomyColors),
        anatomyPast: [], anatomyFuture: [], anatomyEditStart: null,
        ...faceRebase(),
        poses,
        // A RaceMenu file carries no view state, so those fields keep their
        // current values rather than being reset to defaults.
        activeRegion: payload.activeRegion ?? s.activeRegion,
        transformMode: payload.transformMode ?? s.transformMode,
        bisymmetry: payload.bisymmetry ?? s.bisymmetry,
        asymmetry: payload.bisymmetry === true ? false : s.asymmetry,
        preset: resolvePresetId(payload.preset ?? s.preset),
        name: payload.name ?? s.name,
        assetSelection,
        /* A preset that names no gear keeps what is worn, exactly like the
           view fields above — a `.jslot` has no notion of the paper-doll. */
        equipment: payload.equipment ?? s.equipment,
        /* A `.jslot` records `actor.weight` as 0–100; `parsePreset` divides it.
           When BODY_WEIGHT_ENABLED is false, weight is locked at 0. Defaults to 0 (_0 body). */
        weight: BODY_WEIGHT_ENABLED ? (payload.weight ?? 0) : 0,
        linkFaceToWeight: (payload as { linkFaceToWeight?: boolean }).linkFaceToWeight ?? s.linkFaceToWeight,
        linkBrowToHair: (payload as { linkBrowToHair?: boolean }).linkBrowToHair ?? s.linkBrowToHair,
        lashesColor: payload.lashesColor ?? s.lashesColor,
        lashesOpacity: payload.lashesOpacity ?? s.lashesOpacity,
        browColor: (payload as { browColor?: string }).browColor
          ?? (((payload as { linkBrowToHair?: boolean }).linkBrowToHair ?? s.linkBrowToHair) && payload.hair?.tone && payload.hair.tone.toLowerCase() !== '#ffffff'
            ? payload.hair.tone
            : s.browColor),
        browGloss: payload.browGloss ?? s.browGloss,
        browGlossy: payload.browGlossy ?? s.browGlossy,
        hair: payload.hair ? coerceHair({ ...s.hair, ...payload.hair }) : s.hair,
        overlayLayers: payload.overlays ?? s.overlayLayers,
        /* A replacement stack invalidates the panel's `kind:id` selection; a
           file that carries no overlays keeps both. */
        activeOverlay: payload.overlays ? null : s.activeOverlay,
        presetNonce: s.presetNonce + 1,
      };
    });
  },

  snapshotPreset: () => {
    /* While a hold-compare is up the live fields hold the baseline; a save or
       export started from that state must still write the edited face. */
    const s = liveFaceState(get());
    return buildPresetFile({
      name: s.name,
      preset: s.preset,
      activeRegion: s.activeRegion,
      transformMode: s.transformMode,
      bisymmetry: s.bisymmetry,
      regions: Object.fromEntries(
        REGIONS.map((r) => [
          r.id,
          { sliders: { ...s.sliders[r.id] }, pose: { ...s.poses[r.id] } },
        ]),
      ) as Record<RegionId, { sliders: SliderValues; pose: GizmoPose }>,
      assets: s.assetSelection,
      equipment: s.equipment,
      weight: s.weight,
      hair: { ...s.hair },
      browColor: s.browColor,
      browOpacity: s.browOpacity,
      browGloss: s.browGloss,
      browGlossy: s.browGlossy,
      linkBrowToHair: s.linkBrowToHair,
      lashesColor: s.lashesColor,
      lashesOpacity: s.lashesOpacity,
      overlays: s.overlayLayers,
      bodySlide: useBodySlideStore.getState().sliders,
      anatomyMode: s.anatomyMode,
      ...anatomySnapshot(s),
    });
  },
}), {
  name: SESSION_KEY,
  version: SESSION_VERSION,
  storage: persistStorage,
  skipHydration: true,
  /* The stored fields are exactly the character; transient view state never
     leaves the tab. `pickSession` copies rather than returning references, so
     a later mutation of the live bank cannot silently rewrite the last save. */
  /* Read the edited face rather than the baseline a hold-compare temporarily
     put in the live fields: a reload mid-hold must restore what the user
     built, not the face they were comparing against. `pickSession` copies, so
     none of the transient history fields can leak into the payload. */
  partialize: (s) => pickSession(liveFaceState(s) as PersistedSession),
  /* Runs only when storage actually returned a session. Returning `null` from
     the coercer (a payload that is not even an object) leaves the defaults in
     place, which is the honest response to garbage. */
  merge: (persisted, current) => {
    const restored = coerceSession(persisted, pickSession(current as PersistedSession));
    return restored ? { ...current, ...restored, restored: true } : current;
  },
}));

/** Rehydration is explicit (see `skipHydration` above); this is the one place
 *  that asks for it, marks the answer as in, and only then lets writes resume.
 *  The order matters: `markHydrated` must not persist, or a first visit would
 *  store slider defaults before the startup preset has been applied. */
export function restoreSession(): Promise<void> {
  return Promise.resolve(useCharacter.persist.rehydrate()).then(() => {
    const s = useCharacter.getState();
    s.markHydrated(s.restored);
    enableSessionWrites();
  });
}

/** Selector helpers — keep component subscriptions narrow. */
export const selectRegion = (s: CharacterState): RegionDef =>
  REGIONS_BY_ID[s.activeRegion];

export const selectSliderValues = (s: CharacterState): SliderValues =>
  s.sliders[s.activeRegion];

export const sliderDef = (id: SliderId) => SLIDERS_BY_ID[id];
