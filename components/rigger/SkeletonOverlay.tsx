'use client';

import * as THREE from 'three';
import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { FitResult } from '@/lib/rigger/templateFitter';
import { RIG_BONE_BY_NAME, type RigBoneName } from '@/lib/rigger/vrmSkeleton';

// ── Region → colour map ──────────────────────────────────────────────────────

const REGION_COLORS: Record<string, string> = {
  spine:       '#ffffff',
  head:        '#ffd700',
  leftArm:     '#00bfff',
  rightArm:    '#ff8c00',
  leftLeg:     '#00c800',
  rightLeg:    '#c8ff00',
  leftFinger:  '#888888',
  rightFinger: '#888888',
  secondary:   '#f472b6',
};

function regionColor(boneName: string): string {
  const def = RIG_BONE_BY_NAME[boneName as RigBoneName];
  return REGION_COLORS[def?.region ?? ''] ?? '#ffffff';
}

// ── Props ────────────────────────────────────────────────────────────────────

interface SkeletonOverlayProps {
  fitResult: FitResult;
  visible: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function SkeletonOverlay({ fitResult, visible }: SkeletonOverlayProps) {
  const { bones, boneMap } = fitResult.built;
  const worldPositions = fitResult.worldPositions;

  // Build bone line segments: each bone → its parent
  const segments = useMemo(() => {
    const result: Array<{
      key: string;
      start: THREE.Vector3;
      end: THREE.Vector3;
      color: string;
    }> = [];

    for (const bone of bones) {
      const parent = bone.parent;
      if (!parent || !(parent instanceof THREE.Bone)) continue;

      const startPos = worldPositions.get(bone.name as Parameters<typeof worldPositions.get>[0]);
      const endPos   = worldPositions.get(parent.name as Parameters<typeof worldPositions.get>[0]);

      if (!startPos || !endPos) continue;

      result.push({
        key:   bone.name,
        start: startPos,
        end:   endPos,
        color: regionColor(bone.name),
      });
    }
    return result;
  }, [bones, worldPositions]);

  // Joint positions for spheres
  const joints = useMemo(() => {
    const result: Array<{ key: string; pos: THREE.Vector3; color: string }> = [];
    for (const bone of bones) {
      const pos = worldPositions.get(bone.name as Parameters<typeof worldPositions.get>[0]);
      if (!pos) continue;
      result.push({ key: bone.name, pos, color: regionColor(bone.name) });
    }
    return result;
  }, [bones, worldPositions]);

  if (!visible) return null;

  return (
    <group>
      {/* Bone lines */}
      {segments.map(({ key, start, end, color }) => (
        <Line
          key={key}
          points={[start, end]}
          color={color}
          lineWidth={1.5}
        />
      ))}

      {/* Joint spheres */}
      {joints.map(({ key, pos, color }) => (
        <mesh key={key} position={pos}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}
