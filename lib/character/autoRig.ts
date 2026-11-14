import * as THREE from 'three';
import type { LoadedMesh, MaterialRole, MeshBone } from '@/components/scene/useMeshGeometry';
import {
  meshFrameMatrix,
  XP32_CANONICAL_PARENTS,
} from '@/lib/character/skeleton';
import type { SkeletonRegistry } from '@/lib/character/skeleton';

/**
 * Auto-rig a pack shape that has no usable skinning of its own.
 *
 * Two shapes reach this module:
 *
 *  - a shape with no bones at all (an unskinned garment or body variant), and
 *  - a shape that names bones but whose vertices carry no weights (or only
 *    some of them do, e.g. a producer that dropped a partial weight stream).
 *
 * Weights are transferred from a donor body (`LoadedMesh` with
 * `skinIndex`/`skinWeight` on its geometry) by **exact nearest neighbour** in
 * the shared converter frame. When the donor is absent or degenerate, a
 * canonical XP32 segment fallback assigns each vertex to the nearest
 * anatomical bone already present in the live `SkeletonRegistry`. If neither
 * source can resolve every vertex, the helper returns `null` and the caller
 * keeps drawing the shape as an unskinned mesh — it never half-rigs one.
 *
 * ### Coordinate space
 *
 * Both geometries are read from their own `position` attributes. Nothing here
 * applies a mesh's world matrix or a pose: pack meshes arrive in the same
 * converter frame (the render frame the registry's world rests live in), and
 * a posed/bone-transformed coordinate would drift as soon as the character
 * moves. `LoadedMesh.positions` is not trusted either — the weight slider
 * mutates the rendered geometry in place — so the local attribute is the one
 * source of truth.
 *
 * ### Ownership
 *
 * The returned `AutoRigResult.mesh` owns a **cloned** geometry. The source
 * `LoadedMesh` (and the cached loader geometry behind it) is never mutated or
 * disposed. The caller must dispose the derived geometry with
 * `disposeAutoRiggedMesh` when it replaces or unmounts the derived mesh. Bone
 * definitions are borrowed by reference from the donor (or synthesized from
 * the registry) so `SkeletonRegistry.register` resolves the same `THREE.Bone`
 * objects and the geometry's `skinIndex` values keep their meaning.
 */

/** Roles that may be auto-rigged. Hair, eyes, brows, lashes and mouth are
 *  authored in their own frames and are deliberately excluded. */
const AUTO_RIG_ROLES: ReadonlySet<MaterialRole> = new Set<MaterialRole>(['skin', 'clothing']);

/**
 * Whether a shape is an allowed auto-rig target.
 *
 * Authored material roles are authoritative when present: every slot must be
 * an eligible role, so a mixed clothing + skin outfit is accepted while a
 * shape carrying a hair, eye or accessory slot is not. A legacy
 * single-material mesh has no authored slots, so the caller's `defaultRole`
 * decides (and `SkinnedPart` defaults it to `hair`, which is ineligible).
 */
export function isAutoRigEligible(
  mesh: LoadedMesh,
  defaultRole?: MaterialRole,
): boolean {
  const materials = mesh.materials;
  if (materials?.length) return materials.every((spec) => AUTO_RIG_ROLES.has(spec.role));
  return Boolean(defaultRole && AUTO_RIG_ROLES.has(defaultRole));
}

export interface AutoRigOptions {
  /** Body mesh supplying skin indices/weights. */
  donor?: LoadedMesh | null;
  /** Shared registry used for the canonical-bone fallback. */
  registry?: SkeletonRegistry | null;
  /** Role of a legacy single-material mesh (eligibility gate). */
  defaultRole?: MaterialRole;
}

export interface AutoRigResult {
  /** Clone owning its geometry; bone definitions are shared references. */
  mesh: LoadedMesh;
  /** Which weight source produced the missing vertices. */
  source: 'donor' | 'canonical';
  /** Explicit ownership marker: dispose `mesh.geometry`, never the source. */
  ownsGeometry: true;
}

