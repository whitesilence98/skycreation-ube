'use client';

import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { createEnvironmentScene, ENV_CONFIG } from '@/components/scene/environments';
import { useHdr } from '@/lib/hdrState';
import { inspectHdrHeader, checkHdrDimensions } from '@/lib/hdr';
import { useCharacter } from '@/lib/store';

/**
 * Bakes either a user-uploaded `.hdr`/`.exr` equirectangular panorama or a
 * procedural `createEnvironmentScene(envMode)` cubemap once on change via
 * `PMREMGenerator` and binds it to `scene.environment` (~0 ms/frame runtime).
 */
export function EnvironmentRig() {
  const { gl, scene } = useThree();
  const envMode = useCharacter((s) => s.envMode);
  const envRotation = useCharacter((s) => s.envRotation);
  const envIntensity = useCharacter((s) => s.envIntensity);
  const hdrSource = useHdr((s) => s.source);
  const [customReady, setCustomReady] = useState(false);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    let envTarget: THREE.WebGLRenderTarget | undefined;
    let texture: THREE.DataTexture | undefined;
    let envScene: THREE.Scene | undefined;
    let ready = false;
    try {
      if (hdrSource) {
        inspectHdrHeader(hdrSource.buffer, hdrSource.format);
        const loader = hdrSource.format === 'hdr' ? new HDRLoader() : new EXRLoader();
        texture = loader.createDataTexture(hdrSource.buffer);
        checkHdrDimensions(texture.image.width, texture.image.height);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        envTarget = pmrem.fromEquirectangular(texture);
        ready = true;
        useHdr.setState({ status: 'ready', error: null });
      }
    } catch (error) {
      useHdr.setState({
        status: 'error',
        error:
          error instanceof Error
            ? error.message
            : 'Could not decode this HDRI. Try a standard equirectangular HDR panorama.',
      });
    } finally {
      texture?.dispose();
    }
    try {
      if (!envTarget) {
        envScene = createEnvironmentScene(envMode);
        envTarget = pmrem.fromScene(envScene, 0.04);
      }
      scene.environment = envTarget.texture;
      setCustomReady(ready);
    } finally {
      pmrem.dispose();
      envScene?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            material.dispose();
          }
        }
      });
    }
    const owned = envTarget;
    return () => {
      if (scene.environment === owned?.texture) scene.environment = null;
      owned?.dispose();
    };
  }, [gl, scene, envMode, hdrSource]);

  useEffect(() => {
    scene.environmentIntensity =
      (customReady ? 1 : ENV_CONFIG[envMode].baseIntensity) * envIntensity;
  }, [scene, envMode, envIntensity, customReady]);

  useEffect(() => {
    if (!scene.environmentRotation) {
      scene.environmentRotation = new THREE.Euler(0, 0, 0);
    }
    scene.environmentRotation.set(0, THREE.MathUtils.degToRad(envRotation), 0);
  }, [scene, envRotation]);

  return null;
}
