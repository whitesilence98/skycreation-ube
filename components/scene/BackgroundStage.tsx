'use client';

import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { BackgroundMode } from '@/lib/backgrounds';

/** Character foot level: Skyrim female feet rest at y ≈ -1.476m. */
const FLOOR_Y = -1.476;

interface BackgroundStageProps {
  mode: BackgroundMode;
  customUrl?: string | null;
}

/* ──────────────────────────────────────────────────────────────────────────
   1. SHOWROOM PODIUM & CYCLORAMA STAGE
   ────────────────────────────────────────────────────────────────────────── */
function ShowroomPodium() {
  const podiumGeo = useMemo(() => new THREE.CylinderGeometry(1.35, 1.45, 0.12, 64), []);
  const rimGeo = useMemo(() => new THREE.TorusGeometry(1.36, 0.015, 16, 64), []);
  const floorGeo = useMemo(() => new THREE.PlaneGeometry(16, 16), []);
  const cycGeo = useMemo(() => {
    const geo = new THREE.CylinderGeometry(6.5, 6.5, 6, 48, 1, true, -Math.PI * 0.5, Math.PI);
    return geo;
  }, []);

  const stoneMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1c22',
        roughness: 0.38,
        metalness: 0.15,
      }),
    [],
  );

  const goldRimMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#d4b47a',
        roughness: 0.28,
        metalness: 0.85,
      }),
    [],
  );

  const shadowFloorMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#101216',
        roughness: 0.85,
        metalness: 0.05,
      }),
    [],
  );

  const cycMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#0e1014',
        roughness: 0.95,
        metalness: 0.0,
        side: THREE.BackSide,
      }),
    [],
  );

  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* Central Pedestal Top at exactly FLOOR_Y */}
      <mesh
        geometry={podiumGeo}
        material={stoneMat}
        position={[0, -0.06, 0]}
        receiveShadow
        castShadow
      />
      {/* Decorative Gold Rim */}
      <mesh
        geometry={rimGeo}
        material={goldRimMat}
        position={[0, 0, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      {/* Wide Floor Area */}
      <mesh
        geometry={floorGeo}
        material={shadowFloorMat}
        position={[0, -0.12, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      />
      {/* Curved Cyclorama Backdrop */}
      <mesh geometry={cycGeo} material={cycMat} position={[0, 1.8, 0]} receiveShadow />
    </group>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   2. SKYRIM NORDIC TAVERN CHAMBER
   ────────────────────────────────────────────────────────────────────────── */
function NordicTavern() {
  const leftSconceRef = useRef<THREE.PointLight>(null);
  const rightSconceRef = useRef<THREE.PointLight>(null);

  // Gentle firelight flicker
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 8;
    if (leftSconceRef.current) {
      leftSconceRef.current.intensity = 0.85 + Math.sin(t * 1.3) * 0.12 + Math.cos(t * 2.7) * 0.08;
    }
    if (rightSconceRef.current) {
      rightSconceRef.current.intensity = 0.85 + Math.sin(t * 1.7 + 1.2) * 0.14 + Math.cos(t * 2.1) * 0.07;
    }
  });

  const plankGeos = useMemo(() => {
    const geos: THREE.BoxGeometry[] = [];
    for (let i = -6; i <= 6; i++) {
      geos.push(new THREE.BoxGeometry(0.38, 0.04, 8));
    }
    return geos;
  }, []);

  const woodMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#422c1d',
        roughness: 0.82,
        metalness: 0.05,
      }),
    [],
  );

  const stoneWallMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2a2826',
        roughness: 0.92,
        metalness: 0.02,
      }),
    [],
  );

  const timberMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#342216',
        roughness: 0.78,
        metalness: 0.04,
      }),
    [],
  );

  const ironMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1918',
        roughness: 0.45,
        metalness: 0.75,
      }),
    [],
  );

  const fireMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffaa44',
      }),
    [],
  );

  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* Floor: Rustic wood planks */}
      <group position={[0, -0.02, 0]}>
        {plankGeos.map((geo, i) => (
          <mesh
            key={`plank-${i}`}
            geometry={geo}
            material={woodMat}
            position={[(i - 6) * 0.4, 0, 0]}
            receiveShadow
          />
        ))}
      </group>

      {/* Back Wall: Stone lower half + timber logs */}
      <mesh
        geometry={new THREE.BoxGeometry(10, 1.2, 0.3)}
        material={stoneWallMat}
        position={[0, 0.6, -2.4]}
        receiveShadow
      />
      <mesh
        geometry={new THREE.BoxGeometry(10, 2.8, 0.3)}
        material={timberMat}
        position={[0, 2.6, -2.4]}
        receiveShadow
      />

      {/* Vertical Timber Pillar Posts */}
      <mesh
        geometry={new THREE.BoxGeometry(0.4, 4.2, 0.4)}
        material={timberMat}
        position={[-2.2, 2.1, -2.2]}
        receiveShadow
        castShadow
      />
      <mesh
        geometry={new THREE.BoxGeometry(0.4, 4.2, 0.4)}
        material={timberMat}
        position={[2.2, 2.1, -2.2]}
        receiveShadow
        castShadow
      />

      {/* Horizontal Cross-Beam */}
      <mesh
        geometry={new THREE.BoxGeometry(5.2, 0.35, 0.4)}
        material={timberMat}
        position={[0, 3.4, -2.2]}
        receiveShadow
        castShadow
      />

      {/* Left Wall Torch Sconce */}
      <group position={[-1.4, 1.6, -2.2]}>
        <mesh geometry={new THREE.CylinderGeometry(0.02, 0.02, 0.3)} material={ironMat} />
        <mesh geometry={new THREE.SphereGeometry(0.04, 16, 16)} material={fireMat} position={[0, 0.16, 0.04]} />
        <pointLight
          ref={leftSconceRef}
          color="#ff7f24"
          intensity={0.85}
          distance={4.5}
          decay={2}
          position={[0, 0.2, 0.08]}
        />
      </group>

      {/* Right Wall Torch Sconce */}
      <group position={[1.4, 1.6, -2.2]}>
        <mesh geometry={new THREE.CylinderGeometry(0.02, 0.02, 0.3)} material={ironMat} />
        <mesh geometry={new THREE.SphereGeometry(0.04, 16, 16)} material={fireMat} position={[0, 0.16, 0.04]} />
        <pointLight
          ref={rightSconceRef}
          color="#ff7f24"
          intensity={0.85}
          distance={4.5}
          decay={2}
          position={[0, 0.2, 0.08]}
        />
      </group>
    </group>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   3. SKYRIM ANCIENT RUINS & RUNIC SANCTUARY
   ────────────────────────────────────────────────────────────────────────── */
