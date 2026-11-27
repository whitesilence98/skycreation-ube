'use client';

import { create } from 'zustand';
import { useRoomLifeStore } from '@/lib/builder/lifeStore';

export type BuilderMode = 'build' | 'decorate' | 'tour';
export type BuilderCategory = 'walls' | 'floors' | 'windows' | 'furniture' | 'decor' | 'lighting';
export type PlacedItemType = 'wall' | 'floor' | 'prop';

/** Kenney Furniture Kit GLBs are authored at ~0.5x real-world scale; 2.0 matches our 1.554m character. */
export const KENNEY_UNIT_SCALE = 2.0;

export type InteractTargetTag = 'vanity' | 'wardrobe' | 'mirror' | 'dresser' | 'scale';

export interface PlacedItem {
  id: string;
  catalogId: string;
  assetPath: string;
  category: BuilderCategory;
  type: PlacedItemType;
  position: [number, number, number];
  /** Y-axis rotation in degrees. */
  rotation: number;
  scale: [number, number, number];
  interactTag?: InteractTargetTag;
  noCollide?: boolean;
}

export interface BuilderState {
  mode: BuilderMode;
  activeCategory: BuilderCategory;
  activeSubCategory: string | null;
  grid: 0.5 | 1.0;
  snapAngle: 45 | 90;
  placedItems: PlacedItem[];
  selectedItemId: string | null;
  ghostCatalogId: string | null;
  ghostRotation: number;
  roomWidth: number;
  roomDepth: number;
  /** Live character XZ world position tracked in Tour mode for BlueprintMinimap. */
  playerPos: [number, number, number];
  playerYaw: number;
  /** Currently in-range interactive prop (set by TourController). */
  nearbyInteract: { itemId: string; tag: InteractTargetTag; label: string } | null;
  hydrated: boolean;

