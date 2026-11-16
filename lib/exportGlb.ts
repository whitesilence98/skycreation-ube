'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { GLTFExporter } from 'three-stdlib';
import * as THREE from 'three';
import { useCharacter } from '@/lib/store';
import { buildExportClips, restInverses } from '@/lib/character/animation';
import {
  registerPackageExportHandler,
  unregisterPackageExportHandler,
  exportCharacterPackageScene,
  type PackageExportOptions,
} from '@/lib/exportPackage';

export interface ExportOptions {
  /** Include the `Pose` + `Idle` clips. `false` (or omitted) is a static mesh. */
  animated?: boolean;
}

type ExportHandler = (customName?: string, options?: ExportOptions) => Promise<void>;

let activeHandler: ExportHandler | null = null;

/**
 * A second export would run discovery against a scene the first export has
 * already mutated (hidden collision bones, pruned skeleton bindings), so
 * overlap is refused rather than serialised. Cleared by the export's
 * `finally`, including on failure.
 */
let exportInFlight = false;

export function isExportInFlight(): boolean {
  return exportInFlight;
}

export function setExportInFlight(val: boolean): void {
  exportInFlight = val;
}

export function registerExportHandler(handler: ExportHandler) {
  activeHandler = handler;
}

export function unregisterExportHandler() {
  activeHandler = null;
}

/**
 * Trigger export of the full 3D character model with rig as a `.glb` binary.
 *
 * `options.animated` adds a `Pose` clip (the selected stance) and an `Idle`
 * clip (breathing layered over that stance). Omitting it exports the static
 * mesh with no animation, as before.
 */
export async function exportCharacterGlb(
  customName?: string,
  options?: ExportOptions,
): Promise<void> {
  const opts: ExportOptions = { animated: true, ...options };
  if (activeHandler) {
    return activeHandler(customName, opts);
  }
  throw new Error('3D scene is not ready for export. Please wait for model to load.');
}

/**
 * Computes the vertical distance needed to lift the character so that the
 * lowest point of the soles sits precisely at Y = 0.0 on the ground plane.
 */
export function computeGroundOffset(character: THREE.Object3D): number {
  let minY = Infinity;
  const tempVec = new THREE.Vector3();

  character.traverse((child) => {
    if (
      (child as THREE.Mesh).isMesh &&
      child.visible &&
      child.name !== 'face-gizmo' &&
      child.name !== 'mesh-overlay' &&
      !child.userData?.isHelper
    ) {
      const mesh = child as THREE.Mesh;
      const geo = mesh.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return;
      const pos = geo.attributes.position;
      const arr = pos.array;
      const mat = mesh.matrixWorld;
      for (let i = 0; i < arr.length; i += 3) {
        tempVec.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(mat);
        if (tempVec.y < minY) {
          minY = tempVec.y;
        }
      }
    }
  });

  if (Number.isFinite(minY) && minY < -0.3) {
    return -minY;
  }
  return 1.554;
}

/**
 * Traverses skinned meshes to collect all bones with non-zero vertex weights,
 * plus all their ancestor bones up to the root.
 */
export function findEssentialBones(
  skinnedMeshes: THREE.SkinnedMesh[],
  headBone: THREE.Bone | null,
  rootBone: THREE.Bone | null,
): Set<THREE.Bone> {
  const essential = new Set<THREE.Bone>();

  if (headBone) essential.add(headBone);
  if (rootBone) essential.add(rootBone);

  for (const mesh of skinnedMeshes) {
    const geo = mesh.geometry;
    const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    const bones = mesh.skeleton?.bones;

    if (!skinWeight || !skinIndex || !bones) continue;

    const wArr = skinWeight.array;
    const iArr = skinIndex.array;

    for (let i = 0; i < wArr.length; i++) {
      if (wArr[i] > 0.0001) {
        const boneIdx = iArr[i];
        if (boneIdx < bones.length) {
          const bone = bones[boneIdx];
          if (bone) essential.add(bone);
        }
      }
    }
  }

  // Include all ancestors up to the root so the skeleton hierarchy stays complete
  const ancestorsToAdd: THREE.Bone[] = [];
  for (const bone of essential) {
    let curr: THREE.Object3D | null = bone.parent;
    while (curr) {
      if ((curr as any).isBone) {
        ancestorsToAdd.push(curr as THREE.Bone);
      }
      curr = curr.parent;
    }
  }
  for (const b of ancestorsToAdd) {
    essential.add(b);
  }

  return essential;
}