interface DonorInfluence {
  index: number;
  weight: number;
}

interface DonorRig {
  bones: MeshBone[];
  positions: Float32Array;
  /** Sanitized (non-zero, in-range, normalized) influences per donor vertex. */
  influences: Array<DonorInfluence[] | null>;
  valid: number[];
  grid: SpatialHash;
}

const EPSILON = 1e-12;

const positionOf = (geometry: THREE.BufferGeometry): THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null => {
  const attribute = geometry.getAttribute('position');
  return attribute && attribute.count > 0 ? attribute : null;
};

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

/** Point-to-segment squared distance, in the shared render frame. */
function distanceSqToSegment(
  x: number,
  y: number,
  z: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (lengthSq > EPSILON) {
    t = ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / lengthSq;
    t = Math.min(1, Math.max(0, t));
  }
  const dx = x - (a.x + abx * t);
  const dy = y - (a.y + aby * t);
  const dz = z - (a.z + abz * t);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Uniform grid over donor vertices for exact nearest-neighbour lookup.
 *
 * `nearest` is exhaustive, not radius-limited: it expands cell rings until no
 * unscanned ring can contain a closer point, and falls back to a linear scan
 * when the query is far outside the donor's bounding box. Equal distances are
 * broken by donor vertex index, so repeated calls yield identical weights.
 */
class SpatialHash {
  private readonly positions: Float32Array;
  private readonly valid: number[];
  private readonly cell: number;
  private readonly minCX: number;
  private readonly minCY: number;
  private readonly minCZ: number;
  private readonly maxCX: number;
  private readonly maxCY: number;
  private readonly maxCZ: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(positions: Float32Array, valid: number[]) {
    this.positions = positions;
    this.valid = valid;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const index of valid) {
      const o = index * 3;
      const x = positions[o];
      const y = positions[o + 1];
      const z = positions[o + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
    /* Roughly one vertex per cell for a compact donor; a floor keeps every
       vertex from landing in the same bucket on a degenerate point cloud. */
    this.cell = Math.max(1e-5, diagonal > 0 ? diagonal / Math.cbrt(Math.max(1, valid.length)) : 1);
    this.minCX = Math.floor(minX / this.cell);
    this.minCY = Math.floor(minY / this.cell);
    this.minCZ = Math.floor(minZ / this.cell);
    this.maxCX = Math.floor(maxX / this.cell);
    this.maxCY = Math.floor(maxY / this.cell);
    this.maxCZ = Math.floor(maxZ / this.cell);
    for (const index of valid) {
      const o = index * 3;
      const key = this.key(
        Math.floor(positions[o] / this.cell),
        Math.floor(positions[o + 1] / this.cell),
        Math.floor(positions[o + 2] / this.cell),
      );
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(index);
      else this.buckets.set(key, [index]);
    }
  }

  private key(cx: number, cy: number, cz: number): string {
    return `${cx},${cy},${cz}`;
  }

  /** Donor vertex index of the exact nearest valid vertex, or -1. */
  nearest(x: number, y: number, z: number): number {
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    const gz = Math.floor(z / this.cell);
    const maxRing = Math.max(
      Math.abs(gx - this.minCX),
      Math.abs(gx - this.maxCX),
      Math.abs(gy - this.minCY),
      Math.abs(gy - this.maxCY),
      Math.abs(gz - this.minCZ),
      Math.abs(gz - this.maxCZ),
    );

    const positions = this.positions;
    let best = -1;
    let bestSq = Infinity;
    const consider = (index: number) => {
      const o = index * 3;
      const dx = x - positions[o];
      const dy = y - positions[o + 1];
      const dz = z - positions[o + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestSq || (d === bestSq && (best < 0 || index < best))) {
        best = index;
        bestSq = d;
      }
    };

    /* A query far outside the donor bbox would spend its time in empty rings;
       the linear scan is exact, just not accelerated. */
    if (maxRing > 24) {
      for (const index of this.valid) consider(index);
      return best;
    }

    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (let cx = gx - ring; cx <= gx + ring; cx += 1) {
        for (let cy = gy - ring; cy <= gy + ring; cy += 1) {
          for (let cz = gz - ring; cz <= gz + ring; cz += 1) {
            /* Only the shell of the ring; the interior was scanned already. */
            if (
              Math.abs(cx - gx) !== ring &&
              Math.abs(cy - gy) !== ring &&
              Math.abs(cz - gz) !== ring
            ) continue;
            const bucket = this.buckets.get(this.key(cx, cy, cz));
            if (!bucket) continue;
            for (const index of bucket) consider(index);
          }
        }
      }
      /* Cells in rings beyond `ring` begin at least `ring * cell` away. Stop
         only when that bound is strictly larger than the best found, so an
         exact boundary tie can still be resolved by the lower index. */
      if (best >= 0) {
        const limitSq = ring * this.cell * (ring * this.cell);
        if (limitSq > bestSq) break;
      }
    }

    /* The ring bound is derived from the bbox, so this is unreachable with a
       non-empty valid list; keep it as a correctness backstop. */
    if (best < 0) for (const index of this.valid) consider(index);
    return best;
  }
}

/** Read and sanitize a donor's skinning. Invalid vertices are skipped so the
 *  nearest *valid* donor vertex wins instead of poisoning the transfer. */
function readDonor(donor: LoadedMesh | null | undefined): DonorRig | null {
  if (!donor?.bones?.length) return null;
  const position = positionOf(donor.geometry);
  const indexAttribute = donor.geometry.getAttribute('skinIndex');
  const weightAttribute = donor.geometry.getAttribute('skinWeight');
  if (!position || !indexAttribute || !weightAttribute) return null;
  if (
    indexAttribute.itemSize !== 4 ||
    weightAttribute.itemSize !== 4 ||
    indexAttribute.count !== position.count ||
    weightAttribute.count !== position.count
  ) return null;

  const count = position.count;
  const positions = new Float32Array(count * 3);
  const influences: Array<DonorInfluence[] | null> = new Array(count).fill(null);
  const valid: number[] = [];
  const boneCount = donor.bones.length;

  for (let v = 0; v < count; v += 1) {
    const x = position.getX(v);
    const y = position.getY(v);
    const z = position.getZ(v);
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue;
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;

    const collected: DonorInfluence[] = [];
    for (let k = 0; k < 4; k += 1) {
      const index = indexAttribute.getComponent(v, k);
      const weight = weightAttribute.getComponent(v, k);
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < boneCount &&
        isFiniteNumber(weight) &&
        weight > 0
      ) {
        collected.push({ index, weight });
      }
    }
    if (!collected.length) continue;

    /* Deterministic: heaviest first, then lower bone index. */
    collected.sort((a, b) => (b.weight - a.weight) || (a.index - b.index));
    const top = collected.slice(0, 4);
    let sum = 0;
    for (const influence of top) sum += influence.weight;
    if (!(sum > EPSILON)) continue;
    for (const influence of top) influence.weight /= sum;
    influences[v] = top;
    valid.push(v);
  }

  if (!valid.length) return null;
  return {
    bones: donor.bones,
    positions,
    influences,
    valid,
    grid: new SpatialHash(positions, valid),
  };
}

