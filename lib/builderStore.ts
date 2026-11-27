'use client';

import { create } from 'zustand';
import { useRoomLifeStore } from '@/lib/builder/lifeStore';

export type BuilderMode = 'build' | 'decorate' | 'tour';
export type BuilderCategory = 'walls' | 'floors' | 'windows' | 'furniture' | 'decor' | 'lighting';
export type PlacedItemType = 'wall' | 'floor' | 'prop';
export type RoomEdge = 'left' | 'right' | 'back' | 'front';

/** Kenney Furniture Kit GLBs are authored at ~0.5x real-world scale; 2.0 matches our 1.554m character. */
export const KENNEY_UNIT_SCALE = 2.0;

/** Top thickness offset of Kenney `floorFull.glb` planks at `KENNEY_UNIT_SCALE = 2.0`. */
export const FLOOR_SLAB_TOP = 0.08;

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

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
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
  roomBounds: RoomBounds;
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
  resizeRoom: (nextWidth: number, nextDepth: number) => void;
  expandRoomEdge: (edge: RoomEdge, deltaMeters?: number) => void;
  setPlayerPose: (pos: [number, number, number], yaw: number) => void;
  setNearbyInteract: (info: { itemId: string; tag: InteractTargetTag; label: string } | null) => void;
  clearAll: () => void;
  resetStarterRoom: () => void;
  markHydrated: () => void;
}

const DEFAULT_BOUNDS: RoomBounds = { minX: -5, maxX: 5, minZ: -4, maxZ: 4 };

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

function clampDim(m: number): number {
  const snapped = Math.round(m / 2) * 2;
  return Math.max(6, Math.min(20, snapped));
}

function makeFloorTile(x: number, z: number, id?: string): PlacedItem {
  const s = KENNEY_UNIT_SCALE;
  return {
    id: id ?? `floor_${x}_${z}_${makeId().slice(0, 4)}`,
    catalogId: 'structure/floorFull',
    assetPath: '/assets/builder/structure/floorFull.glb',
    category: 'floors',
    type: 'floor',
    position: [x, 0, z],
    rotation: 0,
    scale: [s, s, s],
    noCollide: true,
  };
}

function makeWallSegment(
  x: number,
  z: number,
  rotation: number,
  catalogId = 'structure/wall',
  category: BuilderCategory = 'walls',
  id?: string,
): PlacedItem {
  const s = KENNEY_UNIT_SCALE;
  const file = catalogId.split('/')[1] ?? 'wall';
  return {
    id: id ?? `wall_${x}_${z}_${rotation}_${makeId().slice(0, 4)}`,
    catalogId,
    assetPath: `/assets/builder/structure/${file}.glb`,
    category,
    type: 'wall',
    position: [x, 0, z],
    rotation,
    scale: [s, s, s],
  };
}

/**
 * Spacious `10m × 8m` luxury studio suite (`x ∈ [-5, +5]`, `z ∈ [-4, +4]`) with
 * distinct Vanity/Dressing, Living Lounge, and Bedroom zones plus wide clearances.
 */
