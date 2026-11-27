'use client';

import { useMemo } from 'react';
import { Grid } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

interface RoomGridProps {
  gridSize: 0.5 | 1.0;
  visible: boolean;
  onPointerMoveFloor?: (pt: THREE.Vector3) => void;
  onClickFloor?: (pt: THREE.Vector3, e: ThreeEvent<MouseEvent>) => void;
  onContextMenuFloor?: (e: ThreeEvent<MouseEvent>) => void;
}

/**
 * Ground shadow receiver, warm Wuxia architectural grid lines, and invisible
 * XZ raycast target at `y = 0` for snapping walls & furniture.
 */
export function RoomGrid({
  gridSize,
  visible,
  onPointerMoveFloor,
  onClickFloor,
  onContextMenuFloor,
}: RoomGridProps) {
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
      {/* Subtle dark matte studio base plane below floor tiles */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.105, 0]}
        material={groundMat}
        receiveShadow
      >
        <planeGeometry args={[36, 36]} />
      </mesh>

      {/* Architectural grid overlay at y = 0.001 */}
      {visible && (
        <Grid
          position={[0, 0.002, 0]}
          args={[16, 16]}
          cellSize={gridSize}
          cellThickness={0.55}
          cellColor="#6e6556"
          sectionSize={2.0}
          sectionThickness={1.0}
          sectionColor="#d4b483"
          fadeDistance={18}
          fadeStrength={1.6}
          infiniteGrid={false}
        />
      )}

      {/* Invisible raycast target plane at y = 0 for click/hover placement */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
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
        <planeGeometry args={[28, 28]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
