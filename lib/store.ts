'use client';

import { create } from 'zustand';
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
  buildPresetFile,
  resolvePresetId,
  type PresetFile,
  type PresetPayload,
} from '@/lib/presetIO';
import type { AssetSelection, AssetKind, AssetCatalogues, UiCategory } from '@/lib/manifestSelect';
import { DEFAULT_HAIR, coerceHair, applyHairStyle as hairStyle, type HairSettings, type HairTab } from '@/lib/hair/settings';
import type { CatalogueEntry } from '@/lib/mo2/types';
import type { EnvMode } from '@/components/scene/environments';

/** One tinted layer composited onto the face bake, in atlas space. */
export interface OverlayLayer {
  kind: AssetKind;
  /** Catalogue id of the tintmask. */
  id: string;
  /** `#rrggbb` from the preset's `tintInfo`, or a neutral when absent. */
  color: string;
  opacity: number;
}

/** Which category the asset panel is listing. Mirrors the HUD's sub-tabs. */
export type ActiveCategory = UiCategory;

export type PostFxMode = 'all' | 'enb' | 'pure' | 'off';

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

export interface CharacterState {
  hair: HairSettings;
  hairTab: HairTab;
  setHair: (patch: Partial<HairSettings>) => void;
  applyHairStyle: (id: string) => void;
  setHairTab: (tab: HairTab) => void;
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
  /** Active asset source identity, so a source switch can drop stale picks. */
  assetSourceId: string | null;
  setAssetSource: (id: string | null) => void;
  /** Active ENB & ReShade post-processing mode */
  postFxMode: PostFxMode;
  /** Active procedural HDR environment lighting preset */
  envMode: EnvMode;
  /** Environment rotation around Y axis in degrees [0, 360) */
  envRotation: number;
  /** Skin glossiness / specular sheen level [0.0 = matte, 1.0 = oiled/wet] */
  skinGloss: number;

  sliders: Record<RegionId, SliderValues>;
  poses: Record<RegionId, GizmoPose>;
  preset: string;
  utils: UtilityToggles;
  /** Chosen MO2 asset per category. Missing = the manifest's own default. */
  assetSelection: AssetSelection;
  assetCatalogues: AssetCatalogues;
  panelMode: 'mesh' | 'texture';
  setPanelMode: (mode: 'mesh' | 'texture') => void;
  setAssets: (patch: Partial<Record<AssetKind, string | null>>) => void;
  setAssetCatalogue: (kind: AssetKind, entries: CatalogueEntry[]) => void;
  /** Which category the asset panel lists. Set by the HUD's sub-tabs. */
  activeCategory: ActiveCategory;
  /** Makeup / tattoo / wrinkle / brow layers, in draw order. */
  overlayLayers: OverlayLayer[];
  /** Set while the user is dragging a slider so the gizmo yields to it. */
  activeSlider: SliderId | null;
  /** Bumped whenever a preset is applied, to retrigger camera framing. */
  presetNonce: number;

  setActiveRegion: (id: RegionId) => void;
  setPrimaryTab: (t: string) => void;
  setSubTab: (t: string) => void;
  setTransformMode: (m: TransformMode) => void;
  setBisymmetry: (v: boolean) => void;
  setAsymmetry: (v: boolean) => void;
  setShowMesh: (v: boolean) => void;
  setPostFxMode: (mode: PostFxMode) => void;
  setEnvMode: (mode: EnvMode) => void;
  setEnvRotation: (rotation: number) => void;
  setSkinGloss: (v: number) => void;
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
  clearOverlays: (kind?: AssetKind) => void;
  setOverlayLayers: (layers: OverlayLayer[]) => void;
  setName: (n: string) => void;
  resetRegion: () => void;
  /** Replaces every region's bank with a parsed preset. */
  loadPreset: (payload: PresetPayload, sculptHeadId?: string) => void;
  /** Everything the exporter needs to write a preset file. */
  snapshotPreset: () => PresetFile;
}

export const useCharacter = create<CharacterState>((set, get) => ({
  hair: { ...DEFAULT_HAIR },
  hairTab: 'STYLE',
  setHairTab: (hairTab) => set({ hairTab }),
  setHair: (patch) => set((s) => {
    const shapeKeys = ['lengthCm', 'bangs', 'side', 'back', 'volume', 'curl', 'wave', 'wispiness', 'asymmetry'];
    return { hair: coerceHair({ ...s.hair, ...patch,
      style: shapeKeys.some((key) => key in patch) ? 'custom' : s.hair.style }) };
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
  transformMode: 'translate',
  bisymmetry: true,
  asymmetry: false,
  showMesh: false,
  garmentVisible: true,
  setGarmentVisible: (garmentVisible) => set({ garmentVisible }),
  bodyPoseId: 'rest',
  setBodyPose: (bodyPoseId) => set({ bodyPoseId }),
  /* Skyrim's own default weight is 1.0, and `femalebody_1.nif` is the mesh the
     game shows at it. */
  weight: 1,
  setWeight: (weight) => set({ weight: Math.min(1, Math.max(0, weight)) }),
  assetSourceId: null,
  /* A different source has different catalogue ids: every pick, cached list
     and overlay tintmask from the previous one is unresolvable and must not
     leak into the new session. */
  setAssetSource: (id) =>
    set((s) =>
      s.assetSourceId === id
        ? s
        : {
            assetSourceId: id,
            assetSelection: {},
            assetCatalogues: {},
            overlayLayers: [],
            activeCategory: 'skin',
          },
    ),
  postFxMode: 'off',
  envMode: 'off',
  envRotation: 0,
  skinGloss: 0.52,

  sliders: buildSliderBank(),
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
  setPostFxMode: (postFxMode) => set({ postFxMode }),
  setEnvMode: (envMode) => set({ envMode }),
  setEnvRotation: (envRotation) => set({ envRotation }),
  setSkinGloss: (skinGloss) => set({ skinGloss }),

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
      return {
        preset: def ? def.id : PRESETS[0].id,
        presetNonce: s.presetNonce + 1,
        sliders: def ? presetSliderBank(def) : buildSliderBank(),
        poses: buildPoseBank(),
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
        /* A `.jslot` records `actor.weight` as 0–100; `parsePreset` divides it.
           A LYRA export writes the same 0–1 value back. A file that carries
           neither keeps the current weight, like the view fields above. */
        weight: payload.weight ?? s.weight,
        hair: payload.hair ? coerceHair(payload.hair) : s.hair,
        overlayLayers: payload.overlays ?? s.overlayLayers,
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
      weight: s.weight,
      hair: { ...s.hair },
      overlays: s.overlayLayers,
    });
  },
}));

/** Selector helpers — keep component subscriptions narrow. */
export const selectRegion = (s: CharacterState): RegionDef =>
  REGIONS_BY_ID[s.activeRegion];

export const selectSliderValues = (s: CharacterState): SliderValues =>
  s.sliders[s.activeRegion];

export const sliderDef = (id: SliderId) => SLIDERS_BY_ID[id];
