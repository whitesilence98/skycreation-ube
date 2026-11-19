/**
 * What survives an F5, and the rules for trusting what comes back.
 *
 * `lib/store.ts` owns the live character; this module owns the *smaller* copy
 * that goes to `localStorage` and the coercion applied when it returns. The
 * split exists because a stored session is untrusted input: it can be stale
 * from an older build, hand-edited in devtools, or written by a different pack.
 * Every field therefore goes through the same validators the preset importer
 * uses rather than being spread straight onto the store.
 *
 * Nothing here may import three.js or a React component: the store is
 * transpiled into a bare `vm` context by `scripts/check_hair.cjs` and
 * `scripts/check_preset_import.cjs`, where neither exists.
 */

import {
  NAME_DEFAULT,
  PRESETS,
  REGIONS,
  type RegionId,
  type SliderValues,
  type TransformMode,
} from '@/lib/regions';
import {
  coercePose,
  coerceSliderValues,
  coerceWeight,
  isRegionId,
  sanitizeAssetSelection,
  sanitizeOverlayLayers,
} from '@/lib/presetIO';
import { CATEGORY_MAP, type AssetSelection, type UiCategory } from '@/lib/manifestSelect';
import { isEquipSelection, isEquipSlot, type EquipSelection, type EquipSlot } from '@/lib/equipment';
import { HAIR_TABS, coerceHair, type HairSettings, type HairTab } from '@/lib/hair/settings';
import { ENV_MODES, type EnvMode } from '@/lib/envModes';
import { BACKGROUND_MODES, type BackgroundMode } from '@/lib/backgrounds';
import { coerceLighting, bounded, wrapDegrees, type LightingSettings } from '@/lib/lighting';
import { CAMERA_ROTATE_SPEED_DEFAULT, CAMERA_ROTATE_SPEED_MIN, CAMERA_ROTATE_SPEED_MAX } from '@/lib/camera';
import { coerceAnatomy, coerceAsymmetry, coerceAnatomyColors } from '@/lib/anatomy/validate';
import type { AnatomySnapshot, AnatomyMode } from '@/lib/anatomy/params';
import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware';
import type {
  ActiveCategory, BodyTab, ColorOverlay, EnbPreset, FilterPreset, GizmoPose, GradeSettings,
  OverlayLayer, ToneMappingId, UtilityToggles,
} from '@/lib/store';

/**
 * Bumped when a stored shape stops being readable by the current build.
 *
 * The version is in the key as well as the payload, so a bump starts a clean
 * session instead of migrating a payload the app has no UI to inspect.
 *
 * v2 intentionally starts fresh for the new rendering defaults (approved reset).
 * The v1 key is left untouched; it is not automatically restored.
 */
export const SESSION_VERSION = 2;

export const SESSION_KEY = `lyra.character-session.v${SESSION_VERSION}`;

/**
 * Exactly the fields that describe what the user built.
 *
 * Deliberately absent, and why:
 *
 * - `assetCatalogues` — megabytes of MO2 listing, refetched per category. A
 *   restored id is validated against the live catalogue anyway.
 * - `previewMode`, `graphicsOpen` — panel visibility. A reload into
 *   `previewMode` hides every panel with nothing on screen saying how to leave
 *   (`chrome` in `Hud.tsx` is literally `!previewMode`).
 * - `activeSlider` — a drag-in-progress flag; a reload can never be mid-drag.
 * - `presetNonce` — a counter that re-frames the camera; restoring it would
 *   fire a framing the user did not ask for.
 * - `stats` — the HUD's debug counters, recomputed from the scene.
 * - `restored` — per-load bookkeeping; persisting it would make the next load
 *   think it had already restored a character.
 *
 * `assetSourceId` *is* kept: it is what lets a genuine pack switch invalidate
 * the picks while an ordinary reload leaves them alone.
 */
