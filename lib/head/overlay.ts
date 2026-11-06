import * as THREE from 'three';
import { REGIONS_BY_ID, type RegionId } from '@/lib/regions';

/* ────────────────────────────────────────────────────────────────
   Edge extraction (done once per head build)
   ──────────────────────────────────────────────────────────────── */
export function buildMeshEdges(
  geometry: THREE.BufferGeometry,
  step = 1,
  inside?: (vertexIndex: number) => boolean,
): Uint32Array {
  const index = geometry.getIndex();
  if (!index) return new Uint32Array(0);
  const n = geometry.getAttribute('position').count;
  const seen = new Set<number>();
  const out: number[] = [];

  for (let i = 0; i < index.count; i += 3 * step) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const keepA = !inside || inside(a);
    const keepB = !inside || inside(b);
    const keepC = !inside || inside(c);

    const tri: Array<[number, number]> = [];
    if (keepA && keepB) tri.push([a, b]);
    if (keepB && keepC) tri.push([b, c]);
    if (keepC && keepA) tri.push([c, a]);

    for (const [u, v] of tri) {
      const lo = u < v ? u : v;
      const hi = u < v ? v : u;
      const key = lo * n + hi;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(lo, hi);
      }
    }
  }
  return new Uint32Array(out);
}

/**
 * A triangulated grid over the loft, sampled every `ringStep` rings and
 * `segStep` segments.
 *
 * Both the faint full-face veil and the dense active-region wire come from
 * here, and the sampling rate is the *only* thing that differs between them.
 * That is deliberate: 128 × 160 = 20 480 quads, and drawing every unique edge
 * is ~61 k segments (122 k vertices) re-skinned on the CPU every other frame —
 * the pale rectangular grid across the whole face in the reported crop, and
 * the heaviest loop in the scene.
 *
 * The reference draws a *triangulated* patch: one diagonal per quad,
 * alternating direction so neighbouring quads mirror each other. Adding both
 * diagonals (the cross-hatch an earlier pass avoided by dropping them all)
 * reads as a white blot; keeping exactly one gives the reference's read.
 *
 * `inside` optionally clips each quad to a region, which is how the active
 * region's denser patch is produced without a 61 k-edge intermediate table.
 */
export function buildGridEdges(
  ringCount: number,
  segmentCount: number,
  ringStep = 4,
  segStep = 6,
  inside?: (vertexIndex: number) => boolean,
): Uint32Array {
  const out: number[] = [];
  const cols = Math.ceil(segmentCount / segStep);
  const rows = Math.ceil(ringCount / ringStep);
  const keep = (a: number, b: number) => !inside || (inside(a) && inside(b));

  for (let r = 0; r < rows; r++) {
    const ri = Math.min(ringCount - 1, r * ringStep);
    const rNext = Math.min(ringCount - 1, (r + 1) * ringStep);
    for (let c = 0; c < cols; c++) {
      const si = (c * segStep) % segmentCount;
      const sNext = ((c + 1) * segStep) % segmentCount;
      const a = ri * segmentCount + si;
      const b = ri * segmentCount + sNext;
      const cc = rNext * segmentCount + si;
      const d = rNext * segmentCount + sNext;
      /* Ring iso-line and the vertical, both shared with the next cell. */
      if (keep(a, b)) out.push(a, b);
      if (keep(a, cc)) out.push(a, cc);
      /* One diagonal per quad, alternating. */
      if ((r + c) % 2 === 0) {
        if (keep(a, d)) out.push(a, d);
      } else if (keep(b, cc)) {
        out.push(b, cc);
      }
    }
  }
  return new Uint32Array(out);
}

/** The region ellipsoid as a predicate over loft vertex indices. */
export function regionPredicate(
  basePositions: Float32Array,
  region: RegionId,
): (vertexIndex: number) => boolean {
  const def = REGIONS_BY_ID[region];
  const [cx, cy, cz] = def.center;
  const R = def.radius;
  const rx = R * 0.82;
  const ry = R * 1.06;
  const rz = R * 0.80;
  return (i: number) => {
    const dx = (basePositions[i * 3] - cx) / rx;
    const dy = (basePositions[i * 3 + 1] - cy) / ry;
    const dz = (basePositions[i * 3 + 2] - cz) / rz;
    return dx * dx + dy * dy + dz * dz <= 1;
  };
}