/**
 * Binds a mesh to the single head bone of the unified skeleton.
 */
export function createHeadSkinnedMesh(
  mesh: THREE.Mesh,
  name: string,
  rootBone: THREE.Bone,
  headBone: THREE.Bone,
  restHeadWorld: THREE.Matrix4,
): THREE.SkinnedMesh {
  const geo = mesh.geometry.clone();
  const count = geo.attributes.position.count;

  // Vertex skinning: index 1 is headBone, weight 1.0
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndices[i * 4] = 1;
    skinWeights[i * 4] = 1.0;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));

  const boneInverses = [
    rootBone.matrixWorld.clone().invert(),
    restHeadWorld.clone().invert(),
  ];
  const skeleton = new THREE.Skeleton([rootBone, headBone], boneInverses);

  // Clone material and assign explicit semantic name so exporters preserve it
  const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const mat = origMat ? origMat.clone() : new THREE.MeshStandardMaterial();
  mat.name = name;

  const skinned = new THREE.SkinnedMesh(geo, mat);
  skinned.name = name;
  skinned.castShadow = true;
  skinned.receiveShadow = true;
  skinned.bind(skeleton, new THREE.Matrix4());
  return skinned;
}

/**
 * Export the character scene to `.glb`, mutating the live scene only inside a
 * single `try`, with every mutation undone by `finally`.
 *
 * Two invariants keep the preview intact if the exporter throws:
 *
 *  - **Every mutation has a recorded undo before it is performed.** Visibility
 *    changes push the object (and it is re-shown from the recorded original,
 *    not assumed to have been visible), skeleton re-binding pushes a restore
 *    closure, and temp facial meshes push themselves for removal.
 *  - **Discovery runs before the first mutation.** Lookups that can throw
 *    (missing character/skeleton/root bone) leave the scene untouched.
 *
 * The function is exported for the headless export check; the bridge is a thin
 * wrapper around it.
 */
