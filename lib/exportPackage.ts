'use client';

import * as THREE from 'three';
import { GLTFExporter, OBJExporter } from 'three-stdlib';
import { zip, strToU8 } from 'fflate';
import { useCharacter } from '@/lib/store';
import { buildExportClips, restInverses } from '@/lib/character/animation';
import {
  computeGroundOffset,
  findEssentialBones,
  createHeadSkinnedMesh,
  isExportInFlight,
  setExportInFlight,
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
  throw new Error('3D scene is not ready for packaging. Please wait for the model to finish loading.');
}

/**
 * Converts a Three.js Texture (Image, Canvas, Bitmap, or DataTexture)
 * into standard lossless PNG bytes.
 */
export async function textureToPngBytes(texture: THREE.Texture): Promise<Uint8Array | null> {
  const image = texture.image;
  if (!image) return null;

  try {
    // 1. HTMLCanvasElement
    if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
      return new Promise<Uint8Array | null>((resolve) => {
        image.toBlob((blob) => {
          if (!blob) return resolve(null);
          blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(() => resolve(null));
        }, 'image/png');
      });
    }

    // 2. HTMLImageElement
    if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width || 1024;
      canvas.height = image.naturalHeight || image.height || 1024;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return new Promise<Uint8Array | null>((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) return resolve(null);
          blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(() => resolve(null));
        }, 'image/png');
      });
    }

    // 3. ImageBitmap
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0);
      return new Promise<Uint8Array | null>((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) return resolve(null);
          blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(() => resolve(null));
        }, 'image/png');
      });
    }

    // 4. DataTexture with raw buffer
    if (image.data && image.width && image.height) {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const clamped = image.data instanceof Uint8ClampedArray
        ? image.data
        : new Uint8ClampedArray(image.data.buffer || image.data);
      const imgData = new ImageData(clamped, image.width, image.height);
      ctx.putImageData(imgData, 0, 0);
      return new Promise<Uint8Array | null>((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) return resolve(null);
          blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(() => resolve(null));
        }, 'image/png');
      });
    }
  } catch (err) {
    console.warn('textureToPngBytes failed:', err);
  }
  return null;
}

/**
 * Classifies a mesh by role to assign consistent, industry-standard material and texture names.
 */
function classifyMesh(mesh: THREE.Mesh): { category: string; baseName: string } {
  const name = mesh.name.toLowerCase();
  if (name.includes('head') || name === 'femalehead_hph') return { category: 'face', baseName: 'Face' };
  if (name.includes('eye')) return { category: 'eyes', baseName: 'Eyes' };
  if (name.includes('brow')) return { category: 'brows', baseName: 'Brows' };
  if (name.includes('lash')) return { category: 'lashes', baseName: 'Lashes' };
  if (name.includes('mouth')) return { category: 'mouth', baseName: 'Mouth' };
  if (name.includes('body') || name === 'baseshape') return { category: 'body', baseName: 'Body' };
  if (name.includes('hand')) return { category: 'hands', baseName: 'Hands' };
  if (name.includes('feet') || name.includes('foot')) return { category: 'feet', baseName: 'Feet' };
  if (
    name.includes('hair') ||
    name.includes('shadow') ||
    name.includes('empressof') ||
    name.includes('scalp') ||
    name.includes('regina') ||
    name.includes('piratess')
  ) {
    return { category: 'hair', baseName: 'Hair' };
  }
  if (
    name.includes('cloth') ||
    name.includes('outfit') ||
    name.includes('onepiece') ||
    name.includes('garment') ||
    name.includes('dress') ||
    name.includes('armor')
  ) {
    return { category: 'outfit', baseName: 'Outfit' };
  }
  return { category: 'other', baseName: mesh.name || 'Part' };
}

interface MaterialDef {
  name: string;
  diffuseMap?: string;
  normalMap?: string;
  roughnessMap?: string;
}