export function createStarterRoomItems(): PlacedItem[] {
  const s = KENNEY_UNIT_SCALE;
  const items: PlacedItem[] = [];

  // 1. 5 × 4 floor tiles (10m × 8m; tile origin [x, 0, z] covers [x..x+2, z-2..z])
  for (let x = -5; x <= 3; x += 2) {
    for (let z = -2; z <= 4; z += 2) {
      items.push(makeFloorTile(x, z, `starter_floor_${x}_${z}`));
    }
  }

  // 2. Back perimeter wall (z = -4, spanning x = -5..+5, facing inward +Z)
  items.push(
    makeWallSegment(-5, -4, 0, 'structure/wallWindow', 'windows', 'starter_wall_back_1'),
    makeWallSegment(-3, -4, 0, 'structure/wall', 'walls', 'starter_wall_back_2'),
    makeWallSegment(-1, -4, 0, 'structure/wallWindowSlide', 'windows', 'starter_wall_back_3'),
    makeWallSegment(1, -4, 0, 'structure/wall', 'walls', 'starter_wall_back_4'),
    makeWallSegment(3, -4, 0, 'structure/wallWindow', 'windows', 'starter_wall_back_5'),
  );

  // 3. Left perimeter wall (x = -5, spanning z = +4..-4 -> rotation 90)
  items.push(
    makeWallSegment(-5, 4, 90, 'structure/wall', 'walls', 'starter_wall_left_1'),
    makeWallSegment(-5, 2, 90, 'structure/wallWindow', 'windows', 'starter_wall_left_2'),
    makeWallSegment(-5, 0, 90, 'structure/wall', 'walls', 'starter_wall_left_3'),
    makeWallSegment(-5, -2, 90, 'structure/wall', 'walls', 'starter_wall_left_4'),
  );

  // 4. Interior partition between Main Studio & Bedroom Alcove (x = +1)
  items.push(
    makeWallSegment(1, 4, 90, 'structure/wall', 'walls', 'starter_part_1'),
    makeWallSegment(1, 2, 90, 'structure/wallDoorwayWide', 'windows', 'starter_part_door'),
    makeWallSegment(1, -2, 90, 'structure/wall', 'walls', 'starter_part_3'),
  );

  // 5. Furnished Zones: Vanity/Dressing + Living Lounge + Bedroom Alcove
  items.push(
    // Vanity & Dressing Zone
    {
      id: 'starter_vanity_desk',
      catalogId: 'furniture/desk',
      assetPath: '/assets/builder/furniture/desk.glb',
      category: 'furniture',
      type: 'prop',
      position: [-1.5, 0, -3.15],
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
      position: [-1.5, 0.77, -3.4],
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
      position: [-4.1, 0, -3.2],
      rotation: 45,
      scale: [s, s, s],
      interactTag: 'wardrobe',
    },
    {
      id: 'starter_dresser',
      catalogId: 'furniture/cabinetBedDrawer',
      assetPath: '/assets/builder/furniture/cabinetBedDrawer.glb',
      category: 'furniture',
      type: 'prop',
      position: [-3.0, 0, -3.3],
      rotation: 0,
      scale: [s, s, s],
      interactTag: 'dresser',
    },

    // Living Lounge Zone
    {
      id: 'starter_sofa',
      catalogId: 'furniture/loungeSofaLong',
      assetPath: '/assets/builder/furniture/loungeSofaLong.glb',
      category: 'furniture',
      type: 'prop',
      position: [-1.6, 0, 2.7],
      rotation: 180,
      scale: [s, s, s],
    },
    {
      id: 'starter_rug',
      catalogId: 'decor/rugRectangle',
      assetPath: '/assets/builder/decor/rugRectangle.glb',
      category: 'decor',
      type: 'prop',
      position: [-1.8, 0, 1.2],
      rotation: 0,
      scale: [s, s, s],
      noCollide: true,
    },
    {
      id: 'starter_coffee_table',
      catalogId: 'furniture/tableCoffee',
      assetPath: '/assets/builder/furniture/tableCoffee.glb',
      category: 'furniture',
      type: 'prop',
      position: [-1.8, 0, 1.3],
      rotation: 0,
      scale: [s, s, s],
    },
    {
      id: 'starter_tv',
      catalogId: 'decor/televisionModern',
      assetPath: '/assets/builder/decor/televisionModern.glb',
      category: 'decor',
      type: 'prop',
      position: [-4.2, 0, 1.5],
      rotation: 90,
      scale: [s, s, s],
    },
    {
      id: 'starter_bookcase',
      catalogId: 'furniture/bookcaseOpen',
      assetPath: '/assets/builder/furniture/bookcaseOpen.glb',
      category: 'furniture',
      type: 'prop',
      position: [-4.2, 0, -0.5],
      rotation: 90,
      scale: [s, s, s],
    },
    {
      id: 'starter_plant',
      catalogId: 'decor/pottedPlant',
      assetPath: '/assets/builder/decor/pottedPlant.glb',
      category: 'decor',
      type: 'prop',
      position: [-4.1, 0, 3.2],
      rotation: 0,
      scale: [s, s, s],
    },
    {
      id: 'starter_lamp',
      catalogId: 'lighting/lampRoundFloor',
      assetPath: '/assets/builder/lighting/lampRoundFloor.glb',
      category: 'lighting',
      type: 'prop',
      position: [-0.2, 0, 3.2],
      rotation: 0,
      scale: [s, s, s],
    },

    // Bedroom Alcove Zone (x = +1..+5)
    {
      id: 'starter_bed',
      catalogId: 'furniture/bedDouble',
      assetPath: '/assets/builder/furniture/bedDouble.glb',
      category: 'furniture',
      type: 'prop',
      position: [3.3, 0, -2.5],
      rotation: 0,
      scale: [s, s, s],
      interactTag: 'scale',
    },
    {
      id: 'starter_side_table',
      catalogId: 'furniture/sideTableDrawers',
      assetPath: '/assets/builder/furniture/sideTableDrawers.glb',
      category: 'furniture',
      type: 'prop',
      position: [4.35, 0, -3.2],
      rotation: 0,
      scale: [s, s, s],
    },
    {
      id: 'starter_table_lamp',
      catalogId: 'lighting/lampRoundTable',
      assetPath: '/assets/builder/lighting/lampRoundTable.glb',
      category: 'lighting',
      type: 'prop',
      position: [4.35, 0.56, -3.2],
      rotation: 0,
      scale: [s, s, s],
      noCollide: true,
    },
    {
      id: 'starter_bedroom_rug',
      catalogId: 'decor/rugRound',
      assetPath: '/assets/builder/decor/rugRound.glb',
      category: 'decor',
      type: 'prop',
      position: [3.1, 0, 0.3],
      rotation: 0,
      scale: [s, s, s],
      noCollide: true,
    },
    {
      id: 'starter_accent_chair',
      catalogId: 'furniture/loungeDesignChair',
      assetPath: '/assets/builder/furniture/loungeDesignChair.glb',
      category: 'furniture',
      type: 'prop',
      position: [3.8, 0, 2.3],
      rotation: -135,
      scale: [s, s, s],
    },
  );

  return items;
}

