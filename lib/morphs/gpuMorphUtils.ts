/**
 * lib/morphs/gpuMorphUtils.ts
 *
 * Shared helpers for relative GPU morph target assembly, smooth rotational
 * morph-normal delta computation, Three.js WebGLMorphtargets cache invalidation,
 * and alias-aware morph weight updates.
 */

import * as THREE from 'three';

export interface SparseMorphDelta {
  indices: number[];
  deltas: number[];
}

export interface MorphTargetEntry {
  name: string;
  deltas: Float32Array;
}

export function hasNamedMorphTarget(geo: THREE.BufferGeometry, aliases: readonly string[]): boolean {
  const attrs = geo.morphAttributes.position;
  if (!attrs?.length) return false;
  return attrs.some((attr) => aliases.includes(attr.name));
}

export function expandSparseMorph(
  vertCount: number,
  sparse: SparseMorphDelta,
  scaleY = 1.0,
  attenuateLashTips = false,
): Float32Array {
  const deltas = new Float32Array(vertCount * 3);
  const scaleZ = scaleY === 1.0 ? 1.0 : 0.72 + 0.28 * scaleY;
  const { indices, deltas: packed } = sparse;
  for (let k = 0; k < indices.length; k++) {
    const idx = indices[k];
    if (idx < 0 || idx >= vertCount) continue;
    const p = k * 3;
    const out = idx * 3;
    const rawY = packed[p + 1];
    let scaledY = rawY * scaleY;
    // Keep lash roots locked to eyelid margin (`scaleY`), while softening extra tip rotation on tall sculpts.
    if (attenuateLashTips && scaleY > 1 && rawY < -0.010) {
      scaledY = -0.010 * scaleY + (rawY + 0.010) * (1 + (scaleY - 1) * 0.25);
    }
    deltas[out] = packed[p];
    deltas[out + 1] = scaledY;
    deltas[out + 2] = packed[p + 2] * scaleZ;
  }
  return deltas;
}

/**
 * Computes closed/deformed-pose normal rotation deltas (`recomputedTarget - recomputedBase`)
 * over triangles bordering moved vertices, preserving authored UV-seam normals at rest
 * while keeping deformed skin shading smooth under dynamic lighting.
 */
export function computeMorphNormalDeltas(
  geo: THREE.BufferGeometry,
  posDeltas: Float32Array,
): Float32Array | null {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return null;

  const count = pos.count;
  const posArr = pos.array as Float32Array;
  const deformedPos = new Float32Array(count * 3);
  const movedMask = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const dx = posDeltas[o];
    const dy = posDeltas[o + 1];
    const dz = posDeltas[o + 2];
    deformedPos[o] = posArr[o] + dx;
    deformedPos[o + 1] = posArr[o + 1] + dy;
    deformedPos[o + 2] = posArr[o + 2] + dz;
    if (dx * dx + dy * dy + dz * dz > 1e-12) {
      movedMask[i] = 1;
    }
  }

  const baseAcc = new Float32Array(count * 3);
  const deformedAcc = new Float32Array(count * 3);
  const ringAffected = new Uint8Array(movedMask);
  const idxAttr = geo.getIndex();
  const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(count / 3);
  const idxArr = idxAttr?.array;

  const accumulate = (src: Float32Array, dst: Float32Array, a: number, b: number, c: number) => {
    const oa = a * 3;
    const ob = b * 3;
    const oc = c * 3;
    const abx = src[ob] - src[oa];
    const aby = src[ob + 1] - src[oa + 1];
    const abz = src[ob + 2] - src[oa + 2];
    const acx = src[oc] - src[oa];
    const acy = src[oc + 1] - src[oa + 1];
    const acz = src[oc + 2] - src[oa + 2];
    const fnx = aby * acz - abz * acy;
    const fny = abz * acx - abx * acz;
    const fnz = abx * acy - aby * acx;
    dst[oa] += fnx;
    dst[oa + 1] += fny;
    dst[oa + 2] += fnz;
    dst[ob] += fnx;
    dst[ob + 1] += fny;
    dst[ob + 2] += fnz;
    dst[oc] += fnx;
    dst[oc + 1] += fny;
    dst[oc + 2] += fnz;
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const a = idxArr ? idxArr[i0] : i0;
    const b = idxArr ? idxArr[i0 + 1] : i0 + 1;
    const c = idxArr ? idxArr[i0 + 2] : i0 + 2;
    if (a >= count || b >= count || c >= count) continue;
    if (!movedMask[a] && !movedMask[b] && !movedMask[c]) continue;

    ringAffected[a] = 1;
    ringAffected[b] = 1;
    ringAffected[c] = 1;
    accumulate(posArr, baseAcc, a, b, c);
    accumulate(deformedPos, deformedAcc, a, b, c);
  }

  const normalDeltas = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    if (!ringAffected[i]) continue;
    const o = i * 3;
    const blen = Math.hypot(baseAcc[o], baseAcc[o + 1], baseAcc[o + 2]);
    const clen = Math.hypot(deformedAcc[o], deformedAcc[o + 1], deformedAcc[o + 2]);
    if (blen <= 1e-10 || clen <= 1e-10) continue;
    const binv = 1 / blen;
    const cinv = 1 / clen;
    normalDeltas[o] = deformedAcc[o] * cinv - baseAcc[o] * binv;
    normalDeltas[o + 1] = deformedAcc[o + 1] * cinv - baseAcc[o + 1] * binv;
    normalDeltas[o + 2] = deformedAcc[o + 2] * cinv - baseAcc[o + 2] * binv;
  }

  return normalDeltas;
}