function buildMtlContent(materials: MaterialDef[]): string {
  let mtl = '# CC-Kit Skyrim Character Creator - Material Library\n';
  mtl += '# Compatible with Blender, Adobe Mixamo, Unity, and Unreal Engine\n';

  for (const m of materials) {
    mtl += `\nnewmtl ${m.name}\n`;
    mtl += 'Ka 1.000 1.000 1.000\n';
    mtl += 'Kd 1.000 1.000 1.000\n';
    mtl += 'Ks 0.200 0.200 0.200\n';
    mtl += 'Ns 10.0\n';
    mtl += 'd 1.0\n';
    mtl += 'illum 2\n';
    if (m.diffuseMap) {
      mtl += `map_Kd textures/${m.diffuseMap}\n`;
    }
    if (m.normalMap) {
      mtl += `map_Bump textures/${m.normalMap}\n`;
    }
  }
  return mtl;
}

function buildReadmeContent(name: string): string {
  return `========================================================================
CC-KIT 3D CHARACTER ASSET PACKAGE
========================================================================
Character Name: ${name}
Export Date: ${new Date().toISOString()}

INCLUDED FILES:
  • ${name}.glb       : Rigged & animated 3D model with skeletal XP32 rig & embedded textures.
  • ${name}.obj       : Static 3D mesh (T-pose / biped) for Mixamo or sculpt software.
  • ${name}.mtl       : Material and texture mapping definitions for the OBJ.
  • textures/         : All high-resolution (2K) PBR textures in lossless PNG format.
  • preset.json       : Full character morphs, slider positions, and color settings.

------------------------------------------------------------------------
1. HOW TO IMPORT INTO BLENDER
------------------------------------------------------------------------
1. Open Blender.
2. Go to File > Import > glTF 2.0 (.glb/.gltf) and select "${name}.glb".
3. NOTE: Blender defaults to "Solid View" (solid white/grey clay).
   To see all textures, hover over the 3D viewport and press 'Z',
   then select "Material Preview" (or click the preview sphere in the top-right).
4. The skeletal rig and stance animations (Idle / Pose) are immediately ready to use!

------------------------------------------------------------------------
2. HOW TO RIG & ANIMATE IN ADOBE MIXAMO
------------------------------------------------------------------------
Option A (Fastest):
- Upload this entire "${name}_Package.zip" directly to Mixamo.com!
  (Mixamo automatically reads the .obj, .mtl, and textures/ folder).
- Or upload a zip containing "${name}.obj", "${name}.mtl", and the "textures" folder.
- On Mixamo.com, click "Upload Character" and drop the file.
- Place the 5 auto-rig markers (Chin, Wrists, Elbows, Knees, Groin).
- Mixamo will auto-rig your character with full textures in 30 seconds!

Option B (Retargeting existing rig):
- Note that "${name}.glb" already contains a complete humanoid skeleton.
  You can also retarget Mixamo animation FBXs directly onto this skeleton in
  Blender, Unity, or Unreal Engine.

------------------------------------------------------------------------
3. HOW TO IMPORT INTO UNITY
------------------------------------------------------------------------
1. Drag "${name}.glb" and the "textures" folder into your Unity Project window.
2. Select "${name}.glb" in the Project window:
   - In the Inspector, click the "Rig" tab.
   - Set "Animation Type" to "Humanoid".
   - Click "Apply".
3. Any Unity Humanoid animation will now work seamlessly on this character.
4. You can also assign the loose textures from the "textures/" folder to
   URP or HDRP Lit materials for advanced shader rendering.

------------------------------------------------------------------------
4. HOW TO IMPORT INTO UNREAL ENGINE 5
------------------------------------------------------------------------
1. Drag "${name}.glb" and the "textures" folder into your Content Browser.
2. Unreal will import the Skeletal Mesh, Skeleton, and PBR textures.
3. Open or create a Material Instance, and plug the Diffuse and Normal maps
   from the "textures/" folder into the material slots.
4. Use Unreal's IK Retargeter to retarget Manny/Quinn animations.
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
          const tempMesh = createHeadSkinnedMesh(
            mesh,
            mesh.name === 'FemaleHead_hph' ? 'Head' : mesh.name,
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

    // 5. Normalize single-material arrays on meshes so exporters never drop them.
    character.traverse((child) => {
      if ((child as any).isMesh) {
        const mesh = child as THREE.Mesh;
        if (
          Array.isArray(mesh.material) &&
          mesh.material.length === 1 &&
          (!mesh.geometry.groups || mesh.geometry.groups.length === 0)
        ) {
          restoreMaterials.push({ mesh, origMaterial: mesh.material });
          mesh.material = mesh.material[0];
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

    // 7. Collect textures from active character materials
    const textureFiles: Record<string, Uint8Array> = {};
    const textureByUuid = new Map<string, string>(); // uuid -> filename
    const materialDefs: MaterialDef[] = [];
    const usedMaterialNames = new Set<string>();

    const allMeshes: THREE.Mesh[] = [];
    character.traverse((child) => {
      if ((child as any).isMesh && child.visible) {
        allMeshes.push(child as THREE.Mesh);
      }
    });

    for (const mesh of allMeshes) {
      const { category, baseName } = classifyMesh(mesh);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      for (let mIdx = 0; mIdx < mats.length; mIdx++) {
        const mat = mats[mIdx] as THREE.MeshStandardMaterial;
        if (!mat) continue;

        let matName = mat.name || (mats.length > 1 ? `${baseName}_${mIdx}` : baseName);
        if (!usedMaterialNames.has(matName)) {
          usedMaterialNames.add(matName);
        }
        mat.name = matName;

        const def: MaterialDef = { name: matName };

        // Process diffuse map
        if (mat.map) {
          const uuid = mat.map.uuid;
          if (textureByUuid.has(uuid)) {
            def.diffuseMap = textureByUuid.get(uuid);
          } else {
            const filename = `${matName}_Diffuse.png`;
            const pngBytes = await textureToPngBytes(mat.map);
            if (pngBytes && pngBytes.length > 0) {
              textureFiles[filename] = pngBytes;
              textureByUuid.set(uuid, filename);
              def.diffuseMap = filename;
            }
          }
        }

        // Process normal map
        if (mat.normalMap) {
          const uuid = mat.normalMap.uuid;
          if (textureByUuid.has(uuid)) {
            def.normalMap = textureByUuid.get(uuid);
          } else {
            const filename = `${matName}_Normal.png`;
            const pngBytes = await textureToPngBytes(mat.normalMap);
            if (pngBytes && pngBytes.length > 0) {
              textureFiles[filename] = pngBytes;
              textureByUuid.set(uuid, filename);
              def.normalMap = filename;
            }
          }
        }

        // Process roughness map
        if (mat.roughnessMap) {
          const uuid = mat.roughnessMap.uuid;
          if (textureByUuid.has(uuid)) {
            def.roughnessMap = textureByUuid.get(uuid);
          } else {
            const filename = `${matName}_Roughness.png`;
            const pngBytes = await textureToPngBytes(mat.roughnessMap);
            if (pngBytes && pngBytes.length > 0) {
              textureFiles[filename] = pngBytes;
              textureByUuid.set(uuid, filename);
              def.roughnessMap = filename;
            }
          }
        }

        materialDefs.push(def);
      }
    }

    // 8. Generate GLB binary
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
    const glbBuffer = gltf as ArrayBuffer;

    // 9. Generate OBJ and MTL text
    const objExporter = new OBJExporter();
    const rawObj = objExporter.parse(character);
    const mtlText = buildMtlContent(materialDefs);
    const objText = `mtllib ${safeName}.mtl\n` + rawObj;

    // 10. Generate Preset JSON & README
    const presetFile = useCharacter.getState().snapshotPreset();
    const presetText = JSON.stringify(presetFile, null, 2);
    const readmeText = buildReadmeContent(safeName);

    // 11. Package into ZIP with fflate
    const zipTree: Record<string, any> = {
      [`${safeName}.glb`]: new Uint8Array(glbBuffer),
      [`${safeName}.obj`]: strToU8(objText),
      [`${safeName}.mtl`]: strToU8(mtlText),
      'preset.json': strToU8(presetText),
      'README.txt': strToU8(readmeText),
      textures: textureFiles,
    };

    const zipBuffer = await new Promise<Uint8Array>((resolve, reject) => {
      zip(zipTree, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    // 12. Trigger browser download
    const blob = new Blob([zipBuffer.buffer as ArrayBuffer], { type: 'application/zip' });
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
