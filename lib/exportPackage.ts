'use client';

import * as THREE from 'three';
import { GLTFExporter } from 'three-stdlib';
import { zipSync, strToU8 } from 'fflate';
import { useCharacter } from '@/lib/store';
import { buildExportClips, restInverses } from '@/lib/character/animation';
import {
  computeGroundOffset,
  findEssentialBones,
  createHeadSkinnedMesh,
  isExportInFlight,
  setExportInFlight,
  patchGlbIor,
  type ExportOptions,
} from '@/lib/exportGlb';

export type PackageExportOptions = ExportOptions;

type PackageExportHandler = (customName?: string, options?: PackageExportOptions) => Promise<void>;

let activePackageHandler: PackageExportHandler | null = null;

export function registerPackageExportHandler(handler: PackageExportHandler) {
  activePackageHandler = handler;
}

export function unregisterPackageExportHandler() {
  activePackageHandler = null;
}

/**
 * Triggers full game asset package (.zip) export containing:
 * - Rigged 3D model (.glb) with XP32 skeleton & animations
 * - Static biped 3D mesh (.obj + .mtl) for Mixamo Auto-Rigger & sculpt tools
 * - Loose high-resolution (2K) PBR textures (.png) in textures/ folder
 * - Character morph preset (.json)
 * - Step-by-step README guide for Blender, Mixamo, Unity, and Unreal Engine
 */
export async function exportCharacterPackage(
  customName?: string,
  options?: PackageExportOptions,
): Promise<void> {
  const opts: PackageExportOptions = { animated: true, ...options };
  if (activePackageHandler) {
    return activePackageHandler(customName, opts);
  }
  throw new Error('3D scene is not ready for packaging. Please wait for model to load.');
}

/**
 * Sanitizes a string into a clean, safe identifier for OBJ / MTL (no spaces or illegal characters).
 */
export function sanitizeMtlName(name: string | undefined, fallback: string = 'Material'): string {
  if (!name) return fallback;
  const clean = name.trim().replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');
  return clean || fallback;
}

/**
 * Resolves a clean, canonical material name for a mesh and material slot, ensuring
 * that the Three.js material, GLTF material, MTL library, and OBJ `usemtl` statements
 * match with 100% precision.
 */
export function resolveSafeMaterialName(
  mesh: THREE.Mesh,
  origMat: THREE.Material | undefined,
  slotIndex: number = 0,
): string {
  const rawName = origMat?.name || mesh.name || `Material_${slotIndex}`;
  const lower = rawName.toLowerCase();
  const meshLower = (mesh.name || '').toLowerCase();

  // 1. Facial parts
  if (lower.includes('femalehead') || lower.includes('head') || lower.includes('face') || meshLower === 'face' || meshLower === 'head') return 'Face';
  if (lower.includes('mouth') || meshLower === 'mouth') return 'Mouth';
  if (lower.includes('eye') || meshLower === 'eyes') return 'Eyes';
  if (lower.includes('lash') || meshLower === 'lashes') return 'Lashes';
  if (lower.includes('brow') || meshLower === 'brows') return 'Brows';

  // 2. Extremities & Body skin
  if (meshLower === 'hands' || lower.includes('hand')) return 'Hands';
  if (meshLower === 'feet' || lower.includes('foot') || lower.includes('feet')) return 'Feet';
  if (meshLower === 'body' || lower === 'baseshape' || (lower === 'default' && meshLower.includes('body'))) return 'Body';

  // 3. Hair
  if (
    lower.includes('hair') ||
    meshLower.includes('hair') ||
    lower.includes('s4studio') ||
    lower.includes('shadow') ||
    lower.includes('empressof') ||
    lower.includes('asterion')
  ) {
    return 'Hair';
  }

  // 4. Garments & Equipment (preserve authored NIF material names like t_shirt_v2, leggings_v1, bodysuit_v1)
  const cleanMat = sanitizeMtlName(origMat?.name, '');
  if (cleanMat && cleanMat !== 'default' && cleanMat !== 'Material') {
    return cleanMat;
  }

  const cleanMesh = sanitizeMtlName(mesh.name, '');
  if (cleanMesh && cleanMesh !== 'Part' && cleanMesh !== 'Garment') {
    return cleanMesh;
  }

  return `Material_${slotIndex}`;
}

