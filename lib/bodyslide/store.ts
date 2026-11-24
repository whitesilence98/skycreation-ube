/**
 * lib/bodyslide/store.ts
 *
 * Zustand store & slice for BodySlide morph sliders, preset management, and category navigation.
 * Provides real-time reactive access for both UI components and 3D deformation pipelines.
 * Includes backward-compatibility mapping from legacy silhouette sliders to BodySlide morph targets.
 */

import { create, type StateCreator } from 'zustand';
import {
  BUILTIN_PRESETS,
  loadPresetFromUrl,
  exportBodySlidePresetXml,
  type BodySlidePreset,
  type ExportBodySlideOptions,
  type PresetMeta,
} from './presetLoader';
import CONVERTING_OUTFITS_SLIDERS from './convertingOutfitsPreset.json';
import { UBE_BODY_CATEGORIES, type BodySlideCategory } from './categories';

/** All canonical body slider names extracted from UBE_BODY_CATEGORIES */
export const ALL_UBE_BODY_SLIDER_NAMES: readonly string[] = Object.freeze(
  Array.from(new Set(UBE_BODY_CATEGORIES.flatMap((cat: BodySlideCategory) => cat.sliders.map((s) => s.name))))
);

/** Canonical base sliders for UBE Necoco Body (Baked into newbody baseline) */
export const DEFAULT_NECOCO_SLIDERS: Readonly<Record<string, number>> = Object.freeze({});

/** Legacy V1 base sliders preserved for preset loading */
export const NECOCO_V1_SLIDERS: Readonly<Record<string, number>> = Object.freeze({
  Necoco_Body_Addon_Belly: 100,
  Necoco_Body_Addon_Butt: 100,
  Necoco_Body_Addon_Leg: 100,
  Necoco_Body_Addon_Lewd_Zone: 100,
  Necoco_Body_Addon_Upper_Body_Smooth: 100,
  'Necoco_Body_w|o_Boob': 100,
  Necoco_Boob_Addon_MafaVam: 100,
  Necoco_Boob_Base: 100,
});

/** Pre-parsed preset slider maps for instantaneous zero-latency application */
export const BUILTIN_PRESET_SLIDERS: Record<string, Record<string, number>> = {
  'default-slim': {},
  'necoco-v1': { ...NECOCO_V1_SLIDERS },
  'necoco-v2': {
    ...NECOCO_V1_SLIDERS,
    Necoco_Boob_Addon_Bom39: 65,
  },
  'necoco-converting-outfits': { ...CONVERTING_OUTFITS_SLIDERS },
};

/**
 * Backward compatibility: Mapping from legacy RaceMenu/silhouette sliders
 * to canonical BodySlide morph targets on the UBE Necoco mesh.
 */
export const LEGACY_SILHOUETTE_MAPPING: Readonly<Record<string, string>> = Object.freeze({
  'body.chestSize': 'Necoco_Overall_Boob',
  'body.waistSize': 'Necoco_Body_Addon_Belly',
  'body.buttSize': 'Necoco_Body_Addon_Butt',
  'body.belly': 'Necoco_Body_Addon_Belly',
  'body.thighWidth': 'Necoco_Body_Addon_Leg',
  'body.fat': 'Necoco_Body_Addon_Upper_Body_Smooth',
  'body.hipWidth': 'Upper_Outer_Thighs_Width',
});

/**
 * Maps a set of legacy anatomy parameters (e.g. from an imported preset or legacy store)
 * to BodySlide slider morph values.
 */
export function mapLegacySilhouetteToBodySlide(
  legacyAnatomy: Partial<Record<string, number>> = {}
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [legacyKey, morphKey] of Object.entries(LEGACY_SILHOUETTE_MAPPING)) {
    const val = legacyAnatomy[legacyKey];
    if (typeof val === 'number' && Number.isFinite(val)) {
      // Legacy sliders range from 0 to 100.
      result[morphKey] = Math.max(0, Math.min(100, val));
    }
  }

  return result;
}

/** Canonical Background Bases (pure un-morphed _0 slim baseline) */
export const NUDE_BASE_SLIDERS: Readonly<Record<string, number>> = Object.freeze({});

export const CLOTHED_BASE_SLIDERS: Readonly<Record<string, number>> = Object.freeze({
  NipplesShowUp: 0,
  AreolaErection: 0,
});

/**
 * Computes synchronized dual slider sets:
 * - nudeSliders: High-poly UBE Necoco morphs for femalebody_0 / _1
 * - clothedSliders: Conformed morphs for wardrobe outfits (converting outfits base + delta mapping)
 * - sliders: Unified map for UI slider display
 */
