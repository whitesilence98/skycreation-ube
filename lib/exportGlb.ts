'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { GLTFExporter } from 'three-stdlib';
import * as THREE from 'three';
import { useCharacter } from '@/lib/store';

type ExportHandler = (customName?: string) => Promise<void>;

let activeHandler: ExportHandler | null = null;

export function registerExportHandler(handler: ExportHandler) {
  activeHandler = handler;
}

export function unregisterExportHandler() {
  activeHandler = null;
}

/** Trigger export of the full 3D character model with rig as a `.glb` binary file. */
export async function exportCharacterGlb(customName?: string): Promise<void> {
  if (activeHandler) {
    return activeHandler(customName);
  }
  throw new Error('3D scene is not ready for export. Please wait for model to load.');
}

/**
 * Traverses skinned meshes to collect all bones with non-zero vertex weights,
 * plus all their ancestor bones up to the root.
 */
function findEssentialBones(
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
 * Builds a 30 FPS 2-keyframe AnimationClip ("Pose") capturing the active
 * rotation, translation, and scale of every essential bone.
 */
function buildPoseAnimationClip(essentialBones: Iterable<THREE.Bone>): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const times = [0, 1 / 30];

  for (const bone of essentialBones) {
    const q = bone.quaternion;
    const p = bone.position;
    const s = bone.scale;

    // Use bone.uuid to bypass bracket name parsing quirks in Three.js PropertyBinding
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${bone.uuid}.quaternion`,
        times,
        [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w],
      ),
    );
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${bone.uuid}.position`,
        times,
        [p.x, p.y, p.z, p.x, p.y, p.z],
      ),
    );
    if (Math.abs(s.x - 1) > 0.001 || Math.abs(s.y - 1) > 0.001 || Math.abs(s.z - 1) > 0.001) {
      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${bone.uuid}.scale`,
          times,
          [s.x, s.y, s.z, s.x, s.y, s.z],
        ),
      );
    }
  }

  return new THREE.AnimationClip('Pose', 1 / 30, tracks);
}

/**
 * Binds a mesh to the single head bone of the unified skeleton.
 */
function createHeadSkinnedMesh(
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
  const skinned = new THREE.SkinnedMesh(geo, mesh.material);
  skinned.name = name;
  skinned.castShadow = true;
  skinned.receiveShadow = true;
  skinned.bind(skeleton, new THREE.Matrix4());
  return skinned;
}

/**
 * Mounts inside the Three.js Canvas to bridge between the scene graph
 * and external HUD export triggers.
 */
export function GlbExportBridge() {
  const { scene } = useThree();
  const name = useCharacter((s) => s.name);

  useEffect(() => {
    const handler = async (customName?: string) => {
      const character = scene.getObjectByName('character');
      if (!character) {
        throw new Error('Character model not found in scene.');
      }

      // 1. Locate the main body skeleton and head bone
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

      // 2. Collect all body skinned meshes
      const bodySkinnedMeshes: THREE.SkinnedMesh[] = [];
      character.traverse((child) => {
        if ((child as any).isSkinnedMesh && child.parent !== character.getObjectByName('SkyrimHeadRoot')) {
          bodySkinnedMeshes.push(child as THREE.SkinnedMesh);
        }
      });

      // 3. Identify essential bones and filter out dummy collision spheres
      const essentialBones = findEssentialBones(bodySkinnedMeshes, headBone, rootBone);
      const hiddenDummies: THREE.Bone[] = [];
      skeletonGroup.traverse((child) => {
        if ((child as any).isBone && !essentialBones.has(child as THREE.Bone)) {
          if (child.visible) {
            child.visible = false;
            hiddenDummies.push(child as THREE.Bone);
          }
        }
      });

      // 4. Prune dummy bones from each body SkinnedMesh skeleton
      const restoreMeshSkeletons: (() => void)[] = [];
      const essentialList = Array.from(essentialBones);

      for (const mesh of bodySkinnedMeshes) {
        const origSkeleton = mesh.skeleton;
        const origBones = origSkeleton.bones;
        const newBones: THREE.Bone[] = [];
        const oldToNew = new Map<number, number>();

        for (let i = 0; i < origBones.length; i++) {
          const b = origBones[i];
          if (essentialBones.has(b)) {
            oldToNew.set(i, newBones.length);
            newBones.push(b);
          }
        }

        const geo = mesh.geometry;
        const skinIndexAttr = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
        const skinWeightAttr = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;

        if (skinIndexAttr && skinWeightAttr) {
          const oldIndices = skinIndexAttr.array;
          const weights = skinWeightAttr.array;
          const newIndices = new Uint16Array(oldIndices.length);

          for (let i = 0; i < oldIndices.length; i++) {
            if (weights[i] > 0.0001) {
              newIndices[i] = oldToNew.get(oldIndices[i]) ?? 0;
            } else {
              newIndices[i] = 0;
            }
          }

          skinIndexAttr.array = newIndices;
          skinIndexAttr.needsUpdate = true;
          mesh.bind(new THREE.Skeleton(newBones), new THREE.Matrix4());

          restoreMeshSkeletons.push(() => {
            skinIndexAttr.array = oldIndices;
            skinIndexAttr.needsUpdate = true;
            mesh.bind(origSkeleton, new THREE.Matrix4());
          });
        }
      }

      // 5. Hide the separate SkyrimHeadRoot and attach facial meshes to the unified skeleton
      const rigRoot = character.getObjectByName('SkyrimHeadRoot');
      const tempFacialMeshes: THREE.SkinnedMesh[] = [];

      if (rigRoot) {
        rigRoot.visible = false;
        rigRoot.traverse((child) => {
          if ((child as any).isMesh && child.name && child.name !== 'SkyrimHeadRoot') {
            const mesh = child as THREE.Mesh;
            const skinnedFaceMesh = createHeadSkinnedMesh(
              mesh,
              mesh.name === 'FemaleHead_hph' ? 'Head' : mesh.name,
              rootBone!,
              headBone,
              restHeadWorld,
            );
            tempFacialMeshes.push(skinnedFaceMesh);
            character.add(skinnedFaceMesh);
          }
        });
      }

      // 6. Hide UI gizmos, overlay lines, and helper meshes
      const hiddenHelpers: THREE.Object3D[] = [];
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
          if (child.visible) {
            child.visible = false;
            hiddenHelpers.push(child);
          }
        }
      });

      // 7. Ensure matrices are updated
      character.updateMatrixWorld(true);

      // 8. Build active pose animation clip
      const poseClip = buildPoseAnimationClip(essentialList);

      const restoreAll = () => {
        for (const helper of hiddenHelpers) helper.visible = true;
        for (const dummy of hiddenDummies) dummy.visible = true;
        for (const restore of restoreMeshSkeletons) restore();
        if (rigRoot) rigRoot.visible = true;
        for (const tempMesh of tempFacialMeshes) {
          character.remove(tempMesh);
          tempMesh.geometry.dispose();
        }
      };

      const exporter = new GLTFExporter();
      try {
        const gltf = await exporter.parseAsync(character, {
          binary: true,
          trs: true,
          onlyVisible: true,
          animations: [poseClip],
          maxTextureSize: 4096,
        });

        const blob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const rawName = customName || name || 'Character';
        const safeName = rawName.trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
        a.download = `${safeName}.glb`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } finally {
        restoreAll();
      }
    };

    registerExportHandler(handler);
    return () => unregisterExportHandler();
  }, [scene, name]);

  return null;
}
