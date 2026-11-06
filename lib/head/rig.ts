import * as THREE from 'three';
import {
  REGIONS,
  REGIONS_BY_ID,
  type RegionId,
  type SliderDef,
  type SliderValues,
} from '@/lib/regions';
import type { GizmoPose } from '@/lib/store';

export interface RegionBoneDef {
  region: RegionId;
  /** Pivot of the bone — chosen anatomically so scaling feels right. */
  pivot: [number, number, number];
  /** Centre of the influence field (differs from the pivot on purpose). */
  influence: [number, number, number];
  /** Ellipsoidal falloff radii. */
  radii: [number, number, number];
  /** Max bone weight at the centre. */
  strength: number;
}

export const REGION_BONES: RegionBoneDef[] = [
  {
    region: 'forehead',
    pivot: [0, 0.065, 0.080],
    influence: [0, 0.071, 0.081],
    radii: [0.057, 0.036, 0.05],
    strength: 0.95,
  },
  {
    region: 'eyebrows',
    pivot: [0, 0.035, 0.076],
    influence: [0, 0.037, 0.075],
    radii: [0.052, 0.018, 0.034],
    strength: 0.9,
  },
  {
    region: 'nose',
    pivot: [0, 0.020, 0.088],
    influence: [0, -0.0024, 0.0936],
    radii: [0.024, 0.032, 0.034],
    strength: 1.0,
  },
  {
    region: 'cheeks',
    pivot: [0.040, 0.000, 0.065],
    influence: [0.0468, 0.0006, 0.066],
    radii: [0.030, 0.028, 0.036],
    strength: 0.85,
  },
  {
    region: 'lips',
    pivot: [0, -0.020, 0.080],
    influence: [0, -0.0309, 0.0844],
    radii: [0.028, 0.018, 0.028],
    strength: 1.0,
  },
  {
    region: 'jaw',
    pivot: [0, -0.060, 0.045],
    influence: [0, -0.0763, 0.038],
    radii: [0.048, 0.035, 0.048],
    strength: 0.9,
  },
];

const mirror = (p: [number, number, number]): [number, number, number] => [-p[0], p[1], p[2]];

/** Regions whose deformation is a left/right pair. */
const isPairedRegion = (id: RegionId) => id === 'eyebrows' || id === 'cheeks';

/** The bone key for one side of a paired region.
 *
 *  `REGIONS_BY_ID[x].bone` already names the *left* bone (`'Brow_L'`,
 *  `'Cheek_L'`), so appending `_L`/`_R` to it produced `Brow_L_L` / `Brow_L_R`
 *  while `regionBoneKeys` asked for `Brow_L` / `Brow_R`. Every lookup was
 *  `undefined`: eyebrows and cheeks were never posed at all and the gizmo was
 *  inert on them. Strip the suffix, do not append to it. */
const pairedBoneKey = (def: { bone: string }, side: 'L' | 'R') =>
  `${def.bone.replace(/_[LR]$/, '')}_${side}`;

/** Bind pivot of a region's **left** bone, in head space.
 *
 *  `poseBone` writes `pivot + residual` and mirrors the pivot's x by `side`,
 *  so every caller that poses a bone has to hand it the same pivot `createRig`
 *  bound the bone at — otherwise the deformation happens about the origin and
 *  the face shears.
 *
 *  Resolved by **bone name**, not region id: `lips` and `jaw` share `Jaw`,
 *  and `createRig` binds that one bone at the first entry naming it. Keying off
 *  the region would hand the jaw a different pivot from the lips and teleport
 *  the bone whenever the active tab changed. */
export function regionPivot(region: RegionId): [number, number, number] {
  const name = REGIONS_BY_ID[region]?.bone;
  const def = REGION_BONES.find((rb) => REGIONS_BY_ID[rb.region]?.bone === name);
  return def ? def.pivot : [0, 0, 0];
}

export interface Rig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  headBone: THREE.Bone;
  /** region -> bone used by the gizmo and sliders */
  bones: Record<string, THREE.Bone>;
  /** region -> every bone that shares the deformation (L/R pairs) */
  regionBoneKeys: Record<RegionId, string[]>;
  /** flat list used by the CPU mirror of the skinning. */
  bindData: {
    skinIndex: Float32Array;
    skinWeight: Float32Array;
    basePosition: Float32Array;
    boneInverses: THREE.Matrix4[];
  };
  dispose: () => void;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Builds a flat bone hierarchy under a head root and skins the procedural
 * head to it. Weights are smooth ellipsoidal fields so a dragged nose bone
 * bends the face around the nose instead of moving a rigid chunk.
 */
