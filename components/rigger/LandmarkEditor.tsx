'use client';

import * as THREE from 'three';
import { useMemo, useRef, useState, useCallback } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useRiggerStore } from '@/lib/rigger/store';
import { fitSkeletonToLandmarks } from '@/lib/rigger/templateFitter';
import type { LandmarkId, LandmarkMap } from '@/lib/rigger/vrmSkeleton';
import { LANDMARK_IDS, VRM_BONE_DEFS } from '@/lib/rigger/vrmSkeleton';

// ── Landmark metadata ────────────────────────────────────────────────────────

export const LANDMARK_META: Record<LandmarkId, { label: string; emoji: string; color: string }> = {
  headTop:       { label: 'Crown',          emoji: '👑', color: '#FFD700' },
  neckBase:      { label: 'Neck Base',      emoji: '🔵', color: '#FFA500' },
  leftShoulder:  { label: 'L. Shoulder',    emoji: '🔵', color: '#00BFFF' },
  rightShoulder: { label: 'R. Shoulder',    emoji: '🔵', color: '#FF6347' },
  leftHip:       { label: 'L. Hip',         emoji: '🔵', color: '#32CD32' },
  rightHip:      { label: 'R. Hip',         emoji: '🔵', color: '#FF69B4' },
  leftAnkle:     { label: 'L. Ankle',       emoji: '🔵', color: '#00FA9A' },
  rightAnkle:    { label: 'R. Ankle',       emoji: '🔵', color: '#FF4500' },
};

/* `LANDMARK_IDS` now comes from vrmSkeleton.ts — three copies of this list
   meant three places for the placement order to drift. */

const REGION_COLORS: Record<string, string> = {
  spine: '#ffffff', head: '#ffd700',
  leftArm: '#00bfff', rightArm: '#ff8c00',
  leftLeg: '#00c800', rightLeg: '#c8ff00',
  leftFinger: '#888888', rightFinger: '#888888',
};

function regionColor(boneName: string): string {
  const def = VRM_BONE_DEFS.find((d) => d.name === boneName);
  return REGION_COLORS[def?.region ?? ''] ?? '#ffffff';
}

// ── Live skeleton preview (computed from current landmarks) ──────────────────

