/**
 * lib/morphs/faceMorphStore.ts
 *
 * Zustand store for UBE FaceGen Character Generation (.tri) morph sliders.
 * Manages slider weights across the 7 facial anatomy categories.
 */

import { create } from 'zustand';

export type FaceMorphCategory =
  | 'Head'
  | 'Face'
  | 'Eyes'
  | 'Brow'
  | 'Mouth'
  | 'Nose'
  | 'Extra/Pers';

export interface FaceSliderDef {
  name: string;
  label: string;
  category: FaceMorphCategory;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

/** Core morph sliders corresponding to CharGen .tri blend targets */
export const FACE_SLIDERS: FaceSliderDef[] = [
  // ── Brow ─────────────────────────────────────────────────────────────
  { name: 'BrowIn', label: 'Brow Depth (In)', category: 'Brow', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'BrowUp', label: 'Brow Height (Up/Down)', category: 'Brow', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'BrowForward', label: 'Brow Forward', category: 'Brow', min: -100, max: 100, step: 1, defaultValue: 0 },

  // ── Eyes ─────────────────────────────────────────────────────────────
  { name: 'EyesBack', label: 'Eyes Depth (Back/Fwd)', category: 'Eyes', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'EyesMoveDown', label: 'Eyes Position (Up/Down)', category: 'Eyes', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'Tear_duct_fix', label: 'Tear Duct Alignment', category: 'Eyes', min: 0, max: 100, step: 1, defaultValue: 0 },

  // ── Nose ─────────────────────────────────────────────────────────────
  { name: 'NoseShort', label: 'Nose Length (Short/Long)', category: 'Nose', min: -100, max: 100, step: 1, defaultValue: 0 },

  // ── Mouth ────────────────────────────────────────────────────────────
  { name: 'LipMoveOut', label: 'Lips Depth (Out/In)', category: 'Mouth', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'LipMoveUp', label: 'Lips Height (Up/Down)', category: 'Mouth', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'LipMoveDown', label: 'Lower Lip Position', category: 'Mouth', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'Underbite', label: 'Jaw Underbite / Overbite', category: 'Mouth', min: -100, max: 100, step: 1, defaultValue: 0 },

  // ── Face & Cheeks ────────────────────────────────────────────────────
  { name: 'ChinThin', label: 'Chin Width (Thin/Wide)', category: 'Face', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'ChinMoveUp', label: 'Chin Height (Up/Down)', category: 'Face', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'JawWide', label: 'Jaw Width', category: 'Face', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'CheeksIn', label: 'Cheek Fullness (In/Out)', category: 'Face', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'CheeksUp', label: 'Cheekbone Height (Up)', category: 'Face', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'CheeksDown', label: 'Cheek Position (Down)', category: 'Face', min: -100, max: 100, step: 1, defaultValue: 0 },

  // ── Head ─────────────────────────────────────────────────────────────
  { name: 'NeckSize__HEAD', label: 'Neck Circumference', category: 'Head', min: -100, max: 100, step: 1, defaultValue: 0 },
  { name: 'UpperChestHeight_n|p__HEAD', label: 'Collarbone / Chest Height', category: 'Head', min: -100, max: 100, step: 1, defaultValue: 0 },

  // ── Extra/Pers ───────────────────────────────────────────────────────
  { name: 'VampireMorph', label: 'Vampire Cheek & Lip Hollow', category: 'Extra/Pers', min: 0, max: 100, step: 1, defaultValue: 0 },
];

export interface FaceMorphState {
  /** Active slider values: sliderName -> number (-100..100 or 0..100) */
  faceSliders: Record<string, number>;
  activeCategory: FaceMorphCategory;
  searchQuery: string;

  setFaceSlider: (name: string, value: number) => void;
  setFaceSliders: (sliders: Record<string, number>) => void;
  resetFaceSlider: (name: string) => void;
  resetFaceSliders: () => void;
  setActiveCategory: (category: FaceMorphCategory) => void;
  setSearchQuery: (query: string) => void;
}

export const useFaceMorphStore = create<FaceMorphState>((set) => ({
  faceSliders: {},
  activeCategory: 'Face',
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
