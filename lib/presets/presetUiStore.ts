'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { captureViewport } from '@/lib/presets/capture';
import { useCharacter } from '@/lib/store';
import { parsePreset } from '@/lib/presetIO';

export interface PresetSlot {
  id: string;
  presetId?: string;
  presetUrl?: string;
  label: string;
  customName?: string;
  thumb?: string | null;
  isEmpty: boolean;
  presetData?: any;
}

export const INITIAL_PRESET_SLOTS: PresetSlot[] = [
  {
    id: 'preset-slot-1',
    presetId: 'lyra',
    presetUrl: '/assets/preset-pack/presets/default.json',
    label: 'Default',
    customName: 'Default',
    thumb: '/assets/preset-pack/textures/presets/default.webp',
    isEmpty: false,
  },
  {
    id: 'preset-slot-2',
    label: 'Face Preset 2',
    thumb: null,
    isEmpty: true,
  },
  {
    id: 'preset-slot-3',
    label: 'Face Preset 3',
    thumb: null,
    isEmpty: true,
  },
  {
    id: 'preset-slot-4',
    label: 'Face Preset 4',
    thumb: null,
    isEmpty: true,
  },
  {
    id: 'preset-slot-5',
    label: 'Face Preset 5',
    thumb: null,
    isEmpty: true,
  },
  {
    id: 'preset-slot-6',
    presetId: 'zhizhen2025',
    label: 'Face Preset 6',
    customName: 'Zhizhen 2025',
    thumb: '/assets/preset-pack/textures/presets/ubezhizhen2025.webp',
    isEmpty: false,
  },
  {
    id: 'preset-slot-7',
    label: 'Face Preset 7',
    thumb: null,
    isEmpty: true,
  },
  {
    id: 'preset-slot-8',
    label: 'Face Preset 8',
    thumb: null,
    isEmpty: true,
  },
];

interface PresetUiStore {
  selectedIndex: number;
  slots: PresetSlot[];
  isRenaming: boolean;
  renameValue: string;
  statusMessage: string | null;

  selectSlot: (index: number) => void;
  startRename: () => void;
  cancelRename: () => void;
  setRenameValue: (val: string) => void;
  confirmRename: () => void;
  deleteSelectedSlot: () => void;
  retakeCoverImage: () => Promise<void>;
  applySelectedSlot: () => void;
  saveCurrentToSlot: (index: number) => Promise<void>;
  flashStatus: (msg: string) => void;
}

