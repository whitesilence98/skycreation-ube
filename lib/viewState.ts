'use client';

import { create } from 'zustand';

/** Transient camera telemetry; never persisted or subscribed to by the scene. */
export const useViewState = create<{ yawDeg: number; pitchDeg: number; distance: number }>(() => ({
  yawDeg: 0, pitchDeg: 0, distance: 0.75,
}));