/** Region vertices, thinned to a tidy BDO-style anchor set. */
export function selectRegionVertices(segments: Uint32Array, stride = 5): Uint32Array {
  const set = new Set<number>();
  for (let i = 0; i < segments.length; i += 2) {
    set.add(segments[i]);
    set.add(segments[i + 1]);
  }
  const all = Array.from(set).sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < all.length; i += stride) out.push(all[i]);
  return new Uint32Array(out);
}

/* ────────────────────────────────────────────────────────────────
   Dashed contours — snapped onto the head surface
   ──────────────────────────────────────────────────────────────── */
export interface ContourDef {
  region: RegionId;
  /** Polyline in head-local (x, y); closed loops repeat their first point. */
  points: Array<[number, number]>;
  closed: boolean;
}

function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n = 64,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

export const CONTOURS: ContourDef[] = [
  { region: 'forehead', points: ellipse(0, 0.0505, 0.0545, 0.0225, 64), closed: true },
  {
    region: 'eyebrows',
    closed: false,
    points: [
      [-0.0548, 0.0128],
      [-0.0442, 0.0175],
      [-0.0302, 0.0202],
      [-0.0165, 0.0198],
      [-0.0052, 0.0162],
      [0.0052, 0.0162],
      [0.0165, 0.0198],
      [0.0302, 0.0202],
      [0.0442, 0.0175],
      [0.0548, 0.0128],
    ],
  },
  { region: 'nose', points: ellipse(0, -0.0405, 0.0182, 0.0312, 64), closed: true },
  { region: 'cheeks', points: ellipse(-0.0472, -0.0405, 0.0248, 0.0242, 48), closed: true },
  { region: 'lips', points: ellipse(0, -0.0902, 0.0295, 0.0138, 56), closed: true },
  {
    region: 'jaw',
    closed: false,
    points: [
      [-0.0582, -0.0925],
      [-0.0535, -0.1142],
      [-0.0432, -0.1328],
      [-0.0252, -0.1452],
      [0, -0.1502],
      [0.0252, -0.1452],
      [0.0432, -0.1328],
      [0.0535, -0.1142],
      [0.0582, -0.0925],
    ],
  },
];

/**
 * Snaps each (x, y) sample to the nearest **frontmost** vertex of the head.
 *
 * Nearest-3D was wrong: on a closed skull the nearest vertex to a forehead
 * sample can sit on the far side, so contours collapsed into a scribble
 * across the face. For each sample we instead find the vertex whose (x, y)
 * is closest and, among those within a small tolerance, take the one with
 * the greatest z — i.e. the point on the front surface.
 */
export function snapContour(
  points: Array<[number, number]>,
  basePositions: Float32Array,
): Uint32Array {
  const out: number[] = [];
  const count = basePositions.length / 3;

  for (const [x, y] of points) {
    let best = -1;
    let bestD = Infinity;
    let bestZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const px = basePositions[i * 3];
      const py = basePositions[i * 3 + 1];
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      const z = basePositions[i * 3 + 2];
      // a strictly nearer vertex wins; near-ties resolve to the frontmost
      if (d < bestD - 1e-9 || (d < bestD * 1.02 && z > bestZ)) {
        bestD = Math.min(bestD, d);
        bestZ = z;
        best = i;
      }
    }
    if (best >= 0) out.push(best);
  }
  return new Uint32Array(out);
}

/**
 * Fills a Line geometry from skinned vertex positions.
 *
 * `close` must follow the contour's own `closed` flag: an open polyline
 * (eyebrows, jawline) that gets force-closed draws a chord straight back to
 * its first sample, which reads as a long stroke slashed across the face.
 */
export function writeContourPositions(
  attr: THREE.BufferAttribute,
  indices: Uint32Array,
  sample: (vertex: number, out: THREE.Vector3) => THREE.Vector3,
  samplePoint: THREE.Vector3,
  close = true,
): number {
  let n = 0;
  for (let i = 0; i < indices.length; i++) {
    sample(indices[i], samplePoint);
    attr.setXYZ(n++, samplePoint.x, samplePoint.y, samplePoint.z);
  }
  if (close && indices.length > 2) {
    sample(indices[0], samplePoint);
    attr.setXYZ(n++, samplePoint.x, samplePoint.y, samplePoint.z);
  }
  attr.needsUpdate = true;
  return n;
}
