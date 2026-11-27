'use client';

import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { Html, useGLTF } from '@react-three/drei';
import { BUILDER_CATALOG_BY_ID } from '@/lib/builderCatalog';
import { KENNEY_UNIT_SCALE, type PlacedItem, type PlacedItemType } from '@/lib/builderStore';

function HologramMesh({
  assetPath,
  itemType,
  scale,
  showWireBox = true,
  promptLabel,
}: {
  assetPath: string;
  itemType: PlacedItemType;
  scale: [number, number, number];
  showWireBox?: boolean;
  promptLabel?: string;
}) {
  const gltf = useGLTF(assetPath);

  const { holoScene, localOffset, boxSize, boxCenter } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    const holoMat = new THREE.MeshStandardMaterial({
      color: '#4ad5ff',
      emissive: '#3ad0ff',
      emissiveIntensity: 0.72,
      roughness: 0.35,
      metalness: 0.1,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    });

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = holoMat;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    let ox = 0;
    let oy = -box.min.y;
    let oz = 0;
    if (itemType === 'floor') {
      oy = -box.max.y;
    } else if (itemType === 'prop') {
      ox = -center.x;
      oz = -center.z;
    }

    return {
      holoScene: clone,
      localOffset: [ox, oy, oz] as [number, number, number],
      boxSize: size,
      boxCenter:
        itemType === 'prop'
          ? new THREE.Vector3(0, size.y * 0.5, 0)
          : new THREE.Vector3(center.x + ox, size.y * 0.5, center.z + oz),
    };
  }, [gltf.scene, itemType]);

  return (
    <group>
      <group scale={scale}>
        <primitive object={holoScene} position={localOffset} />
        {showWireBox && (
          <>
            <mesh position={boxCenter}>
              <boxGeometry args={[boxSize.x + 0.02, boxSize.y + 0.02, boxSize.z + 0.02]} />
              <meshBasicMaterial color="#b3f2ff" wireframe transparent opacity={0.85} />
            </mesh>
            {/* Subtle 4-way ground placement chevrons matching reference hologram */}
            {[
              { pos: [boxSize.x * 0.5 + 0.14, 0.02, 0] as [number, number, number], rot: -Math.PI / 2 },
              { pos: [-boxSize.x * 0.5 - 0.14, 0.02, 0] as [number, number, number], rot: Math.PI / 2 },
              { pos: [0, 0.02, boxSize.z * 0.5 + 0.14] as [number, number, number], rot: Math.PI },
              { pos: [0, 0.02, -boxSize.z * 0.5 - 0.14] as [number, number, number], rot: 0 },
            ].map((arr, idx) => (
              <mesh
                key={idx}
                position={arr.pos}
                rotation={[-Math.PI / 2, 0, arr.rot]}
              >
                <coneGeometry args={[0.045, 0.09, 3]} />
                <meshBasicMaterial color="#dfba73" transparent opacity={0.85} />
              </mesh>
            ))}
          </>
        )}
      </group>
      {promptLabel && (
        <Html
          position={[boxSize.x * scale[0] * 0.45 + 0.35, boxSize.y * scale[1] * 0.55, 0]}
          center
          zIndexRange={[25, 0]}
        >
          <div className="pointer-events-none whitespace-nowrap rounded-[2px] border border-white/25 bg-[#121318]/92 px-2 py-0.5 text-[10px] font-mono tracking-wider text-[#f3efe7] shadow-lg backdrop-blur-sm">
            {promptLabel}
          </div>
        </Html>
      )}
    </group>
  );
}

export function GhostItem({
  catalogId,
  position,
  rotation,
  promptLabel = 'PLACE [L-CLICK]',
}: {
  catalogId: string;
  position: [number, number, number];
  rotation: number;
  promptLabel?: string;
}) {
  const entry = BUILDER_CATALOG_BY_ID[catalogId];
  if (!entry) return null;

  return (
    <group
      position={position}
      rotation={[0, THREE.MathUtils.degToRad(rotation), 0]}
    >
      <Suspense fallback={null}>
        <HologramMesh
          assetPath={entry.path}
          itemType={entry.type}
          scale={[KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE]}
          promptLabel={promptLabel}
        />
      </Suspense>
    </group>
  );
}

export function WallGhostChain({
  segments,
  endPoint,
  lengthMeters,
}: {
  segments: Array<Omit<PlacedItem, 'id'>>;
  endPoint: [number, number, number] | null;
  lengthMeters: number;
}) {
  return (
    <group>
      {segments.map((seg, idx) => (
        <group
          key={`wall-ghost-${idx}`}
          position={seg.position}
          rotation={[0, THREE.MathUtils.degToRad(seg.rotation), 0]}
        >
          <Suspense fallback={null}>
            <HologramMesh
              assetPath={seg.assetPath}
              itemType="wall"
              scale={seg.scale}
              showWireBox={false}
            />
          </Suspense>
        </group>
      ))}
      {endPoint && (
        <Html position={[endPoint[0], 1.7, endPoint[2]]} center zIndexRange={[25, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-[2px] border border-[#3ad0ff]/60 bg-[#121318]/92 px-2 py-0.5 text-[10px] font-mono tracking-wider text-[#a8ecff] shadow-lg">
            {lengthMeters > 0 ? `${lengthMeters.toFixed(1)}m · COMMIT [L-CLICK]` : 'START WALL [L-CLICK]'}
          </div>
        </Html>
      )}
    </group>
  );
}
