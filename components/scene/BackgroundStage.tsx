'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { BackgroundMode } from '@/lib/backgrounds';

/** Character foot level: Skyrim female feet rest at y ≈ -1.476m. */
const FLOOR_Y = -1.476;

interface BackgroundStageProps {
  mode: BackgroundMode;
  customUrl?: string | null;
}

/**
 * Clean studio backdrop: bright warm-neutral pool behind the character
 * falling off to dark corners (`#121216`) + subtle shadow catcher on floor.
 */
function StudioPool() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.9999, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          void main() {
            vec2 center = vec2(0.54, 0.56);
            vec2 d = (vUv - center) * vec2(1.15, 1.38);
            float t = clamp(length(d), 0.0, 1.2);
            vec3 core = vec3(0.84, 0.85, 0.87);
            vec3 mid = vec3(0.42, 0.43, 0.47);
            vec3 edge = vec3(0.08, 0.085, 0.10);
            vec3 col = mix(core, mid, smoothstep(0.05, 0.55, t));
            col = mix(col, edge, smoothstep(0.5, 1.05, t));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );

  const shadowGeo = useMemo(() => new THREE.CircleGeometry(1.1, 48), []);
  const shadowMat = useMemo(
    () =>
      new THREE.ShadowMaterial({
        opacity: 0.28,
        transparent: true,
      }),
    [],
  );

  useEffect(() => () => {
    material.dispose();
    shadowGeo.dispose();
    shadowMat.dispose();
  }, [material, shadowGeo, shadowMat]);

  return (
    <group name="StudioPoolStage">
      <mesh renderOrder={-1000} frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
        <primitive object={material} attach="material" />
      </mesh>
      <mesh
        geometry={shadowGeo}
        material={shadowMat}
        position={[0, FLOOR_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      />
    </group>
  );
}

export function BackgroundStage(_props: BackgroundStageProps) {
  const { scene } = useThree();

  useEffect(() => {
    scene.fog = null;
    scene.background = null;
    return () => {
      scene.background = null;
    };
  }, [scene]);

  return <StudioPool />;
}
