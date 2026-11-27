'use client';

import { create } from 'zustand';
import type { ActionTag, NeedKey } from '@/lib/builder/smartObjects';

export type TimeScale = 0 | 1 | 3 | 10;
export type LifeActivityState = 'idle' | 'walking' | 'acting';

export interface LifeActivitySnapshot {
  state: LifeActivityState;
  actionTag: ActionTag;
  label: string;
  reason: string;
  targetItemId: string | null;
  progress: number;
}

export type NeedsMap = Record<NeedKey, number>;

export interface RoomLifeState {
  /** Total elapsed in-game minutes (`510` = Day 1, 08:30). */
  simTimeMinutes: number;
  timeScale: TimeScale;
  aiEnabled: boolean;
  needs: NeedsMap;
  activity: LifeActivitySnapshot;
  /** Recently placed prop IDs given a temporary curiosity score boost. */
  recentItemIds: string[];
  thoughtLog: string[];

  advanceClock: (deltaGameMinutes: number) => void;
  setTimeScale: (scale: TimeScale) => void;
  toggleAi: () => void;
  setAiEnabled: (enabled: boolean) => void;
  setNeeds: (needs: NeedsMap) => void;
  setActivity: (activity: LifeActivitySnapshot) => void;
  notifyItemPlaced: (itemId: string) => void;
  consumeRecentItem: (itemId: string) => void;
  pushThought: (entry: string) => void;
  resetLife: () => void;
}

const DEFAULT_NEEDS: NeedsMap = {
  energy: 86,
  comfort: 82,
  fun: 78,
  grooming: 84,
};

const DEFAULT_ACTIVITY: LifeActivitySnapshot = {
  state: 'idle',
  actionTag: 'idle',
  label: 'Relaxing in Room',
  reason: 'Looking around',
  targetItemId: null,
  progress: 0,
};

export function formatSimClock(simTimeMinutes: number): {
  day: number;
  hours: number;
  minutes: number;
  formatted: string;
  isNight: boolean;
} {
  const safe = Math.max(0, simTimeMinutes);
  const day = Math.floor(safe / 1440) + 1;
  const dayMins = Math.floor(safe % 1440);
  const hours = Math.floor(dayMins / 60);
  const minutes = dayMins % 60;
  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const isNight = hours >= 20 || hours < 6;
  return { day, hours, minutes, formatted: `${hh}:${mm}`, isNight };
}

export const useRoomLifeStore = create<RoomLifeState>((set) => ({
  simTimeMinutes: 510,
  timeScale: 1,
  aiEnabled: true,
  needs: { ...DEFAULT_NEEDS },
  activity: { ...DEFAULT_ACTIVITY },
  recentItemIds: [],
  thoughtLog: ['08:30 · Moved into studio suite'],

  advanceClock: (deltaGameMinutes) => {
    if (deltaGameMinutes <= 0) return;
    set((s) => ({ simTimeMinutes: s.simTimeMinutes + deltaGameMinutes }));
  },

  setTimeScale: (timeScale) => set({ timeScale }),
  toggleAi: () => set((s) => ({ aiEnabled: !s.aiEnabled })),
  setAiEnabled: (aiEnabled) => set({ aiEnabled }),
  setNeeds: (needs) => set({ needs }),
  setActivity: (activity) => set({ activity }),

  notifyItemPlaced: (itemId) =>
    set((s) => ({
      recentItemIds: [itemId, ...s.recentItemIds.filter((id) => id !== itemId)].slice(0, 6),
    })),

  consumeRecentItem: (itemId) =>
    set((s) => ({
      recentItemIds: s.recentItemIds.filter((id) => id !== itemId),
    })),

  pushThought: (entry) =>
    set((s) => ({
      thoughtLog: [entry, ...s.thoughtLog].slice(0, 8),
    })),

  resetLife: () =>
    set({
      simTimeMinutes: 510,
      needs: { ...DEFAULT_NEEDS },
      activity: { ...DEFAULT_ACTIVITY },
      recentItemIds: [],
      thoughtLog: ['08:30 · Reset room life simulation'],
    }),
}));