export function computeDualSliders(userSliders: Record<string, number> = {}): {
  nudeSliders: Record<string, number>;
  clothedSliders: Record<string, number>;
  sliders: Record<string, number>;
} {
  const nude: Record<string, number> = { ...NUDE_BASE_SLIDERS, ...userSliders };
  const clothed: Record<string, number> = { ...CLOTHED_BASE_SLIDERS, ...userSliders };

  if (!('NipplesShowUp' in userSliders)) {
    clothed.NipplesShowUp = 0;
  }
  if (!('AreolaErection' in userSliders)) {
    clothed.AreolaErection = 0;
  }

  // Cross-map Necoco slider changes to standard UBE / Clothes Pack outfit morphs:
  if ('Necoco_Overall_Boob' in userSliders) {
    const val = userSliders.Necoco_Overall_Boob;
    clothed.BreastsBigger = Math.max(0, (clothed.BreastsBigger ?? 0) + (val * 0.7));
    clothed.BiggerBreasts_ForOutfits = val * 0.8;
  }
  if ('Necoco_Boob_Base' in userSliders) {
    const delta = userSliders.Necoco_Boob_Base - 100;
    clothed.BreastsBigger = Math.max(0, (clothed.BreastsBigger ?? 0) + delta * 0.4);
  }
  if ('Necoco_Boob_Distance' in userSliders) {
    clothed['BreastCenterGapWidth n|p'] = userSliders.Necoco_Boob_Distance;
  }
  if ('Necoco_Body_Addon_Belly' in userSliders) {
    const delta = userSliders.Necoco_Body_Addon_Belly - 100;
    clothed.BellyFatty = Math.max(0, (clothed.BellyFatty ?? 0) + delta * 0.5);
    clothed.BiggerBelly_ForOutfits = Math.max(0, delta * 0.5);
  }
  if ('Necoco_Body_Addon_Butt' in userSliders) {
    const delta = userSliders.Necoco_Body_Addon_Butt - 100;
    clothed['GluteSize p|n'] = Math.max(0, (clothed['GluteSize p|n'] ?? 0) + delta * 0.5);
    clothed.BiggerButt_ForOutfits = Math.max(0, delta * 0.5);
  }
  if ('Necoco_Body_Addon_Leg' in userSliders) {
    const delta = userSliders.Necoco_Body_Addon_Leg - 100;
    clothed.BiggerThighs_ForOutfits = Math.max(0, delta * 0.5);
    clothed.UpperThighsSizeBig = Math.max(0, (clothed.UpperThighsSizeBig ?? 0) + delta * 0.6);
  }
  if ('Upper_Outer_Thighs_Width' in userSliders) {
    clothed.Upper_Outer_Thighs_Width = userSliders.Upper_Outer_Thighs_Width;
    clothed.BiggerHips_ForOutfits = userSliders.Upper_Outer_Thighs_Width * 0.5;
  }

  // Unified sliders map for UI display: checks userSliders -> nudeSliders -> clothedSliders
  const sliders: Record<string, number> = {
    ...clothed,
    ...nude,
    ...userSliders,
  };

  return { nudeSliders: nude, clothedSliders: clothed, sliders };
}

export interface BodySlideState {
  /** User's personal slider adjustments */
  userSliders: Record<string, number>;
  /** Effective nude sliders (NUDE_BASE + user adjustments) for femalebody_0 / _1 */
  nudeSliders: Record<string, number>;
  /** Effective clothed sliders (CLOTHED_BASE + user adjustments) for outfit_0 / _1 */
  clothedSliders: Record<string, number>;
  /** Canonical alias pointing to clothedSliders for backward compatibility and batch builder */
  sliders: Record<string, number>;
  /** Identifier of the currently applied preset (or null if customized) */
  activePresetId: string | null;
  /** UI search filter query */
  searchQuery: string;
  /** Currently open category accordion header in UI */
  activeCategory: string | null;
  /** Active sub tab in Body Panel: 'bodyslide' or 'skeleton' */
  activeSubTab: 'bodyslide' | 'skeleton';
  /** Async loading state */
  isLoadingPreset: boolean;
  /** Error message if loading failed */
  presetError: string | null;
  /** Registered presets catalogue */
  presets: readonly PresetMeta[];

  // Actions
  setSlider: (name: string, value: number) => void;
  setSliders: (sliders: Record<string, number>) => void;
  resetSlider: (name: string) => void;
  resetSliders: () => void;
  resetToDefaults: () => void;
  clearAllSliders: () => void;
  saveBodyConfig: (name?: string) => { nudeSliders: Record<string, number>; clothedSliders: Record<string, number> };
  loadPreset: (presetIdOrPath: string) => Promise<void>;
  applyPreset: (presetIdOrPath: string) => Promise<void>;
  applyPresetObject: (preset: BodySlidePreset, presetId?: string) => void;
  applyLegacySilhouette: (legacyAnatomy: Partial<Record<string, number>>) => void;
  exportPresetXml: (options?: Partial<ExportBodySlideOptions>) => string;
  setSearchQuery: (query: string) => void;
  setActiveCategory: (category: string | null) => void;
  setActiveSubTab: (tab: 'bodyslide' | 'skeleton') => void;
}

