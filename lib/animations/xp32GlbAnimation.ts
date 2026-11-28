/**
 * lib/animations/xp32GlbAnimation.ts
 *
 * Direct native Skyrim XP32 skeleton animation loader.
 * Loads Blender-authored XP32 GLBs (`/assets/animations/{idle,selfie}.glb`)
 * and binds keyframe tracks directly to the live XP32 `SkeletonRegistry`.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import type { SkeletonRegistry } from '@/lib/character/skeleton';

export type Xp32AnimationId = 'idle' | 'selfie';

export const XP32_ANIMATION_URLS: Record<Xp32AnimationId, string> = {
  idle: '/assets/animations/idle.glb',
  selfie: '/assets/animations/selfie.glb',
};

const cachedRawClips = new Map<Xp32AnimationId, THREE.AnimationClip>();
let preloadPromise: Promise<void> | null = null;

/**
 * Preloads all native XP32 animation GLB files.
 */
export function preloadXp32Animations(): Promise<void> {
  if (preloadPromise) return preloadPromise;

  const loader = new GLTFLoader();
  const entries = Object.entries(XP32_ANIMATION_URLS) as [Xp32AnimationId, string][];

  preloadPromise = Promise.all(
    entries.map(([id, url]) =>
      new Promise<void>((resolve) => {
        loader.load(
          url,
          (gltf) => {
            if (gltf.animations && gltf.animations.length > 0) {
              cachedRawClips.set(id, gltf.animations[0]);
            }
            resolve();
          },
          undefined,
          (err) => {
            console.warn(`[xp32GlbAnimation] Failed to load ${url}:`, err);
            resolve();
          },
        );
      }),
    ),
  ).then(() => {});

  return preloadPromise;
}

/**
 * Binds cached native XP32 raw glTF tracks to the live `SkeletonRegistry`.
 * Tracks are mapped by sanitized XP32 bone names to UUID-based property tracks,
 * ensuring seamless Three.js PropertyBinding without character/bracket parse errors.
 */
export function buildXp32Clip(
  id: Xp32AnimationId,
  registry: SkeletonRegistry,
): THREE.AnimationClip | null {
  const rawClip = cachedRawClips.get(id);
  if (!rawClip) return null;

  // Map sanitized bone names (as exported by glTF) to registered Three.js bones
  const boneMap = new Map<string, THREE.Bone>();
  for (const [name, bone] of registry.byName.entries()) {
    const sanitized = THREE.PropertyBinding.sanitizeNodeName(name);
    boneMap.set(sanitized, bone);
    boneMap.set(name, bone);
  }

  const tracks: THREE.KeyframeTrack[] = [];

  for (const track of rawClip.tracks) {
    const dotIdx = track.name.lastIndexOf('.');
    if (dotIdx === -1) continue;

    const nodeName = track.name.slice(0, dotIdx);
    const property = track.name.slice(dotIdx + 1);

    const bone = boneMap.get(nodeName);
    if (!bone) continue;

    if (property === 'quaternion') {
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${bone.uuid}.quaternion`,
          track.times,
          track.values,
          track.getInterpolation(),
        ),
      );
    } else if (property === 'position') {
      // Only retain translation on pelvis / root bones so limb lengths and BodySlide proportions are preserved
      if (bone.name.includes('Pelvis') || bone.name.includes('Root')) {
        tracks.push(
          new THREE.VectorKeyframeTrack(
            `${bone.uuid}.position`,
            track.times,
            track.values,
            track.getInterpolation(),
          ),
        );
      }
    }
    // Scale tracks are ignored to keep BodySlide morph scales and RaceMenu node scales intact
  }

  if (tracks.length === 0) return null;

  return new THREE.AnimationClip(`xp32_${id}`, rawClip.duration, tracks);
}
