'use client';

/**
 * Renderer counters published by the scene once every half second.
 *
 * Kept in its own store so sampling never re-renders `CharacterScene` or the
 * panel tree: only the graphics panel subscribes, and only while it is open.
 * `renderer.info` reports counts, never GPU bytes — WebGL does not expose
 * memory totals, which is why the panel labels VRAM as unavailable.
 */

import { create } from 'zustand';

export interface RenderStats {
  /** Frames per second over the last sampling window. */
  fps: number;
  /** Draw calls per frame, averaged over the window. */
  calls: number;
  /** Triangles per frame, averaged over the window. */
  tris: number;
  /** Live GPU textures, not per-frame. */
  textures: number;
}

interface RenderStatsStore extends RenderStats {
  set: (patch: Partial<RenderStats>) => void;
}

export const useRenderStats = create<RenderStatsStore>((set) => ({
  fps: 0,
  calls: 0,
  tris: 0,
  textures: 0,
  set: (patch) => set(patch),
}));