export function createRig(geometry: THREE.BufferGeometry): Rig {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const count = position.count;

  const root = new THREE.Group();
  root.name = 'SkyrimHeadRoot';

  const headBone = new THREE.Bone();
  headBone.name = 'NPC Head [Head]';
  headBone.position.set(0, -0.02, 0);
  root.add(headBone);

  const bones: Record<string, THREE.Bone> = { Head: headBone };
  const boneList: THREE.Bone[] = [headBone];

  const addBone = (key: string, p: [number, number, number]) => {
    const b = new THREE.Bone();
    b.name = key;
    b.position.set(p[0], p[1], p[2]);
    // Recorded so `poseBone` can prove it does not move a bone at rest.
    b.userData.bindPivot = p;
    root.add(b);
    bones[key] = b;
    boneList.push(b);
    return b;
  };

  /* Flat siblings — one matrix per deform field keeps readback unambiguous.
     `lips` and `jaw` both deform through `Jaw`, so the region loop would add
     it twice and orphan the first copy; add each key once. */
  for (const rb of REGION_BONES) {
    const def = REGIONS_BY_ID[rb.region];
    if (isPairedRegion(rb.region)) {
      for (const side of ['L', 'R'] as const) {
        const key = pairedBoneKey(def, side);
        if (!bones[key]) addBone(key, side === 'L' ? rb.pivot : mirror(rb.pivot));
      }
    } else if (!bones[def.bone]) {
      addBone(def.bone, rb.pivot);
    }
  }

  const regionBoneKeys: Record<RegionId, string[]> = {
    forehead: ['Forehead'],
    eyebrows: ['Brow_L', 'Brow_R'],
    nose: ['Nose'],
    cheeks: ['Cheek_L', 'Cheek_R'],
    lips: ['Lips'],
    jaw: ['Jaw'],
  };

  // ── weights ────────────────────────────────────────────────────
  const skinIndex = new Float32Array(count * 4);
  const skinWeight = new Float32Array(count * 4);

  const fields: Array<{
    boneIndex: number;
    center: THREE.Vector3;
    inv: THREE.Vector3;
    strength: number;
  }> = [];

  for (const rb of REGION_BONES) {
    const def = REGIONS_BY_ID[rb.region];
    if (isPairedRegion(rb.region)) {
      /* The brow influence sits at x = 0, so choosing the bone from the sign
         of the centre put *both* mirrored fields on the same bone and left
         the other one unweighted. The side has to come from the loop index. */
      const sides = ['L', 'R'] as const;
      const centers = [rb.influence, mirror(rb.influence)];
      for (let i = 0; i < 2; i++) {
        const c = centers[i];
        fields.push({
          boneIndex: boneList.indexOf(bones[pairedBoneKey(def, sides[i])]),
          center: new THREE.Vector3(c[0], c[1], c[2]),
          inv: new THREE.Vector3(1 / rb.radii[0], 1 / rb.radii[1], 1 / rb.radii[2]),
          strength: rb.strength,
        });
      }
    } else {
      fields.push({
        boneIndex: boneList.indexOf(bones[def.bone]),
        center: new THREE.Vector3(rb.influence[0], rb.influence[1], rb.influence[2]),
        inv: new THREE.Vector3(1 / rb.radii[0], 1 / rb.radii[1], 1 / rb.radii[2]),
        strength: rb.strength,
      });
    }
  }

  const acc: Array<{ i: number; w: number }> = [];

  for (let v = 0; v < count; v++) {
    const x = position.getX(v);
    const y = position.getY(v);
    const z = position.getZ(v);

    acc.length = 0;
    for (let f = 0; f < fields.length; f++) {
      const fd = fields[f];
      const dx = (x - fd.center.x) * fd.inv.x;
      const dy = (y - fd.center.y) * fd.inv.y;
      const dz = (z - fd.center.z) * fd.inv.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      /* exp(-2.1 d²) → ~0.12 at the ellipse boundary, effectively zero at
         1.6×. The back-of-head term used to be a hard cliff (`z > 0.004 ? 1 :
         0.18`), which sheared the nape whenever a slider moved the face; a
         smoothstep over 1.5 cm keeps the falloff continuous. */
      const depth = smoothstep(-0.004, 0.011, z);
      /* Pin the neck seam: lower neck vertices (y < -0.095) must stay 100% rigid on the head bone
         so facial bone deformations (jaw, chin, lips) never tear the seam with the body mesh. */
      const neckPin = y < -0.09 ? smoothstep(-0.105, -0.09, y) : 1.0;
      const w = Math.exp(-2.1 * d2) * fd.strength * (0.18 + 0.82 * depth) * neckPin;
      if (w > 0.004) acc.push({ i: fd.boneIndex, w });
    }

    // keep the 4 strongest (the skinning shader's limit)
    acc.sort((a, b) => b.w - a.w);
    const top = acc.slice(0, 4);
    let sum = 0;
    for (const t of top) sum += t.w;

    if (sum < 0.02) {
      // stays rigid on the head bone
      skinIndex[v * 4] = 0;
      skinWeight[v * 4] = 1;
      continue;
    }

    const norm = Math.min(1, 1 / sum);
    for (let k = 0; k < top.length; k++) {
      skinIndex[v * 4 + k] = top[k].i;
      skinWeight[v * 4 + k] = top[k].w * norm;
    }
    // feather the residual onto the head bone so nothing snaps
    const total = top.reduce((s, t) => s + t.w * norm, 0);
    if (total < 1) {
      const free = 1 - total;
      if (top.length < 4) {
        skinIndex[v * 4 + top.length] = 0;
        skinWeight[v * 4 + top.length] = free;
      } else {
        skinWeight[v * 4] += free;
      }
    }
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e9d3c4'),
    roughness: 0.62,
    metalness: 0.0,
  });

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'FemaleHead_hph';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(boneList));
  mesh.updateMatrixWorld(true);

  const boneInverses = boneList.map((b) => b.matrixWorld.clone().invert());
  const basePosition = new Float32Array(position.array as Float32Array);

  return {
    root,
    mesh,
    skeleton: mesh.skeleton,
    headBone,
    bones,
    regionBoneKeys,
    bindData: { skinIndex, skinWeight, basePosition, boneInverses },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Convert slider values + gizmo pose into a bone TRS.
 *
 * The bone is placed **relative to its bind pivot**. Writing the delta alone
 * (which is what this did) dropped the forehead 87 mm, the nose 81 mm and the
 * jaw 117 mm off their bind positions, and because the bones also carry scale
 * that produced a non-uniform transform about an origin nowhere near the
 * feature — the face sheared instead of deforming.
 */
export function poseBone(
  bone: THREE.Bone,
  def: SliderDef[],
  values: SliderValues,
  pose: GizmoPose,
  side: 1 | -1 = 1,
  pivot: readonly [number, number, number] = [0, 0, 0],
) {
  const get = (id: string) => values[id as keyof SliderValues] ?? 0;

  const byChannel: Record<string, number> = {};
  for (const s of def) byChannel[s.channel] = (byChannel[s.channel] ?? 0) + get(s.id) * s.gain;

  bone.position.set(
    pivot[0] * side + pose.offset[0] + (byChannel.x ?? 0) * side,
    pivot[1] + pose.offset[1] + (byChannel.y ?? 0),
    pivot[2] + pose.offset[2] + (byChannel.z ?? 0),
  );

  const rotX = (byChannel.rotX ?? 0) + (byChannel.rotZ ?? 0);
  bone.rotation.set(pose.rotation[0] + rotX, pose.rotation[1], pose.rotation[2]);

  /* Width / length / depth drive the scale channels directly, as a fraction of
     the bind scale. They used to be routed through the *translation* channels
     with a `1 + x·6.5` coupling, so `width +12` both slid the bone 54 mm and
     inflated it 30 %. A bone scaling about its own pivot widens a feature in
     place, which is what those three labels mean. The clamps keep an extreme
     preset from inverting the mesh. */
  const radial = 1 + (byChannel.radial ?? 0);
  const clampScale = (v: number) => Math.min(1.5, Math.max(0.6, v));
  bone.scale.set(
    clampScale(1 + (byChannel.scaleX ?? 0) + pose.scale[0]) * radial,
    clampScale(1 + (byChannel.scaleY ?? 0) + pose.scale[1]) * radial,
    clampScale(1 + (byChannel.scaleZ ?? 0) + pose.scale[2]) * radial,
  );
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

/**
 * The invariant the pivot bug broke: with a zero gizmo pose and every slider
 * at its neutral value, a bone must sit exactly on the pivot it was bound at.
 * Returning the deviation (rather than asserting here) lets the caller decide
 * whether the current values *are* neutral — the rig cannot know that.
 *
 * A bone drifting from its pivot is not cosmetic: `skinPoint` and the GPU
 * skinning both apply `bone.matrixWorld × boneInverse`, so a shifted bone
 * translates its whole weight field and shears the face around it.
 */
export function bonePivotDeviation(rig: Rig): Array<{ bone: string; mm: number }> {
  const out: Array<{ bone: string; mm: number }> = [];
  for (const bone of rig.skeleton.bones) {
    const pivot = bone.userData.bindPivot as [number, number, number] | undefined;
    if (!pivot) continue;
    // Bones are flat children of `root`, so `bone.position` *is* the pivot-space
    // location — no world matrix involved, and no dependence on where the
    // rig is mounted in the scene graph.
    const mm =
      Math.hypot(
        bone.position.x - pivot[0],
        bone.position.y - pivot[1],
        bone.position.z - pivot[2],
      ) * 1000;
    if (mm > 0.01) out.push({ bone: bone.name, mm });
  }
  return out;
}

/**
 * Poses one bone of a region, resolving its side and bind pivot from the rig.
 *
 * The pivot is not a parameter on purpose. `poseBone` used to be called with
 * the delta alone and silently dropped the pivot, displacing the forehead by
 * 87 mm, the nose by 81 mm and the jaw by 117 mm — and because the bones also
 * carry scale, that sheared the whole face. Routing every pose through here
 * means a caller *cannot* forget it.
 */
export function poseRegionBone(
  rig: Rig,
  key: string,
  region: RegionId,
  def: SliderDef[],
  values: SliderValues,
  pose: GizmoPose,
) {
  const bone = rig.bones[key];
  if (!bone) return;
  const side: 1 | -1 = key.endsWith('_R') ? -1 : 1;
  poseBone(bone, def, values, pose, side, regionPivot(region));
}

/**
 * Dev-only sanity check for the rig wiring. Every region bone key must resolve
 * to a bone, and every bone must have been bound at the pivot its region will
 * later pose it about. Both are things the paired-name and pivot bugs broke
 * silently, with no error in the console and a dead gizmo as the only symptom.
 */
export function verifyRigWiring(rig: Rig): string[] {
  const problems: string[] = [];
  for (const region of Object.keys(REGIONS_BY_ID) as RegionId[]) {
    const keys = rig.regionBoneKeys[region];
    if (!keys?.length) {
      problems.push(`${region}: no bone keys`);
      continue;
    }
    const pivot = regionPivot(region);
    for (const key of keys) {
      const bone = rig.bones[key];
      if (!bone) {
        problems.push(`${region}: key "${key}" has no bone`);
        continue;
      }
      const bound = bone.userData.bindPivot as [number, number, number] | undefined;
      if (!bound) {
        problems.push(`${region}: bone "${key}" was never bound`);
        continue;
      }
      const side = key.endsWith('_R') ? -1 : 1;
      const dx = Math.abs(bound[0] - pivot[0] * side) * 1000;
      const dy = Math.abs(bound[1] - pivot[1]) * 1000;
      const dz = Math.abs(bound[2] - pivot[2]) * 1000;
      if (Math.max(dx, dy, dz) > 0.01) {
        problems.push(`${region}: bone "${key}" bound at a different pivot`);
      }
    }
  }
  return problems;
}

/**
 * CPU mirror of the skinning shader — used for the cyan overlay, vertex
 * anchors and dashed contours so they track the GPU-deformed head exactly.
 */
export function skinPoint(
  rig: Rig,
  vertexIndex: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const { skinIndex, skinWeight, basePosition, boneInverses } = rig.bindData;
  const bones = rig.skeleton.bones;

  out.set(
    basePosition[vertexIndex * 3],
    basePosition[vertexIndex * 3 + 1],
    basePosition[vertexIndex * 3 + 2],
  );

  let sx = 0;
  let sy = 0;
  let sz = 0;

  for (let k = 0; k < 4; k++) {
    const w = skinWeight[vertexIndex * 4 + k];
    if (w === 0) continue;
    const bi = skinIndex[vertexIndex * 4 + k];
    const bone = bones[bi];
    bone.updateMatrixWorld(true);
    // boneMatrix = bone.matrixWorld * boneInverse
    _m.multiplyMatrices(bone.matrixWorld, boneInverses[bi]);
    _v.copy(out).applyMatrix4(_m);
    sx += _v.x * w;
    sy += _v.y * w;
    sz += _v.z * w;
  }

  return out.set(sx, sy, sz);
}

/** World-space position of a region's gizmo anchor. */
export function regionAnchor(region: RegionId): THREE.Vector3 {
  const rb = REGION_BONES.find((r) => r.region === region)!;
  const c = rb.influence;
  return new THREE.Vector3(c[0], c[1], c[2]);
}

export const ALL_REGION_IDS: RegionId[] = REGIONS.map((r) => r.id);

export { smoothstep };