function AncientRuins() {
  const runeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a2228',
        emissive: '#1ce0d8',
        emissiveIntensity: 0.65,
        roughness: 0.5,
      }),
    [],
  );

  const stoneMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#242a30',
        roughness: 0.88,
        metalness: 0.05,
      }),
    [],
  );

  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* Stone Flagstone Floor */}
      <mesh
        geometry={new THREE.CylinderGeometry(4.5, 4.8, 0.1, 8)}
        material={stoneMat}
        position={[0, -0.05, 0]}
        receiveShadow
      />

      {/* Left Carved Nordic Monolith */}
      <group position={[-1.8, 1.4, -1.6]} rotation={[0, 0.35, 0]}>
        <mesh
          geometry={new THREE.BoxGeometry(0.45, 3.2, 0.55)}
          material={stoneMat}
          receiveShadow
          castShadow
        />
        <mesh
          geometry={new THREE.BoxGeometry(0.08, 2.0, 0.56)}
          material={runeMat}
          position={[0, 0, 0]}
        />
      </group>

      {/* Right Carved Nordic Monolith */}
      <group position={[1.8, 1.4, -1.6]} rotation={[0, -0.35, 0]}>
        <mesh
          geometry={new THREE.BoxGeometry(0.45, 3.2, 0.55)}
          material={stoneMat}
          receiveShadow
          castShadow
        />
        <mesh
          geometry={new THREE.BoxGeometry(0.08, 2.0, 0.56)}
          material={runeMat}
          position={[0, 0, 0]}
        />
      </group>

      {/* Distant Archway */}
      <mesh
        geometry={new THREE.TorusGeometry(3.2, 0.35, 12, 32, Math.PI)}
        material={stoneMat}
        position={[0, 1.5, -3.2]}
        rotation={[0, 0, 0]}
        receiveShadow
      />
    </group>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   4. SKYRIM AURORA BOREALIS & NIGHT SKY
   ────────────────────────────────────────────────────────────────────────── */