export interface PersistedSession extends AnatomySnapshot {
  anatomyMode: AnatomyMode;
  hair: HairSettings;
  hairTab: HairTab;
  name: string;
  activeRegion: RegionId;
  primaryTab: string;
  subTab: string;
  bodyTab?: BodyTab;
  transformMode: TransformMode;
  bisymmetry: boolean;
  asymmetry: boolean;
  showMesh: boolean;
  garmentVisible: boolean;
  bodyPoseId: string;
  animationId?: 'idle' | 'rest';
  animationPlaying?: boolean;
  animationSpeed?: number;
  autoRigUnskinned?: boolean;
  weight: number;
  bodyPhysicsEnabled?: boolean;
  bodyPhysicsBounciness?: number;
  bodyCollisionsEnabled?: boolean;
  assetSourceId: string | null;
  enbPreset: EnbPreset;
  enbEnabled: boolean;
  fx: { smaa: boolean; bloom: boolean; dof: boolean; vignette: boolean; grain: boolean };
  grade: GradeSettings;
  envMode: EnvMode;
  envRotation: number;
  backgroundMode?: BackgroundMode;
  customBackgroundUrl?: string | null;
  lighting?: LightingSettings;
  envIntensity?: number;
  exposure?: number;
  cameraRotateSpeed?: number;
  skinGloss: number;
  skinSss: number;
  skinDetail: number;
  skinSheen: number;
  skinColor: string;
  browColor?: string;
  browOpacity?: number;
  browGloss?: number;
  browGlossy?: number;
  linkBrowToHair?: boolean;
  /** Eyelash tint `#rrggbb`. */
  lashesColor?: string;
  /** Eyelash opacity 0–1. */
  lashesOpacity?: number;
  toneMapping: ToneMappingId;
  sliders: Record<RegionId, SliderValues>;
  poses: Record<RegionId, GizmoPose>;
  preset: string;
  utils: UtilityToggles;
  assetSelection: AssetSelection;
  /** One worn garment per equipment slot; see `lib/equipment.ts`. */
  equipment: EquipSelection;
  equipSlot: EquipSlot;
  panelMode: 'mesh' | 'texture';
  activeCategory: ActiveCategory;
  overlayLayers: OverlayLayer[];
  cameraFov?: number;
}

/* ── the vocabularies a hand-edited payload can violate ─────────────────── */

const TRANSFORM_MODES: readonly TransformMode[] = ['translate', 'rotate', 'scale'];
const ENB_PRESETS: readonly EnbPreset[] = ['all', 'enb', 'pure'];
const FILTER_PRESETS: readonly FilterPreset[] = ['vanilla', 'dramatic', 'cinematic', 'fantasy'];
/* Mirrors `TONE_MAPPING_IDS` in `lib/store.ts`. A value that is not one of
   these has no `ToneMappingMode` to map onto in the scene. */
const TONE_MAPPINGS: readonly ToneMappingId[] = ['neutral', 'agx', 'aces', 'cineon'];
const FX_KEYS = ['smaa', 'bloom', 'dof', 'vignette', 'grain'] as const;
const UTIL_KEYS: Array<keyof UtilityToggles> = [
  'camPreset', 'beautyAlbum', 'poseEdit', 'viewOutfit', 'cameraFocus', 'historyRevert',
];

/* Mirrors `PRIMARY` / `SECONDARY` in `TopBar.tsx`. Kept here as a validator
   list: an unknown tab id highlights nothing and renders an empty panel,
   which reads as a bug rather than as "your old tab no longer exists". */
const PRIMARY_TABS = ['PRESET', 'HAIR', 'FACE SHAPE', 'FACE', 'BODY', 'EQUIPMENT'];
const SECONDARY_TABS = ['SKIN', 'EYES', 'LASHES', 'BROWS', 'MOUTH', 'MAKEUP', 'TATTOO'];
const BODY_TABS: readonly BodyTab[] = ['gear', 'physique'];

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function coerceCategory(v: unknown): ActiveCategory {
  return typeof v === 'string' && Object.hasOwn(CATEGORY_MAP, v) ? (v as UiCategory) : 'skin';
}

/**
 * A grade with every number bounded and the three tint rows rebuilt.
 *
 * The overlay array is a fixed 3-tuple in the renderer (`uTint0..2`), so a
 * stored row count of 0 or 9 must not reach `GradeEffect`; missing rows are
 * filled from the supplied default and extras are dropped.
 */
function coerceGrade(raw: unknown, fallback: GradeSettings): GradeSettings {
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const rawOverlays = Array.isArray(o.overlays) ? (o.overlays as unknown[]) : [];
  const overlays = fallback.overlays.map((base, i): ColorOverlay => {
    const layer = rawOverlays[i];
    if (!layer || typeof layer !== 'object') return { ...base };
    const l = layer as Record<string, unknown>;
    return {
      color: typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : base.color,
      amount: clamp(finite(l.amount, base.amount), -100, 100),
      enabled: bool(l.enabled, base.enabled),
    };
  }) as GradeSettings['overlays'];
  return {
    contrast: clamp(finite(o.contrast, fallback.contrast), -100, 100),
    saturation: clamp(finite(o.saturation, fallback.saturation), -100, 100),
    ambient: clamp(finite(o.ambient, fallback.ambient), -10, 10),
    filter: isOneOf(FILTER_PRESETS, o.filter) ? o.filter : fallback.filter,
    overlays,
  };
}

