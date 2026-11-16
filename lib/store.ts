'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
import type { CatalogueEntry } from '@/lib/mo2/types';
import { type EnvMode } from '@/lib/envModes';
import { type BackgroundMode } from '@/lib/backgrounds';
import { type CameraFraming, type CameraPoseRequest, CAMERA_FOV_DEFAULT, CAMERA_FOV_MIN, CAMERA_FOV_MAX, CAMERA_ROTATE_SPEED_DEFAULT, CAMERA_ROTATE_SPEED_MIN, CAMERA_ROTATE_SPEED_MAX } from '@/lib/camera';
import { LIGHTING_DEFAULTS, coerceLighting, bounded, wrapDegrees, type LightingSettings } from '@/lib/lighting';

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
export type Workspace = 'edit' | 'assets' | 'camera' | 'graphics' | 'poses' | 'physics' | 'sculpt' | 'settings' | 'wardrobe';

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

export interface CharacterState {
  hair: HairSettings;
  hairTab: HairTab;
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
  /** Skin tone color tint `#rrggbb`. '#ffffff' = untinted raw diffuse. */
  skinColor: string;
  /** Eyebrow tint `#rrggbb`. Default '#2B1A0A' matching Skyrim creation studio. */
  browColor: string;
  setBrowColor: (c: string) => void;
  /** Whether eyebrow color synchronizes with hair color by default (Skyrim RaceMenu parity). */
  linkBrowToHair: boolean;
  setLinkBrowToHair: (link: boolean) => void;
  /** Eyebrow opacity [0..1]. Default 1.0 (100%). */
  browOpacity: number;
  setBrowOpacity: (v: number) => void;
  /** Eyebrow specular gloss [0..1]. Default 0.15 (15%). */
  browGloss: number;
  setBrowGloss: (v: number) => void;
  /** Eyebrow glossiness sharpness [0..1]. Default 0.15 (15%). */
  browGlossy: number;
  setBrowGlossy: (v: number) => void;
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
  /** Makeup / tattoo / wrinkle / brow layers, in draw order. */
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
export const useCharacter = create<CharacterState>()(persist((set, get) => ({
  hair: { ...DEFAULT_HAIR },  hairTab: 'STYLE',
  setHairTab: (hairTab) => set({ hairTab }),
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
  /* Default weight is locked to 0 (slim _0 mesh) when BODY_WEIGHT_ENABLED is false. */
  weight: BODY_WEIGHT_ENABLED ? 1 : 0,
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
  backgroundMode: 'void',
  customBackgroundUrl: null,
  lighting: { ...LIGHTING_DEFAULTS },
  cameraRotateSpeed: CAMERA_ROTATE_SPEED_DEFAULT,
  skinGloss: 0.52,
  skinSss: 1,
  skinDetail: 0.45,
  skinSheen: 0.2,
  skinColor: '#ffffff',
  browColor: '#2B1A0A',
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
  linkBrowToHair: true,
  setLinkBrowToHair: (linkBrowToHair) => set((s) => ({
    linkBrowToHair,
    browColor: linkBrowToHair && s.hair.tone && s.hair.tone.toLowerCase() !== '#ffffff'
      ? s.hair.tone
      : (linkBrowToHair && (!s.hair.tone || s.hair.tone.toLowerCase() === '#ffffff') ? '#2B1A0A' : s.browColor),
  })),
  browOpacity: 1.0,
  setBrowOpacity: (browOpacity) => set({ browOpacity: Math.min(1, Math.max(0, browOpacity)) }),
  browGloss: 0.15,
  setBrowGloss: (browGloss) => set({ browGloss: Math.min(1, Math.max(0, browGloss)) }),
  browGlossy: 0.15,
  setBrowGlossy: (browGlossy) => set({ browGlossy: Math.min(1, Math.max(0, browGlossy)) }),
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
    return { assetSelection: next };
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
      const region = s.activeRegion;
      return {
        sliders: {
          ...s.sliders,
          [region]: { ...s.sliders[region], [id]: value },
        },
      };
    }),

  setActiveSlider: (activeSlider) => set({ activeSlider }),

  setPose: (patch) =>
    set((s) => ({
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
      if (def?.headMeshId) {
        assetSelection.headMesh = def.headMeshId;
      } else {
        delete assetSelection.headMesh;
      }
      return {
        preset: def ? def.id : PRESETS[0].id,
        presetNonce: s.presetNonce + 1,
        sliders: def ? presetSliderBank(def) : buildSliderBank(),
        poses: buildPoseBank(),
        assetSelection,
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

  resetRegion: () =>
    set((s) => ({
      sliders: {
        ...s.sliders,
        [s.activeRegion]: { ...REGIONS_BY_ID[s.activeRegion].defaults },
      },
      poses: { ...s.poses, [s.activeRegion]: identityPose() },
    })),

  loadPreset: (payload, sculptHeadId) =>
    set((s) => {
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
           When BODY_WEIGHT_ENABLED is false, weight is locked at 0. */
        weight: BODY_WEIGHT_ENABLED ? (payload.weight ?? s.weight) : 0,
        linkFaceToWeight: (payload as { linkFaceToWeight?: boolean }).linkFaceToWeight ?? s.linkFaceToWeight,
        linkBrowToHair: (payload as { linkBrowToHair?: boolean }).linkBrowToHair ?? s.linkBrowToHair,
        browColor: (payload as { browColor?: string }).browColor
          ?? (((payload as { linkBrowToHair?: boolean }).linkBrowToHair ?? s.linkBrowToHair) && payload.hair?.tone && payload.hair.tone.toLowerCase() !== '#ffffff'
            ? payload.hair.tone
            : s.browColor),
        hair: payload.hair ? coerceHair({ ...s.hair, ...payload.hair }) : s.hair,
        overlayLayers: payload.overlays ?? s.overlayLayers,
        /* A replacement stack invalidates the panel's `kind:id` selection; a
           file that carries no overlays keeps both. */
        activeOverlay: payload.overlays ? null : s.activeOverlay,
        presetNonce: s.presetNonce + 1,
      };
    }),

  snapshotPreset: () => {
    const s = get();
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
      overlays: s.overlayLayers,
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
  partialize: (s) => pickSession(s as PersistedSession),
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
