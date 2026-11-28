'use client';

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  SHADOW_QUALITY_SPEC,
  useGraphicsSettings,
  type AnisotropyOption,
} from '@/lib/graphicsSettings';

const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
] as const;

export function applyTextureAnisotropy(
  root: THREE.Object3D,
  anisotropy: AnisotropyOption,
  maxAnisotropy: number,
): void {
  const clamped = Math.max(1, Math.min(anisotropy, maxAnisotropy));
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      if (!mat) continue;
      for (const key of TEXTURE_KEYS) {
        const tex = (mat as unknown as Record<string, unknown>)[key];
        if (tex instanceof THREE.Texture && tex.anisotropy !== clamped) {
          tex.anisotropy = clamped;
          tex.needsUpdate = true;
        }
      }
    }
  });
}

/**
 * Syncs persisted `useGraphicsSettings` values (`renderScale`, `shadowQuality`,
 * `anisotropy`) into the active Three.js WebGLRenderer & Scene without remounting Canvas.
 */
export function GraphicsRuntimeBridge() {
  const { gl, scene, setDpr } = useThree();
  const renderScale = useGraphicsSettings((s) => s.renderScale);
  const shadowQuality = useGraphicsSettings((s) => s.shadowQuality);
  const anisotropy = useGraphicsSettings((s) => s.anisotropy);
  const prevSoftRef = useRef<boolean | null>(null);

  useEffect(() => {
    const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    // Allow explicit scaling both below 1.0 (e.g. 0.85x) and up to the configured cap
    const targetDpr = renderScale < 1 ? renderScale : Math.min(deviceDpr, renderScale);
    setDpr(targetDpr);
  }, [renderScale, setDpr]);

  useEffect(() => {
    const spec = SHADOW_QUALITY_SPEC[shadowQuality];
    gl.shadowMap.enabled = spec.enabled;
    const nextType = spec.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const typeChanged = prevSoftRef.current !== null && prevSoftRef.current !== spec.soft;
    prevSoftRef.current = spec.soft;

    if (gl.shadowMap.type !== nextType || typeChanged) {
      gl.shadowMap.type = nextType;
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          if (mat) mat.needsUpdate = true;
        }
      });
    }
    gl.shadowMap.needsUpdate = true;
  }, [gl, scene, shadowQuality]);

  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    applyTextureAnisotropy(scene, anisotropy, maxAniso);
  }, [gl, scene, anisotropy]);

  return null;
}