const coerceToggleSet = <K extends string>(
  raw: unknown,
  keys: readonly K[],
  fallback: Record<K, boolean>,
): Record<K, boolean> => {
  const out = { ...fallback };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const key of keys) out[key] = bool(o[key], fallback[key]);
  return out;
};

/**
 * A whole stored session, field by field, against `defaults`.
 *
 * Returns `null` when the payload is not an object at all — the caller then
 * keeps the pristine defaults, which is also how a corrupt or absent entry is
 * handled. Values that are merely *stale* (an env mode this build dropped, an
 * asset id from another pack, a slider outside its range) are repaired rather
 * than rejected: throwing away a whole face because one field moved between
 * versions would be worse than not restoring at all.
 */
export function coerceSession(raw: unknown, defaults: PersistedSession): PersistedSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  /* Sliders and poses are banks over the *current* region list, so a region
     added since the session was written gets the default instead of a hole. */
  const rawSliders = (o.sliders ?? {}) as Record<string, unknown>;
  const rawPoses = (o.poses ?? {}) as Record<string, unknown>;
  const sliders = Object.fromEntries(REGIONS.map((r) => [
    r.id,
    coerceSliderValues(rawSliders[r.id], defaults.sliders[r.id]),
  ])) as Record<RegionId, SliderValues>;
  const poses = Object.fromEntries(REGIONS.map((r) => [
    r.id,
    coercePose(rawPoses[r.id]),
  ])) as Record<RegionId, GizmoPose>;

  return {
    anatomy: coerceAnatomy(o.anatomy),
    anatomyAsymmetry: coerceAsymmetry(o.anatomyAsymmetry),
    anatomyColors: coerceAnatomyColors(o.anatomyColors),
    anatomyMode: o.anatomyMode === 'advanced' ? 'advanced' : 'legacy',
    hair: coerceHair(o.hair),
    hairTab: isOneOf(HAIR_TABS, o.hairTab) ? o.hairTab : defaults.hairTab,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 14) : NAME_DEFAULT,
    activeRegion: isRegionId(o.activeRegion) ? o.activeRegion : defaults.activeRegion,
    primaryTab: isOneOf(PRIMARY_TABS, o.primaryTab) ? o.primaryTab : defaults.primaryTab,
    subTab: isOneOf(SECONDARY_TABS, o.subTab) ? o.subTab : defaults.subTab,
    bodyTab: isOneOf(BODY_TABS, o.bodyTab) ? o.bodyTab : defaults.bodyTab,
    transformMode: isOneOf(TRANSFORM_MODES, o.transformMode) ? o.transformMode : defaults.transformMode,
    bisymmetry: bool(o.bisymmetry, defaults.bisymmetry),
    asymmetry: bool(o.asymmetry, defaults.asymmetry),
    showMesh: bool(o.showMesh, defaults.showMesh),
    garmentVisible: bool(o.garmentVisible, defaults.garmentVisible),
    bodyPoseId: typeof o.bodyPoseId === 'string' ? o.bodyPoseId : defaults.bodyPoseId,
    animationId: o.animationId === 'rest' || o.animationId === 'idle' ? o.animationId : (defaults.animationId ?? 'idle'),
    animationPlaying: bool(o.animationPlaying, defaults.animationPlaying ?? true),
    animationSpeed: bounded(o.animationSpeed, defaults.animationSpeed ?? 1, 0.2, 2),
    autoRigUnskinned: bool(o.autoRigUnskinned, defaults.autoRigUnskinned ?? true),
    /* When default weight is 0 (locked), session restores 0. Otherwise coerceWeight. */
    weight: defaults.weight === 0 ? 0 : (coerceWeight(o.weight) ?? defaults.weight),
    bodyPhysicsEnabled: bool(o.bodyPhysicsEnabled, defaults.bodyPhysicsEnabled ?? true),
    bodyPhysicsBounciness: clamp(finite(o.bodyPhysicsBounciness, defaults.bodyPhysicsBounciness ?? 0.5), 0, 1),
    bodyCollisionsEnabled: bool(o.bodyCollisionsEnabled, defaults.bodyCollisionsEnabled ?? true),
    assetSourceId: typeof o.assetSourceId === 'string' || o.assetSourceId === null
      ? (o.assetSourceId as string | null)
      : null,
    enbPreset: isOneOf(ENB_PRESETS, o.enbPreset) ? o.enbPreset : defaults.enbPreset,
    enbEnabled: bool(o.enbEnabled, defaults.enbEnabled),
    fx: coerceToggleSet(o.fx, FX_KEYS, defaults.fx),
    grade: coerceGrade(o.grade, defaults.grade),
    envMode: isOneOf(ENV_MODES, o.envMode) ? o.envMode : defaults.envMode,
    envRotation: wrapDegrees(finite(o.envRotation, defaults.envRotation)),
    backgroundMode: isOneOf(BACKGROUND_MODES, o.backgroundMode) ? o.backgroundMode : (defaults.backgroundMode ?? 'void'),
    customBackgroundUrl: typeof o.customBackgroundUrl === 'string' ? o.customBackgroundUrl : (defaults.customBackgroundUrl ?? null),
    lighting: coerceLighting(o.lighting, defaults.lighting),
    envIntensity: bounded(o.envIntensity, defaults.envIntensity ?? 1, 0, 2),
    exposure: bounded(o.exposure, defaults.exposure ?? 1, 0.1, 4),
    cameraRotateSpeed: bounded(o.cameraRotateSpeed, defaults.cameraRotateSpeed ?? CAMERA_ROTATE_SPEED_DEFAULT, CAMERA_ROTATE_SPEED_MIN, CAMERA_ROTATE_SPEED_MAX),
    skinGloss: clamp(finite(o.skinGloss, defaults.skinGloss), 0, 1),
    skinSss: clamp(finite(o.skinSss, defaults.skinSss), 0, 1),
    skinDetail: clamp(finite(o.skinDetail, defaults.skinDetail), 0, 1),
    skinSheen: clamp(finite(o.skinSheen, defaults.skinSheen), 0, 1),
    skinColor: typeof o.skinColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.skinColor) ? o.skinColor : (defaults.skinColor ?? '#ffffff'),
    browColor: typeof o.browColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.browColor) ? o.browColor : (defaults.browColor ?? '#2B1A0A'),
    browOpacity: clamp(finite(o.browOpacity, defaults.browOpacity ?? 1.0), 0.05, 1.0),
    browGloss: clamp(finite(o.browGloss, defaults.browGloss ?? 0.15), 0, 1),
    browGlossy: clamp(finite(o.browGlossy, defaults.browGlossy ?? 0.15), 0, 1),
    linkBrowToHair: bool(o.linkBrowToHair, defaults.linkBrowToHair ?? true),
    lashesColor: typeof o.lashesColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.lashesColor) ? o.lashesColor : (defaults.lashesColor ?? '#1a1412'),
    lashesOpacity: clamp(finite(o.lashesOpacity, defaults.lashesOpacity ?? 1), 0, 1),
    toneMapping: isOneOf(TONE_MAPPINGS, o.toneMapping) ? o.toneMapping : defaults.toneMapping,
    sliders,
    poses,
    preset: PRESETS.some((p) => p.id === o.preset) ? (o.preset as string) : defaults.preset,
    utils: coerceToggleSet(o.utils, UTIL_KEYS, defaults.utils),
    /* `sanitizeAssetSelection` drops unknown kinds and non-string ids but
       keeps the surviving picks, so a session written before a kind was
       removed still restores the rest of the map. An id that
       no longer exists in the pack resolves to the manifest's own default
       rather than crashing — `resolveManifest` treats an unmatched id as "no
       explicit pick". */
    assetSelection: sanitizeAssetSelection(o.assetSelection) ?? defaults.assetSelection,
    /* Worn garments are a slot map of their own; a slot the vocabulary no
       longer names, or a non-string id, drops rather than poisoning the
       render. `resolveManifest` ignores an id the pack no longer ships. */
    equipment: isEquipSelection(o.equipment) ? o.equipment : defaults.equipment,
    equipSlot: isEquipSlot(o.equipSlot) ? o.equipSlot : defaults.equipSlot,
    panelMode: o.panelMode === 'mesh' || o.panelMode === 'texture' ? o.panelMode : defaults.panelMode,
    activeCategory: coerceCategory(o.activeCategory),
    overlayLayers: sanitizeOverlayLayers(o.overlayLayers) ?? defaults.overlayLayers,
    cameraFov: clamp(finite(o.cameraFov, defaults.cameraFov ?? 27), 15, 60),
  };
}

