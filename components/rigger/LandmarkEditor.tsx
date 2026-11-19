'use client';

import * as THREE from 'three';
import { useRef, useState, useCallback } from 'react';
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useRiggerStore } from '@/lib/rigger/store';
import type { LandmarkId } from '@/lib/rigger/vrmSkeleton';

// ── Colour palette ───────────────────────────────────────────────────────────

const LANDMARK_COLORS: Record<LandmarkId, string> = {
  headTop:       '#FFD700',
  neckBase:      '#FFA500',
  leftShoulder:  '#00BFFF',
  rightShoulder: '#FF6347',
  leftHip:       '#32CD32',
  rightHip:      '#FF69B4',
  leftAnkle:     '#00FA9A',
  rightAnkle:    '#FF4500',
};

const LANDMARK_IDS: LandmarkId[] = [
  'headTop', 'neckBase',
  'leftShoulder', 'rightShoulder',
  'leftHip', 'rightHip',
  'leftAnkle', 'rightAnkle',
];

// ── Single draggable handle ──────────────────────────────────────────────────

interface HandleProps {
  id: LandmarkId;
  position: THREE.Vector3;
  targetMeshRef: React.RefObject<THREE.Mesh | null>;
}

function LandmarkHandle({ id, position, targetMeshRef }: HandleProps) {
  const setLandmark     = useRiggerStore((s) => s.setLandmark);
  const activeLandmark  = useRiggerStore((s) => s.activeLandmark);
  const setActiveLandmark = useRiggerStore((s) => s.setActiveLandmark);
  const { camera, gl, raycaster } = useThree();

  const meshRef   = useRef<THREE.Mesh>(null);
  const dragging  = useRef(false);
  const [hovered, setHovered] = useState(false);

  const color = LANDMARK_COLORS[id];

  // ── Drag via pointer capture ─────────────────────────────────────────────

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      // If this landmark is the active one, deselect and start drag
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      if (activeLandmark === id) setActiveLandmark(null);
    },
    [activeLandmark, id, setActiveLandmark],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();

      // Raycast against the target mesh to snap to surface
      const mesh = targetMeshRef.current;
      if (!mesh) return;

      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length > 0) {
        setLandmark(id, hits[0].point);
      }
    },
    [camera, gl, id, raycaster, setLandmark, targetMeshRef],
  );

  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      dragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [],
  );

  return (
    <mesh
      ref={meshRef}
      position={position}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <sphereGeometry args={[0.025, 12, 12]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={hovered ? 1.5 : 0.6}
        roughness={0.2}
        metalness={0.1}
      />
      {hovered && (
        <Html
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 11,
            whiteSpace: 'nowrap',
            fontFamily: 'monospace',
          }}
        >
          {id}
        </Html>
      )}
    </mesh>
  );
}

// ── Transparent mesh overlay for placement clicks ────────────────────────────

interface PlacementOverlayProps {
  targetMeshRef: React.RefObject<THREE.Mesh | null>;
}

function PlacementOverlay({ targetMeshRef }: PlacementOverlayProps) {
  const activeLandmark    = useRiggerStore((s) => s.activeLandmark);
  const setLandmark       = useRiggerStore((s) => s.setLandmark);
  const setActiveLandmark = useRiggerStore((s) => s.setActiveLandmark);

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!activeLandmark) return;
      e.stopPropagation();
      setLandmark(activeLandmark, e.point);
      setActiveLandmark(null);
    },
    [activeLandmark, setLandmark, setActiveLandmark],
  );

  const mesh = targetMeshRef.current;
  if (!mesh || !activeLandmark) return null;

  // Clone the mesh as a transparent hit-test overlay
  return (
    <primitive
      object={mesh.clone()}
      onPointerDown={onPointerDown}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </primitive>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface LandmarkEditorProps {
  targetMeshRef: React.RefObject<THREE.Mesh | null>;
}

export function LandmarkEditor({ targetMeshRef }: LandmarkEditorProps) {
  const landmarks = useRiggerStore((s) => s.landmarks);

  return (
    <group>
      <PlacementOverlay targetMeshRef={targetMeshRef} />
      {LANDMARK_IDS.map((id) => {
        const pos = landmarks[id];
        if (!pos) return null;
        return (
          <LandmarkHandle
            key={id}
            id={id}
            position={pos}
            targetMeshRef={targetMeshRef}
          />
        );
      })}
    </group>
  );
}