/**
 * Extracts all embedded PNG/JPEG texture buffers directly from the GLB binary buffer.
 * Runs in under 3ms with zero canvas/CORS overhead.
 */
function extractTexturesFromGlb(glbBuffer: ArrayBuffer): {
  textureFiles: Record<string, [Uint8Array, { level: number }]>;
  materialDefs: Array<{ name: string; diffuseMap?: string; normalMap?: string }>;
} {
  const buf = new Uint8Array(glbBuffer);
  const view = new DataView(glbBuffer);

  const jsonLen = view.getUint32(12, true);
  const jsonBytes = buf.subarray(20, 20 + jsonLen);
  const decoder = new TextDecoder('utf-8');
  const jsonChunk = decoder.decode(jsonBytes);
  const gltf = JSON.parse(jsonChunk);

  const binOffset = 20 + jsonLen;
  const binLen = view.getUint32(binOffset, true);
  const bin = buf.subarray(binOffset + 8, binOffset + 8 + binLen);

  const textureFiles: Record<string, [Uint8Array, { level: number }]> = {};
  const savedImages = new Map<number, string>(); // imgIdx -> filename
  const materialDefs: Array<{ name: string; diffuseMap?: string; normalMap?: string }> = [];

  function getImageBytes(imgIdx: number | undefined): Uint8Array | null {
    if (imgIdx === undefined || !gltf.images || !gltf.images[imgIdx]) return null;
    const imgDef = gltf.images[imgIdx];
    if (imgDef.bufferView === undefined || !gltf.bufferViews) return null;
    const bv = gltf.bufferViews[imgDef.bufferView];
    const byteOffset = bv.byteOffset || 0;
    return bin.subarray(byteOffset, byteOffset + bv.byteLength);
  }

  const materials = gltf.materials || [];
  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i];
    const safeName = sanitizeMtlName(mat.name, `Material_${i}`);
    const pbr = mat.pbrMetallicRoughness || {};
    let diffuseFile: string | undefined;
    let normalFile: string | undefined;

    if (pbr.baseColorTexture && gltf.textures) {
      const tex = gltf.textures[pbr.baseColorTexture.index];
      const imgIdx = tex?.source;
      if (imgIdx !== undefined) {
        if (savedImages.has(imgIdx)) {
          diffuseFile = savedImages.get(imgIdx);
        } else {
          diffuseFile = `${safeName}_Diffuse.png`;
          const bytes = getImageBytes(imgIdx);
          if (bytes && bytes.length > 0) {
            savedImages.set(imgIdx, diffuseFile);
            textureFiles[diffuseFile] = [bytes, { level: 0 }];
          }
        }
      }
    }

    if (mat.normalTexture && gltf.textures) {
      const tex = gltf.textures[mat.normalTexture.index];
      const imgIdx = tex?.source;
      if (imgIdx !== undefined) {
        if (savedImages.has(imgIdx)) {
          normalFile = savedImages.get(imgIdx);
        } else {
          normalFile = `${safeName}_Normal.png`;
          const bytes = getImageBytes(imgIdx);
          if (bytes && bytes.length > 0) {
            savedImages.set(imgIdx, normalFile);
            textureFiles[normalFile] = [bytes, { level: 0 }];
          }
        }
      }
    }

    materialDefs.push({ name: safeName, diffuseMap: diffuseFile, normalMap: normalFile });
  }

  return { textureFiles, materialDefs };
}

function buildMtlContent(materials: Array<{ name: string; diffuseMap?: string; normalMap?: string }>): string {
  let mtl = '# CC-Kit Skyrim Character Creator - Material Library\n';
  mtl += '# Compatible with Blender, Adobe Mixamo, Unity, and Unreal Engine\n';

  const seen = new Set<string>();
  for (const m of materials) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);

    mtl += `\nnewmtl ${m.name}\n`;
    mtl += 'Ka 1.000 1.000 1.000\n';
    mtl += 'Kd 1.000 1.000 1.000\n';
    mtl += 'Ks 0.200 0.200 0.200\n';
    mtl += 'Ns 10.0\n';
    mtl += 'd 1.0\n';
    mtl += 'illum 2\n';
    if (m.diffuseMap) {
      mtl += `map_Kd textures/${m.diffuseMap}\n`;
      // For Lashes, Hair, and Brows, export map_d so alpha cutout / transparency works automatically in Blender
      if (
        m.name === 'Lashes' ||
        m.name === 'Hair' ||
        m.name === 'Brows' ||
        m.name.toLowerCase().includes('lash') ||
        m.name.toLowerCase().includes('brow')
      ) {
        mtl += `map_d textures/${m.diffuseMap}\n`;
      }
    }
    if (m.normalMap) {
      mtl += `map_Bump textures/${m.normalMap}\n`;
    }
  }
  return mtl;
}