function makeMorphAttr(name: string, data: Float32Array): THREE.Float32BufferAttribute {
  const attr = new THREE.Float32BufferAttribute(data, 3);
  attr.name = name;
  return attr;
}

/**
 * Merges named relative morph targets + morph normals into `geo` while preserving
 * any unrelated morph targets (e.g. keeping `eyeBlinkLeft/Right` intact when adding
 * smile/viseme targets, and vice versa). Emits `geo.dispose()` when updating an
 * existing geometry so Three.js `WebGLMorphtargets` evicts cached GPU morph textures.
 */
export function mergeNamedMorphTargets(
  geo: THREE.BufferGeometry,
  entries: readonly MorphTargetEntry[],
  managedNames: ReadonlySet<string>,
  flagKey: string,
): boolean {
  if (entries.length === 0) return false;

  const prevAttrs = geo.morphAttributes.position ?? [];
  const hadPriorTargets = prevAttrs.length > 0;
  const existingPos = prevAttrs.filter((a) => !managedNames.has(a.name));
  const existingNorm = (geo.morphAttributes.normal ?? []).filter((a) => !managedNames.has(a.name));

  const nextPos = [...existingPos];
  const nextNorm = [...existingNorm];

  for (const { name, deltas } of entries) {
    nextPos.push(makeMorphAttr(name, deltas));
    const normDeltas = computeMorphNormalDeltas(geo, deltas);
    if (normDeltas) {
      nextNorm.push(makeMorphAttr(name, normDeltas));
    }
  }

  geo.morphTargetsRelative = true;
  geo.morphAttributes.position = nextPos;
  if (nextNorm.length === nextPos.length) {
    geo.morphAttributes.normal = nextNorm;
  } else {
    delete geo.morphAttributes.normal;
  }
  geo.userData[flagKey] = true;

  if (hadPriorTargets) {
    geo.dispose();
  }
  return true;
}

export function setNamedMorphWeight(
  mesh: THREE.Mesh,
  aliases: readonly string[],
  weight: number,
): void {
  const dict = mesh.morphTargetDictionary;
  const influences = mesh.morphTargetInfluences;
  if (!dict || !influences) return;
  for (const name of aliases) {
    const idx = dict[name];
    if (idx !== undefined && idx < influences.length) {
      influences[idx] = weight;
    }
  }
}
