'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { FLOOR_SLAB_TOP, useBuilderStore, type PlacedItem } from '@/lib/builderStore';
import { hydrateBuilderSession } from '@/lib/builderSession';
import { TimeOfDayLighting } from '@/components/builder/RoomLifeController';

const FLOOR_Y = -1.476;
const _headPos = new THREE.Vector3(0, 0, 0);
const _camDir = new THREE.Vector3();
const _wallWorld = new THREE.Vector3();
const _toWall = new THREE.Vector3();

function StaticRoomItem({
  item,
  occlusionCheck,
}: {
  item: PlacedItem;
  occlusionCheck: boolean;
}) {
  const gltf = useGLTF(item.assetPath);
  const groupRef = useRef<THREE.Group>(null);

  const cloned = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = item.type !== 'floor';
        node.receiveShadow = true;
      }
    });
    return c;
  }, [gltf.scene, item.type]);

  // Hide any solid wall or prop standing directly between the Studio camera and character.
  useFrame(({ camera }) => {
    const grp = groupRef.current;
    if (!grp) return;
    if (!occlusionCheck) {
      if (!grp.visible) grp.visible = true;
      return;
    }

    _camDir.subVectors(camera.position, _headPos);
    const camDist = _camDir.length();
    if (camDist < 0.25) {
      grp.visible = true;
      return;
    }
    _camDir.divideScalar(camDist);

    if (item.type === 'wall') {
      const rad = THREE.MathUtils.degToRad(item.rotation);
      const midOffX = item.scale[0] * 0.5 * Math.cos(rad);
      const midOffZ = -item.scale[0] * 0.5 * Math.sin(rad);
      _wallWorld.set(item.position[0] + midOffX, 1.1, item.position[2] + midOffZ);
    } else {
      _wallWorld.set(item.position[0], item.position[1] + 0.5, item.position[2]);
    }
    if (grp.parent) {
      grp.parent.localToWorld(_wallWorld);
    }

    _toWall.subVectors(_wallWorld, _headPos);
    const along = _toWall.dot(_camDir);
    if (along > 0.15 && along < camDist - 0.1) {
      const perpSq = Math.max(0, _toWall.lengthSq() - along * along);
      const clearRadius = item.type === 'wall' ? 1.85 : 1.15;
      grp.visible = perpSq > clearRadius * clearRadius;
    } else {
      grp.visible = true;
    }
  });

  return (
    <group
      ref={groupRef}
      position={item.position}
      rotation={[0, THREE.MathUtils.degToRad(item.rotation), 0]}
      scale={item.scale}
    >
      <primitive object={cloned} />
    </group>
  );
}

/**
 * Mounts the live Room Builder environment inside `CharacterScene` centered and oriented
 * around the character's current room `playerPos` and `playerYaw` so looking at her front
 * displays the furnished room behind her.
 */
export function RoomStage() {
  const placedItems = useBuilderStore((s) => s.placedItems);
  const playerPos = useBuilderStore((s) => s.playerPos);
  const playerYaw = useBuilderStore((s) => s.playerYaw);

  useEffect(() => {
    hydrateBuilderSession();
  }, []);

  return (
    <group name="UnifiedRoomStage">
      <TimeOfDayLighting intensityScale={0.42} />
      <group rotation={[0, -playerYaw, 0]}>
        <group position={[-playerPos[0], FLOOR_Y - FLOOR_SLAB_TOP, -playerPos[2]]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.105, 0]} receiveShadow>
            <planeGeometry args={[36, 36]} />
            <meshStandardMaterial color="#252831" roughness={0.92} metalness={0.04} />
          </mesh>
          <Suspense fallback={null}>
            {placedItems.map((item) => (
              <StaticRoomItem
                key={item.id}
                item={item}
                occlusionCheck={item.type === 'wall' || (item.type === 'prop' && !item.noCollide)}
              />
            ))}
          </Suspense>
        </group>
      </group>
    </group>
  );
}
