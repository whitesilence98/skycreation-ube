import * as THREE from 'three';
import { KENNEY_UNIT_SCALE, type PlacedItem } from '@/lib/builderStore';

export interface GridPoint {
  x: number;
  z: number;
}

/** Snap an XZ world coordinate to the active builder grid (0.5m or 1.0m). */
export function snapToGrid(x: number, z: number, grid: 0.5 | 1.0): GridPoint {
  return {
    x: Math.round(x / grid) * grid,
    z: Math.round(z / grid) * grid,
  };
}

/** Snap a Three.js Vector3 onto the y=0 plane grid. */
export function snapVectorToGrid(v: THREE.Vector3, grid: 0.5 | 1.0): THREE.Vector3 {
  const pt = snapToGrid(v.x, v.z, grid);
  return new THREE.Vector3(pt.x, 0, pt.z);
}

/** Build straight wall segments from `start` to `end` along an axis (X or Z). */
function buildAxisWallSegments(
  start: GridPoint,
  end: GridPoint,
  wallCatalogId: string,
): Array<Omit<PlacedItem, 'id'>> {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const segments: Array<Omit<PlacedItem, 'id'>> = [];

  const isHorizontal = Math.abs(dx) >= Math.abs(dz);
  const span = Math.abs(isHorizontal ? dx : dz);
  if (span < 0.25) return segments;

  // Kenney wall.glb is 1.0 local -> 2.0m when scaled by KENNEY_UNIT_SCALE (2.0)
  // Kenney wallHalf.glb is 0.5 local -> 1.0m when scaled by 2.0
  // Rotations in Three.js Y-up right-handed coords:
  //   0°   => extends along +X
  //   180° => extends along -X
  //   90°  => extends along -Z
  //   270° => extends along +Z
  let rotation = 0;
  let dirX = 0;
  let dirZ = 0;

  if (isHorizontal) {
    if (dx > 0) {
      rotation = 0;
      dirX = 1;
    } else {
      rotation = 180;
      dirX = -1;
    }
  } else {
    if (dz < 0) {
      rotation = 90;
      dirZ = -1;
    } else {
      rotation = 270;
      dirZ = 1;
    }
  }

  let cursorX = start.x;
  let cursorZ = start.z;
  let remaining = Math.round(span * 2) / 2; // round to nearest 0.5m

  // First segment uses the user-picked wall style (e.g. window/doorway), or all if plain wall
  const useAlternateOnlyOnFull = wallCatalogId !== 'structure/wall' && wallCatalogId !== 'structure/wallHalf';

  while (remaining >= 0.49) {
    if (remaining >= 1.99) {
      const catId = useAlternateOnlyOnFull ? wallCatalogId : 'structure/wall';
      const folderPart = catId.includes('Window') || catId.includes('Doorway') || catId.includes('doorway') ? 'windows' : 'walls';
      segments.push({
        catalogId: catId,
        assetPath: `/assets/builder/${catId}.glb`,
        category: folderPart,
        type: 'wall',
        position: [cursorX, 0, cursorZ],
        rotation,
        scale: [KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE],
      });
      cursorX += dirX * 2.0;
      cursorZ += dirZ * 2.0;
      remaining -= 2.0;
    } else if (remaining >= 0.99) {
      segments.push({
        catalogId: 'structure/wallHalf',
        assetPath: '/assets/builder/structure/wallHalf.glb',
        category: 'walls',
        type: 'wall',
        position: [cursorX, 0, cursorZ],
        rotation,
        scale: [KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE],
      });
      cursorX += dirX * 1.0;
      cursorZ += dirZ * 1.0;
      remaining -= 1.0;
    } else {
      // 0.5m micro-segment using wallHalf scaled 0.5x on X
      segments.push({
        catalogId: 'structure/wallHalf',
        assetPath: '/assets/builder/structure/wallHalf.glb',
        category: 'walls',
        type: 'wall',
        position: [cursorX, 0, cursorZ],
        rotation,
        scale: [KENNEY_UNIT_SCALE * 0.5, KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE],
      });
      cursorX += dirX * 0.5;
      cursorZ += dirZ * 0.5;
      remaining -= 0.5;
    }
  }

  return segments;
}

/**
 * Computes a clean Manhattan L-shaped chain of modular walls from `start` to `end`.
 * Automatically splits 2.0m (`wall.glb`), 1.0m (`wallHalf.glb`), and 0.5m segments.
 */
export function buildWallChain(
  start: GridPoint,
  end: GridPoint,
  wallCatalogId = 'structure/wall',
): Array<Omit<PlacedItem, 'id'>> {
  const dx = end.x - start.x;
  const dz = end.z - start.z;

  if (Math.abs(dx) < 0.25 && Math.abs(dz) < 0.25) return [];

  // Single axis run
  if (Math.abs(dx) < 0.25 || Math.abs(dz) < 0.25) {
    return buildAxisWallSegments(start, end, wallCatalogId);
  }

  // L-bend: run dominant axis first, then corner to second axis
  const corner: GridPoint =
    Math.abs(dx) >= Math.abs(dz)
      ? { x: end.x, z: start.z }
      : { x: start.x, z: end.z };

  const leg1 = buildAxisWallSegments(start, corner, wallCatalogId);
  const leg2 = buildAxisWallSegments(corner, end, wallCatalogId);
  return [...leg1, ...leg2];
}
