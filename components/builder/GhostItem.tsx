'use client';

import { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Html, useGLTF } from '@react-three/drei';
import { BUILDER_CATALOG_BY_ID } from '@/lib/builderCatalog';
import { KENNEY_UNIT_SCALE, type PlacedItem, type PlacedItemType } from '@/lib/builderStore';
import { registerCatalogExtent } from '@/lib/builder/footprintRegistry';

function HologramMesh({
  catalogId,
  assetPath,
  itemType,
  scale,
  valid = true,
  invalidReason = null,
  showWireBox = true,
  promptLabel,
}: {
  catalogId: string;
  assetPath: string;
  itemType: PlacedItemType;
  scale: [number, number, number];
  valid?: boolean;
  invalidReason?: string | null;
  showWireBox?: boolean;
  promptLabel?: string;
}) {
  const gltf = useGLTF(assetPath);

  const { holoScene, holoMat, localOffset, boxSize, boxCenter } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    const mat = new THREE.MeshStandardMaterial({
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
        child.material = mat;
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
      holoMat: mat,
      localOffset: [ox, oy, oz] as [number, number, number],
      boxSize: size,
      boxCenter:
        itemType === 'prop'
          ? new THREE.Vector3(0, size.y * 0.5, 0)
          : new THREE.Vector3(center.x + ox, size.y * 0.5, center.z + oz),
    };
  }, [gltf.scene, itemType]);

  // Share measured unscaled GLTF bounds with placementValidator
  useEffect(() => {
    registerCatalogExtent(catalogId, [boxSize.x, boxSize.y, boxSize.z]);
  }, [catalogId, boxSize]);

  // Swap cyan ↔ red hologram colors smoothly without re-cloning geometry
  useEffect(() => {
    holoMat.color.set(valid ? '#4ad5ff' : '#ff3b3b');
    holoMat.emissive.set(valid ? '#3ad0ff' : '#ff2424');
    holoMat.emissiveIntensity = valid ? 0.72 : 0.92;
    holoMat.opacity = valid ? 0.44 : 0.52;
  }, [holoMat, valid]);

  useEffect(() => () => holoMat.dispose(), [holoMat]);

  const badgeText = valid
    ? promptLabel
    : `BLOCKED${invalidReason ? ` · ${invalidReason.toUpperCase()}` : ''}`;

  return (
    <group>
      <group scale={scale}>
        <primitive object={holoScene} position={localOffset} />
        {showWireBox && (
          <>
            <mesh position={boxCenter}>
              <boxGeometry args={[boxSize.x + 0.02, boxSize.y + 0.02, boxSize.z + 0.02]} />
              <meshBasicMaterial
                color={valid ? '#b3f2ff' : '#ff9999'}
                wireframe
                transparent
                opacity={valid ? 0.85 : 0.95}
              />
            </mesh>
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
                <meshBasicMaterial color={valid ? '#dfba73' : '#ff5252'} transparent opacity={0.9} />
              </mesh>
            ))}
          </>
        )}
      </group>
      {badgeText && (
        <Html
          position={[boxSize.x * scale[0] * 0.45 + 0.35, boxSize.y * scale[1] * 0.55, 0]}
          center
          zIndexRange={[25, 0]}
        >
          <div
            className={`pointer-events-none whitespace-nowrap rounded-[2px] border px-2 py-0.5 text-[10px] font-mono tracking-wider shadow-lg backdrop-blur-sm ${
              valid
                ? 'border-white/25 bg-[#121318]/92 text-[#f3efe7]'
                : 'border-[#ff5a5a]/85 bg-[#2a0d0d]/95 text-[#ffd2d2]'
            }`}
          >
            {badgeText}
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
  valid = true,
  invalidReason = null,
  promptLabel = 'PLACE [L-CLICK]',
}: {
  catalogId: string;
  position: [number, number, number];
  rotation: number;
  valid?: boolean;
  invalidReason?: string | null;
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
          catalogId={catalogId}
          assetPath={entry.path}
          itemType={entry.type}
          scale={[KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE]}
          valid={valid}
          invalidReason={invalidReason}
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
  invalidIndices = [],
  invalidReason = null,
}: {
  segments: Array<Omit<PlacedItem, 'id'>>;
  endPoint: [number, number, number] | null;
  lengthMeters: number;
  invalidIndices?: number[];
  invalidReason?: string | null;
}) {
  const invalidSet = useMemo(() => new Set(invalidIndices), [invalidIndices]);
  const allValid = invalidIndices.length === 0;

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
              catalogId={seg.catalogId}
              assetPath={seg.assetPath}
              itemType="wall"
              scale={seg.scale}
              valid={!invalidSet.has(idx)}
              showWireBox={false}
            />
          </Suspense>
        </group>
      ))}
      {endPoint && (
        <Html position={[endPoint[0], 1.7, endPoint[2]]} center zIndexRange={[25, 0]}>
          <div
            className={`pointer-events-none whitespace-nowrap rounded-[2px] border px-2 py-0.5 text-[10px] font-mono tracking-wider shadow-lg ${
              allValid
                ? 'border-[#3ad0ff]/60 bg-[#121318]/92 text-[#a8ecff]'
                : 'border-[#ff5a5a]/85 bg-[#2a0d0d]/95 text-[#ffd2d2]'
            }`}
          >
            {!allValid
              ? `BLOCKED${invalidReason ? ` · ${invalidReason.toUpperCase()}` : ''}`
              : lengthMeters > 0
                ? `${lengthMeters.toFixed(1)}m · COMMIT [L-CLICK]`
                : 'START WALL [L-CLICK]'}
          </div>
        </Html>
      )}
    </group>
  );
}