function applyBoundsResize(
  prevItems: PlacedItem[],
  oldB: RoomBounds,
  newB: RoomBounds,
): PlacedItem[] {
  const floorKeys = new Set<string>();
  const kept: PlacedItem[] = [];

  const isInsideFloorBounds = (x: number, z: number, b: RoomBounds) =>
    x >= b.minX - 0.1 && x <= b.maxX - 1.9 && z >= b.minZ + 1.9 && z <= b.maxZ + 0.1;

  for (const item of prevItems) {
    if (item.type === 'floor') {
      const [fx, , fz] = item.position;
      if (isInsideFloorBounds(fx, fz, newB)) {
        kept.push(item);
        floorKeys.add(`${fx},${fz}`);
      }
      continue;
    }

    // Shift/trim outer back perimeter walls (z ≈ oldB.minZ, rotation ≈ 0)
    if (
      item.type === 'wall' &&
      Math.abs(item.rotation % 180) < 5 &&
      Math.abs(item.position[2] - oldB.minZ) < 0.2
    ) {
      const wx = item.position[0];
      if (wx >= newB.minX - 0.1 && wx <= newB.maxX - 1.9) {
        kept.push({ ...item, position: [wx, item.position[1], newB.minZ] });
      }
      continue;
    }

    // Shift/trim outer left perimeter walls (x ≈ oldB.minX, rotation ≈ 90/270)
    if (
      item.type === 'wall' &&
      Math.abs((Math.abs(item.rotation) % 180) - 90) < 5 &&
      Math.abs(item.position[0] - oldB.minX) < 0.2
    ) {
      const wz = item.position[2];
      if (wz >= newB.minZ + 1.9 && wz <= newB.maxZ + 0.1) {
        kept.push({ ...item, position: [newB.minX, item.position[1], wz] });
      }
      continue;
    }

    kept.push(item);
  }

  // Fill any missing 2m×2m floor tiles inside new bounds
  for (let x = newB.minX; x <= newB.maxX - 2 + 0.01; x += 2) {
    for (let z = newB.minZ + 2; z <= newB.maxZ + 0.01; z += 2) {
      const key = `${x},${z}`;
      if (!floorKeys.has(key)) {
        kept.push(makeFloorTile(x, z));
        floorKeys.add(key);
      }
    }
  }

  // Fill exposed segments along back perimeter wall (`z = newB.minZ`) & left perimeter wall (`x = newB.minX`)
  const hasBackWallAt = (wx: number) =>
    kept.some(
      (i) =>
        i.type === 'wall' &&
        Math.abs(i.rotation % 180) < 5 &&
        Math.abs(i.position[2] - newB.minZ) < 0.25 &&
        Math.abs(i.position[0] - wx) < 0.25,
    );
  for (let x = newB.minX; x <= newB.maxX - 2 + 0.01; x += 2) {
    if (!hasBackWallAt(x)) {
      kept.push(makeWallSegment(x, newB.minZ, 0));
    }
  }

  const hasLeftWallAt = (wz: number) =>
    kept.some(
      (i) =>
        i.type === 'wall' &&
        Math.abs((Math.abs(i.rotation) % 180) - 90) < 5 &&
        Math.abs(i.position[0] - newB.minX) < 0.25 &&
        Math.abs(i.position[2] - wz) < 0.25,
    );
  for (let z = newB.minZ + 2; z <= newB.maxZ + 0.01; z += 2) {
    if (!hasLeftWallAt(z)) {
      kept.push(makeWallSegment(newB.minX, z, 90));
    }
  }

  return kept;
}

