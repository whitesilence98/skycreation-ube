import { BUILDER_CATALOG_BY_ID } from '@/lib/builderCatalog';
import { getCatalogExtent } from '@/lib/builder/footprintRegistry';
import type { PlacedItem, RoomBounds } from '@/lib/builderStore';

export type PlacementCandidate = Omit<PlacedItem, 'id'> & { id?: string };

export interface Obb2D {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  /** Direction vector along local +X (unit length). */
  ax: number;
  az: number;
  /** Direction vector along local +Z (unit length). */
  bx: number;
  bz: number;
}

export interface PlacementValidationResult {
  valid: boolean;
  reason: string | null;
  collidingIds: string[];
}

export interface WallBatchValidationResult {
  valid: boolean;
  invalidIndices: number[];
  reason: string | null;
}

type CollisionLayer = 'floor' | 'rug' | 'accent' | 'solid' | 'wall';

const TABLETOP_OR_WALL_ACCENTS = [
  'bathroomMirror',
  'coatRack', // matches wall coatRack (coatRackStanding checked first below)
  'laptop',
  'books',
  'pillow',
  'plantSmall',
  'lampRoundTable',
  'lampSquareTable',
  'lampWall',
  'lampSquareCeiling',
  'ceilingFan',
] as const;

export function getCollisionLayer(item: Pick<PlacementCandidate, 'catalogId' | 'type' | 'noCollide'>): CollisionLayer {
  if (item.type === 'floor') return 'floor';
  if (item.type === 'wall') return 'wall';
  if (item.catalogId.includes('rug')) return 'rug';
  if (item.catalogId.includes('coatRackStanding')) return 'solid';
  if (item.noCollide) return 'accent';
  for (const pat of TABLETOP_OR_WALL_ACCENTS) {
    if (item.catalogId.includes(pat)) return 'accent';
  }
  return 'solid';
}

