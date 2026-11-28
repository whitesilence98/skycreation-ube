'use client';

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

const graphicsStorage: StateStorage = {
  getItem: (key) => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore storage quota or private-mode errors
    }
  },
  removeItem: (key) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage errors
    }
  },
};

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'custom';
export type RenderScaleOption = 0.85 | 1.0 | 1.25 | 1.5;
export type ShadowQualityOption = 'off' | 'low' | 'medium' | 'high';
export type AnisotropyOption = 1 | 4 | 8;
export type RoomPostFxOption = 'off' | 'station' | 'always';
export type MaxFpsOption = 30 | 60 | 0;

export interface GraphicsSettingsValues {
  renderScale: RenderScaleOption;
  shadowQuality: ShadowQualityOption;
  anisotropy: AnisotropyOption;
  roomPostFx: RoomPostFxOption;
  maxFps: MaxFpsOption;
  glassBlur: boolean;
}

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPreset, 'custom'>, GraphicsSettingsValues> = {
  low: {
    renderScale: 0.85,
    shadowQuality: 'off',
    anisotropy: 1,
    roomPostFx: 'off',
    maxFps: 30,
    glassBlur: false,
  },
  medium: {
    renderScale: 1.25,
    shadowQuality: 'medium',
    anisotropy: 4,
    roomPostFx: 'station',
    maxFps: 60,
    glassBlur: false,
  },
  high: {
    renderScale: 1.5,
    shadowQuality: 'high',
    anisotropy: 8,
    roomPostFx: 'always',
    maxFps: 60,
    glassBlur: true,
  },
};

export const SHADOW_QUALITY_SPEC: Record<
  ShadowQualityOption,
  { enabled: boolean; mapSize: 512 | 1024 | 2048; soft: boolean }
> = {
  off: { enabled: false, mapSize: 512, soft: false },
  low: { enabled: true, mapSize: 512, soft: false },
  medium: { enabled: true, mapSize: 1024, soft: false },
  high: { enabled: true, mapSize: 2048, soft: true },
};

export interface GraphicsSettingsState extends GraphicsSettingsValues {
  preset: GraphicsPreset;
  applyPreset: (preset: Exclude<GraphicsPreset, 'custom'>) => void;
  updateGraphics: (patch: Partial<GraphicsSettingsValues>) => void;
}

export const useGraphicsSettings = create<GraphicsSettingsState>()(
  persist(
    (set) => ({
      preset: 'medium',
      ...GRAPHICS_PRESETS.medium,
      applyPreset: (preset) =>
        set({
          preset,
          ...GRAPHICS_PRESETS[preset],
        }),
      updateGraphics: (patch) =>
        set((state) => ({
          ...state,
          ...patch,
          preset: 'custom',
        })),
    }),
    {
      name: 'cc-kit-graphics-v1',
      storage: createJSONStorage(() => graphicsStorage),
    },
  ),
);