export function inferBoundsFromItems(items: PlacedItem[]): RoomBounds {
  const floors = items.filter((i) => i.type === 'floor');
  if (floors.length === 0) return { ...DEFAULT_BOUNDS };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const f of floors) {
    const fx = f.position[0];
    const fz = f.position[2];
    if (fx < minX) minX = fx;
    if (fx + 2 > maxX) maxX = fx + 2;
    if (fz - 2 < minZ) minZ = fz - 2;
    if (fz > maxZ) maxZ = fz;
  }
  return { minX, maxX, minZ, maxZ };
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
  roomWidth: 10,
  roomDepth: 8,
  roomBounds: { ...DEFAULT_BOUNDS },
  playerPos: [-2.0, 0, -0.5],
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
    set((s) => {
      const bounds = inferBoundsFromItems(placedItems);
      return {
        placedItems,
        roomBounds: bounds,
        roomWidth: roomWidth ?? Math.max(6, bounds.maxX - bounds.minX),
        roomDepth: roomDepth ?? Math.max(6, bounds.maxZ - bounds.minZ),
        selectedItemId: null,
      };
    }),

  resizeRoom: (nextW, nextD) =>
    set((s) => {
      const targetW = clampDim(nextW);
      const targetD = clampDim(nextD);
      const oldB = s.roomBounds;
      const curW = oldB.maxX - oldB.minX;
      const curD = oldB.maxZ - oldB.minZ;
      if (targetW === curW && targetD === curD) return s;

      const dw = targetW - curW;
      const dd = targetD - curD;
      // Split 4m+ deltas evenly across both edges; 2m deltas alternate cleanly without breaking 2m tile parity
      const leftExpand = dw > 0 ? Math.floor(dw / 4) * 2 : -Math.floor(-dw / 4) * 2;
      const rightExpand = dw - leftExpand;
      const backExpand = dd > 0 ? Math.floor(dd / 4) * 2 : -Math.floor(-dd / 4) * 2;
      const frontExpand = dd - backExpand;

      const newB: RoomBounds = {
        minX: oldB.minX - leftExpand,
        maxX: oldB.maxX + rightExpand,
        minZ: oldB.minZ - backExpand,
        maxZ: oldB.maxZ + frontExpand,
      };
      const nextItems = applyBoundsResize(s.placedItems, oldB, newB);
      return {
        placedItems: nextItems,
        roomBounds: newB,
        roomWidth: targetW,
        roomDepth: targetD,
      };
    }),

  expandRoomEdge: (edge, deltaMeters = 2) =>
    set((s) => {
      const oldB = s.roomBounds;
      const newB: RoomBounds = { ...oldB };
      const step = Math.round(deltaMeters / 2) * 2;
      if (step === 0) return s;

      if (edge === 'left') newB.minX -= step;
      if (edge === 'right') newB.maxX += step;
      if (edge === 'back') newB.minZ -= step;
      if (edge === 'front') newB.maxZ += step;

      const nextW = newB.maxX - newB.minX;
      const nextD = newB.maxZ - newB.minZ;
      if (nextW < 6 || nextW > 20 || nextD < 6 || nextD > 20) return s;

      return {
        placedItems: applyBoundsResize(s.placedItems, oldB, newB),
        roomBounds: newB,
        roomWidth: nextW,
        roomDepth: nextD,
      };
    }),

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
      roomWidth: 10,
      roomDepth: 8,
      roomBounds: { ...DEFAULT_BOUNDS },
      selectedItemId: null,
      ghostCatalogId: null,
      playerPos: [-2.0, 0, -0.5],
      playerYaw: 0,
    }),

  markHydrated: () => set({ hydrated: true }),
}));