export const usePresetUiStore = create<PresetUiStore>()(
  persist(
    (set, get) => ({
      selectedIndex: 0,
      slots: INITIAL_PRESET_SLOTS,
      isRenaming: false,
      renameValue: '',
      statusMessage: null,

      flashStatus: (msg: string) => {
        set({ statusMessage: msg });
        window.setTimeout(() => {
          if (get().statusMessage === msg) {
            set({ statusMessage: null });
          }
        }, 3000);
      },

      selectSlot: (index: number) => {
        if (index < 0 || index >= get().slots.length) return;
        set({ selectedIndex: index, isRenaming: false });
      },

      startRename: () => {
        const { selectedIndex, slots } = get();
        const currentSlot = slots[selectedIndex];
        if (!currentSlot) return;
        set({
          isRenaming: true,
          renameValue: currentSlot.customName || currentSlot.label,
        });
      },

      cancelRename: () => {
        set({ isRenaming: false, renameValue: '' });
      },

      setRenameValue: (renameValue: string) => {
        set({ renameValue });
      },

      confirmRename: () => {
        const { selectedIndex, slots, renameValue, flashStatus } = get();
        const trimmed = renameValue.trim();
        if (!trimmed) {
          set({ isRenaming: false });
          return;
        }
        const updated = [...slots];
        updated[selectedIndex] = {
          ...updated[selectedIndex],
          label: trimmed,
          customName: trimmed,
        };
        set({ slots: updated, isRenaming: false, renameValue: '' });
        flashStatus(`Renamed to "${trimmed}"`);
      },

      deleteSelectedSlot: () => {
        const { selectedIndex, slots, flashStatus } = get();
        const currentSlot = slots[selectedIndex];
        if (!currentSlot) return;

        if (currentSlot.isEmpty) {
          flashStatus('Slot is already empty');
          return;
        }

        const confirmMsg = `Delete preset "${currentSlot.label}"?`;
        if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) {
          return;
        }

        const updated = [...slots];
        updated[selectedIndex] = {
          id: currentSlot.id,
          label: `Face Preset ${selectedIndex + 1}`,
          thumb: null,
          isEmpty: true,
          presetId: undefined,
          customName: undefined,
          presetData: undefined,
        };
        set({ slots: updated });
        flashStatus(`Deleted Face Preset ${selectedIndex + 1}`);
      },

      retakeCoverImage: async () => {
        const { selectedIndex, slots, flashStatus } = get();
        const currentSlot = slots[selectedIndex];
        if (!currentSlot) return;

        try {
          const snapshotUrl = await captureViewport();
          if (!snapshotUrl) {
            flashStatus('Failed to capture viewport');
            return;
          }

          const characterStore = useCharacter.getState();
          const presetData = characterStore.snapshotPreset();

          const updated = [...slots];
          updated[selectedIndex] = {
            ...currentSlot,
            thumb: snapshotUrl,
            isEmpty: false,
            presetData,
          };
          set({ slots: updated });
          flashStatus(`Cover image updated for ${currentSlot.label}`);
        } catch {
          flashStatus('Could not retake cover image');
        }
      },

      applySelectedSlot: () => {
        const { selectedIndex, slots, flashStatus } = get();
        const currentSlot = slots[selectedIndex];
        if (!currentSlot) return;

        const characterStore = useCharacter.getState();

        if (currentSlot.isEmpty) {
          // If empty, save the current face into this slot
          void get().saveCurrentToSlot(selectedIndex);
          return;
        }

        if (currentSlot.presetData) {
          try {
            const payload = parsePreset(JSON.stringify(currentSlot.presetData));
            characterStore.loadPreset(payload);
            flashStatus(`Applied ${currentSlot.label}`);
          } catch {
            flashStatus(`Failed to apply ${currentSlot.label}`);
          }
          return;
        }

        if (currentSlot.presetUrl) {
          void fetch(currentSlot.presetUrl)
            .then((res) => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.text();
            })
            .then((text) => {
              const payload = parsePreset(text, 'default.json');
              characterStore.loadPreset(payload);
              flashStatus(`Applied ${currentSlot.label}`);
            })
            .catch(() => {
              if (currentSlot.presetId) {
                characterStore.applyPreset(currentSlot.presetId as any);
              }
              flashStatus(`Failed to load ${currentSlot.label}`);
            });
          return;
        }

        try {
          if (currentSlot.presetId) {
            characterStore.applyPreset(currentSlot.presetId as any);
            characterStore.setName((currentSlot.customName || currentSlot.label).toUpperCase());
            characterStore.setAssets({ preset: undefined });
          }
          flashStatus(`Applied ${currentSlot.label}`);
        } catch {
          flashStatus(`Failed to apply ${currentSlot.label}`);
        }
      },

      saveCurrentToSlot: async (index: number) => {
        const { slots, flashStatus } = get();
        const currentSlot = slots[index];
        if (!currentSlot) return;

        try {
          const characterStore = useCharacter.getState();
          const presetData = characterStore.snapshotPreset();
          const snapshotUrl = await captureViewport();

          const updated = [...slots];
          updated[index] = {
            ...currentSlot,
            thumb: snapshotUrl ?? currentSlot.thumb,
            isEmpty: false,
            presetData,
          };
          set({ slots: updated, selectedIndex: index });
          flashStatus(`Saved character to ${currentSlot.label}`);
        } catch {
          flashStatus('Could not save to slot');
        }
      },
    }),
    {
      name: 'wuxia-preset-slots-v2',
      partialize: (state) => ({
        selectedIndex: state.selectedIndex,
        slots: state.slots,
      }),
    }
  )
);
