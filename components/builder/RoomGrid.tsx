'use client';

import { useMemo } from 'react';
import { Grid } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useBuilderStore } from '@/lib/builderStore';

interface RoomGridProps {
  gridSize: 0.5 | 1.0;
  visible: boolean;
  onPointerMoveFloor?: (pt: THREE.Vector3) => void;
  onClickFloor?: (pt: THREE.Vector3, e: ThreeEvent<MouseEvent>) => void;
  onContextMenuFloor?: (e: ThreeEvent<MouseEvent>) => void;
}

/**
 * Ground shadow receiver, warm Wuxia architectural grid lines, and invisible
 * XZ raycast target at `y = 0` that dynamically scales to any expanded room size.
 */
export function RoomGrid({
  gridSize,
  visible,
  onPointerMoveFloor,
  onClickFloor,
  onContextMenuFloor,
}: RoomGridProps) {
  const roomWidth = useBuilderStore((s) => s.roomWidth);
  const roomDepth = useBuilderStore((s) => s.roomDepth);
  const roomBounds = useBuilderStore((s) => s.roomBounds);

  const centerX = (roomBounds.minX + roomBounds.maxX) * 0.5;
  const centerZ = (roomBounds.minZ + roomBounds.maxZ) * 0.5;
  const gridSpan = Math.max(24, roomWidth + 10, roomDepth + 10);

  const groundMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#21242b',
        roughness: 0.92,
        metalness: 0.04,
      }),
    [],
  );

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[centerX, -0.105, centerZ]}
        material={groundMat}
        receiveShadow
      >
        <planeGeometry args={[64, 64]} />
      </mesh>

      {visible && (
        <Grid
          position={[centerX, 0.002, centerZ]}
          args={[gridSpan, gridSpan]}
          cellSize={gridSize}
          cellThickness={0.55}
          cellColor="#6e6556"
          sectionSize={2.0}
          sectionThickness={1.0}
          sectionColor="#d4b483"
          fadeDistance={gridSpan + 6}
          fadeStrength={1.6}
          infiniteGrid={false}
        />
      )}

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[centerX, 0, centerZ]}
        onPointerMove={(e) => {
          onPointerMoveFloor?.(e.point);
        }}
        onClick={(e) => {
          onClickFloor?.(e.point, e);
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          onContextMenuFloor?.(e);
        }}
      >
        <planeGeometry args={[64, 64]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
