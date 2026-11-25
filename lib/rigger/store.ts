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

import {
  LANDMARK_IDS,
  getLandmarkIdsForPreset,
  nextUnplacedLandmark,
  type LandmarkId,
  type LandmarkMap,
  type LandmarkPreset,
  type RequiredLandmarkId,
} from '@/lib/rigger/vrmSkeleton';
import type { FitResult } from '@/lib/rigger/templateFitter';
import type { WeightTransferResult } from '@/lib/rigger/weightTransfer';
import type { DiffusionResult } from '@/lib/rigger/heatDiffusion';
import type { TestAnimationMode } from '@/lib/rigger/testAnimations';
import type { ExportTarget } from '@/lib/rigger/engineProfiles';

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

export type RigStage = 'idle' | 'mesh-loaded' | 'landmarks-ready' | 'rigging' | 'done' | 'error';
export type UiPhase = 'rig' | 'preview' | 'export';
export type LandmarkMode = 'auto' | 'manual';
export type { ExportTarget };

/**
 * The 8 anatomical landmarks required before rigging can proceed. The list
 * itself lives in `vrmSkeleton.ts` so the store, the 3D editor and the sidebar
 * cannot drift apart.
 */
const REQUIRED_LANDMARK_IDS: readonly RequiredLandmarkId[] = LANDMARK_IDS;

/** Bilateral landmark pairs mirrored when `useSymmetry` is enabled. */
export const MIRROR_PAIR: Partial<Record<LandmarkId, LandmarkId>> = {
  leftShoulder:  'rightShoulder',
  rightShoulder: 'leftShoulder',
  leftElbow:     'rightElbow',
  rightElbow:    'leftElbow',
  leftWrist:     'rightWrist',
  rightWrist:    'leftWrist',
  leftHip:       'rightHip',
  rightHip:      'leftHip',
  leftKnee:      'rightKnee',
  rightKnee:     'leftKnee',
  leftAnkle:     'rightAnkle',
  rightAnkle:    'leftAnkle',
};

const CENTER_LANDMARKS: ReadonlySet<LandmarkId> = new Set([
  'headTop',
  'chin',
  'neckBase',
  'groin',
]);

