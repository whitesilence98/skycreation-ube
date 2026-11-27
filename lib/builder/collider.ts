import * as THREE from 'three';
import { KENNEY_UNIT_SCALE, type PlacedItem } from '@/lib/builderStore';

/** Approximate unscaled local extents (width, height, depth) for quick AABB collider generation. */
function estimateExtents(item: PlacedItem): { cx: number; cy: number; cz: number; size: THREE.Vector3 } {
  const [sx, sy, sz] = item.scale;
  const k = KENNEY_UNIT_SCALE;

  if (item.type === 'wall') {
    const isHalf = item.catalogId.includes('wallHalf');
    const isCorner = item.catalogId.includes('Corner');
    const len = (isHalf ? 0.5 : isCorner ? 0.55 : 1.0) * sx;
    const depth = (isCorner ? 0.55 : 0.08) * sz;
    const height = 1.29 * sy;
    return {
      cx: len * 0.5,
      cy: height * 0.5,
      cz: -depth * 0.5,
      size: new THREE.Vector3(len, height, depth),
    };
  }

  // Generic prop extents (~0.65m radius around centered prop)
  const w = 0.45 * (sx / k) * 2;
  const h = 0.85 * (sy / k) * 2;
  const d = 0.45 * (sz / k) * 2;
  return {
    cx: 0,
    cy: h * 0.5,
    cz: 0,
    size: new THREE.Vector3(w, h, d),
  };
}

/**
 * Builds world-space AABB `Box3` colliders for solid walls and furniture props.
 * Floors, rugs, ceiling lights, and `noCollide` items are excluded so the character
 * can walk freely across floors and rugs.
 */
export function buildColliders(items: PlacedItem[]): THREE.Box3[] {
  const boxes: THREE.Box3[] = [];
  const rotMat = new THREE.Matrix4();
  const centerVec = new THREE.Vector3();

  for (const item of items) {
    if (item.type === 'floor' || item.noCollide) continue;
    const isDoorway =
      item.catalogId.includes('Doorway') || item.catalogId.includes('doorway');
    const { cx, cy, cz, size } = estimateExtents(item);
    const rad = THREE.MathUtils.degToRad(item.rotation);
    rotMat.makeRotationY(rad);

    // Leave the center opening walkable for doorway walls; only keep side jamb pillars.
    if (isDoorway && item.type === 'wall') {
      const jambWidth = size.x * 0.22;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const rx = jambWidth * cos + size.z * sin;
      const rz = jambWidth * sin + size.z * cos;
      for (const frac of [0.11, 0.89]) {
        centerVec.set(size.x * frac, cy, cz).applyMatrix4(rotMat);
        centerVec.x += item.position[0];
        centerVec.y += item.position[1];
        centerVec.z += item.position[2];
        boxes.push(
          new THREE.Box3().setFromCenterAndSize(
            centerVec,
            new THREE.Vector3(rx, size.y, rz),
          ),
        );
      }
      continue;
    }

    centerVec.set(cx, cy, cz).applyMatrix4(rotMat);
    centerVec.x += item.position[0];
    centerVec.y += item.position[1];
    centerVec.z += item.position[2];

    // Rotate AABB XZ dimensions for 90°/270° or angled placements
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const rx = size.x * cos + size.z * sin;
    const rz = size.x * sin + size.z * cos;

    const box = new THREE.Box3().setFromCenterAndSize(
      centerVec,
      new THREE.Vector3(rx, size.y, rz),
    );
    boxes.push(box);
  }

  return boxes;
}

/**
 * Checks whether a character cylinder/capsule at `pos` with `radius` overlaps any room collider,
 * and returns a resolved position sliding along unobstructed axes if possible.
 */
export function resolvePlayerCollision(
  prevPos: THREE.Vector3,
  nextPos: THREE.Vector3,
  colliders: THREE.Box3[],
  radius = 0.24,
): THREE.Vector3 {
  const testPoint = (x: number, z: number): boolean => {
    for (const box of colliders) {
      if (box.max.y < 0.1 || box.min.y > 1.7) continue; // ignore ceiling items
      const clampedX = Math.max(box.min.x, Math.min(x, box.max.x));
      const clampedZ = Math.max(box.min.z, Math.min(z, box.max.z));
      const dx = x - clampedX;
      const dz = z - clampedZ;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  };

  if (!testPoint(nextPos.x, nextPos.z)) return nextPos;
  // Slide along X only
  if (!testPoint(nextPos.x, prevPos.z)) {
    return new THREE.Vector3(nextPos.x, nextPos.y, prevPos.z);
  }
  // Slide along Z only
  if (!testPoint(prevPos.x, nextPos.z)) {
    return new THREE.Vector3(prevPos.x, nextPos.y, nextPos.z);
  }
  return prevPos.clone();
}
