import { KENNEY_UNIT_SCALE, type PlacedItem } from '@/lib/builderStore';

export const NAV_CELL_SIZE = 0.5;
const PLAYER_PAD = 0.28;

export interface NavGrid {
  cellSize: number;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** Row-major walkability flags (`row * cols + col`). */
  walkable: Uint8Array;
}

interface Box2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function worldFloorRect(item: PlacedItem): Box2D {
  const [sx, , sz] = item.scale;
  const isHalf = item.catalogId.includes('floorHalf');
  const w = (isHalf ? 0.5 : 1.0) * sx;
  const d = 1.0 * sz;
  // Kenney floor tiles extend local [0..w] in X and [-d..0] in Z before rotation.
  const corners: Array<[number, number]> = [
    [0, 0],
    [w, 0],
    [0, -d],
    [w, -d],
  ];
  const rad = degToRad(item.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [lx, lz] of corners) {
    // Three.js Y-axis rotation: x' = x*cos + z*sin, z' = -x*sin + z*cos
    const wx = item.position[0] + lx * cos + lz * sin;
    const wz = item.position[2] - lx * sin + lz * cos;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wz < minZ) minZ = wz;
    if (wz > maxZ) maxZ = wz;
  }
  return { minX, maxX, minZ, maxZ };
}

function worldColliderBoxes(items: PlacedItem[]): Box2D[] {
  const boxes: Box2D[] = [];
  const k = KENNEY_UNIT_SCALE;

  for (const item of items) {
    if (item.type === 'floor' || item.noCollide) continue;
    // Ignore wall/ceiling mounted props above head height
    if (item.position[1] > 1.55) continue;

    const [sx, , sz] = item.scale;
    const rad = degToRad(item.rotation);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const absCos = Math.abs(cos);
    const absSin = Math.abs(sin);

    if (item.type === 'wall') {
      const isHalf = item.catalogId.includes('wallHalf');
      const isCorner = item.catalogId.includes('Corner');
      const isDoorway =
        item.catalogId.includes('Doorway') || item.catalogId.includes('doorway');
      const len = (isHalf ? 0.5 : isCorner ? 0.55 : 1.0) * sx;
      const depth = (isCorner ? 0.55 : 0.08) * sz;

      if (isDoorway) {
        const jambWidth = len * 0.22;
        const rx = (jambWidth * absCos + depth * absSin) * 0.5 + PLAYER_PAD;
        const rz = (jambWidth * absSin + depth * absCos) * 0.5 + PLAYER_PAD;
        for (const frac of [0.11, 0.89]) {
          const lx = len * frac;
          const lz = -depth * 0.5;
          const wx = item.position[0] + lx * cos + lz * sin;
          const wz = item.position[2] - lx * sin + lz * cos;
          boxes.push({ minX: wx - rx, maxX: wx + rx, minZ: wz - rz, maxZ: wz + rz });
        }
        continue;
      }

      const cx = len * 0.5;
      const cz = -depth * 0.5;
      const wx = item.position[0] + cx * cos + cz * sin;
      const wz = item.position[2] - cx * sin + cz * cos;
      const rx = (len * absCos + depth * absSin) * 0.5 + PLAYER_PAD;
      const rz = (len * absSin + depth * absCos) * 0.5 + PLAYER_PAD;
      boxes.push({ minX: wx - rx, maxX: wx + rx, minZ: wz - rz, maxZ: wz + rz });
      continue;
    }

    const w = 0.45 * (sx / k) * 2;
    const d = 0.45 * (sz / k) * 2;
    const rx = (w * absCos + d * absSin) * 0.5 + PLAYER_PAD;
    const rz = (w * absSin + d * absCos) * 0.5 + PLAYER_PAD;
    boxes.push({
      minX: item.position[0] - rx,
      maxX: item.position[0] + rx,
      minZ: item.position[2] - rz,
      maxZ: item.position[2] + rz,
    });
  }

  return boxes;
}