// Re-export nextUnplacedLandmark for convenience while keeping check_rigger_landmarks.cjs intact.
export { nextUnplacedLandmark };

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
  meshUrl: string | null;
  meshGeometry: THREE.BufferGeometry | null;
  meshMaterial: THREE.Material | THREE.Material[] | null;
  meshBbox: THREE.Box3 | null;

  // ── Landmarks ───────────────────────────────────────────────────────────
  landmarks: Partial<LandmarkMap>;
  landmarkPreset: LandmarkPreset;
  landmarkMode: LandmarkMode;
  activeLandmark: LandmarkId | null;
  isDraggingLandmark: boolean;
  useSymmetry: boolean;
  landmarksConfirmed: boolean;
  /** Brief flash when a placement click misses the mesh. */
  landmarkMissFlash: boolean;

  // ── Pipeline results (non-serialisable Three.js objects — no persist) ──
  fitResult: FitResult | null;
  rawWeights: WeightTransferResult | null;
  smoothWeights: DiffusionResult | null;

  // ── UI ──────────────────────────────────────────────────────────────────
  stage: RigStage;
  uiPhase: UiPhase;
  lockCamera: boolean;
  progress: { label: string; value: number } | null;
  error: string | null;

  // ── Preview toggles ─────────────────────────────────────────────────────
  showSkeleton: boolean;
  showWeightMap: boolean;
  testAnimation: TestAnimationMode;

  // ── Options ─────────────────────────────────────────────────────────────
  characterName: string;
  exportTarget: ExportTarget;
  includeVrm: boolean;
  diffuseIterations: number;
  bilateralStrength: number;
  requiredBonesOnly: boolean;
  includeSecondaryBones: boolean;

  // ── Actions ─────────────────────────────────────────────────────────────
  setMeshFile: (file: File) => void;
  setMeshGeometry: (geometry: THREE.BufferGeometry | null) => void;
  setMeshMaterial: (material: THREE.Material | THREE.Material[] | null) => void;
  setMeshBbox: (bbox: THREE.Box3 | null) => void;
  clearMesh: () => void;
  setLandmark: (id: LandmarkId, pos: THREE.Vector3) => void;
  setLandmarkPreset: (preset: LandmarkPreset) => void;
  clearLandmarks: () => void;
  /** Remove exactly one marker (and its mirrored partner if symmetry is enabled). */
  deleteLandmark: (id: LandmarkId) => void;
  setActiveLandmark: (id: LandmarkId | null) => void;
  setLandmarkMissFlash: (v: boolean) => void;
  setIsDraggingLandmark: (dragging: boolean) => void;
  setUseSymmetry: (use: boolean) => void;
  setLandmarkMode: (mode: LandmarkMode) => void;
  confirmLandmarks: () => void;
  setFitResult: (r: FitResult) => void;
  setRawWeights: (r: WeightTransferResult) => void;
  setSmoothWeights: (r: DiffusionResult) => void;
  setStage: (s: RigStage) => void;
  setUiPhase: (phase: UiPhase) => void;
  setLockCamera: (locked: boolean) => void;
  backToRig: () => void;
  setProgress: (p: { label: string; value: number } | null) => void;
  setError: (e: string | null) => void;
  toggleSkeleton: () => void;
  toggleWeightMap: () => void;
  setTestAnimation: (mode: TestAnimationMode) => void;
  setCharacterName: (n: string) => void;
  setExportTarget: (target: ExportTarget) => void;
  setOption: <
    K extends keyof Pick<
      RiggerState,
      | 'includeVrm'
      | 'diffuseIterations'
      | 'bilateralStrength'
      | 'requiredBonesOnly'
      | 'includeSecondaryBones'
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
  | 'setMeshMaterial'
  | 'setMeshBbox'
  | 'clearMesh'
  | 'setLandmark'
  | 'setLandmarkPreset'
  | 'clearLandmarks'
  | 'deleteLandmark'
  | 'setActiveLandmark'
  | 'setLandmarkMissFlash'
  | 'setIsDraggingLandmark'
  | 'setUseSymmetry'
  | 'setLandmarkMode'
  | 'confirmLandmarks'
  | 'setFitResult'
  | 'setRawWeights'
  | 'setSmoothWeights'
  | 'setStage'
  | 'setUiPhase'
  | 'setLockCamera'
  | 'backToRig'
  | 'setProgress'
  | 'setError'
  | 'toggleSkeleton'
  | 'toggleWeightMap'
  | 'setTestAnimation'
  | 'setCharacterName'
  | 'setExportTarget'
  | 'setOption'
  | 'reset'
>;