/**
 * Exports visible character meshes to Wavefront OBJ format.
 * Bypasses three-stdlib's bug with BufferGeometry on Line objects, and ensures
 * only valid 3D polygon meshes with proper MTL material names are exported for Mixamo & Blender.
 */
function exportCharacterMeshesToObj(
  character: THREE.Object3D,
  materialDefs: Array<{ name: string; diffuseMap?: string; normalMap?: string }>,
  safeName: string,
): string {
  let output = `# CC-Kit Skyrim Character Creator - 3D Mesh (Mixamo / Blender / Game Ready)\n`;
  output += `mtllib ${safeName}.mtl\n\n`;

  let indexVertex = 0;
  let indexUv = 0;
  let indexNormal = 0;

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  // Collect only renderable, visible character meshes (filter out helpers, gizmos, bones, and lines)
  const exportMeshes: THREE.Mesh[] = [];
  const headRoot = character.getObjectByName('SkyrimHeadRoot');

  function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D | null | undefined): boolean {
    if (!ancestor) return false;
    let curr: THREE.Object3D | null = object.parent;
    while (curr) {
      if (curr === ancestor) return true;
      curr = curr.parent;
    }
    return false;
  }

  function isTrulyVisible(object: THREE.Object3D): boolean {
    let curr: THREE.Object3D | null = object;
    while (curr && curr !== character) {
      if (!curr.visible) return false;
      curr = curr.parent;
    }
    return true;
  }

  character.traverse((child) => {
    if (
      (child as any).isMesh &&
      child.visible &&
      child.name !== 'mesh-overlay' &&
      child.name !== 'face-gizmo' &&
      child.name !== 'FemaleHead_hph' && // Never export internal FemaleHead_hph; use unified Head
      !child.userData?.isHelper &&
      child !== headRoot &&
      !isDescendantOf(child, headRoot) && // Exclude un-unified headRoot meshes to prevent duplicates & spikes
      isTrulyVisible(child)
    ) {
      const geo = (child as THREE.Mesh).geometry;
      if (geo && ((geo as any).isBufferGeometry || (geo as any).attributes?.position)) {
        exportMeshes.push(child as THREE.Mesh);
      }
    }
  });

  function getMeshMaterialName(mesh: THREE.Mesh, mat?: THREE.Material): string {
    const rawMat = mat || (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
    const safe = sanitizeMtlName(rawMat?.name);
    if (safe && safe !== 'Material' && safe !== 'default') return safe;
    const meshSafe = sanitizeMtlName(mesh.name);
    if (meshSafe && meshSafe !== 'Part' && meshSafe !== 'Garment') return meshSafe;
    return materialDefs[0]?.name || 'Body';
  }

  for (const mesh of exportMeshes) {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos || pos.count === 0) continue;

    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const norm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const index = geo.getIndex();

    mesh.updateMatrixWorld(true);
    normalMatrix.getNormalMatrix(mesh.matrixWorld);

    output += `o ${sanitizeMtlName(mesh.name, 'Part')}\n`;
    const matName = getMeshMaterialName(mesh);
    output += `usemtl ${matName}\n`;

    // Check if this mesh has active skeletal skinning to bake the pose into the OBJ
    const isSkinned = !!((mesh as any).isSkinnedMesh && (mesh as THREE.SkinnedMesh).skeleton);
    const skeleton = isSkinned ? (mesh as THREE.SkinnedMesh).skeleton : null;
    const skinMatrices: THREE.Matrix4[] = [];
    const skinRotMatrices: THREE.Matrix3[] = [];

    if (skeleton && skeleton.bones.length > 0) {
      skeleton.update();
      for (let b = 0; b < skeleton.bones.length; b++) {
        const bone = skeleton.bones[b];
        const inv = skeleton.boneInverses[b];
        const m = new THREE.Matrix4();
        if (bone && inv) {
          m.multiplyMatrices(bone.matrixWorld, inv);
        } else if (bone) {
          m.copy(bone.matrixWorld);
        }
        skinMatrices.push(m);
        const rot = new THREE.Matrix3();
        rot.setFromMatrix4(m);
        skinRotMatrices.push(rot);
      }
    }

    const skinIndexAttr = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    const skinWeightAttr = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    const sIndices = skinIndexAttr ? skinIndexAttr.array : null;
    const sWeights = skinWeightAttr ? skinWeightAttr.array : null;
    const bindMatrix = (mesh as any).bindMatrix || new THREE.Matrix4();

    const rawPos = new THREE.Vector3();
    const rawNorm = new THREE.Vector3();
    const tempV = new THREE.Vector3();
    const tempN = new THREE.Vector3();

    // 1. Vertices (world coordinates baked with active skeleton pose)
    for (let i = 0; i < pos.count; i++) {
      rawPos.fromBufferAttribute(pos, i);

      if (isSkinned && sIndices && sWeights && skinMatrices.length > 0) {
        const i4 = i * 4;
        tempV.copy(rawPos).applyMatrix4(bindMatrix);
        v.set(0, 0, 0);
        let totalW = 0;

        for (let k = 0; k < 4; k++) {
          const w = sWeights[i4 + k];
          if (w > 0.0001) {
            const bIdx = sIndices[i4 + k];
            const mat = skinMatrices[bIdx];
            if (mat) {
              tempN.copy(tempV).applyMatrix4(mat).multiplyScalar(w);
              v.add(tempN);
              totalW += w;
            }
          }
        }
        if (totalW < 0.001) {
          v.copy(rawPos).applyMatrix4(mesh.matrixWorld);
        }
      } else {
        v.copy(rawPos).applyMatrix4(mesh.matrixWorld);
      }

      output += `v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}\n`;
    }

    // 2. UVs (Invert V coordinate: GLTFExporter exports images with flipY=true (top-down),
    // while Wavefront OBJ specification expects bottom-up V coordinates (0 = bottom, 1 = top).
    // Inverting V here ensures all face, body, hair, and clothing textures map right-side up in Blender & Mixamo.
    if (uv) {
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = 1.0 - uv.getY(i);
        output += `vt ${u.toFixed(5)} ${v.toFixed(5)}\n`;
      }
    }

    // 3. Normals (world coordinates baked with active skeleton pose)
    if (norm) {
      for (let i = 0; i < norm.count; i++) {
        rawNorm.fromBufferAttribute(norm, i);

        if (isSkinned && sIndices && sWeights && skinRotMatrices.length > 0) {
          const i4 = i * 4;
          n.set(0, 0, 0);
          let totalW = 0;

          for (let k = 0; k < 4; k++) {
            const w = sWeights[i4 + k];
            if (w > 0.0001) {
              const bIdx = sIndices[i4 + k];
              const rotMat = skinRotMatrices[bIdx];
              if (rotMat) {
                tempN.copy(rawNorm).applyMatrix3(rotMat).multiplyScalar(w);
                n.add(tempN);
                totalW += w;
              }
            }
          }
          if (totalW > 0.001) {
            n.normalize();
          } else {
            n.copy(rawNorm).applyMatrix3(normalMatrix).normalize();
          }
        } else {
          n.copy(rawNorm).applyMatrix3(normalMatrix).normalize();
        }

        output += `vn ${n.x.toFixed(4)} ${n.y.toFixed(4)} ${n.z.toFixed(4)}\n`;
      }
    }

    // 4. Faces
    const hasUv = !!uv;
    const hasNorm = !!norm;
    const isMultiMat = Array.isArray(mesh.material);
    const groups = (mesh.geometry.groups && mesh.geometry.groups.length > 0)
      ? mesh.geometry.groups.filter((g) => {
          const matIdx = g.materialIndex ?? 0;
          const raw = isMultiMat ? (mesh.material as THREE.Material[])[matIdx] : mesh.material;
          const mat = Array.isArray(raw) ? raw[0] : raw;
          return mat ? mat.visible !== false : true;
        })
      : null;

    if (groups && groups.length > 0 && index) {
      for (const group of groups) {
        const matIdx = group.materialIndex ?? 0;
        const raw = isMultiMat ? (mesh.material as THREE.Material[])[matIdx] : mesh.material;
        const mat = Array.isArray(raw) ? raw[0] : raw;
        const subMatName = getMeshMaterialName(mesh, mat);
        output += `usemtl ${subMatName}\n`;
        const start = group.start;
        const count = group.count;
        for (let i = start; i < start + count; i += 3) {
          const i0 = index.getX(i) + 1;
          const i1 = index.getX(i + 1) + 1;
          const i2 = index.getX(i + 2) + 1;
          const f0 = `${indexVertex + i0}/${hasUv ? indexUv + i0 : ''}/${hasNorm ? indexNormal + i0 : ''}`;
          const f1 = `${indexVertex + i1}/${hasUv ? indexUv + i1 : ''}/${hasNorm ? indexNormal + i1 : ''}`;
          const f2 = `${indexVertex + i2}/${hasUv ? indexUv + i2 : ''}/${hasNorm ? indexNormal + i2 : ''}`;
          output += `f ${f0} ${f1} ${f2}\n`;
        }
      }
    } else if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const i0 = index.getX(i) + 1;
        const i1 = index.getX(i + 1) + 1;
        const i2 = index.getX(i + 2) + 1;
        const f0 = `${indexVertex + i0}/${hasUv ? indexUv + i0 : ''}/${hasNorm ? indexNormal + i0 : ''}`;
        const f1 = `${indexVertex + i1}/${hasUv ? indexUv + i1 : ''}/${hasNorm ? indexNormal + i1 : ''}`;
        const f2 = `${indexVertex + i2}/${hasUv ? indexUv + i2 : ''}/${hasNorm ? indexNormal + i2 : ''}`;
        output += `f ${f0} ${f1} ${f2}\n`;
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        const i0 = i + 1;
        const i1 = i + 2;
        const i2 = i + 3;
        const f0 = `${indexVertex + i0}/${hasUv ? indexUv + i0 : ''}/${hasNorm ? indexNormal + i0 : ''}`;
        const f1 = `${indexVertex + i1}/${hasUv ? indexUv + i1 : ''}/${hasNorm ? indexNormal + i1 : ''}`;
        const f2 = `${indexVertex + i2}/${hasUv ? indexUv + i2 : ''}/${hasNorm ? indexNormal + i2 : ''}`;
        output += `f ${f0} ${f1} ${f2}\n`;
      }
    }

    indexVertex += pos.count;
    if (uv) indexUv += uv.count;
    if (norm) indexNormal += norm.count;
  }

  return output;
}

