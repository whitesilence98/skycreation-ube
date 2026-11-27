'use client';

import { useEffect, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useBuilderStore, type BuilderMode } from '@/lib/builderStore';

interface BuilderCameraProps {
  mode: BuilderMode;
  orbitEnabled: boolean;
}

/**
 * Isometric 3/4 Orbit camera for `build` and `decorate` modes.
 * Scales max orbit distance dynamically with room dimensions so large lofts/villas
 * stay comfortably visible, and shifts projection right for desktop left panel.
 */
export function BuilderCamera({ mode, orbitEnabled }: BuilderCameraProps) {
  const { camera, size } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const prevModeRef = useRef<BuilderMode | null>(null);
  const roomWidth = useBuilderStore((s) => s.roomWidth);
  const roomDepth = useBuilderStore((s) => s.roomDepth);

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
      camera.position.set(7.2, 6.8, 8.4);
      if (controlsRef.current) {
        controlsRef.current.target.set(-0.2, 0.7, -0.2);
        controlsRef.current.update();
      } else {
        camera.lookAt(-0.2, 0.7, -0.2);
      }
    }
  }, [camera, mode]);

  if (mode === 'tour') return null;

  const maxOrbitDist = Math.max(20, Math.max(roomWidth, roomDepth) * 1.65);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={orbitEnabled}
      enablePan
      enableDamping
      dampingFactor={0.08}
      minDistance={3.2}
      maxDistance={maxOrbitDist}
      minPolarAngle={THREE.MathUtils.degToRad(22)}
      maxPolarAngle={THREE.MathUtils.degToRad(74)}
      target={[-0.2, 0.7, -0.2]}
    />
  );
}
