'use client';

import { create } from 'zustand';

/**
 * Transient state for the Smart Customization screen.
 *
 * Kept out of `useCharacter` on purpose: this is one screen's working state —
 * a staged file, a preview edge list, a revert target — not character data.
 * Putting it in the persisted character store would mean writing a `File` and
 * a `Float32Array` through the session serialiser, and it must not survive a
 * reload. Kept out of the component tree so the page body and the footer can
 * share it without one owning the other.
 */

export type SmartStatus = 'idle' | 'parsing' | 'rejected' | 'staged' | 'image';

export interface StagedMesh {
  name: string;
  verts: number;
  tris: number;
  scale: number;
  rotatedZUp: boolean;
  previewEdges: Float32Array;
  /** The head worn before the import; `Esc` restores it. */
  previousHeadId: string | null;
}

interface SmartSession {
  status: SmartStatus;
  error: string | null;
  imageUrl: string | null;
  staged: StagedMesh | null;
  /** True once a mesh has been assigned to the character and not yet reverted. */
  applied: boolean;
  setStatus: (status: SmartStatus) => void;
  setError: (error: string | null) => void;
  setImageUrl: (url: string | null) => void;
  stage: (mesh: StagedMesh) => void;
  markApplied: () => void;
  markReverted: () => void;
  clear: () => void;
  reset: () => void;
}

export const useSmartSession = create<SmartSession>()((set) => ({
  status: 'idle',
  error: null,
  imageUrl: null,
  staged: null,
  applied: false,
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setImageUrl: (imageUrl) => set({ imageUrl }),
  stage: (staged) => set({ staged, status: 'staged', error: null }),
  markApplied: () => set({ applied: true }),
  markReverted: () => set({ applied: false }),
  clear: () => set({ staged: null, status: 'idle', error: null, applied: false }),
  reset: () => set({ status: 'idle', error: null, imageUrl: null, staged: null, applied: false }),
}));