const DEFAULT_STATE: RiggerStateData = {
  // Mesh
  meshFile: null,
  meshUrl: null,
  meshGeometry: null,
  meshMaterial: null,
  meshBbox: null,
  // Landmarks
  landmarks: {},
  landmarkPreset: '14',
  landmarkMode: 'auto',
  activeLandmark: null,
  isDraggingLandmark: false,
  useSymmetry: true,
  landmarksConfirmed: false,
  landmarkMissFlash: false,
  // Pipeline results
  fitResult: null,
  rawWeights: null,
  smoothWeights: null,
  // UI
  stage: 'idle',
  uiPhase: 'rig',
  lockCamera: false,
  progress: null,
  error: null,
  // Preview toggles
  showSkeleton: true,
  showWeightMap: false,
  testAnimation: 'tpose' as TestAnimationMode,
  // Options
  characterName: '',
  exportTarget: 'vrm',
  includeVrm: true,
  diffuseIterations: 4,
  bilateralStrength: 0.5,
  requiredBonesOnly: false,
  includeSecondaryBones: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useRiggerStore = create<RiggerState>()((set) => ({
  ...DEFAULT_STATE,

  // ── Mesh ──────────────────────────────────────────────────────────────────

  setMeshFile: (file) => {
    set((s) => {
      if (s.meshUrl) URL.revokeObjectURL(s.meshUrl);
      return {
        meshFile: file,
        meshUrl: URL.createObjectURL(file),
        meshGeometry: null,
        meshMaterial: null,
        meshBbox: null,
        stage: 'mesh-loaded',
        uiPhase: 'rig',
        lockCamera: false,
        landmarks: {},
        landmarksConfirmed: false,
        fitResult: null,
        rawWeights: null,
        smoothWeights: null,
        progress: null,
        error: null,
        testAnimation: 'tpose' as TestAnimationMode,
      };
    });
  },

  setMeshGeometry: (geometry) => set({ meshGeometry: geometry }),

  setMeshMaterial: (material) => set({ meshMaterial: material }),

  setMeshBbox: (bbox) => set({ meshBbox: bbox }),

  clearMesh: () => {
    set((s) => {
      if (s.meshUrl) URL.revokeObjectURL(s.meshUrl);
      return { ...DEFAULT_STATE };
    });
  },

  // ── Landmarks ─────────────────────────────────────────────────────────────

  setLandmark: (id, pos) => {
    set((s) => {
      const nextLandmarks: Partial<LandmarkMap> = { ...s.landmarks, [id]: pos };
      if (s.useSymmetry) {
        if (CENTER_LANDMARKS.has(id)) {
          nextLandmarks[id] = new THREE.Vector3(0, pos.y, pos.z);
        } else {
          const pairId = MIRROR_PAIR[id];
          if (pairId) {
            nextLandmarks[pairId] = new THREE.Vector3(-pos.x, pos.y, pos.z);
          }
        }
      }
      return {
        landmarks: nextLandmarks,
        landmarksConfirmed: false,
      };
    });
  },

  setLandmarkPreset: (preset) => {
    set((s) => {
      const allowed = getLandmarkIdsForPreset(preset);
      const nextActive =
        s.activeLandmark && allowed.includes(s.activeLandmark)
          ? s.activeLandmark
          : null;
      return {
        landmarkPreset: preset,
        activeLandmark: nextActive,
      };
    });
  },

  clearLandmarks: () => {
    set({ landmarks: {}, landmarksConfirmed: false, activeLandmark: null, isDraggingLandmark: false });
  },

  deleteLandmark: (id) => {
    set((s) => {
      const nextLandmarks = { ...s.landmarks };
      delete nextLandmarks[id];
      if (s.useSymmetry) {
        const partner = MIRROR_PAIR[id];
        if (partner) delete nextLandmarks[partner];
      }
      return {
        landmarks: nextLandmarks,
        landmarksConfirmed: false,
        activeLandmark: id,
        isDraggingLandmark: false,
      };
    });
  },

  setActiveLandmark: (id) => {
    set({ activeLandmark: id });
  },

  setLandmarkMissFlash: (v) => set({ landmarkMissFlash: v }),

  setIsDraggingLandmark: (dragging) => {
    set({ isDraggingLandmark: dragging });
  },

  setUseSymmetry: (use) => {
    set({ useSymmetry: use });
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

  setUiPhase: (phase) => set((s) => ({
    uiPhase: phase,
    ...(phase !== 'rig' ? { activeLandmark: null, isDraggingLandmark: false } : {}),
    ...(phase === 'preview' && !s.fitResult ? {} : {}),
  })),

  setLockCamera: (locked) => set({ lockCamera: locked }),

  backToRig: () => set((s) => ({
    uiPhase: 'rig',
    stage: areAllLandmarksSet(s.landmarks) ? 'landmarks-ready' : s.meshUrl ? 'mesh-loaded' : 'idle',
    testAnimation: 'tpose' as TestAnimationMode,
    fitResult: null,
    rawWeights: null,
    smoothWeights: null,
    showWeightMap: false,
    progress: null,
    error: null,
    activeLandmark: null,
    isDraggingLandmark: false,
  })),

  setProgress: (p) => set({ progress: p }),

  setError: (e) => set((s) => {
    if (e === null) {
      if (s.stage !== 'error') return { error: null };
      return {
        error: null,
        stage: s.fitResult ? 'done' : s.meshUrl ? (areAllLandmarksSet(s.landmarks) ? 'landmarks-ready' : 'mesh-loaded') : 'idle',
      };
    }
    return { error: e, stage: 'error' };
  }),

  // ── Preview toggles ───────────────────────────────────────────────────────

  toggleSkeleton: () => set((s) => ({ showSkeleton: !s.showSkeleton })),

  toggleWeightMap: () => set((s) => ({ showWeightMap: !s.showWeightMap })),

  setTestAnimation: (mode) => set({ testAnimation: mode }),

  // ── Options ───────────────────────────────────────────────────────────────

  setCharacterName: (n) => set({ characterName: n }),

  setExportTarget: (target) => set({ exportTarget: target }),

  setOption: (key, val) => set({ [key]: val } as Pick<RiggerState, typeof key>),

  // ── Reset ─────────────────────────────────────────────────────────────────

  reset: () => {
    set((s) => {
      if (s.meshUrl) URL.revokeObjectURL(s.meshUrl);
      return { ...DEFAULT_STATE };
    });
  },
}));
