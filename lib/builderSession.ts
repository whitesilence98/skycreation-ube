import { useBuilderStore, type PlacedItem } from '@/lib/builderStore';

const BUILDER_KEY = 'cc-kit-builder-v2';

interface BuilderSessionPayload {
  version: 1;
  placedItems: PlacedItem[];
  roomWidth: number;
  roomDepth: number;
}

export function saveBuilderSession(
  items: PlacedItem[],
  roomWidth: number,
  roomDepth: number,
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: BuilderSessionPayload = {
      version: 1,
      placedItems: items,
      roomWidth,
      roomDepth,
    };
    window.localStorage.setItem(BUILDER_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function loadBuilderSession(): BuilderSessionPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BUILDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BuilderSessionPayload> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.placedItems)) {
      return null;
    }
    return {
      version: 1,
      placedItems: parsed.placedItems,
      roomWidth: typeof parsed.roomWidth === 'number' && parsed.roomWidth > 0 ? parsed.roomWidth : 10,
      roomDepth: typeof parsed.roomDepth === 'number' && parsed.roomDepth > 0 ? parsed.roomDepth : 8,
    };
  } catch {
    return null;
  }
}

export function hydrateBuilderSession(): void {
  const store = useBuilderStore.getState();
  if (store.hydrated) return;
  const saved = loadBuilderSession();
  if (saved) {
    store.replacePlacedItems(saved.placedItems, saved.roomWidth, saved.roomDepth);
  }
  store.markHydrated();
}