function getInitialUserSliders(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('cc_user_body_sliders');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      return {};
    }
    // Auto-clean old converting-outfits distortion (-153 BreastsZero, 100 SaggingBreastsZone, or stale breast expansion)
    if (
      parsed.BreastsZero === -153 ||
      parsed.SaggingBreastsZone === 100 ||
      parsed['Under Curve'] === 200 ||
      (parsed.BreastsBigger !== undefined && parsed.BreastsBigger > 0)
    ) {
      localStorage.removeItem('cc_user_body_sliders');
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

const initialUserSliders = getInitialUserSliders();
const { nudeSliders: initialNude, clothedSliders: initialClothed, sliders: initialSliders } = computeDualSliders(initialUserSliders);

/**
 * Zustand slice creator for BodySlide state.
 */
export const createBodySlideSlice: StateCreator<BodySlideState> = (set, get) => ({
  userSliders: initialUserSliders,
  nudeSliders: initialNude,
  clothedSliders: initialClothed,
  sliders: initialSliders,
  activePresetId: Object.keys(initialUserSliders).length === 0 ? 'default-slim' : null,
  searchQuery: '',
  activeCategory: '1. Necoco Boob',
  activeSubTab: 'bodyslide',
  isLoadingPreset: false,
  presetError: null,
  presets: BUILTIN_PRESETS,

  setSlider: (name, value) => {
    set((state) => {
      const newUserSliders = {
        ...state.userSliders,
        [name]: value,
      };
      const { nudeSliders, clothedSliders, sliders } = computeDualSliders(newUserSliders);
      return {
        userSliders: newUserSliders,
        nudeSliders,
        clothedSliders,
        sliders,
        activePresetId: null,
      };
    });
  },

  setSliders: (newSliders) => {
    set((state) => {
      const newUserSliders = {
        ...state.userSliders,
        ...newSliders,
      };
      const { nudeSliders, clothedSliders, sliders } = computeDualSliders(newUserSliders);
      return {
        userSliders: newUserSliders,
        nudeSliders,
        clothedSliders,
        sliders,
      };
    });
  },

  resetSlider: (name) => {
    set((state) => {
      const newUserSliders = { ...state.userSliders };
      delete newUserSliders[name];
      const { nudeSliders, clothedSliders, sliders } = computeDualSliders(newUserSliders);
      return {
        userSliders: newUserSliders,
        nudeSliders,
        clothedSliders,
        sliders,
        activePresetId: null,
      };
    });
  },

  resetSliders: () => {
    const defaultSliders = {};
    const { nudeSliders, clothedSliders, sliders } = computeDualSliders(defaultSliders);
    set({
      userSliders: defaultSliders,
      nudeSliders,
      clothedSliders,
      sliders,
      activePresetId: 'default-slim',
    });
  },

  resetToDefaults: () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('cc_user_body_sliders');
      } catch {}
    }
    const defaultSliders = {};
    const { nudeSliders, clothedSliders, sliders } = computeDualSliders(defaultSliders);
    set({
      userSliders: defaultSliders,
      nudeSliders,
      clothedSliders,
      sliders,
      activePresetId: 'default-slim',
    });
  },

  clearAllSliders: () => {
    const { nudeSliders, clothedSliders, sliders } = computeDualSliders({});
    set({
      userSliders: {},
      nudeSliders,
      clothedSliders,
      sliders,
      activePresetId: 'default-slim',
    });
  },

  saveBodyConfig: (name?: string) => {
    const userSliders = get().userSliders;
    const { nudeSliders, clothedSliders } = computeDualSliders(userSliders);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('cc_user_body_sliders', JSON.stringify(userSliders));
      } catch (err) {
        console.warn('[BodySlideStore] Failed to persist user sliders:', err);
      }
    }
    return { nudeSliders, clothedSliders };
  },

  loadPreset: async (presetIdOrPath: string) => {
    const { presets } = get();
    const query = presetIdOrPath.trim().toLowerCase();

    // Check synchronous builtin cache first for instant response
    if (
      query === 'default-slim' ||
      query === 'slim' ||
      query === '0' ||
      query === 'default' ||
      query === 'slim _0 base' ||
      query === 'ube slim'
    ) {
      const presetSliders = { ...BUILTIN_PRESET_SLIDERS['default-slim'] };
      const { nudeSliders, clothedSliders, sliders } = computeDualSliders(presetSliders);
      set({
        userSliders: presetSliders,
        nudeSliders,
        clothedSliders,
        sliders,
        activePresetId: 'default-slim',
        isLoadingPreset: false,
        presetError: null,
      });
      return;
    }

    if (query === 'necoco-v1' || query === 'ube necoco v1' || query === 'v1') {
      const presetSliders = { ...BUILTIN_PRESET_SLIDERS['necoco-v1'] };
      const { nudeSliders, clothedSliders, sliders } = computeDualSliders(presetSliders);
      set({
        userSliders: presetSliders,
        nudeSliders,
        clothedSliders,
        sliders,
        activePresetId: 'necoco-v1',
        isLoadingPreset: false,
        presetError: null,
      });
      return;
    }

    if (query === 'necoco-v2' || query === 'ube necoco v2' || query === 'v2') {
      const presetSliders = { ...BUILTIN_PRESET_SLIDERS['necoco-v2'] };
      const { nudeSliders, clothedSliders, sliders } = computeDualSliders(presetSliders);
      set({
        userSliders: presetSliders,
        nudeSliders,
        clothedSliders,
        sliders,
        activePresetId: 'necoco-v2',
        isLoadingPreset: false,
        presetError: null,
      });
      return;
    }

    if (
      query === 'necoco-converting-outfits' ||
      query === 'converting-outfits' ||
      query === 'converting outfits' ||
      query === 'ube necoco for converting outfits'
    ) {
      const presetSliders = { ...BUILTIN_PRESET_SLIDERS['necoco-converting-outfits'] };
      const { nudeSliders, clothedSliders, sliders } = computeDualSliders(presetSliders);
      set({
        userSliders: presetSliders,
        nudeSliders,
        clothedSliders,
        sliders,
        activePresetId: 'necoco-converting-outfits',
        isLoadingPreset: false,
        presetError: null,
      });
      return;
    }

    // Resolve preset meta from catalogue or treat as custom path
    const meta = presets.find(
      (p) =>
        p.id.toLowerCase() === query ||
        p.name.toLowerCase() === query ||
        p.filePath.toLowerCase() === query,
    );
    const url = meta ? meta.filePath : presetIdOrPath;
    const presetId = meta ? meta.id : null;

    set({ isLoadingPreset: true, presetError: null });

    try {
      const preset = await loadPresetFromUrl(url);
      if (!preset) {
        throw new Error(`Failed to load preset from ${url}`);
      }

      const { nudeSliders, clothedSliders, sliders } = computeDualSliders(preset.sliders);
      set({
        userSliders: { ...preset.sliders },
        nudeSliders,
        clothedSliders,
        sliders,
        activePresetId: presetId,
        isLoadingPreset: false,
        presetError: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        isLoadingPreset: false,
        presetError: message,
      });
      console.error('[useBodySlideStore] Error applying preset:', err);
    }
  },

  applyPreset: async (presetIdOrPath: string) => {
    return get().loadPreset(presetIdOrPath);
  },

  applyPresetObject: (preset: BodySlidePreset, presetId?: string) => {
    const { nudeSliders, clothedSliders, sliders } = computeDualSliders(preset.sliders);
    set({
      userSliders: { ...preset.sliders },
      nudeSliders,
      clothedSliders,
      sliders,
      activePresetId: presetId ?? null,
    });
  },

  applyLegacySilhouette: (legacyAnatomy: Partial<Record<string, number>>) => {
    const mapped = mapLegacySilhouetteToBodySlide(legacyAnatomy);
    if (Object.keys(mapped).length === 0) return;
    set((state) => {
      const newUserSliders = {
        ...state.userSliders,
        ...mapped,
      };
      const { nudeSliders, clothedSliders, sliders } = computeDualSliders(newUserSliders);
      return {
        userSliders: newUserSliders,
        nudeSliders,
        clothedSliders,
        sliders,
      };
    });
  },

  exportPresetXml: (options?: Partial<ExportBodySlideOptions>) => {
    const currentSliders = get().sliders;
    return exportBodySlidePresetXml({
      presetName: options?.presetName ?? (get().activePresetId ?? 'Custom Preset'),
      sliders: { ...currentSliders, ...(options?.sliders ?? {}) },
      ...options,
    });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setActiveCategory: (category: string | null) => {
    set({ activeCategory: category });
  },

  setActiveSubTab: (tab: 'bodyslide' | 'skeleton') => {
    set({ activeSubTab: tab });
  },
});

export const useBodySlideStore = create<BodySlideState>(createBodySlideSlice);

/** Re-export alias for convenience */
export const useBodySlide = useBodySlideStore;
