/**
 * lib/rigger/normalizeMesh.ts
 *
 * Bakes any uploaded GLB / GLTF / OBJ scene hierarchy (multi-part meshes,
 * node translations/rotations/scales, and pre-existing skin poses) into a
 * single world-space multi-material `THREE.Mesh` rooted cleanly at the origin.
 *
 * Also auto-grounds (`minY = 0`), centers (`centerX = centerZ = 0`), and
 * auto-orients sideways/backward external characters (e.g. Tripo / Meshy / Z-up
 * exports rotated 90° around Y) so `+Z` is front, `+Y` is up, and arms span `±X`.
 */

import * as THREE from 'three';

function isVisibleUpTo(obj: THREE.Object3D, stopRoot: THREE.Object3D): boolean {
  let curr: THREE.Object3D | null = obj;
  while (curr) {
    if (!curr.visible) return false;
    if (curr === stopRoot) break;
    curr = curr.parent;
  }
  return true;
}

/**
 * Translates `geometry` so soles sit at `minY = 0` and X/Z are centered at `0`.
 */
export function groundAndCenterGeometry(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return new THREE.Box3();

  const dx = -(bb.min.x + bb.max.x) * 0.5;
  const dy = -bb.min.y;
  const dz = -(bb.min.z + bb.max.z) * 0.5;

  if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6 || Math.abs(dz) > 1e-6) {
    geometry.translate(dx, dy, dz);
    geometry.computeBoundingBox();
  }
  geometry.computeBoundingSphere();
  return geometry.boundingBox!.clone();
}

const _rotMatrix = new THREE.Matrix4();
const _rotAxis = new THREE.Vector3();

/**
 * Rotates a mesh geometry around a cardinal axis (`x` | `y` | `z`), re-grounds
 * it to `minY = 0` centered at origin, and returns the updated bounding box.
 */
export function transformMeshGeometry(
  mesh: THREE.Mesh,
  axis: 'x' | 'y' | 'z',
  angleRad: number,
): THREE.Box3 {
  _rotAxis.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  _rotMatrix.makeRotationAxis(_rotAxis, angleRad);
  mesh.geometry.applyMatrix4(_rotMatrix);
  return groundAndCenterGeometry(mesh.geometry);
}

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx]!;
}

/**
 * Detects sideways (`±90° Y`) or backwards (`180° Y`) external humanoid meshes
 * and rotates them to our canonical glTF / VRM orientation (`+Y` up, `+Z` front,
 * arms spanning `±X`, grounded at `Y = 0`).
 */
export function autoOrientHumanMesh(mesh: THREE.Mesh): { rotatedYDeg: number } {
  const geo = mesh.geometry;
  let bb = groundAndCenterGeometry(geo);
  const posAttr = geo.getAttribute('position');
  if (!posAttr || posAttr.count < 24) return { rotatedYDeg: 0 };

  const minY = bb.min.y;
  const totalH = Math.max(1e-4, bb.max.y - minY);
  const totalV = posAttr.count;
  const step = Math.max(1, Math.floor(totalV / 20000));

  let rotatedYDeg = 0;

  // Step 1: Detect 90° Y misalignment (arm/shoulder band wider along Z than X)
  const armXs: number[] = [];
  const armZs: number[] = [];
  for (let i = 0; i < totalV; i += step) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const u = (y - minY) / totalH;
    if (u >= 0.64 && u <= 0.90) {
      armXs.push(x);
      armZs.push(z);
    }
  }

  if (armXs.length >= 16) {
    armXs.sort((a, b) => a - b);
    armZs.sort((a, b) => a - b);
    const spanX = percentileSorted(armXs, 0.99) - percentileSorted(armXs, 0.01);
    const spanZ = percentileSorted(armZs, 0.99) - percentileSorted(armZs, 0.01);
    if (spanZ > spanX * 1.35) {
      bb = transformMeshGeometry(mesh, 'y', -Math.PI * 0.5);
      rotatedYDeg -= 90;
    }
  }

  // Step 2: Detect 180° Y misalignment using ankle-vs-foot anterior toe overhang
  const footZs: number[] = [];
  const ankleZs: number[] = [];
  for (let i = 0; i < totalV; i += step) {
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const u = (y - bb.min.y) / Math.max(1e-4, bb.max.y - bb.min.y);
    if (u <= 0.045) footZs.push(z);
    else if (u >= 0.065 && u <= 0.16) ankleZs.push(z);
  }

  if (footZs.length >= 8 && ankleZs.length >= 8) {
    footZs.sort((a, b) => a - b);
    ankleZs.sort((a, b) => a - b);
    const footMidZ = (percentileSorted(footZs, 0.05) + percentileSorted(footZs, 0.95)) * 0.5;
    const ankleMidZ = percentileSorted(ankleZs, 0.5);
    if (footMidZ - ankleMidZ < -0.008 * totalH) {
      transformMeshGeometry(mesh, 'y', Math.PI);
      rotatedYDeg += 180;
    }
  }

  return { rotatedYDeg };
}

