/**
 * lib/morphs/faceMorphStore.ts
 *
 * Zustand store for UBE FaceGen Character Generation (.tri) morph sliders.
 * Manages slider weights across the 7 facial anatomy categories.
 */

import { create } from 'zustand';

export type FaceMorphCategory =
  | 'Brows'
  | 'Eyes'
  | 'Nose'
  | 'Lips'
  | 'Cheeks'
  | 'Jaw';

export type FaceMorphSectionId =
  | 'eyebrows'
  | 'eyes'
  | 'nose'
  | 'lips'
  | 'cheeks'
  | 'jaw';

export interface FaceSliderDef {
  /** Primary morph name stored in faceSliders / faceMorphs (and applied for positive values). */
  name: string;
  /** Optional authored opposite .tri morph name applied when value < 0 (e.g. BrowUp vs BrowDown). */
  negName?: string;
  label: string;
  category: FaceMorphCategory;
  section: FaceMorphSectionId;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

/**
 * Bidirectional FaceGen CharGen .tri morph sliders covering all 17 opposing
 * pairs (34 targets) in FemaleHeadCharGen.tri / Brows / Eyes / Lashes plus
 * VampireMorph in MouthHumanF_tangentChargen.tri.
 */
export const FACE_SLIDERS: FaceSliderDef[] = [
  // ── Brows ────────────────────────────────────────────────────────────
  { name: 'BrowUp', negName: 'BrowDown', label: 'Brow Height', category: 'Brows', section: 'eyebrows', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'BrowForward', negName: 'BrowBack', label: 'Brow Depth', category: 'Brows', section: 'eyebrows', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'BrowIn', negName: 'BrowOut', label: 'Brow Spacing', category: 'Brows', section: 'eyebrows', min: -100, max: 100, step: 1, defaultValue: 0 },

  // ── Eyes ─────────────────────────────────────────────────────────────
  { name: 'EyesMoveUp', negName: 'EyesMoveDown', label: 'Eye Vertical Position', category: 'Eyes', section: 'eyes', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'EyesMoveOut', negName: 'EyesMoveIn', label: 'Eye Spacing', category: 'Eyes', section: 'eyes', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'EyesForward', negName: 'EyesBack', label: 'Eye Depth', category: 'Eyes', section: 'eyes', min: -100, max: 100, step: 1, defaultValue: 0 },

  // ── Nose ─────────────────────────────────────────────────────────────
  { name: 'NoseUp', negName: 'NoseDown', label: 'Nose Bridge / Tip Height', category: 'Nose', section: 'nose', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'NoseLong', negName: 'NoseShort', label: 'Nose Length', category: 'Nose', section: 'nose', min: -100, max: 100, step: 1, defaultValue: 0 },

  // ── Lips & Mouth ─────────────────────────────────────────────────────
  { name: 'LipMoveOut', negName: 'LipMoveIn', label: 'Lip Protrusion', category: 'Lips', section: 'lips', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'LipMoveUp', negName: 'LipMoveDown', label: 'Lip Vertical Position', category: 'Lips', section: 'lips', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'Overbite', negName: 'Underbite', label: 'Bite Balance (Over / Under)', category: 'Lips', section: 'lips', min: -100, max: 100, step: 1, defaultValue: 0 },

  // ── Cheeks ───────────────────────────────────────────────────────────
  { name: 'CheeksUp', negName: 'CheeksDown', label: 'Cheekbone Height', category: 'Cheeks', section: 'cheeks', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'CheeksOut', negName: 'CheeksIn', label: 'Cheek Fullness (Full / Hollow)', category: 'Cheeks', section: 'cheeks', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'VampireMorph', label: 'Gaunt Cheek Contour', category: 'Cheeks', section: 'cheeks', min: 0, max: 100, step: 1, defaultValue: 0 },

  // ── Jaw & Chin ───────────────────────────────────────────────────────
  { name: 'JawWide', negName: 'JawNarrow', label: 'Jaw Width', category: 'Jaw', section: 'jaw', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'JawUp', negName: 'JawDown', label: 'Jaw Height', category: 'Jaw', section: 'jaw', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'ChinMoveUp', negName: 'ChinMoveDown', label: 'Chin Height', category: 'Jaw', section: 'jaw', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'ChinWide', negName: 'ChinThin', label: 'Chin Width', category: 'Jaw', section: 'jaw', min: -100, max: 100, step: 1, defaultValue: 0 },
];

export const FACE_SLIDERS_BY_NAME: Record<string, FaceSliderDef> = Object.fromEntries(
  FACE_SLIDERS.map((s) => [s.name, s]),
);

export function getFaceSlidersForSection(section: string): FaceSliderDef[] {
  return FACE_SLIDERS.filter((s) => s.section === section);
}

export interface FaceMorphState {
  /** Active slider values: sliderName -> number (-100..100 or 0..100) */
  faceSliders: Record<string, number>;
  activeCategory: FaceMorphCategory;
  searchQuery: string;

  setFaceSlider: (name: string, value: number) => void;
  setFaceSliders: (sliders: Record<string, number>) => void;
  setFaceSlidersExact: (sliders: Record<string, number>) => void;
  resetFaceSlider: (name: string) => void;
  resetFaceSliders: () => void;
  setActiveCategory: (category: FaceMorphCategory) => void;
  setSearchQuery: (query: string) => void;
}

export const useFaceMorphStore = create<FaceMorphState>((set) => ({
  faceSliders: {},
  activeCategory: 'Brows',
  searchQuery: '',

  setFaceSlider: (name, value) => {
    set((state) => ({
      faceSliders: {
        ...state.faceSliders,
        [name]: value,
      },
    }));
  },

  setFaceSliders: (newSliders) => {
    set((state) => ({
      faceSliders: {
        ...state.faceSliders,
        ...newSliders,
      },
    }));
  },

  setFaceSlidersExact: (sliders) => {
    set({ faceSliders: { ...sliders } });
  },

  resetFaceSlider: (name) => {
    set((state) => {
      const next = { ...state.faceSliders };
      delete next[name];
      return { faceSliders: next };
    });
  },

  resetFaceSliders: () => {
    set({ faceSliders: {} });
  },

  setActiveCategory: (activeCategory) => {
    set({ activeCategory });
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery });
  },
}));