/** Canonical XP32 segments, bone → the child that defines its far end.
 *  A bone with no registered child is treated as a point. */
const CANONICAL_SEGMENTS: ReadonlyArray<readonly [string, string | null]> = [
  ['NPC Pelvis [Pelv]', 'NPC Spine [Spn0]'],
  ['NPC Spine [Spn0]', 'NPC Spine1 [Spn1]'],
  ['NPC Spine1 [Spn1]', 'NPC Spine2 [Spn2]'],
  ['NPC Spine2 [Spn2]', 'NPC Neck [Neck]'],
  ['NPC Neck [Neck]', 'NPC Head [Head]'],
  ['NPC Head [Head]', 'NPCEyeBone'],
  ['NPC L Clavicle [LClv]', 'NPC L UpperArm [LUar]'],
  ['NPC L UpperArm [LUar]', 'NPC L Forearm [LLar]'],
  ['NPC L Forearm [LLar]', 'NPC L Hand [LHnd]'],
  ['NPC L Hand [LHnd]', null],
  ['NPC R Clavicle [RClv]', 'NPC R UpperArm [RUar]'],
  ['NPC R UpperArm [RUar]', 'NPC R Forearm [RLar]'],
  ['NPC R Forearm [RLar]', 'NPC R Hand [RHnd]'],
  ['NPC R Hand [RHnd]', null],
  ['NPC L Thigh [LThg]', 'NPC L Calf [LClf]'],
  ['NPC L Calf [LClf]', 'NPC L Foot [Lft ]'],
  ['NPC L Foot [Lft ]', 'NPC L Toe0 [LToe]'],
  ['NPC R Thigh [RThg]', 'NPC R Calf [RClf]'],
  ['NPC R Calf [RClf]', 'NPC R Foot [Rft ]'],
  ['NPC R Foot [Rft ]', 'NPC R Toe0 [RToe]'],
];