/**
 * Builds a 2D `0.5m` occupancy grid over placed floor tiles (or default `-4..4m` pad),
 * subtracting padded wall and prop colliders while keeping doorways open.
 */
export function buildNavGrid(items: PlacedItem[], cellSize = NAV_CELL_SIZE): NavGrid {
  const floors = items.filter((i) => i.type === 'floor').map(worldFloorRect);
  const floorRects = floors.length > 0 ? floors : [{ minX: -4, maxX: 4, minZ: -4, maxZ: 4 }];

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const r of floorRects) {
    if (r.minX < minX) minX = r.minX;
    if (r.maxX > maxX) maxX = r.maxX;
    if (r.minZ < minZ) minZ = r.minZ;
    if (r.maxZ > maxZ) maxZ = r.maxZ;
  }

  // Snap outer grid origin neatly to cellSize
  minX = Math.floor(minX / cellSize) * cellSize;
  minZ = Math.floor(minZ / cellSize) * cellSize;
  maxX = Math.ceil(maxX / cellSize) * cellSize;
  maxZ = Math.ceil(maxZ / cellSize) * cellSize;

  const cols = Math.max(1, Math.round((maxX - minX) / cellSize));
  const rows = Math.max(1, Math.round((maxZ - minZ) / cellSize));
  const walkable = new Uint8Array(cols * rows);

  const blockers = worldColliderBoxes(items);

  for (let r = 0; r < rows; r++) {
    const cz = minZ + (r + 0.5) * cellSize;
    for (let c = 0; c < cols; c++) {
      const cx = minX + (c + 0.5) * cellSize;
      const onFloor = floorRects.some(
        (f) => cx >= f.minX + 0.05 && cx <= f.maxX - 0.05 && cz >= f.minZ + 0.05 && cz <= f.maxZ - 0.05,
      );
      if (!onFloor) continue;

      const blocked = blockers.some(
        (b) => cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ,
      );
      walkable[r * cols + c] = blocked ? 0 : 1;
    }
  }

  return { cellSize, minX, minZ, cols, rows, walkable };
}

export function worldToCell(grid: NavGrid, x: number, z: number): [number, number] {
  const c = Math.max(0, Math.min(grid.cols - 1, Math.floor((x - grid.minX) / grid.cellSize)));
  const r = Math.max(0, Math.min(grid.rows - 1, Math.floor((z - grid.minZ) / grid.cellSize)));
  return [c, r];
}

export function cellToWorld(grid: NavGrid, c: number, r: number): [number, number] {
  return [
    grid.minX + (c + 0.5) * grid.cellSize,
    grid.minZ + (r + 0.5) * grid.cellSize,
  ];
}

export function isCellWalkable(grid: NavGrid, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
  return grid.walkable[r * grid.cols + c] === 1;
}

export function isWorldWalkable(grid: NavGrid, x: number, z: number): boolean {
  const [c, r] = worldToCell(grid, x, z);
  return isCellWalkable(grid, c, r);
}