  setMode: (m: BuilderMode) => void;
  setCategory: (c: BuilderCategory) => void;
  setSubCategory: (sub: string | null) => void;
  setGrid: (g: 0.5 | 1.0) => void;
  setSnapAngle: (a: 45 | 90) => void;
  setGhost: (catalogId: string | null) => void;
  rotateGhost: (delta?: number) => void;
  placeItem: (item: Omit<PlacedItem, 'id'> & { id?: string }) => string;
  placeBatch: (items: Array<Omit<PlacedItem, 'id'> & { id?: string }>) => void;
  removeItem: (id: string) => void;
  rotateItem: (id: string, delta?: number) => void;
  selectItem: (id: string | null) => void;
  moveItem: (id: string, pos: [number, number, number]) => void;
  replacePlacedItems: (items: PlacedItem[], roomWidth?: number, roomDepth?: number) => void;
  setPlayerPose: (pos: [number, number, number], yaw: number) => void;
  setNearbyInteract: (info: { itemId: string; tag: InteractTargetTag; label: string } | null) => void;
  clearAll: () => void;
  resetStarterRoom: () => void;
  markHydrated: () => void;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 12);
  }
  return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function wrapDeg(deg: number): number {
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

/**
 * Cozy starter studio suite matching the reference isometric floorplan (6m x 4m main room + alcove)
 * so the user lands in a playable, furnished room immediately on opening ROOM mode.
 */
export function createStarterRoomItems(): PlacedItem[] {
  const s = KENNEY_UNIT_SCALE;
  const wallScale: [number, number, number] = [s, s, s];
  const floorScale: [number, number, number] = [s, s, s];
  const items: PlacedItem[] = [];

  // Floor tiles (2m x 2m each; origin at front-left corner [0, 0, -2] after scale 2)
  for (let x = -3; x <= 1; x += 2) {
    for (let z = -1; z <= 3; z += 2) {
      items.push({
        id: `starter_floor_${x}_${z}`,
        catalogId: 'structure/floorFull',
        assetPath: '/assets/builder/structure/floorFull.glb',
        category: 'floors',
        type: 'floor',
        position: [x, 0, z],
        rotation: 0,
        scale: floorScale,
        noCollide: true,
      });
    }
  }

  // Back wall (-Z edge at z = -3, from x = -3 to x = +3)
  items.push(
    {
      id: 'starter_wall_back_w1',
      catalogId: 'structure/wallWindow',
      assetPath: '/assets/builder/structure/wallWindow.glb',
      category: 'windows',
      type: 'wall',
      position: [-3, 0, -3],
      rotation: 0,
      scale: wallScale,
    },
    {
      id: 'starter_wall_back_2',
      catalogId: 'structure/wall',
      assetPath: '/assets/builder/structure/wall.glb',
      category: 'walls',
      type: 'wall',
      position: [-1, 0, -3],
      rotation: 0,
      scale: wallScale,
    },
    {
      id: 'starter_wall_back_w2',
      catalogId: 'structure/wallWindowSlide',
      assetPath: '/assets/builder/structure/wallWindowSlide.glb',
      category: 'windows',
      type: 'wall',
      position: [1, 0, -3],
      rotation: 0,
      scale: wallScale,
    },
  );

  // Left wall (x = -3, from z = +3 to z = -3 -> rotation 90 faces +X inward along -Z)
  items.push(
    {
      id: 'starter_wall_left_1',
      catalogId: 'structure/wall',
      assetPath: '/assets/builder/structure/wall.glb',
      category: 'walls',
      type: 'wall',
      position: [-3, 0, 3],
      rotation: 90,
      scale: wallScale,
    },
    {
      id: 'starter_wall_left_w',
      catalogId: 'structure/wallWindow',
      assetPath: '/assets/builder/structure/wallWindow.glb',
      category: 'windows',
      type: 'wall',
      position: [-3, 0, 1],
      rotation: 90,
      scale: wallScale,
    },
    {
      id: 'starter_wall_left_3',
      catalogId: 'structure/wall',
      assetPath: '/assets/builder/structure/wall.glb',
      category: 'walls',
      type: 'wall',
      position: [-3, 0, -1],
      rotation: 90,
      scale: wallScale,
    },
  );

  // Interior partition wall with doorway (x = 1, from z = 3 to z = -1)
  items.push(
    {
      id: 'starter_wall_part_1',
      catalogId: 'structure/wallDoorway',
      assetPath: '/assets/builder/structure/wallDoorway.glb',
      category: 'windows',
      type: 'wall',
      position: [1, 0, 1],
      rotation: 90,
      scale: wallScale,
    },
    {
      id: 'starter_wall_part_2',
      catalogId: 'structure/wall',
      assetPath: '/assets/builder/structure/wall.glb',
      category: 'walls',
      type: 'wall',
      position: [1, 0, -1],
      rotation: 90,
      scale: wallScale,
    },
  );

  // Furniture & Decor
  items.push(
    {
      id: 'starter_sofa',
      catalogId: 'furniture/loungeSofa',
      assetPath: '/assets/builder/furniture/loungeSofa.glb',
      category: 'furniture',
      type: 'prop',
      position: [-0.8, 0, 1.8],
      rotation: 180,
      scale: [s, s, s],
    },
    {
      id: 'starter_rug',
      catalogId: 'decor/rugRectangle',
      assetPath: '/assets/builder/decor/rugRectangle.glb',
      category: 'decor',
      type: 'prop',
      position: [-0.8, 0, 0.95],
      rotation: 0,
      scale: [s, s, s],
      noCollide: true,
    },
    {
      id: 'starter_vanity_desk',
      catalogId: 'furniture/desk',
      assetPath: '/assets/builder/furniture/desk.glb',
      category: 'furniture',
      type: 'prop',
      position: [0.0, 0, -2.2],
      rotation: 0,
      scale: [s, s, s],
      interactTag: 'vanity',
    },
    {
      id: 'starter_vanity_mirror',
      catalogId: 'furniture/bathroomMirror',
      assetPath: '/assets/builder/furniture/bathroomMirror.glb',
      category: 'furniture',
      type: 'prop',
      position: [0.0, 0.77, -2.45],
      rotation: 0,
      scale: [s, s, s],
      interactTag: 'mirror',
    },
    {
      id: 'starter_coat_rack',
      catalogId: 'furniture/coatRackStanding',
      assetPath: '/assets/builder/furniture/coatRackStanding.glb',
      category: 'furniture',
      type: 'prop',
      position: [-2.4, 0, -2.3],
      rotation: 45,
      scale: [s, s, s],
      interactTag: 'wardrobe',
    },
    {
      id: 'starter_plant',
      catalogId: 'decor/pottedPlant',
      assetPath: '/assets/builder/decor/pottedPlant.glb',
      category: 'decor',
      type: 'prop',
      position: [-2.3, 0, 2.2],
      rotation: 0,
      scale: [s, s, s],
    },
    {
      id: 'starter_lamp',
      catalogId: 'lighting/lampRoundFloor',
      assetPath: '/assets/builder/lighting/lampRoundFloor.glb',
      category: 'lighting',
      type: 'prop',
      position: [2.3, 0, -2.2],
      rotation: 0,
      scale: [s, s, s],
    },
  );

  return items;
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  mode: 'decorate',
  activeCategory: 'furniture',
  activeSubCategory: null,
  grid: 0.5,
  snapAngle: 45,
  placedItems: createStarterRoomItems(),
  selectedItemId: null,
  ghostCatalogId: null,
  ghostRotation: 0,
  roomWidth: 8,
  roomDepth: 8,
  playerPos: [-1.2, 0, 0.2],
  playerYaw: 0,
  nearbyInteract: null,
  hydrated: false,

  setMode: (mode) =>
    set({
      mode,
      selectedItemId: null,
      ghostCatalogId: null,
      nearbyInteract: null,
    }),

  setCategory: (activeCategory) =>
    set({
      activeCategory,
      activeSubCategory: null,
    }),

  setSubCategory: (activeSubCategory) => set({ activeSubCategory }),
  setGrid: (grid) => set({ grid }),
  setSnapAngle: (snapAngle) => set({ snapAngle }),
  setGhost: (ghostCatalogId) =>
    set({
      ghostCatalogId,
      selectedItemId: ghostCatalogId ? null : get().selectedItemId,
    }),

  rotateGhost: (delta) =>
    set((s) => ({
      ghostRotation: wrapDeg(s.ghostRotation + (delta ?? s.snapAngle)),
    })),

  placeItem: (item) => {
    const id = item.id ?? makeId();
    const full: PlacedItem = { ...item, id };
    set((s) => ({
      placedItems: [...s.placedItems, full],
    }));
    if (full.type === 'prop') {
      useRoomLifeStore.getState().notifyItemPlaced(id);
    }
    return id;
  },

  placeBatch: (items) => {
    if (!items.length) return;
    const stamped = items.map((item) => ({
      ...item,
      id: item.id ?? makeId(),
    }));
    set((s) => ({
      placedItems: [...s.placedItems, ...stamped],
    }));
  },

  removeItem: (id) =>
    set((s) => ({
      placedItems: s.placedItems.filter((i) => i.id !== id),
      selectedItemId: s.selectedItemId === id ? null : s.selectedItemId,
    })),

  rotateItem: (id, delta) =>
    set((s) => ({
      placedItems: s.placedItems.map((i) =>
        i.id === id ? { ...i, rotation: wrapDeg(i.rotation + (delta ?? s.snapAngle)) } : i,
      ),
    })),

  selectItem: (selectedItemId) =>
    set({
      selectedItemId,
      ghostCatalogId: selectedItemId ? null : get().ghostCatalogId,
    }),

  moveItem: (id, position) =>
    set((s) => ({
      placedItems: s.placedItems.map((i) => (i.id === id ? { ...i, position } : i)),
    })),

  replacePlacedItems: (placedItems, roomWidth, roomDepth) =>
    set((s) => ({
      placedItems,
      roomWidth: roomWidth ?? s.roomWidth,
      roomDepth: roomDepth ?? s.roomDepth,
      selectedItemId: null,
    })),

  setPlayerPose: (playerPos, playerYaw) => set({ playerPos, playerYaw }),
  setNearbyInteract: (nearbyInteract) => set({ nearbyInteract }),

  clearAll: () =>
    set({
      placedItems: [],
      selectedItemId: null,
      ghostCatalogId: null,
      nearbyInteract: null,
    }),

  resetStarterRoom: () =>
    set({
      placedItems: createStarterRoomItems(),
      selectedItemId: null,
      ghostCatalogId: null,
      playerPos: [-1.2, 0, 0.2],
      playerYaw: 0,
    }),

  markHydrated: () => set({ hydrated: true }),
}));