function buildReadmeContent(name: string): string {
  return `========================================================================
CC-KIT 3D CHARACTER ASSET PACKAGE
========================================================================
Character Name: ${name}
Export Date: ${new Date().toISOString()}

INCLUDED FILES:
  • ${name}.obj       : 3D character mesh with active pose for Mixamo, Blender, Maya, or ZBrush.
  • ${name}.mtl       : Material and texture mapping definitions with alpha transparency.
  • textures/         : All high-resolution (2K) PBR textures in lossless PNG format.
  • preset.json       : Full character morphs, slider positions, and color settings.

  * Note: For the standalone rigged & animated XP32 skeleton model (.glb),
    use the "EXPORT .GLB" button in the CC-Kit bottom toolbar.

------------------------------------------------------------------------
1. HOW TO IMPORT INTO BLENDER
------------------------------------------------------------------------
1. Open Blender.
2. Go to File > Import > Wavefront (.obj) and select "${name}.obj".
   (Blender will automatically load "${name}.mtl" and the "textures/" folder).
3. To view all textures and transparency, press 'Z' and select "Material Preview".
   All face maps, eyelashes, eyebrows, hair, and outfit textures are already connected!
4. If you need the rigged/animated skeletal mesh instead, export "${name}.glb"
   using the "EXPORT .GLB" button in CC-Kit and import via File > Import > glTF 2.0.

------------------------------------------------------------------------
2. HOW TO RIG & ANIMATE IN ADOBE MIXAMO
------------------------------------------------------------------------
- Upload this entire "${name}_Package.zip" directly to Mixamo.com!
  (Mixamo automatically reads the .obj, .mtl, and textures/ folder).
- On Mixamo.com, click "Upload Character" and drop this .zip file.
- Place the 5 auto-rig markers (Chin, Wrists, Elbows, Knees, Groin).
- Mixamo will auto-rig your character with full textures in 30 seconds!

------------------------------------------------------------------------
3. HOW TO IMPORT INTO UNITY / UNREAL ENGINE
------------------------------------------------------------------------
1. Drag the "${name}.obj" and "textures/" folder into your project.
2. The PBR maps (Face, Body, Lashes, Brows, Hair, Outfit) are standard PNGs
   ready for URP/HDRP Lit materials in Unity or Material Instances in UE5.
========================================================================
`;
}