export async function exportCharacterScene(
  scene: THREE.Scene,
  customName?: string,
  options?: ExportOptions,
): Promise<void> {
  if (exportInFlight) {
    throw new Error('Export already in progress.');
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

  // ── Mutation phase: everything below runs inside one try/finally ────────
  /** Objects hidden for the export, with the visibility they had before it. */
  const hidden: { object: THREE.Object3D; wasVisible: boolean }[] = [];
  const hide = (object: THREE.Object3D) => {
    hidden.push({ object, wasVisible: object.visible });
    object.visible = false;
  };
  const restoreMeshSkeletons: (() => void)[] = [];
  const tempFacialMeshes: THREE.SkinnedMesh[] = [];
  const restoreMaterials: Array<{ mesh: THREE.Mesh; origMaterial: THREE.Material | THREE.Material[] }> = [];

  exportInFlight = true;
  try {
    // 1. Hide dummy collision bones that no mesh weights and the export drops.
    skeletonGroup.traverse((child) => {
      if ((child as any).isBone && !essentialBones.has(child as THREE.Bone) && child.visible) {
        hide(child);
      }
    });

    // 2. Prune those bones from each body SkinnedMesh skeleton.
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

      /* Inverses come from the REST pose, never from the live pose: a
         skeleton built while the character is posed (or, worse, mid-
         animation) would make that frame the exported rest. */
      const pruned = new THREE.Skeleton(newBones, restInverses(newBones, origSkeleton));
      restoreMeshSkeletons.push(() => {
        skinIndexAttr.array = oldIndices;
        skinIndexAttr.needsUpdate = true;
        /* Restore the exact original binding rather than re-deriving it:
           `bind(origSkeleton, identity)` would drop the mesh's real bind
           matrix and let `bindMatrixInverse` pick up the current pose. */
        mesh.bind(origSkeleton, origBindMatrix);
        mesh.bindMatrixInverse.copy(origBindMatrixInverse);
        pruned.dispose();
      });
      skinIndexAttr.array = newIndices;
      skinIndexAttr.needsUpdate = true;
      mesh.bind(pruned, new THREE.Matrix4());
    }

    // 3. Hide the separate SkyrimHeadRoot and attach its facial meshes to the
    //    unified skeleton, recording the root's ORIGINAL visibility.
    if (headRoot) {
      /* Facial meshes are still rebuilt and added when the root was already
         hidden — only the visibility change itself is conditional, so the
         facial geometry never silently vanishes from an export. */
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

    // 4.5. Normalize single-material arrays on meshes so exporters never drop them.
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

    // 5. Apply ground elevation (feet soles at Y = 0.0) and 180° rotation (facing front)
    const rawName = customName || 'Character';
    const safeName = rawName.trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
    character.name = safeName;

    const groundOffset = computeGroundOffset(character);
    character.position.set(0, groundOffset, 0);
    character.rotation.set(0, Math.PI, 0);
    character.updateMatrixWorld(true);

    /* 6. Build the clips the exporter will emit. Only the active pose is
       snapshotted (never all 72 tracks), and every track is filtered to the
       bones that survived pruning — the exporter warns and drops any track
       whose node is gone. Facial-rig (`SkyrimHeadRoot`) bones collapse onto
       the head bone below, so only body/XP32 motion is exported. */
    const keep = new Set(essentialList.flatMap((bone) => [bone.uuid, bone.name]));
    const animated = options?.animated !== false;
    const clips = animated ? buildExportClips(essentialList, keep) : [];

    const exporter = new GLTFExporter();
    const gltf = await exporter.parseAsync(character, {
      binary: true,
      trs: true,
      onlyVisible: true,
      animations: clips,
      maxTextureSize: 4096,
    });

    const blob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.glb`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } finally {
    // Guaranteed restoration of live scene transforms
    character.position.copy(origPos);
    character.rotation.copy(origRot);
    character.name = origName;
    character.updateMatrixWorld(true);
    // Cleanup is itself failure-tolerant: one bad restore must not leave the
    // rest un-undone, so each step is isolated.
    for (const { mesh, origMaterial } of restoreMaterials) {
      mesh.material = origMaterial;
    }
    for (const restore of restoreMeshSkeletons) {
      try {
        restore();
      } catch {
        /* keep restoring the remaining meshes */
      }
    }
    for (const tempMesh of tempFacialMeshes) {
      try {
        character.remove(tempMesh);
        tempMesh.geometry.dispose();
      } catch {
        /* keep cleaning up */
      }
    }
    for (const { object, wasVisible } of hidden) {
      object.visible = wasVisible;
    }
    exportInFlight = false;
  }
}

/**
 * Mounts inside the Three.js Canvas to bridge between the scene graph
 * and external HUD export triggers.
 */
export function GlbExportBridge() {
  const { scene } = useThree();
  const name = useCharacter((s) => s.name);

  useEffect(() => {
    const handler = (customName?: string, options?: ExportOptions) =>
      exportCharacterScene(scene as THREE.Scene, customName || name, options);
    const pkgHandler = (customName?: string, options?: PackageExportOptions) =>
      exportCharacterPackageScene(scene as THREE.Scene, customName || name, options);

    registerExportHandler(handler);
    registerPackageExportHandler(pkgHandler);
    return () => {
      unregisterExportHandler();
      unregisterPackageExportHandler();
    };
  }, [scene, name]);

  return null;
}