/**
 * Extracts all visible meshes from a loaded scene, bakes skinning and world
 * matrices into their vertex buffers, merges them into one clean `Mesh`, and
 * grounds/centers/orients the character upright facing `+Z` at `[0, 0, 0]`.
 */
export function bakeAndMergeSceneMeshes(root: THREE.Object3D): THREE.Mesh | null {
  root.updateMatrixWorld(true);

  const sourceMeshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    const asMesh = child as THREE.Mesh;
    if (!asMesh.isMesh) return;
    if (!isVisibleUpTo(asMesh, root)) return;
    const pos = asMesh.geometry?.getAttribute('position');
    if (!pos || pos.count === 0) return;
    sourceMeshes.push(asMesh);
  });

  if (sourceMeshes.length === 0) return null;

  let totalVerts = 0;
  for (const m of sourceMeshes) {
    totalVerts += m.geometry.getAttribute('position').count;
  }

  const posOut  = new Float32Array(totalVerts * 3);
  const normOut = new Float32Array(totalVerts * 3);
  const uvOut   = new Float32Array(totalVerts * 2);

  const materials: THREE.Material[] = [];
  const indicesBySlot: number[][] = [];
  const matInstanceToSlot = new Map<THREE.Material, number>();

  const getMaterialSlot = (mat: THREE.Material): number => {
    const existing = matInstanceToSlot.get(mat);
    if (existing !== undefined) return existing;
    const idx = materials.length;
    matInstanceToSlot.set(mat, idx);
    materials.push(mat);
    indicesBySlot.push([]);
    return idx;
  };

  const vPos  = new THREE.Vector3();
  const vNorm = new THREE.Vector4();
  const vN3   = new THREE.Vector3();
  const normMat = new THREE.Matrix3();

  let vertOffset = 0;

  for (const m of sourceMeshes) {
    const geo = m.geometry;
    const posAttr = geo.getAttribute('position');
    const vCount  = posAttr.count;

    let normAttr = geo.getAttribute('normal');
    let tempGeo: THREE.BufferGeometry | null = null;
    if (!normAttr) {
      tempGeo = geo.clone();
      tempGeo.computeVertexNormals();
      normAttr = tempGeo.getAttribute('normal');
    }

    const uvAttr = geo.getAttribute('uv');
    const isSkinned = Boolean((m as THREE.SkinnedMesh).isSkinnedMesh && (m as THREE.SkinnedMesh).skeleton);
    const skinned = m as THREE.SkinnedMesh;
    const flipWinding = m.matrixWorld.determinant() < 0;
    normMat.getNormalMatrix(m.matrixWorld);

    for (let i = 0; i < vCount; i++) {
      if (isSkinned) {
        skinned.getVertexPosition(i, vPos);
        vPos.applyMatrix4(m.matrixWorld);

        if (normAttr) {
          vNorm.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i), 0);
          skinned.applyBoneTransform(i, vNorm);
          vN3.set(vNorm.x, vNorm.y, vNorm.z).applyMatrix3(normMat).normalize();
        } else {
          vN3.set(0, 1, 0);
        }
      } else {
        vPos.fromBufferAttribute(posAttr, i).applyMatrix4(m.matrixWorld);
        if (normAttr) {
          vN3.fromBufferAttribute(normAttr, i).applyMatrix3(normMat).normalize();
        } else {
          vN3.set(0, 1, 0);
        }
      }

      const o3 = (vertOffset + i) * 3;
      posOut[o3]     = vPos.x;
      posOut[o3 + 1] = vPos.y;
      posOut[o3 + 2] = vPos.z;

      normOut[o3]     = Number.isFinite(vN3.x) ? vN3.x : 0;
      normOut[o3 + 1] = Number.isFinite(vN3.y) ? vN3.y : 1;
      normOut[o3 + 2] = Number.isFinite(vN3.z) ? vN3.z : 0;

      const o2 = (vertOffset + i) * 2;
      uvOut[o2]     = uvAttr ? uvAttr.getX(i) : 0;
      uvOut[o2 + 1] = uvAttr ? uvAttr.getY(i) : 0;
    }

    tempGeo?.dispose();

    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const indexAttr = geo.index;
    const rawCount  = indexAttr ? indexAttr.count : vCount;
    const groups    = geo.groups && geo.groups.length > 0
      ? geo.groups
      : [{ start: 0, count: rawCount, materialIndex: 0 }];

    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0];
      if (!mat || mat.visible === false) continue;
      const slot   = getMaterialSlot(mat);
      const bucket = indicesBySlot[slot];
      const end    = Math.min(g.start + g.count, rawCount);

      for (let idx = g.start; idx + 2 < end; idx += 3) {
        const i0 = (indexAttr ? indexAttr.getX(idx)     : idx)     + vertOffset;
        const i1 = (indexAttr ? indexAttr.getX(idx + 1) : idx + 1) + vertOffset;
        const i2 = (indexAttr ? indexAttr.getX(idx + 2) : idx + 2) + vertOffset;
        if (flipWinding) {
          bucket.push(i0, i2, i1);
        } else {
          bucket.push(i0, i1, i2);
        }
      }
    }

    vertOffset += vCount;
  }

  const totalIndices = indicesBySlot.reduce((sum, b) => sum + b.length, 0);
  if (totalIndices === 0) return null;

  const indexArray = totalVerts > 65535
    ? new Uint32Array(totalIndices)
    : new Uint16Array(totalIndices);

  const mergedGeo = new THREE.BufferGeometry();
  mergedGeo.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
  mergedGeo.setAttribute('normal',   new THREE.BufferAttribute(normOut, 3));
  mergedGeo.setAttribute('uv',       new THREE.BufferAttribute(uvOut, 2));

  let cursor = 0;
  for (let slot = 0; slot < indicesBySlot.length; slot++) {
    const bucket = indicesBySlot[slot];
    if (bucket.length === 0) continue;
    for (let i = 0; i < bucket.length; i++) {
      indexArray[cursor + i] = bucket[i];
    }
    mergedGeo.addGroup(cursor, bucket.length, slot);
    cursor += bucket.length;
  }

  mergedGeo.setIndex(new THREE.BufferAttribute(indexArray, 1));

  const finalMaterial = materials.length === 1 ? materials[0] : materials;
  const mergedMesh = new THREE.Mesh(mergedGeo, finalMaterial);
  mergedMesh.name = 'CharacterMesh';
  mergedMesh.castShadow = true;
  mergedMesh.receiveShadow = true;

  autoOrientHumanMesh(mergedMesh);
  return mergedMesh;
}
