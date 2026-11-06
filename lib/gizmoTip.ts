'use client';

import { create } from 'zustand';

/**
 * Screen-space position of the active bone's tooltip anchor, in CSS pixels
 * relative to the canvas.
 *
 * The tooltip is DOM, but it has to sit on top of the WebGL canvas at a point
 * that only the scene knows. Rendering it *inside* <Canvas> would put it in
 * react-three-fiber's reconciler, which only understands three objects — a
 * `createPortal` to an HTML host still gets reconciled as `<div>` there and
 * throws "Div is not part of the THREE namespace". So the scene writes the
 * projected point here each frame and the HUD layer, which is plain React DOM,
 * reads it back.
 */
export interface GizmoTipState {
  x: number;
  y: number;
  /** False when the anchor is behind the camera. */
  visible: boolean;
  setTip: (x: number, y: number, visible: boolean) => void;
}

export const useGizmoTip = create<GizmoTipState>((set) => ({
  x: 0,
  y: 0,
  visible: false,
  setTip: (x, y, visible) => set({ x, y, visible }),
}));
