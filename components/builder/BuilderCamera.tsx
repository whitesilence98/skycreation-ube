'use client';

import { useEffect, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { BuilderMode } from '@/lib/builderStore';

interface BuilderCameraProps {
  mode: BuilderMode;
  orbitEnabled: boolean;
}

/**
 * Isometric 3/4 Orbit camera for `build` and `decorate` modes.
 * Automatically shifts viewport projection slightly right on desktop viewports (>= 1024px)
 * to keep the room centered beside the left builder panel.
 * In `tour` mode, OrbitControls unmounts so `TourController` owns 3rd-person follow cam.
 */
export function BuilderCamera({ mode, orbitEnabled }: BuilderCameraProps) {
  const { camera, size } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const prevModeRef = useRef<BuilderMode | null>(null);

  // Desktop left-panel projection compensation (300px panel -> -140px viewOffset)
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (mode === 'tour') {
      camera.clearViewOffset();
      camera.fov = 52;
      camera.updateProjectionMatrix();
      return;
    }
    camera.fov = 44;
    const isDesktop = size.width >= 1024;
    if (isDesktop) {
      camera.setViewOffset(size.width, size.height, -145, 0, size.width, size.height);
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    return () => {
      camera.clearViewOffset();
    };
  }, [camera, mode, size.width, size.height]);

  // Reset isometric framing when entering builder or returning from Tour mode
  useEffect(() => {
    if (mode === 'tour') {
      prevModeRef.current = mode;
      return;
    }
    const wasTour = prevModeRef.current === 'tour';
    const isInitial = prevModeRef.current === null;
    prevModeRef.current = mode;

    if (isInitial || wasTour) {
      camera.position.set(5.4, 5.2, 6.4);
      if (controlsRef.current) {
        controlsRef.current.target.set(-0.2, 0.7, -0.2);
        controlsRef.current.update();
      } else {
        camera.lookAt(-0.2, 0.7, -0.2);
      }
    }
  }, [camera, mode]);

  if (mode === 'tour') return null;

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={orbitEnabled}
      enablePan
      enableDamping
      dampingFactor={0.08}
      minDistance={3.2}
      maxDistance={15}
      minPolarAngle={THREE.MathUtils.degToRad(22)}
      maxPolarAngle={THREE.MathUtils.degToRad(74)}
      target={[-0.2, 0.7, -0.2]}
    />
  );
}