function LiveSkeletonPreview({ landmarks }: { landmarks: Partial<LandmarkMap> }) {
  const count = Object.keys(landmarks).length;
  if (count < 2) return null;

  // Need at minimum headTop + leftAnkle or rightAnkle to draw something useful
  const preview = useMemo(() => {
    try {
      const full = { ...landmarks } as LandmarkMap;
      // Fill missing with rough guesses from existing so fitSkeleton doesn't crash
      const knownKeys = Object.keys(landmarks) as LandmarkId[];
      if (knownKeys.length < 8) {
        const refH = (landmarks.headTop?.y ?? 1.7);
        const refY = (landmarks.leftAnkle?.y ?? landmarks.rightAnkle?.y ?? 0);
        const refX = (landmarks.leftShoulder?.x ?? -(landmarks.rightShoulder?.x ?? 0.2));
        const height = refH - refY;
        if (!landmarks.headTop)       full.headTop       = new THREE.Vector3(0, refH, 0);
        if (!landmarks.neckBase)      full.neckBase      = new THREE.Vector3(0, refH - height * 0.1, 0);
        if (!landmarks.leftShoulder)  full.leftShoulder  = new THREE.Vector3(-0.2, refH - height * 0.15, 0);
        if (!landmarks.rightShoulder) full.rightShoulder = new THREE.Vector3(0.2, refH - height * 0.15, 0);
        if (!landmarks.leftHip)       full.leftHip       = new THREE.Vector3(refX * 0.5, refH * 0.52, 0);
        if (!landmarks.rightHip)      full.rightHip      = new THREE.Vector3(-refX * 0.5, refH * 0.52, 0);
        if (!landmarks.leftAnkle)     full.leftAnkle     = new THREE.Vector3(refX * 0.4, refY, 0);
        if (!landmarks.rightAnkle)    full.rightAnkle    = new THREE.Vector3(-refX * 0.4, refY, 0);
      }
      return fitSkeletonToLandmarks(full, { requiredOnly: true });
    } catch {
      return null;
    }
  }, [landmarks, count]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!preview) return null;

  const { bones } = preview.built;
  const worldPositions = preview.worldPositions;

  const segments: Array<{ key: string; start: THREE.Vector3; end: THREE.Vector3; color: string }> = [];
  for (const bone of bones) {
    const parent = bone.parent;
    if (!parent || !(parent instanceof THREE.Bone)) continue;
    const startPos = worldPositions.get(bone.name as Parameters<typeof worldPositions.get>[0]);
    const endPos   = worldPositions.get(parent.name as Parameters<typeof worldPositions.get>[0]);
    if (!startPos || !endPos) continue;
    segments.push({ key: bone.name, start: startPos, end: endPos, color: regionColor(bone.name) });
  }

  const joints: Array<{ key: string; pos: THREE.Vector3; color: string }> = [];
  for (const bone of bones) {
    const pos = worldPositions.get(bone.name as Parameters<typeof worldPositions.get>[0]);
    if (!pos) continue;
    joints.push({ key: bone.name, pos, color: regionColor(bone.name) });
  }

  return (
    <group>
      {segments.map(({ key, start, end, color }) => (
        <Line key={key} points={[start, end]} color={color} lineWidth={1.5} opacity={0.6} transparent />
      ))}
      {joints.map(({ key, pos, color }) => (
        <mesh key={key} position={pos}>
          <sphereGeometry args={[0.009, 6, 6]} />
          <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

// ── Single draggable Mixamo-style handle ─────────────────────────────────────

interface HandleProps {
  id: LandmarkId;
  position: THREE.Vector3;
  targetMeshRef: React.RefObject<THREE.Mesh | null>;
  isActive: boolean;
}

function LandmarkHandle({ id, position, targetMeshRef, isActive }: HandleProps) {
  const setLandmark           = useRiggerStore((s) => s.setLandmark);
  const setActiveLandmark     = useRiggerStore((s) => s.setActiveLandmark);
  const setIsDraggingLandmark = useRiggerStore((s) => s.setIsDraggingLandmark);
  const { camera, gl, raycaster } = useThree();

  const meshRef  = useRef<THREE.Mesh>(null);
  const dragging = useRef(false);
  const dragPlane = useRef<THREE.Plane | null>(null);
  const [hovered, setHovered] = useState(false);

  const { color, label } = LANDMARK_META[id];
  const radius = isActive ? 0.038 : hovered ? 0.034 : 0.028;

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      dragging.current = true;
      dragPlane.current = null; // rebuilt for the current camera angle
      setIsDraggingLandmark(true);
      try {
        gl.domElement.setPointerCapture(e.pointerId);
      } catch {}
      setActiveLandmark(null); // deselect once we start dragging
    },
    [gl.domElement, setActiveLandmark, setIsDraggingLandmark],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();
      const mesh = targetMeshRef.current;
      if (!mesh) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(mesh, true);
      if (hits.length > 0) {
        setLandmark(id, hits[0].point.clone());
        return;
      }
      /* Off the silhouette: project onto a camera-facing plane through the
         marker instead of freezing. Hips and shoulders are interior joints, so
         surface-only dragging made them impossible to place correctly. */
      const plane = dragPlane.current ?? new THREE.Plane();
      if (!dragPlane.current) {
        camera.getWorldDirection(plane.normal);
        plane.setFromNormalAndCoplanarPoint(plane.normal, position);
        dragPlane.current = plane;
      }
      const target = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, target)) {
        setLandmark(id, target);
      }
    },
    [camera, gl, id, raycaster, setLandmark, targetMeshRef],
  );

  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      dragging.current = false;
      setIsDraggingLandmark(false);
      try {
        gl.domElement.releasePointerCapture(e.pointerId);
      } catch {}
    },
    [gl.domElement, setIsDraggingLandmark],
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
      <sphereGeometry args={[radius, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={isActive ? 2.5 : hovered ? 1.8 : 0.9}
        roughness={0.1}
        metalness={0.2}
        transparent
        opacity={isActive ? 1 : 0.9}
      />
      {/* Outer ring for active landmark */}
      {isActive && (
        <mesh>
          <torusGeometry args={[0.052, 0.006, 8, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} depthTest={false} />
        </mesh>
      )}
      {/* Always-visible label */}
      <Html
        center
        position={[0, radius + 0.04, 0]}
        style={{
          pointerEvents: 'none',
          userSelect: 'none',
          background: isActive ? color : 'rgba(0,0,0,0.75)',
          color: isActive ? '#000' : '#fff',
          padding: '2px 7px',
          borderRadius: 20,
          fontSize: 10,
          whiteSpace: 'nowrap',
          fontFamily: 'system-ui, sans-serif',
          fontWeight: isActive ? 700 : 500,
          border: `1px solid ${color}`,
          boxShadow: isActive ? `0 0 8px ${color}` : 'none',
          transition: 'all 0.15s',
        }}
      >
        {label}
      </Html>
    </mesh>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface LandmarkEditorProps {
  targetMeshRef: React.RefObject<THREE.Mesh | null>;
  showLivePreview: boolean;
}

export function LandmarkEditor({ targetMeshRef, showLivePreview }: LandmarkEditorProps) {
  const landmarks      = useRiggerStore((s) => s.landmarks);
  const activeLandmark = useRiggerStore((s) => s.activeLandmark);

  return (
    <group>
      {/* Live skeleton preview — updates as landmarks are placed/dragged */}
      {showLivePreview && Object.keys(landmarks).length >= 2 && (
        <LiveSkeletonPreview landmarks={landmarks} />
      )}

      {/* Placed landmark handles */}
      {LANDMARK_IDS.map((id) => {
        const pos = landmarks[id];
        if (!pos) return null;
        return (
          <LandmarkHandle
            key={id}
            id={id}
            position={pos}
            targetMeshRef={targetMeshRef}
            isActive={activeLandmark === id}
          />
        );
      })}
    </group>
  );
}