function AuroraSky() {
  const auroraMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vWorldPosition;

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float y = dir.y;

          // Deep twilight night sky gradient
          vec3 skyColor = mix(vec3(0.02, 0.03, 0.06), vec3(0.005, 0.008, 0.015), clamp(y * 1.5, 0.0, 1.0));

          // Aurora ribbons in upper sky (y > 0.15)
          if (y > 0.12) {
            float wave = sin(dir.x * 4.0 + uTime * 0.4) * cos(dir.z * 3.5 + uTime * 0.3);
            float ribbon = smoothstep(0.2, 0.45, y + wave * 0.08) * smoothstep(0.75, 0.4, y + wave * 0.08);

            // Emerald green to mystic violet gradient
            vec3 auroraGreen = vec3(0.18, 0.95, 0.58);
            vec3 auroraViolet = vec3(0.65, 0.25, 0.95);
            vec3 auroraColor = mix(auroraGreen, auroraViolet, sin(dir.x * 2.0 + uTime * 0.2) * 0.5 + 0.5);

            skyColor += auroraColor * ribbon * 0.65;
          }

          // Subtle stars
          float starNoise = fract(sin(dot(dir.xz, vec2(12.9898, 78.233))) * 43758.5453);
          if (starNoise > 0.994 && y > 0.1) {
            skyColor += vec3(0.85, 0.92, 1.0) * (starNoise - 0.994) * 160.0;
          }

          gl_FragColor = vec4(skyColor, 1.0);
        }
      `,
    });
  }, []);

  useFrame(({ clock }) => {
    auroraMat.uniforms.uTime.value = clock.getElapsedTime();
  });

  const groundGeo = useMemo(() => new THREE.CircleGeometry(16, 32), []);
  const groundMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#15191f',
        roughness: 0.9,
        metalness: 0.05,
      }),
    [],
  );

  return (
    <group>
      {/* Sky Sphere */}
      <mesh geometry={new THREE.SphereGeometry(30, 32, 32)} material={auroraMat} />
      {/* Tundra Ground Floor */}
      <mesh
        geometry={groundGeo}
        material={groundMat}
        position={[0, FLOOR_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      />
    </group>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   5. CUSTOM 3D GLB MODEL SCENE
   ────────────────────────────────────────────────────────────────────────── */
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

    // Check for an explicit spawn marker from Blender (`CharacterSpawn` / `PlayerSpawn`)
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

/* ──────────────────────────────────────────────────────────────────────────
   MAIN STAGE ROUTER
   ────────────────────────────────────────────────────────────────────────── */
/**
 * The reference stage: a bright radial pool behind the character falling off
 * to a near-black vignette at the frame edges.
 *
 * Values are sampled from the 1920x1080 reference, not guessed — centre
 * ~#d2d3d8, mid ~#8f9199, corners ~#121216. It renders as a full-screen quad
 * behind everything, so it costs one draw call and no geometry.
 */
function StudioPool() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uCentre: { value: new THREE.Color('#d6d7dc') },
      uMid: { value: new THREE.Color('#90939c') },
      uEdge: { value: new THREE.Color('#121216') },
      uFocus: { value: new THREE.Vector2(0.52, 0.47) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.999, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uCentre;
      uniform vec3 uMid;
      uniform vec3 uEdge;
      uniform vec2 uFocus;
      varying vec2 vUv;
      void main() {
        /* Elliptical falloff, wider than tall so the pool hugs a standing
           figure rather than reading as a spotlight circle. */
        vec2 d = (vUv - uFocus) * vec2(1.05, 1.45);
        float r = length(d);
        float core = smoothstep(0.52, 0.04, r);
        float halo = smoothstep(1.05, 0.30, r);
        vec3 colour = mix(uEdge, uMid, halo);
        colour = mix(colour, uCentre, core * 0.92);
        gl_FragColor = vec4(colour, 1.0);
      }
    `,
  }), []);
  const shadowGeo = useMemo(() => new THREE.CircleGeometry(3.2, 48), []);
  const shadowMat = useMemo(
    () => new THREE.ShadowMaterial({ transparent: true, opacity: 0.34, color: new THREE.Color('#0a0b10') }),
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

  // Manage fog & clear color per mode
  useMemo(() => {
    if (mode === 'void') {
      scene.fog = null;
    } else if (mode === 'ancient-ruins') {
      scene.fog = new THREE.FogExp2('#0e1318', 0.12);
    } else if (mode === 'nordic-tavern') {
      scene.fog = new THREE.FogExp2('#14100c', 0.08);
    } else {
      scene.fog = null;
    }
  }, [mode, scene]);

  if (mode === 'void') {
    /* The pool is the backdrop; no <color> attachment, or it would paint over
       the quad's edges and turn the vignette flat black again. */
    return <StudioPool />;
  }

  return (
    <group name="BackgroundStage">
      {mode === 'studio-podium' && <ShowroomPodium />}
      {mode === 'nordic-tavern' && <NordicTavern />}
      {mode === 'ancient-ruins' && <AncientRuins />}
      {mode === 'aurora-sky' && <AuroraSky />}
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