/** Finds the closest walkable world XZ center via expanding BFS around `xz`. */
export function findNearestWalkable(
  grid: NavGrid,
  xz: readonly [number, number],
  maxRadiusCells = 10,
): [number, number] | null {
  const [sc, sr] = worldToCell(grid, xz[0], xz[1]);
  if (isCellWalkable(grid, sc, sr)) return cellToWorld(grid, sc, sr);

  let best: [number, number] | null = null;
  let bestDist2 = Infinity;

  for (let rad = 1; rad <= maxRadiusCells; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.abs(dc) !== rad && Math.abs(dr) !== rad) continue;
        const nc = sc + dc;
        const nr = sr + dr;
        if (!isCellWalkable(grid, nc, nr)) continue;
        const d2 = dc * dc + dr * dr;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          best = cellToWorld(grid, nc, nr);
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Picks a random walkable world XZ cell sufficiently far from `avoidXZ`. */
export function sampleRandomWalkable(
  grid: NavGrid,
  avoidXZ: readonly [number, number],
  minDistance = 1.0,
): [number, number] | null {
  const candidates: Array<[number, number]> = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.walkable[r * grid.cols + c] !== 1) continue;
      const [wx, wz] = cellToWorld(grid, c, r);
      const dist = Math.hypot(wx - avoidXZ[0], wz - avoidXZ[1]);
      if (dist >= minDistance) candidates.push([wx, wz]);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

const DIRS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * 8-way A* pathfinder with corner-cutting prevention and colinear waypoint smoothing.
 * Returns `null` if no valid path exists.
 */
export function findPath(
  grid: NavGrid,
  fromXZ: readonly [number, number],
  toXZ: readonly [number, number],
): Array<[number, number]> | null {
  const [sc, sr] = worldToCell(grid, fromXZ[0], fromXZ[1]);
  const [gc, gr] = worldToCell(grid, toXZ[0], toXZ[1]);

  if (!isCellWalkable(grid, sc, sr) || !isCellWalkable(grid, gc, gr)) {
    return null;
  }
  if (sc === gc && sr === gr) {
    return [[toXZ[0], toXZ[1]]];
  }

  const total = grid.cols * grid.rows;
  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const startIdx = sr * grid.cols + sc;
  const goalIdx = gr * grid.cols + gc;

  gScore[startIdx] = 0;
  fScore[startIdx] = Math.hypot(gc - sc, gr - sr);
  const open: number[] = [startIdx];

  while (open.length > 0) {
    let bestPos = 0;
    let bestF = fScore[open[0]];
    for (let i = 1; i < open.length; i++) {
      const f = fScore[open[i]];
      if (f < bestF) {
        bestF = f;
        bestPos = i;
      }
    }

    const cur = open[bestPos];
    open.splice(bestPos, 1);

    if (cur === goalIdx) {
      const rawCells: Array<[number, number]> = [];
      let p = goalIdx;
      while (p !== -1 && p !== startIdx) {
        const c = p % grid.cols;
        const r = Math.floor(p / grid.cols);
        rawCells.push([c, r]);
        p = cameFrom[p];
      }
      rawCells.reverse();

      // Smooth colinear runs & end accurately at requested `toXZ`
      const smoothed: Array<[number, number]> = [];
      let prevDc = 0;
      let prevDr = 0;
      let prevC = sc;
      let prevR = sr;
      for (let i = 0; i < rawCells.length; i++) {
        const [c, r] = rawCells[i];
        const dc = c - prevC;
        const dr = r - prevR;
        if (smoothed.length > 0 && dc === prevDc && dr === prevDr) {
          smoothed[smoothed.length - 1] = cellToWorld(grid, c, r);
        } else {
          smoothed.push(cellToWorld(grid, c, r));
        }
        prevDc = dc;
        prevDr = dr;
        prevC = c;
        prevR = r;
      }
      if (smoothed.length > 0) {
        smoothed[smoothed.length - 1] = [toXZ[0], toXZ[1]];
      }
      return smoothed;
    }

    closed[cur] = 1;
    const cc = cur % grid.cols;
    const cr = Math.floor(cur / grid.cols);

    for (const [dc, dr, stepCost] of DIRS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (!isCellWalkable(grid, nc, nr)) continue;

      // Prevent squeezing diagonally between blocked corners
      if (dc !== 0 && dr !== 0) {
        if (!isCellWalkable(grid, cc + dc, cr) || !isCellWalkable(grid, cc, cr + dr)) {
          continue;
        }
      }

      const nIdx = nr * grid.cols + nc;
      if (closed[nIdx]) continue;

      const tentativeG = gScore[cur] + stepCost;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = cur;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + Math.hypot(gc - nc, gr - nr);
        if (!open.includes(nIdx)) {
          open.push(nIdx);
        }
      }
    }
  }

  return null;
}
