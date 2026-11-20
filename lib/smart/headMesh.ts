import * as THREE from 'three';
import type { MeshData } from '@/components/scene/useMeshGeometry';

/**
 * Turning an arbitrary uploaded mesh into a head the character can wear.
 *
 * Everything here is pure: it takes a `THREE.Object3D` and returns plain
 * attribute arrays. No loader, no DOM, no store — which is what lets
 * `scripts/check_smart_import.cjs` exercise the scale/axis maths directly.
 *
 * The frame assumptions are the ones the renderer already holds: metres,
 * Y-up, character facing −Z, head centred on the origin. The shipped UBE head
 * spans y ∈ [−0.130, 0.138] (0.268 m) and x ∈ ±0.086, so that is the target
 * every import is normalised toward.
 */

/** Height the imported head is scaled to; the shipped UBE head measures 0.268 m. */
export const HEAD_HEIGHT_METRES = 0.27;

/**
 * A model is treated as Z-up when its depth is at least this much larger than
 * its height. Blender/3ds-Max exports are the common Z-up case; a real head is
 * always taller than it is deep, so the margin only has to clear noise.
 */
const Z_UP_RATIO = 1.15;

/** Rejections carry a reason the panel can show verbatim. */
export class MeshImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshImportError';
  }
}

export interface ParsedMesh {
  /** World-space, still in the file's own units and axis convention. */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: number[];
  /** How many drawable meshes were merged; surfaced in the DEV diagnostics. */
  sourceMeshes: number;
}

export interface NormalisedHead extends ParsedMesh {
  /** Multiplier applied to reach metres (before centring). */
  scale: number;
  /** True when a Z-up source was rotated into the Y-up render frame. */
  rotatedZUp: boolean;
  heightMetres: number;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Flatten every drawable mesh under `root` into one triangle list.
 *
 * Each mesh's world matrix is applied at merge time, so a GLB whose transform
 * lives on a parent node arrives at its authored size and orientation instead
 * of collapsing to local coordinates. Meshes without a position attribute are
 * skipped; a scene with none is rejected.
 */
export function mergeSceneMeshes(root: THREE.Object3D): ParsedMesh {
  root.updateMatrixWorld(true);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let sourceMeshes = 0;

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!geometry || !position || position.count === 0) return;

    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const base = positions.length / 3;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      positions.push(finite(vertex.x), finite(vertex.y), finite(vertex.z));
      if (uv) uvs.push(finite(uv.getX(i)), finite(uv.getY(i)));
      else uvs.push(0, 0);
    }

    /* Faces: use the geometry's own index when it has one, otherwise the
       vertex order is already a triangle list. Anything that is not a
       triangle (strips/fans from an exotic exporter) is dropped rather than
       guessed at — the count is reported as a rejection reason downstream. */
    const index = geometry.getIndex();
    if (index) {
      for (let t = 0; t + 2 < index.count; t += 3) {
        indices.push(base + index.getX(t), base + index.getX(t + 1), base + index.getX(t + 2));
      }
    } else {
      for (let i = 0; i + 2 < position.count; i += 3) {
        indices.push(base + i, base + i + 1, base + i + 2);
      }
    }

    /* Normals are recomputed from the final geometry (see `recomputeNormals`):
       a file's authored `vn` data is frequently stale after a node transform,
       and the pipeline's own decoders all normalise the same way. */
    sourceMeshes += 1;
  });

  if (!sourceMeshes) {
    throw new MeshImportError('this file contains no mesh geometry');
  }
  if (indices.length === 0) {
    throw new MeshImportError('no triangles found — this mesh has vertices but no faces');
  }

  const parsed: ParsedMesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    uvs: new Float32Array(uvs),
    indices,
    sourceMeshes,
  };
  parsed.normals = recomputeNormals(parsed.positions, parsed.indices);
  return parsed;
}

/**
 * Unit face normals summed per vertex, then normalised.
 *
 * This is the same weighting `convert_worker.py` and `tri_geometry` use, so an
 * imported head shades consistently with every pack part beside it.
 */
export function recomputeNormals(positions: Float32Array, indices: number[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;

    for (const i of [ia, ib, ic]) {
      normals[i * 3] += nx;
      normals[i * 3 + 1] += ny;
      normals[i * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function boundsOf(positions: Float32Array): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

/**
 * Scale, orient and centre an imported mesh so it can stand in for the UBE head.
 *
 * Order matters and is fixed: rotate a Z-up source first, then measure, then
 * scale by height and translate the bounding-box centre to the origin. Doing
 * the scale before the rotation would mix the two axes it is trying to
 * separate, and centring before scaling would move the model by the wrong
 * amount.
 */
export function normaliseHead(mesh: ParsedMesh): NormalisedHead {
  let positions = new Float32Array(mesh.positions);

  const before = boundsOf(positions);
  const heightBefore = before.max[1] - before.min[1];
  const depthBefore = before.max[2] - before.min[2];
  if (!(heightBefore > 0)) {
    throw new MeshImportError('this mesh is flat — it has no height to match a head');
  }

  /* A model deeper than it is tall was authored Z-up (Blender, 3ds Max).
     Rotate it into the render frame's Y-up convention: (x, y, z) → (x, z, −y). */
  const rotatedZUp = depthBefore > heightBefore * Z_UP_RATIO;
  if (rotatedZUp) {
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      const z = positions[i + 2];
      positions[i + 1] = z;
      positions[i + 2] = -y;
    }
  }

  const bounds = boundsOf(positions);
  const height = bounds.max[1] - bounds.min[1];
  const scale = HEAD_HEIGHT_METRES / height;
  const centre: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];

  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - centre[0]) * scale;
    positions[i + 1] = (positions[i + 1] - centre[1]) * scale;
    positions[i + 2] = (positions[i + 2] - centre[2]) * scale;
  }

  return {
    positions,
    normals: recomputeNormals(positions, mesh.indices),
    uvs: mesh.uvs,
    indices: mesh.indices,
    sourceMeshes: mesh.sourceMeshes,
    scale,
    rotatedZUp,
    heightMetres: HEAD_HEIGHT_METRES,
  };
}

/**
 * Express a normalised head as the `MeshData` the renderer validates.
 *
 * `meshDataToGeometry` requires normals to match positions exactly and UVs to
 * be two per vertex; both are guaranteed here, with a zero-UV fill for a mesh
 * that shipped none (`headTextureMissing` means the head draws untextured
 * regardless, so the values are never sampled).
 */
export function toMeshData(mesh: ParsedMesh): MeshData {
  const vertexCount = mesh.positions.length / 3;
  if (mesh.uvs.length !== vertexCount * 2) {
    mesh = { ...mesh, uvs: new Float32Array(vertexCount * 2) };
  }
  return {
    positions: mesh.positions,
    normals: mesh.normals.length === mesh.positions.length
      ? mesh.normals
      : recomputeNormals(mesh.positions, mesh.indices),
    uvs: mesh.uvs,
    indices: mesh.indices,
  };
}
