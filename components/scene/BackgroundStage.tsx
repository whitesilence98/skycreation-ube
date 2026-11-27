'use client';

import React, { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { BackgroundMode } from '@/lib/backgrounds';
import { RoomStage } from '@/components/builder/RoomPropsLayer';

/** Character foot level: Skyrim female feet rest at y ≈ -1.476m. */
const FLOOR_Y = -1.476;

interface BackgroundStageProps {
  mode: BackgroundMode;
  customUrl?: string | null;
}

class GlbStageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

function CustomGlbScene({ url }: { url: string }) {
  const gltf = useGLTF(url);

  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.updateMatrixWorld(true);

    const spawnNode =
      clone.getObjectByName('CharacterSpawn') ??
      clone.getObjectByName('PlayerSpawn') ??
      clone.getObjectByName('SpawnPoint');

    if (spawnNode) {
      const sp = new THREE.Vector3();
      spawnNode.getWorldPosition(sp);
      clone.position.set(-sp.x, FLOOR_Y - sp.y, -sp.z);
    } else {
      const box = new THREE.Box3().setFromObject(clone);
      if (Number.isFinite(box.min.y)) {
        clone.position.y += FLOOR_Y - box.min.y;
      }
    }

    clone.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.receiveShadow = true;
        node.castShadow = true;
      }
    });
    return clone;
  }, [gltf.scene]);

  return <primitive object={scene} />;
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

export function BackgroundStage({ mode, customUrl }: BackgroundStageProps) {
  const { scene } = useThree();

  useEffect(() => {
    scene.fog = null;
    if (mode === 'room') {
      scene.background = new THREE.Color('#2b2f3a');
    } else if (mode === 'void') {
      scene.background = null;
    } else {
      scene.background = new THREE.Color('#16181f');
    }
    return () => {
      scene.background = null;
    };
  }, [mode, scene]);

  if (mode === 'void') {
    return <StudioPool />;
  }

  return (
    <group name="BackgroundStage">
      {mode === 'room' && <RoomStage />}
      {mode === 'custom-3d' && customUrl && (
        <GlbStageErrorBoundary>
          <Suspense fallback={null}>
            <CustomGlbScene url={customUrl} />
          </Suspense>
        </GlbStageErrorBoundary>
      )}
    </group>
  );
}