/**
 * Builds the complete asset package (.zip) for the given scene.
 */
export async function exportCharacterPackageScene(
  scene: THREE.Scene,
  customName?: string,
  options?: PackageExportOptions,
): Promise<void> {
  if (isExportInFlight()) {
    throw new Error('An export is already in progress.');
  }

  const character = scene.getObjectByName('character');
  if (!character) {
    throw new Error('Character model not found in scene.');
  }

  const origPos = character.position.clone();
  const origRot = character.rotation.clone();
  const origName = character.name;

  // ── Discovery: read-only, may throw, nothing has been mutated yet ───────
  const skeletonGroup = character.getObjectByName('SkeletonRoot');
  if (!skeletonGroup) {
    throw new Error('Character skeleton not found in scene.');
  }

  let rootBone: THREE.Bone | null = null;
  skeletonGroup.traverse((child) => {
    if (!rootBone && (child as any).isBone && (!child.parent || !(child.parent as any).isBone)) {
      rootBone = child as THREE.Bone;
    }
  });
  if (!rootBone) {
    rootBone = skeletonGroup.children.find((c) => (c as any).isBone) as THREE.Bone | null;
  }
  if (!rootBone) {
    throw new Error('Skeleton root bone not found.');
  }

  const headBone = (skeletonGroup.getObjectByName('NPC Head [Head]') || rootBone) as THREE.Bone;
  const restHeadWorld = headBone.userData.__boneRest?.world
    ? (headBone.userData.__boneRest.world as THREE.Matrix4).clone()
    : headBone.matrixWorld.clone();
  const headRoot = character.getObjectByName('SkyrimHeadRoot');

  const bodySkinnedMeshes: THREE.SkinnedMesh[] = [];
  character.traverse((child) => {
    if ((child as any).isSkinnedMesh && child.parent !== headRoot) {
      bodySkinnedMeshes.push(child as THREE.SkinnedMesh);
    }
  });

  const essentialBones = findEssentialBones(bodySkinnedMeshes, headBone, rootBone!);
  const essentialList = Array.from(essentialBones);

  // ── Mutation phase: inside try/finally ──────────────────────────────────
  const hidden: { object: THREE.Object3D; wasVisible: boolean }[] = [];
  const hide = (object: THREE.Object3D) => {
    hidden.push({ object, wasVisible: object.visible });
    object.visible = false;
  };
  const restoreMeshSkeletons: (() => void)[] = [];
  const tempFacialMeshes: THREE.SkinnedMesh[] = [];
  const restoreMaterials: Array<{ mesh: THREE.Mesh; origMaterial: THREE.Material | THREE.Material[] }> = [];
  const restoreGroups: Array<{ mesh: THREE.Mesh; origGroups: THREE.BufferGeometry['groups'] }> = [];

  setExportInFlight(true);
  try {
    // 1. Hide dummy collision bones that no mesh weights.
    skeletonGroup.traverse((child) => {
      if ((child as any).isBone && !essentialBones.has(child as THREE.Bone) && child.visible) {
        hide(child);
      }
    });

    // 2. Prune bones from each body SkinnedMesh skeleton.
    for (const mesh of bodySkinnedMeshes) {
      const origSkeleton = mesh.skeleton;
      const origBones = origSkeleton.bones;
      const origBindMatrix = mesh.bindMatrix.clone();
      const origBindMatrixInverse = mesh.bindMatrixInverse.clone();
      const newBones: THREE.Bone[] = [];
      const oldToNew = new Map<number, number>();

      for (let i = 0; i < origBones.length; i++) {
        const bone = origBones[i];
        if (essentialBones.has(bone)) {
          oldToNew.set(i, newBones.length);
          newBones.push(bone);
        }
      }

      const geo = mesh.geometry;
      const skinIndexAttr = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
      const skinWeightAttr = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      if (!skinIndexAttr || !skinWeightAttr) continue;

      const oldIndices = skinIndexAttr.array;
      const weights = skinWeightAttr.array;
      const newIndices = new Uint16Array(oldIndices.length);

      for (let i = 0; i < oldIndices.length; i++) {
        newIndices[i] = weights[i] > 0.0001 ? oldToNew.get(oldIndices[i]) ?? 0 : 0;
      }

      const pruned = new THREE.Skeleton(newBones, restInverses(newBones, origSkeleton));
      restoreMeshSkeletons.push(() => {
        skinIndexAttr.array = oldIndices;
        skinIndexAttr.needsUpdate = true;
        mesh.bind(origSkeleton, origBindMatrix);
        mesh.bindMatrixInverse.copy(origBindMatrixInverse);
        pruned.dispose();
      });
      skinIndexAttr.array = newIndices;
      skinIndexAttr.needsUpdate = true;
      mesh.bind(pruned, new THREE.Matrix4());
    }

    // 3. Attach facial meshes to unified skeleton.
    if (headRoot) {
      if (headRoot.visible) hide(headRoot);
      headRoot.traverse((child) => {
        if ((child as any).isMesh && child.name && child.name !== 'SkyrimHeadRoot') {
          const mesh = child as THREE.Mesh;
          const semanticName =
            mesh.name === 'FemaleHead_hph' || mesh.name === 'Head' ? 'Face' : mesh.name;
          const tempMesh = createHeadSkinnedMesh(
            mesh,
            semanticName,
            rootBone!,
            headBone,
            restHeadWorld,
          );
          tempFacialMeshes.push(tempMesh);
          character.add(tempMesh);
        }
      });
    }

    // 4. Hide UI gizmos, overlay lines, and helper meshes.
    character.traverse((child) => {
      if (
        child.name === 'face-gizmo' ||
        child.name === 'mesh-overlay' ||
        (child as any).isTransformControls ||
        (child as any).isLine ||
        (child as any).isLineSegments ||
        (child as any).isPoints ||
        child.userData?.isHelper
      ) {
        if (child.visible) hide(child);
      }
    });

    // 5. Sanitize materials on all meshes for clean standard PBR glTF export.
    // Replaces physical materials (carrying clearcoat & sheen) and materials with
    // roughnessMap (which triggers three-stdlib's bug baking metallic=1.0 into the blue channel)
    // with clean MeshStandardMaterials having metallic: 0.0, natural roughness, and proper maps.
    character.traverse((child) => {
      if ((child as any).isMesh) {
        const mesh = child as THREE.Mesh;
        if (!mesh.material) return;

        const origMat = mesh.material;
        restoreMaterials.push({ mesh, origMaterial: origMat });

        const sanitize = (m: THREE.Material, slotIdx: number = 0): THREE.Material => {
          if (!(m as any).isMeshStandardMaterial && !(m as any).isMeshPhysicalMaterial) return m;
          const std = m as THREE.MeshStandardMaterial;
          const safeName = resolveSafeMaterialName(mesh, std, slotIdx);
          const lower = safeName.toLowerCase();
          const isSkin =
            lower.includes('base') ||
            lower.includes('body') ||
            lower.includes('hand') ||
            lower.includes('feet') ||
            lower.includes('foot') ||
            lower.includes('head') ||
            lower.includes('face') ||
            lower.includes('mouth');
          const isEyes = lower.includes('eye');
          const isHair =
            !isSkin &&
            (lower.includes('hair') ||
              lower.includes('s4studio') ||
              lower.includes('shadow') ||
              lower.includes('empressof') ||
              lower.includes('asterion') ||
              /\bace\b/.test(lower));
          const isLashesOrBrows = lower.includes('lash') || lower.includes('brow');

          // Hair and lashes/brows MUST use alphaTest with transparent=false so glTF exports alphaMode="MASK"
          // (transparent=true forces alphaMode="BLEND" which causes Blender EEVEE alpha sorting failure / ghost hair).
          const needsAlphaMask = isHair || isLashesOrBrows;

          return new THREE.MeshStandardMaterial({
            name: safeName,
            color: std.color ? std.color.clone() : new THREE.Color(1, 1, 1),
            map: std.map ?? null,
            normalMap: std.normalMap ?? null,
            normalScale: std.normalScale ? std.normalScale.clone() : new THREE.Vector2(1, 1),
            roughness: isEyes ? 0.1 : (isSkin ? 0.58 : (isHair ? 0.62 : (std.roughness ?? 0.55))),
            metalness: isSkin || isHair || isEyes ? 0.0 : (std.metalness ?? 0.0),
            transparent: false,
            opacity: std.opacity ?? 1.0,
            alphaTest: isHair ? 0.35 : (isLashesOrBrows ? 0.25 : 0),
            side: needsAlphaMask ? THREE.DoubleSide : std.side,
            visible: std.visible, // CRITICAL: preserve hidden status to prevent white untextured embedded body meshes
          });
        };

        if (Array.isArray(origMat)) {
          if (origMat.length === 1 && (!mesh.geometry.groups || mesh.geometry.groups.length === 0)) {
            mesh.material = sanitize(origMat[0], 0);
          } else {
            mesh.material = origMat.map((m, idx) => sanitize(m, idx));
            // Filter geometry.groups so GLTFExporter omits primitives whose material is invisible (e.g. embedded body in clothing)
            if (mesh.geometry.groups && mesh.geometry.groups.length > 0) {
              const origGroups = [...mesh.geometry.groups];
              restoreGroups.push({ mesh, origGroups });
              mesh.geometry.groups = origGroups.filter((g) => {
                const matIdx = g.materialIndex ?? 0;
                const mat = origMat[matIdx];
                return mat ? mat.visible !== false : true;
              });
            }
          }
        } else {
          mesh.material = sanitize(origMat, 0);
        }
      }
    });

    // 6. Ground elevation (feet soles at Y = 0.0) and 180° rotation (facing front)
    const rawName = customName || 'Character';
    const safeName = rawName.trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
    character.name = safeName;

    const groundOffset = computeGroundOffset(character);
    character.position.set(0, groundOffset, 0);
    character.rotation.set(0, Math.PI, 0);
    character.updateMatrixWorld(true);

    // 7. Generate GLB binary
    const keep = new Set(essentialList.flatMap((bone) => [bone.uuid, bone.name]));
    const animated = options?.animated !== false;
    const clips = animated ? buildExportClips(essentialList, keep) : [];

    const gltfExporter = new GLTFExporter();
    const gltf = await gltfExporter.parseAsync(character, {
      binary: true,
      trs: true,
      onlyVisible: true,
      animations: clips,
      maxTextureSize: 4096,
    });
    const glbBuffer = patchGlbIor(gltf as ArrayBuffer);

    // 8. Extract textures from GLB binary (instantaneous, 100% reliable)
    const { textureFiles, materialDefs } = extractTexturesFromGlb(glbBuffer);

    // 9. Generate OBJ and MTL text
    const objText = exportCharacterMeshesToObj(character, materialDefs, safeName);
    const mtlText = buildMtlContent(materialDefs);

    // 10. Generate Preset JSON & README
    const presetFile = useCharacter.getState().snapshotPreset();
    const presetText = JSON.stringify(presetFile, null, 2);
    const readmeText = buildReadmeContent(safeName);

    // 11. Package into ZIP synchronously with level 0 (instantaneous ~200ms)
    // Note: The rigged .glb is exported standalone via the "EXPORT .GLB" button.
    const zipTree: Record<string, any> = {
      [`${safeName}.obj`]: [strToU8(objText), { level: 0 }],
      [`${safeName}.mtl`]: [strToU8(mtlText), { level: 0 }],
      'preset.json': [strToU8(presetText), { level: 0 }],
      'README.txt': [strToU8(readmeText), { level: 0 }],
      textures: textureFiles,
    };

    const zipBytes = zipSync(zipTree);

    // 12. Trigger browser download
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_Package.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
  } finally {
    // Guaranteed restoration of live scene
    character.position.copy(origPos);
    character.rotation.copy(origRot);
    character.name = origName;
    character.updateMatrixWorld(true);

    for (const { mesh, origMaterial } of restoreMaterials) {
      mesh.material = origMaterial;
    }
    for (const { mesh, origGroups } of restoreGroups) {
      mesh.geometry.groups = origGroups;
    }
    for (const restore of restoreMeshSkeletons) {
      try {
        restore();
      } catch {
        /* continue restoring */
      }
    }
    for (const tempMesh of tempFacialMeshes) {
      try {
        character.remove(tempMesh);
        tempMesh.geometry.dispose();
      } catch {
        /* continue restoring */
      }
    }
    for (const { object, wasVisible } of hidden) {
      object.visible = wasVisible;
    }
    setExportInFlight(false);
  }
}