interface CanonicalSegment {
  bone: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
}

function buildCanonicalSegments(registry: SkeletonRegistry | null | undefined): CanonicalSegment[] {
  if (!registry) return [];
  const segments: CanonicalSegment[] = [];
  for (const [bone, child] of CANONICAL_SEGMENTS) {
    const rest = registry.restWorld(bone);
    if (!rest) continue;
    const a = new THREE.Vector3().setFromMatrixPosition(rest);
    const childRest = child ? registry.restWorld(child) : null;
    const b = childRest
      ? new THREE.Vector3().setFromMatrixPosition(childRest)
      : a.clone();
    segments.push({ bone, a, b });
  }
  return segments;
}

/**
 * Up to two normalized canonical influences for a vertex.
 *
 * The nearest segment is always present with the dominant weight. A second
 * *distinct* bone is blended in only when its segment is close (within 1.6×
 * the nearest distance) — that is what softens the seam at a wrist or knee
 * without letting an unrelated limb leak in. Distance weights are inverse
 * square and re-normalized so the pair sums to 1.
 */
function nearestCanonicalBones(
  x: number,
  y: number,
  z: number,
  segments: CanonicalSegment[],
): Array<{ bone: string; weight: number }> {
  let best: CanonicalSegment | null = null;
  let bestSq = Infinity;
  let second: CanonicalSegment | null = null;
  let secondSq = Infinity;
  for (const segment of segments) {
    const d = distanceSqToSegment(x, y, z, segment.a, segment.b);
    if (d < bestSq) {
      /* Strict `<`: on an exact joint tie the earlier (proximal) entry wins,
         which is deterministic and the safer failure direction — a wrist
         vertex bound to the forearm still follows the arm chain. */
      second = best;
      secondSq = bestSq;
      best = segment;
      bestSq = d;
    } else if (d < secondSq && segment.bone !== best?.bone) {
      second = segment;
      secondSq = d;
    }
  }
  if (!best) return [];
  if (!second || secondSq > bestSq * 1.6 * 1.6) {
    return [{ bone: best.bone, weight: 1 }];
  }
  const a = 1 / Math.max(bestSq, EPSILON);
  const b = 1 / Math.max(secondSq, EPSILON);
  const sum = a + b;
  return [
    { bone: best.bone, weight: a / sum },
    { bone: second.bone, weight: b / sum },
  ];
}

/** Turn a registered bone's render-space rest back into a `MeshBone` definition.
 *
 *  The defs are only identifiers: the names are already in the registry, so
 *  `register` reuses the existing `THREE.Bone` and never re-reads `world`.
 *  Converting the transform anyway keeps the value honest if a caller ever
 *  inspects it. */