function itemLabel(catalogId: string): string {
  return BUILDER_CATALOG_BY_ID[catalogId]?.label ?? catalogId.split('/')[1] ?? 'Item';
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Extracts a world-space 2D Oriented Bounding Box (`Obb2D`) in the XZ plane.
 * Uses small ergonomic insets (`0.08m` at wall endpoints, `0.05m` on props) so
 * corner walls and flush desks/nightstands snap cleanly without false overlaps.
 */
export function getItemObb2D(item: Pick<PlacementCandidate, 'catalogId' | 'type' | 'position' | 'rotation' | 'scale'>): Obb2D {
  const [extX, , extZ] = getCatalogExtent(item.catalogId);
  const [sx, , sz] = item.scale;
  const rad = degToRad(item.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Three.js Y-rotation local basis in world XZ:
  // local +X -> (cos, -sin), local +Z -> (sin, cos)
  const ax = cos;
  const az = -sin;
  const bx = sin;
  const bz = cos;

  if (item.type === 'wall') {
    const isHalf = item.catalogId.includes('wallHalf');
    const isCorner = item.catalogId.includes('Corner');
    const len = (isHalf ? 0.5 : isCorner ? 0.55 : extX) * sx;
    const depth = (isCorner ? 0.55 : Math.max(0.08, extZ)) * sz;

    const lx = len * 0.5;
    const lz = -depth * 0.5;
    const cx = item.position[0] + lx * ax + lz * bx;
    const cz = item.position[2] + lx * az + lz * bz;

    return {
      cx,
      cz,
      hx: Math.max(0.06, len * 0.5 - 0.1),
      hz: Math.max(0.04, depth * 0.5 - 0.01),
      ax,
      az,
      bx,
      bz,
    };
  }

  if (item.type === 'floor') {
    const isHalf = item.catalogId.includes('floorHalf');
    const w = (isHalf ? 0.5 : 1.0) * sx;
    const d = 1.0 * sz;
    const lx = w * 0.5;
    const lz = -d * 0.5;
    return {
      cx: item.position[0] + lx * ax + lz * bx,
      cz: item.position[2] + lx * az + lz * bz,
      hx: Math.max(0.1, w * 0.5 - 0.08),
      hz: Math.max(0.1, d * 0.5 - 0.08),
      ax,
      az,
      bx,
      bz,
    };
  }

  // Props are centered on XZ origin in PlacedItemMesh / GhostItem
  const w = extX * sx;
  const d = extZ * sz;
  return {
    cx: item.position[0],
    cz: item.position[2],
    hx: Math.max(0.08, w * 0.5 - 0.05),
    hz: Math.max(0.08, d * 0.5 - 0.05),
    ax,
    az,
    bx,
    bz,
  };
}

function projectedRadius(obb: Obb2D, axisX: number, axisZ: number): number {
  return (
    Math.abs(obb.ax * axisX + obb.az * axisZ) * obb.hx +
    Math.abs(obb.bx * axisX + obb.bz * axisZ) * obb.hz
  );
}

/** Separating Axis Theorem (SAT) overlap test for two 2D OBBs in XZ. */
export function obbIntersects2D(a: Obb2D, b: Obb2D): boolean {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const axes: ReadonlyArray<[number, number]> = [
    [a.ax, a.az],
    [a.bx, a.bz],
    [b.ax, b.az],
    [b.bx, b.bz],
  ];

  for (const [ux, uz] of axes) {
    const dist = Math.abs(dx * ux + dz * uz);
    const ra = projectedRadius(a, ux, uz);
    const rb = projectedRadius(b, ux, uz);
    if (dist >= ra + rb) return false;
  }
  return true;
}

function pointOnFloor(x: number, z: number, floors: PlacedItem[]): boolean {
  for (const fl of floors) {
    const isHalf = fl.catalogId.includes('floorHalf');
    const w = (isHalf ? 0.5 : 1.0) * fl.scale[0];
    const d = 1.0 * fl.scale[2];
    const minX = fl.position[0] - 0.15;
    const maxX = fl.position[0] + w + 0.15;
    const minZ = fl.position[2] - d - 0.15;
    const maxZ = fl.position[2] + 0.15;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true;
  }
  return false;
}

function isWithinRoomFloor(obb: Obb2D, placedItems: PlacedItem[], roomBounds?: RoomBounds): boolean {
  const floors = placedItems.filter((i) => i.type === 'floor');
  if (floors.length > 0) {
    if (!pointOnFloor(obb.cx, obb.cz, floors)) return false;
    // Also verify all 4 OBB corners lie inside placed floor tiles (tolerance 0.15m)
    const signs = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const;
    for (const [sx, sz] of signs) {
      const px = obb.cx + obb.ax * obb.hx * sx + obb.bx * obb.hz * sz;
      const pz = obb.cz + obb.az * obb.hx * sx + obb.bz * obb.hz * sz;
      if (!pointOnFloor(px, pz, floors)) return false;
    }
    return true;
  }

  if (roomBounds) {
    return (
      obb.cx >= roomBounds.minX - 0.2 &&
      obb.cx <= roomBounds.maxX + 0.2 &&
      obb.cz >= roomBounds.minZ - 0.2 &&
      obb.cz <= roomBounds.maxZ + 0.2
    );
  }
  return true;
}

function layersCanCollide(a: CollisionLayer, b: CollisionLayer): boolean {
  if (a === 'floor' && b === 'floor') return true;
  if (a === 'floor' || b === 'floor') return false;
  if (a === 'rug' || b === 'rug') return false;
  if (a === 'accent' || b === 'accent') return false;
  return true;
}

/**
 * Validates whether `candidate` can be placed or moved to its target transform
 * without overlapping incompatible items or spilling outside floor tiles.
 */
export function validatePlacement(
  candidate: PlacementCandidate,
  placedItems: PlacedItem[],
  options?: { excludeId?: string; roomBounds?: RoomBounds },
): PlacementValidationResult {
  const candLayer = getCollisionLayer(candidate);
  const candObb = getItemObb2D(candidate);
  const collidingIds: string[] = [];
  let firstReason: string | null = null;

  // Floor-standing solid furniture & rugs must stay inside placed floor tiles
  if ((candLayer === 'solid' || candLayer === 'rug') && !isWithinRoomFloor(candObb, placedItems, options?.roomBounds)) {
    return {
      valid: false,
      reason: 'Outside floor area',
      collidingIds: [],
    };
  }

  for (const existing of placedItems) {
    if (options?.excludeId && existing.id === options.excludeId) continue;
    const existLayer = getCollisionLayer(existing);
    if (!layersCanCollide(candLayer, existLayer)) continue;

    // Duplicate floor check: match same tile cell
    if (candLayer === 'floor' && existLayer === 'floor') {
      const sameCell =
        Math.hypot(
          candidate.position[0] - existing.position[0],
          candidate.position[2] - existing.position[2],
        ) < 0.25;
      if (sameCell) {
        collidingIds.push(existing.id);
        firstReason ??= `Overlaps ${itemLabel(existing.catalogId)}`;
      }
      continue;
    }

    const existObb = getItemObb2D(existing);
    if (obbIntersects2D(candObb, existObb)) {
      collidingIds.push(existing.id);
      firstReason ??= `Overlaps ${itemLabel(existing.catalogId)}`;
    }
  }

  return {
    valid: collidingIds.length === 0,
    reason: firstReason,
    collidingIds,
  };
}

/**
 * Validates a multi-segment `BUILD WALLS` drag chain against existing walls and furniture.
 */
export function validateWallBatch(
  segments: Array<Omit<PlacedItem, 'id'>>,
  placedItems: PlacedItem[],
): WallBatchValidationResult {
  const invalidIndices: number[] = [];
  let reason: string | null = null;

  for (let i = 0; i < segments.length; i++) {
    const res = validatePlacement(segments[i], placedItems);
    if (!res.valid) {
      invalidIndices.push(i);
      reason ??= res.reason;
    }
  }

  return {
    valid: invalidIndices.length === 0,
    invalidIndices,
    reason,
  };
}