/** The stored slice, copied out of a live store. */
export function pickSession(s: PersistedSession): PersistedSession {
  return {
    anatomy: { ...s.anatomy },
    anatomyAsymmetry: { ...s.anatomyAsymmetry },
    anatomyColors: { ...s.anatomyColors },
    anatomyMode: s.anatomyMode,
    hair: { ...s.hair },
    hairTab: s.hairTab,
    name: s.name,
    activeRegion: s.activeRegion,
    primaryTab: s.primaryTab,
    subTab: s.subTab,
    bodyTab: s.bodyTab,
    transformMode: s.transformMode,
    bisymmetry: s.bisymmetry,
    asymmetry: s.asymmetry,
    showMesh: s.showMesh,
    garmentVisible: s.garmentVisible,
    bodyPoseId: s.bodyPoseId,
    animationId: s.animationId ?? 'idle',
    animationPlaying: s.animationPlaying ?? true,
    animationSpeed: s.animationSpeed ?? 1,
    autoRigUnskinned: s.autoRigUnskinned ?? true,
    weight: s.weight,
    bodyPhysicsEnabled: s.bodyPhysicsEnabled ?? true,
    bodyPhysicsBounciness: s.bodyPhysicsBounciness ?? 0.5,
    bodyCollisionsEnabled: s.bodyCollisionsEnabled ?? true,
    assetSourceId: s.assetSourceId,
    enbPreset: s.enbPreset,
    enbEnabled: s.enbEnabled,
    fx: { ...s.fx },
    grade: {
      ...s.grade,
      /* The renderer maps this tuple by index, so it must survive the copy as
         a fixed-length array rather than being flattened. */
      overlays: s.grade.overlays.map((o) => ({ ...o })) as GradeSettings['overlays'],
    },
    envMode: s.envMode,
    envRotation: s.envRotation,
    lighting: coerceLighting(s.lighting),
    envIntensity: s.envIntensity ?? 1,
    exposure: s.exposure ?? 1,
    cameraRotateSpeed: s.cameraRotateSpeed ?? CAMERA_ROTATE_SPEED_DEFAULT,
    skinGloss: s.skinGloss,
    skinSss: s.skinSss,
    skinDetail: s.skinDetail,
    skinSheen: s.skinSheen,
    skinColor: s.skinColor,
    browColor: s.browColor ?? '#2B1A0A',
    browOpacity: s.browOpacity ?? 1.0,
    browGloss: s.browGloss ?? 0.15,
    browGlossy: s.browGlossy ?? 0.15,
    linkBrowToHair: s.linkBrowToHair ?? true,
    lashesColor: s.lashesColor ?? '#1a1412',
    lashesOpacity: s.lashesOpacity ?? 1,
    toneMapping: s.toneMapping,
    sliders: Object.fromEntries(
      Object.entries(s.sliders).map(([id, values]) => [id, { ...values }]),
    ) as Record<RegionId, SliderValues>,
    poses: Object.fromEntries(
      Object.entries(s.poses).map(([id, pose]) => [id, {
        offset: [...pose.offset], rotation: [...pose.rotation], scale: [...pose.scale],
      }]),
    ) as Record<RegionId, GizmoPose>,
    preset: s.preset,
    utils: { ...s.utils },
    assetSelection: { ...s.assetSelection },
    equipment: { ...s.equipment },
    equipSlot: s.equipSlot,
    panelMode: s.panelMode,
    activeCategory: s.activeCategory,
    overlayLayers: s.overlayLayers.map((l) => ({ ...l })),
    cameraFov: s.cameraFov ?? 27,
  };
}