const FRAME_INVERSE = meshFrameMatrix('head').invert();
function boneDefinitionFor(
  registry: SkeletonRegistry,
  name: string,
): MeshBone | null {
  const rest = registry.restWorld(name);
  if (!rest) return null;
  const nif = FRAME_INVERSE.clone().multiply(rest);
  const e = nif.elements;
  return {
    name,
    parent: XP32_CANONICAL_PARENTS[name] ?? null,
    world: [
      e[0], e[4], e[8], e[12],
      e[1], e[5], e[9], e[13],
      e[2], e[6], e[10], e[14],
    ],
  };
}

/**
 * A vertex's authored row is usable when every slot that carries weight names
 * an in-range bone and no weight is negative or non-finite.
 *
 * Zero-weight slots are deliberately ignored: Bethesda NIFs pad unused slots
 * with arbitrary indices (often `0xFFFF`), and a garbage index at weight 0
 * cannot influence the vertex — disqualifying the row would throw away real
 * authored weights and re-derive them. Those garbage indices are normalized to
 * 0 on copy (see `autoRigMesh`) so they cannot reach a bone lookup.
 */
function hasAuthoredWeights(
  indexAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  weightAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertex: number,
  boneCount: number,
): boolean {
  let sum = 0;
  for (let k = 0; k < 4; k += 1) {
    const weight = weightAttribute.getComponent(vertex, k);
    if (!isFiniteNumber(weight) || weight < 0) return false;
    sum += weight;
    if (weight <= 0) continue;
    const index = indexAttribute.getComponent(vertex, k);
    if (!Number.isInteger(index) || index < 0 || index >= boneCount) return false;
  }
  return sum > EPSILON;
}

/**
 * Derive a skinned clone of `mesh`, or `null` when nothing should change.
 *
 * Returns `null` for:
 *  - a shape whose role is not opt-in eligible,
 *  - a shape that already has complete authored weights (no-op),
 *  - a shape with no bone source (no usable donor and no registry bones),
 *  - any malformed geometry or a vertex that cannot be resolved.
 */
