/**
 * lib/rigger/store.ts
 *
 * Zustand state store for the CC-Kit Auto-Rigger page UI.
 *
 * No 'use client' — this is a pure lib file.
 * No persistence — pipeline results contain non-serialisable Three.js objects.
 */

import * as THREE from 'three';
import { create } from 'zustand';

import type { LandmarkId, LandmarkMap } from '@/lib/rigger/vrmSkeleton';
import type { FitResult } from '@/lib/rigger/templateFitter';
import type { WeightTransferResult } from '@/lib/rigger/weightTransfer';
import type { DiffusionResult } from '@/lib/rigger/heatDiffusion';

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

export type RigStage = 'idle' | 'mesh-loaded' | 'landmarks-ready' | 'rigging' | 'done' | 'error';
export type LandmarkMode = 'auto' | 'manual';

/** The 8 anatomical landmarks required before rigging can proceed. */
const REQUIRED_LANDMARK_IDS: LandmarkId[] = [
  'headTop',
  'neckBase',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftAnkle',
  'rightAnkle',
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns `true` when all 8 required `LandmarkId`s are present and assigned a
 * `THREE.Vector3` in the given partial map.
 */
export function areAllLandmarksSet(landmarks: Partial<LandmarkMap>): boolean {
  return REQUIRED_LANDMARK_IDS.every(
    (id) => landmarks[id] instanceof THREE.Vector3,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Store shape
// ─────────────────────────────────────────────────────────────────────────────

export interface RiggerState {
  // ── Mesh ────────────────────────────────────────────────────────────────
  meshFile: File | null;
  meshUrl: string | null; // object URL for display
  meshGeometry: THREE.BufferGeometry | null;
  meshBbox: THREE.Box3 | null;

  // ── Landmarks ───────────────────────────────────────────────────────────
  landmarks: Partial<LandmarkMap>;
  landmarkMode: LandmarkMode;
  activeLandmark: LandmarkId | null; // which landmark handle is selected
  landmarksConfirmed: boolean;

  // ── Pipeline results (non-serialisable Three.js objects — no persist) ──
  fitResult: FitResult | null;
  rawWeights: WeightTransferResult | null;
  smoothWeights: DiffusionResult | null;

  // ── UI ──────────────────────────────────────────────────────────────────
  stage: RigStage;
  progress: { label: string; value: number } | null;
  error: string | null;

  // ── Preview toggles ─────────────────────────────────────────────────────
  showSkeleton: boolean;
  showWeightMap: boolean;

  // ── Options ─────────────────────────────────────────────────────────────
  characterName: string;
  includeVrm: boolean;
  diffuseIterations: number;
  bilateralStrength: number;
  requiredBonesOnly: boolean;

  // ── Actions ─────────────────────────────────────────────────────────────
  setMeshFile: (file: File) => void;
  setMeshGeometry: (geometry: THREE.BufferGeometry | null) => void;
  setMeshBbox: (bbox: THREE.Box3 | null) => void;
  clearMesh: () => void;
  setLandmark: (id: LandmarkId, pos: THREE.Vector3) => void;
  clearLandmarks: () => void;
  setActiveLandmark: (id: LandmarkId | null) => void;
  setLandmarkMode: (mode: LandmarkMode) => void;
  confirmLandmarks: () => void;
  setFitResult: (r: FitResult) => void;
  setRawWeights: (r: WeightTransferResult) => void;
  setSmoothWeights: (r: DiffusionResult) => void;
  setStage: (s: RigStage) => void;
  setProgress: (p: { label: string; value: number } | null) => void;
  setError: (e: string | null) => void;
  toggleSkeleton: () => void;
  toggleWeightMap: () => void;
  setCharacterName: (n: string) => void;
  setOption: <
    K extends keyof Pick<
      RiggerState,
      'includeVrm' | 'diffuseIterations' | 'bilateralStrength' | 'requiredBonesOnly'
    >,
  >(
    key: K,
    val: RiggerState[K],
  ) => void;
  reset: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default state slice (state only, no actions)
// ─────────────────────────────────────────────────────────────────────────────

type RiggerStateData = Omit<
  RiggerState,
  | 'setMeshFile'
  | 'setMeshGeometry'
  | 'setMeshBbox'
  | 'clearMesh'
  | 'setLandmark'
  | 'clearLandmarks'
  | 'setActiveLandmark'
  | 'setLandmarkMode'
  | 'confirmLandmarks'
  | 'setFitResult'
  | 'setRawWeights'
  | 'setSmoothWeights'
  | 'setStage'
  | 'setProgress'
  | 'setError'
  | 'toggleSkeleton'
  | 'toggleWeightMap'
  | 'setCharacterName'
  | 'setOption'
  | 'reset'
>;

const DEFAULT_STATE: RiggerStateData = {
  // Mesh
  meshFile: null,
  meshUrl: null,
  meshGeometry: null,
  meshBbox: null,
  // Landmarks
  landmarks: {},
  landmarkMode: 'auto',
  activeLandmark: null,
  landmarksConfirmed: false,
  // Pipeline results
  fitResult: null,
  rawWeights: null,
  smoothWeights: null,
  // UI
  stage: 'idle',
  progress: null,
  error: null,
  // Preview toggles
  showSkeleton: true,
  showWeightMap: false,
  // Options
  characterName: '',
  includeVrm: true,
  diffuseIterations: 10,
  bilateralStrength: 0.5,
  requiredBonesOnly: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useRiggerStore = create<RiggerState>()((set) => ({
  ...DEFAULT_STATE,

  // ── Mesh ──────────────────────────────────────────────────────────────────

  setMeshFile: (file) => {
    // Revoke any previous object URL to avoid memory leaks.
    set((s) => {
      if (s.meshUrl) URL.revokeObjectURL(s.meshUrl);
      return {
        meshFile: file,
        meshUrl: URL.createObjectURL(file),
        meshGeometry: null,
        meshBbox: null,
        stage: 'mesh-loaded',
        // Reset downstream state when a new mesh is loaded.
        landmarks: {},
        landmarksConfirmed: false,
        fitResult: null,
        rawWeights: null,
        smoothWeights: null,
        progress: null,
        error: null,
      };
    });
  },

  setMeshGeometry: (geometry) => set({ meshGeometry: geometry }),

  setMeshBbox: (bbox) => set({ meshBbox: bbox }),

  clearMesh: () => {
    set((s) => {
      if (s.meshUrl) URL.revokeObjectURL(s.meshUrl);
      return { ...DEFAULT_STATE };
    });
  },

  // ── Landmarks ─────────────────────────────────────────────────────────────

  setLandmark: (id, pos) => {
    set((s) => ({
      landmarks: { ...s.landmarks, [id]: pos },
      landmarksConfirmed: false,
    }));
  },

  clearLandmarks: () => {
    set({ landmarks: {}, landmarksConfirmed: false, activeLandmark: null });
  },

  setActiveLandmark: (id) => {
    set({ activeLandmark: id });
  },

  setLandmarkMode: (mode) => {
    set({ landmarkMode: mode });
  },

  confirmLandmarks: () => {
    set((s) => ({
      landmarksConfirmed: areAllLandmarksSet(s.landmarks),
      stage: areAllLandmarksSet(s.landmarks) ? 'landmarks-ready' : s.stage,
    }));
  },

  // ── Pipeline results ──────────────────────────────────────────────────────

  setFitResult: (r) => set({ fitResult: r }),

  setRawWeights: (r) => set({ rawWeights: r }),

  setSmoothWeights: (r) => set({ smoothWeights: r }),

  // ── UI ────────────────────────────────────────────────────────────────────

  setStage: (s) => set({ stage: s }),

  setProgress: (p) => set({ progress: p }),

  setError: (e) => set({ error: e, stage: e !== null ? 'error' : 'idle' }),

  // ── Preview toggles ───────────────────────────────────────────────────────

  toggleSkeleton: () => set((s) => ({ showSkeleton: !s.showSkeleton })),

  toggleWeightMap: () => set((s) => ({ showWeightMap: !s.showWeightMap })),

  // ── Options ───────────────────────────────────────────────────────────────

  setCharacterName: (n) => set({ characterName: n }),

  setOption: (key, val) => set({ [key]: val } as Pick<RiggerState, typeof key>),

  // ── Reset ─────────────────────────────────────────────────────────────────

  reset: () => {
    set((s) => {
      if (s.meshUrl) URL.revokeObjectURL(s.meshUrl);
      return { ...DEFAULT_STATE };
    });
  },
}));