/**
 * A storage that exists even where `localStorage` does not.
 *
 * Two departures from the middleware's default `() => window.localStorage`:
 *
 * 1. The headless check scripts import the store in a bare `vm` context. A
 *    missing storage makes `persistImpl` `console.warn` on *every* write, and
 *    those scripts perform dozens — each would land in the test output. A
 *    memory map keeps them quiet and still exercises the same code path.
 * 2. A quota error or a blocked-cookie document must not take the app down.
 *    The session simply stops saving, which is what the app did before this
 *    feature existed.
 */
function memoryStorage(): StateStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

function browserStorage(): StateStorage {
  try {
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

/**
 * Writes stay off until the stored session has been read.
 *
 * `skipHydration` means the store starts on its defaults and hydrates a moment
 * later from an effect. Without this gate, any `set` in between — a user click,
 * a late effect — would write those defaults over the session it had not read
 * yet, and the feature would destroy exactly what it exists to keep. `getItem`
 * stays open so hydration itself still works.
 */
let writesEnabled = false;

export function enableSessionWrites(): void {
  writesEnabled = true;
}

const baseStorage = createJSONStorage<PersistedSession>(
  () => (typeof window === 'undefined' ? memoryStorage() : browserStorage()),
) as PersistStorage<PersistedSession, unknown>;

export const persistStorage: PersistStorage<PersistedSession, unknown> = {
  getItem: (name) => baseStorage.getItem(name),
  setItem: (name, value) => (writesEnabled ? baseStorage.setItem(name, value) : undefined),
  removeItem: (name) => baseStorage.removeItem(name),
};