export function autoRigMesh(
  mesh: LoadedMesh,
  options: AutoRigOptions = {},
): AutoRigResult | null {
  if (!isAutoRigEligible(mesh, options.defaultRole)) return null;

  const sourcePosition = positionOf(mesh.geometry);
  if (!sourcePosition) return null;
  const vertexCount = sourcePosition.count;
  if (!vertexCount) return null;

  const targetBones = mesh.bones?.length ? mesh.bones : [];
  const sourceIndex = mesh.geometry.getAttribute('skinIndex');
  const sourceWeight = mesh.geometry.getAttribute('skinWeight');
  const hasSourceAttributes =
    Boolean(sourceIndex && sourceWeight) &&
    sourceIndex!.itemSize === 4 &&
    sourceWeight!.itemSize === 4 &&
    sourceIndex!.count === vertexCount &&
    sourceWeight!.count === vertexCount;

  const missing = new Uint8Array(vertexCount);
  let missingCount = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    const authored = hasSourceAttributes
      ? hasAuthoredWeights(sourceIndex!, sourceWeight!, v, targetBones.length)
      : false;
    if (!authored) {
      missing[v] = 1;
      missingCount += 1;
    }
  }
  /* Nothing to do: the source's own skinning is the authority. */
  if (!missingCount) return null;

  const donor = readDonor(options.donor);
  const segments = donor ? [] : buildCanonicalSegments(options.registry);
  if (!donor && !segments.length) return null;

  /* Output bone table. Authored indices index `targetBones`, so those always
     keep their positions; anything borrowed is appended by name. */
  const outputBones: MeshBone[] = targetBones.slice();
  const indexByName = new Map<string, number>();
  outputBones.forEach((bone, index) => indexByName.set(bone.name, index));

  let donorIndexToOutput: number[] | null = null;
  if (donor) {
    if (!targetBones.length) {
      /* No target table: borrow the donor's definitions and indices wholesale. */
      outputBones.length = 0;
      outputBones.push(...donor.bones);
      donorIndexToOutput = donor.bones.map((_, index) => index);
    } else {
      donorIndexToOutput = donor.bones.map((bone) => {
        const existing = indexByName.get(bone.name);
        if (existing !== undefined) return existing;
        const index = outputBones.length;
        outputBones.push(bone);
        indexByName.set(bone.name, index);
        return index;
      });
    }
  } else {
    /* Ensure every canonical bone the fallback can choose has an index. */
    for (const segment of segments) {
      if (indexByName.has(segment.bone)) continue;
      const def = options.registry ? boneDefinitionFor(options.registry, segment.bone) : null;
      if (!def) continue;
      indexByName.set(def.name, outputBones.length);
      outputBones.push(def);
    }
  }

  const indices = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);

  for (let v = 0; v < vertexCount; v += 1) {
    const offset = v * 4;
    if (!missing[v]) {
      /* Preserve the authored weights exactly. A zero-weight slot's index is
         written as 0 when it is out of range: it contributes nothing, and a
         stray index would otherwise reach the GPU's bone lookup. */
      for (let k = 0; k < 4; k += 1) {
        const weight = sourceWeight!.getComponent(v, k);
        const index = sourceIndex!.getComponent(v, k);
        const valid = weight > 0 && Number.isInteger(index) && index >= 0 && index < outputBones.length;
        indices[offset + k] = valid ? index : 0;
        weights[offset + k] = weight > 0 ? weight : 0;
      }
      continue;
    }

    const x = sourcePosition.getX(v);
    const y = sourcePosition.getY(v);
    const z = sourcePosition.getZ(v);
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;

    if (donor && donorIndexToOutput) {
      const donorVertex = donor.grid.nearest(x, y, z);
      const influences = donorVertex >= 0 ? donor.influences[donorVertex] : null;
      if (!influences) return null;
      /* Two donor bones can share a name after a remap; combine, then keep 4. */
      const combined = new Map<number, number>();
      for (const influence of influences) {
        const target = donorIndexToOutput[influence.index];
        if (target === undefined) return null;
        combined.set(target, (combined.get(target) ?? 0) + influence.weight);
      }
      const ranked = [...combined.entries()]
        .sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
        .slice(0, 4);
      let sum = 0;
      for (const [, weight] of ranked) sum += weight;
      if (!(sum > EPSILON)) return null;
      ranked.forEach(([index, weight], k) => {
        indices[offset + k] = index;
        weights[offset + k] = weight / sum;
      });
    } else {
      const influences = nearestCanonicalBones(x, y, z, segments);
      if (!influences.length) return null;
      let sum = 0;
      for (const influence of influences.slice(0, 4)) sum += influence.weight;
      if (!(sum > EPSILON)) return null;
      influences.slice(0, 4).forEach((influence, k) => {
        const target = indexByName.get(influence.bone);
        if (target === undefined) return;
        indices[offset + k] = target;
        weights[offset + k] = influence.weight / sum;
      });
    }
  }

  const geometry = mesh.geometry.clone();
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const clonedPosition = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!clonedPosition) {
    geometry.dispose();
    return null;
  }

  return {
    mesh: {
      geometry,
      positions: clonedPosition.array as Float32Array,
      groups: mesh.groups,
      materials: mesh.materials,
      bones: outputBones,
    },
    source: donor ? 'donor' : 'canonical',
    ownsGeometry: true,
  };
}

/** Dispose the derived geometry only. The source mesh remains owned by the
 *  loader; calling this twice is harmless (three's dispose is idempotent). */
export function disposeAutoRiggedMesh(rigged: AutoRigResult | null): void {
  rigged?.mesh.geometry.dispose();
}
